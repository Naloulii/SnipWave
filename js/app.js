/**
 * SnipWave Studio - Application Logic
 * Audio Processing, Trimming, MP3 Encoding (LameJS), YouTube & TikTok Extraction, Tab Capture & IndexedDB Storage
 */

// ==========================================
// 1. DATABASE (IndexedDB)
// ==========================================
const DB_NAME = 'SnipWaveDB';
const DB_VERSION = 1;
const STORE_NAME = 'sounds';

let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => {
      console.error('IndexedDB error:', e);
      reject(e);
    };
  });
}

function dbGetAllSounds() {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = (err) => reject(err);
  });
}

function dbSaveSound(sound) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('DB non initialisée'));
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(sound);
    req.onsuccess = () => resolve(sound);
    req.onerror = (err) => reject(err);
  });
}

function dbDeleteSound(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('DB non initialisée'));
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = (err) => reject(err);
  });
}

function dbClearAllSounds() {
  return new Promise((resolve, reject) => {
    if (!db) return reject(new Error('DB non initialisée'));
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = (err) => reject(err);
  });
}

// ==========================================
// 2. AUDIO CONTEXT & PLAYBACK ENGINE
// ==========================================
let audioCtx = null;
let masterGain = null;
let isExclusiveMode = false;
let masterVolume = 1;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const activePlayers = new Map();

function stopSound(soundId) {
  if (activePlayers.has(soundId)) {
    const player = activePlayers.get(soundId);
    try {
      player.source.stop();
    } catch (e) {}
    if (player.timer) clearInterval(player.timer);
    activePlayers.delete(soundId);
    updateCardPlayState(soundId, false, 0);
  }
}

function stopAllSounds() {
  for (const soundId of activePlayers.keys()) {
    stopSound(soundId);
  }
  stopPreview();
}

async function playSound(sound) {
  const ctx = getAudioContext();

  if (isExclusiveMode) {
    stopAllSounds();
  } else if (activePlayers.has(sound.id)) {
    stopSound(sound.id);
    return;
  }

  try {
    let arrayBuffer;
    if (sound.blob instanceof Blob) {
      arrayBuffer = await sound.blob.arrayBuffer();
    } else if (sound.blob instanceof ArrayBuffer) {
      arrayBuffer = sound.blob;
    } else if (typeof sound.blob === 'string' && sound.blob.startsWith('data:')) {
      const res = await fetch(sound.blob);
      arrayBuffer = await res.arrayBuffer();
    } else {
      throw new Error('Données audio invalides');
    }

    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const soundGain = ctx.createGain();
    soundGain.gain.value = sound.volume !== undefined ? sound.volume : 1;

    source.connect(soundGain);
    soundGain.connect(masterGain);

    source.loop = !!sound.loop;

    const startTime = ctx.currentTime;
    const duration = audioBuffer.duration;

    const timer = setInterval(() => {
      const elapsed = ctx.currentTime - startTime;
      let progress = (elapsed % duration) / duration;
      if (!source.loop && elapsed >= duration) {
        progress = 1;
      }
      updateCardPlayState(sound.id, true, progress);
    }, 50);

    source.onended = () => {
      clearInterval(timer);
      if (!source.loop) {
        activePlayers.delete(sound.id);
        updateCardPlayState(sound.id, false, 0);
      }
    };

    source.start(0);

    activePlayers.set(sound.id, {
      source,
      gain: soundGain,
      startTime,
      duration,
      timer
    });

    updateCardPlayState(sound.id, true, 0);
  } catch (err) {
    console.error('Erreur lecture son:', err);
    showToast('Erreur lors de la lecture : ' + err.message, 'error');
  }
}

// ==========================================
// 3. MP3 ENCODER (LameJS Integration)
// ==========================================
function encodeAudioBufferToMp3(audioBuffer, startSec = 0, endSec = null, kbps = 192) {
  return new Promise((resolve, reject) => {
    try {
      if (!window.lamejs || !window.lamejs.Mp3Encoder) {
        return reject(new Error("LameJS non disponible pour l'encodage MP3"));
      }

      const sampleRate = audioBuffer.sampleRate;
      const numChannels = Math.min(2, audioBuffer.numberOfChannels);
      const totalFrames = audioBuffer.length;

      const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
      const endFrame = Math.min(
        totalFrames,
        Math.ceil((endSec !== null && endSec > 0 ? endSec : audioBuffer.duration) * sampleRate)
      );
      const frameCount = endFrame - startFrame;

      if (frameCount <= 0) {
        return reject(new Error('Intervalle de découpe trop court ou invalide'));
      }

      const encoder = new window.lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
      const mp3Data = [];

      const leftRaw = audioBuffer.getChannelData(0).subarray(startFrame, endFrame);
      const rightRaw = numChannels > 1 ? audioBuffer.getChannelData(1).subarray(startFrame, endFrame) : leftRaw;

      const leftInt16 = new Int16Array(frameCount);
      const rightInt16 = numChannels > 1 ? new Int16Array(frameCount) : null;

      for (let i = 0; i < frameCount; i++) {
        let sL = Math.max(-1, Math.min(1, leftRaw[i]));
        leftInt16[i] = sL < 0 ? sL * 0x8000 : sL * 0x7fff;

        if (rightInt16) {
          let sR = Math.max(-1, Math.min(1, rightRaw[i]));
          rightInt16[i] = sR < 0 ? sR * 0x8000 : sR * 0x7fff;
        }
      }

      const sampleBlockSize = 1152;
      for (let i = 0; i < frameCount; i += sampleBlockSize) {
        const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
        let mp3buf;
        if (numChannels === 1) {
          mp3buf = encoder.encodeBuffer(leftChunk);
        } else {
          const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
          mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
        }
        if (mp3buf && mp3buf.length > 0) {
          mp3Data.push(mp3buf);
        }
      }

      const flushBuf = encoder.flush();
      if (flushBuf && flushBuf.length > 0) {
        mp3Data.push(flushBuf);
      }

      const blob = new Blob(mp3Data, { type: 'audio/mp3' });
      resolve(blob);
    } catch (err) {
      reject(err);
    }
  });
}

function downloadBlob(blob, filename = 'sound.mp3') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

// ==========================================
// 4. TRIMMER STUDIO & WAVEFORM ENGINE
// ==========================================
let currentAudioBuffer = null;
let currentSourceFileName = '';
let currentStartSec = 0;
let currentEndSec = 0;
let previewSource = null;
let previewStartTime = 0;
let isPreviewing = false;
let isPreviewLooping = false;
let previewTimer = null;
let editingSoundId = null;

const canvas = document.getElementById('waveform-canvas');
const canvasCtx = canvas ? canvas.getContext('2d') : null;
const trimRegionEl = document.getElementById('trim-region');
const playheadNeedleEl = document.getElementById('playhead-needle');
const waveformBox = document.getElementById('waveform-container');

let waveformPeaks = [];

function generateWaveformPeaks(buffer, targetPeaks = 400) {
  const rawData = buffer.getChannelData(0);
  const step = Math.ceil(rawData.length / targetPeaks);
  const peaks = [];

  for (let i = 0; i < targetPeaks; i++) {
    const start = i * step;
    const end = Math.min(start + step, rawData.length);
    let min = 1.0;
    let max = -1.0;

    for (let j = start; j < end; j++) {
      const datum = rawData[j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    peaks.push({ min, max, amp: Math.max(Math.abs(min), Math.abs(max)) });
  }
  return peaks;
}

function drawWaveform() {
  if (!canvas || !canvasCtx || !currentAudioBuffer || waveformPeaks.length === 0) return;

  const width = canvas.width;
  const height = canvas.height;
  canvasCtx.clearRect(0, 0, width, height);

  const duration = currentAudioBuffer.duration;
  const startRatio = currentStartSec / duration;
  const endRatio = currentEndSec / duration;

  const barCount = waveformPeaks.length;
  const barWidth = width / barCount;
  const centerY = height / 2;

  canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  canvasCtx.lineWidth = 1;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, centerY);
  canvasCtx.lineTo(width, centerY);
  canvasCtx.stroke();

  for (let i = 0; i < barCount; i++) {
    const peak = waveformPeaks[i];
    const x = i * barWidth;
    const ratio = i / barCount;
    const isSelected = ratio >= startRatio && ratio <= endRatio;

    const barHeight = Math.max(3, peak.amp * (height * 0.85));
    const yTop = centerY - barHeight / 2;

    if (isSelected) {
      const grad = canvasCtx.createLinearGradient(0, yTop, 0, yTop + barHeight);
      grad.addColorStop(0, '#06b6d4');
      grad.addColorStop(1, '#a855f7');
      canvasCtx.fillStyle = grad;
    } else {
      canvasCtx.fillStyle = 'rgba(156, 163, 175, 0.22)';
    }

    const r = Math.min(2, barWidth / 2);
    canvasCtx.beginPath();
    canvasCtx.roundRect(x, yTop, Math.max(1, barWidth - 1), barHeight, r);
    canvasCtx.fill();
  }

  updateTrimOverlay();
}

function updateTrimOverlay() {
  if (!currentAudioBuffer || !trimRegionEl) return;
  const duration = currentAudioBuffer.duration;
  if (duration <= 0) return;

  const leftPercent = (currentStartSec / duration) * 100;
  const rightPercent = (currentEndSec / duration) * 100;
  const widthPercent = rightPercent - leftPercent;

  trimRegionEl.style.left = `${leftPercent}%`;
  trimRegionEl.style.width = `${Math.max(0, widthPercent)}%`;

  document.getElementById('input-start-sec').value = currentStartSec.toFixed(2);
  document.getElementById('input-end-sec').value = currentEndSec.toFixed(2);

  const trimmedDuration = Math.max(0, currentEndSec - currentStartSec);
  document.getElementById('val-trimmed-duration').textContent = `${trimmedDuration.toFixed(2)}s`;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(2);
  const paddedMins = String(mins).padStart(2, '0');
  const paddedSecs = secs < 10 ? '0' + secs : secs;
  return `${paddedMins}:${paddedSecs}`;
}

function resizeWaveformCanvas() {
  if (!waveformBox || !canvas) return;
  const rect = waveformBox.getBoundingClientRect();
  canvas.width = rect.width * (window.devicePixelRatio || 1);
  canvas.height = rect.height * (window.devicePixelRatio || 1);
  drawWaveform();
}

window.addEventListener('resize', resizeWaveformCanvas);

let isDraggingWaveform = false;
let dragTarget = null;

if (waveformBox) {
  waveformBox.addEventListener('mousedown', (e) => {
    if (!currentAudioBuffer) return;
    isDraggingWaveform = true;
    handleWaveformPointer(e);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDraggingWaveform && currentAudioBuffer) {
      handleWaveformPointer(e);
    }
  });

  window.addEventListener('mouseup', () => {
    isDraggingWaveform = false;
    dragTarget = null;
  });
}

function handleWaveformPointer(e) {
  const rect = waveformBox.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const ratio = x / rect.width;
  const clickedTime = ratio * currentAudioBuffer.duration;

  if (!dragTarget) {
    const distToStart = Math.abs(clickedTime - currentStartSec);
    const distToEnd = Math.abs(clickedTime - currentEndSec);
    const tolerance = currentAudioBuffer.duration * 0.05;

    if (distToStart < tolerance && distToStart <= distToEnd) {
      dragTarget = 'start';
    } else if (distToEnd < tolerance) {
      dragTarget = 'end';
    } else {
      dragTarget = 'seek';
    }
  }

  if (dragTarget === 'start') {
    currentStartSec = Math.max(0, Math.min(clickedTime, currentEndSec - 0.05));
  } else if (dragTarget === 'end') {
    currentEndSec = Math.min(currentAudioBuffer.duration, Math.max(clickedTime, currentStartSec + 0.05));
  } else if (dragTarget === 'seek') {
    updatePlayheadPosition(clickedTime);
  }

  drawWaveform();
}

function updatePlayheadPosition(timeSec) {
  if (!currentAudioBuffer || !playheadNeedleEl) return;
  const duration = currentAudioBuffer.duration;
  const ratio = Math.max(0, Math.min(1, timeSec / duration));
  playheadNeedleEl.style.display = 'block';
  playheadNeedleEl.style.left = `${ratio * 100}%`;
  document.getElementById('val-current-time').textContent = formatTime(timeSec);
}

function startPreview() {
  const ctx = getAudioContext();
  stopPreview();

  const trimmedDuration = currentEndSec - currentStartSec;
  if (trimmedDuration <= 0) return;

  previewSource = ctx.createBufferSource();
  previewSource.buffer = currentAudioBuffer;
  previewSource.connect(masterGain);

  previewStartTime = ctx.currentTime;
  isPreviewing = true;
  updatePreviewUI(true);

  previewTimer = setInterval(() => {
    const elapsed = ctx.currentTime - previewStartTime;
    const current = currentStartSec + (elapsed % trimmedDuration);
    updatePlayheadPosition(current);

    if (!isPreviewLooping && elapsed >= trimmedDuration) {
      stopPreview();
    }
  }, 30);

  if (isPreviewLooping) {
    previewSource.loop = true;
    previewSource.loopStart = currentStartSec;
    previewSource.loopEnd = currentEndSec;
    previewSource.start(0, currentStartSec);
  } else {
    previewSource.start(0, currentStartSec, trimmedDuration);
    previewSource.onended = () => {
      if (isPreviewing && !isPreviewLooping) {
        stopPreview();
      }
    };
  }
}

function stopPreview() {
  if (previewSource) {
    try {
      previewSource.stop();
    } catch (e) {}
    previewSource = null;
  }
  if (previewTimer) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
  isPreviewing = false;
  updatePreviewUI(false);
  if (playheadNeedleEl) {
    playheadNeedleEl.style.display = 'none';
  }
}

function updatePreviewUI(playing) {
  const textEl = document.getElementById('text-preview-btn');
  const iconEl = document.getElementById('icon-preview-play');
  if (textEl) textEl.textContent = playing ? "Pause l'extrait" : "Écouter l'extrait";
  if (iconEl) {
    iconEl.setAttribute('data-lucide', playing ? 'pause' : 'play');
    if (window.lucide) lucide.createIcons();
  }
}

// ==========================================
// 5. AUDIO LOADING (File, YouTube, TikTok, Tab Capture, Mic)
// ==========================================
async function loadAudioFromArrayBuffer(arrayBuffer, defaultName = 'Mon Son', emoji = '🔊') {
  const ctx = getAudioContext();
  showTrimmerLoading(true, 'Décodage audio du média...');

  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    currentAudioBuffer = buffer;
    currentSourceFileName = defaultName;

    currentStartSec = 0;
    currentEndSec = Math.min(buffer.duration, 10);

    waveformPeaks = generateWaveformPeaks(buffer);

    document.getElementById('val-total-duration').textContent = formatTime(buffer.duration);
    document.getElementById('input-start-sec').max = buffer.duration;
    document.getElementById('input-end-sec').max = buffer.duration;

    const nameInput = document.getElementById('input-sound-name');
    nameInput.value = defaultName.replace(/\.[^/.]+$/, '');

    const emojiInput = document.getElementById('input-sound-emoji');
    if (emoji) emojiInput.value = emoji;

    if (!document.getElementById('input-sound-key').value) {
      document.getElementById('input-sound-key').value = getNextAvailableKey();
    }

    document.getElementById('trimmer-editor').classList.remove('hidden');
    document.getElementById('btn-save-to-soundboard').disabled = false;
    document.getElementById('btn-download-mp3-direct').disabled = false;

    showTrimmerLoading(false);
    setTimeout(() => resizeWaveformCanvas(), 60);
  } catch (err) {
    showTrimmerLoading(false);
    console.error('Error decoding audio:', err);
    showToast('Format non supporté ou fichier corrompu : ' + err.message, 'error');
  }
}

async function loadAudioFromFile(file) {
  if (!file) return;
  const name = file.name || 'Son local';
  try {
    const arrayBuffer = await file.arrayBuffer();
    await loadAudioFromArrayBuffer(arrayBuffer, name, '📁');
  } catch (err) {
    showToast('Erreur lecture fichier : ' + err.message, 'error');
  }
}

// ------------------------------------------
// YOUTUBE EXTRACTION
// ------------------------------------------
function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/i);
  return match ? match[1] : null;
}

async function loadAudioFromYouTube(url) {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    showToast('URL YouTube invalide. Ex: https://youtube.com/watch?v=... ou Shorts', 'warning');
    return;
  }

  showTrimmerLoading(true, 'Connexion à YouTube et extraction du flux audio...');

  const invidiousInstances = [
    'https://yt.chocolatemoo53.com',
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.tiekoetter.com'
  ];

  let audioBufferData = null;
  let videoTitle = 'YouTube Sound';

  for (const instance of invidiousInstances) {
    try {
      showTrimmerLoading(true, `Extraction audio en cours...`);
      const metaRes = await fetch(`${instance}/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6000) });
      if (!metaRes.ok) continue;

      const meta = await metaRes.json();
      videoTitle = meta.title || videoTitle;

      // Find best audio stream in adaptiveFormats
      const audioStreams = (meta.adaptiveFormats || []).filter((f) => f.type && f.type.startsWith('audio'));
      if (audioStreams.length === 0) continue;

      // Prefer m4a or webm high/medium quality
      const chosenFormat = audioStreams.find((f) => f.container === 'm4a') || audioStreams[0];
      const audioStreamUrl = chosenFormat.url || `${instance}/latest_version?id=${videoId}&itag=${chosenFormat.itag || 140}`;

      // Fetch the audio stream
      try {
        const audioFetch = await fetch(audioStreamUrl, { signal: AbortSignal.timeout(12000) });
        if (audioFetch.ok) {
          audioBufferData = await audioFetch.arrayBuffer();
          break;
        }
      } catch (streamErr) {
        console.warn('Stream direct fetch failed, trying proxy...', streamErr);
      }
    } catch (e) {
      console.warn(`Instance ${instance} error:`, e);
    }
  }

  if (audioBufferData && audioBufferData.byteLength > 0) {
    await loadAudioFromArrayBuffer(audioBufferData, videoTitle, '▶');
    showToast(`Son YouTube "${videoTitle}" extrait avec succès !`, 'success');
  } else {
    showTrimmerLoading(false);
    showToast("Impossible d'extraire directement cette vidéo YouTube (protection ou restriction réseau). Utilisez l'onglet 'Onglet Live' pour capturer l'audio directement !", 'warning');
  }
}

// ------------------------------------------
// TIKTOK EXTRACTION
// ------------------------------------------
async function loadAudioFromTikTok(url) {
  if (!url || !url.trim().includes('tiktok.com')) {
    showToast('Veuillez entrer un lien TikTok valide (ex: https://www.tiktok.com/@.../video/... ou vm.tiktok.com/...)', 'warning');
    return;
  }
  url = url.trim();
  showTrimmerLoading(true, 'Extraction de la vidéo / bande-son TikTok...');

  let audioBufferData = null;
  let soundTitle = 'TikTok Sound';

  try {
    const formData = new URLSearchParams();
    formData.append('url', url);
    formData.append('hd', '1');

    const res = await fetch('https://www.tikwm.com/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData,
      signal: AbortSignal.timeout(8000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data.code === 0 && data.data) {
        soundTitle = data.data.title || (data.data.music_info ? data.data.music_info.title : soundTitle);
        // Direct media URL: either clean music stream or video stream
        const mediaUrl = data.data.music || data.data.play || data.data.wmplay;
        if (mediaUrl) {
          const streamRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(12000) });
          if (streamRes.ok) {
            audioBufferData = await streamRes.arrayBuffer();
          }
        }
      }
    }
  } catch (e) {
    console.warn('TikTok extraction error:', e);
  }

  if (audioBufferData && audioBufferData.byteLength > 0) {
    await loadAudioFromArrayBuffer(audioBufferData, soundTitle, '♪');
    showToast(`Son TikTok "${soundTitle.substring(0, 30)}..." extrait avec succès !`, 'success');
  } else {
    showTrimmerLoading(false);
    showToast("Impossible d'extraire ce lien TikTok. Vous pouvez utiliser l'onglet 'Onglet Live' pour capturer l'audio en direct pendant la lecture !", 'warning');
  }
}

// ------------------------------------------
// TAB AUDIO CAPTURE (Direct browser stream)
// ------------------------------------------
let tabCaptureStream = null;
let tabMediaRecorder = null;
let tabRecordedChunks = [];
let tabCaptureTimer = null;
let tabCaptureSec = 0;

async function toggleTabAudioCapture() {
  const btnLabel = document.getElementById('label-tab-capture-btn');
  const statusEl = document.getElementById('tab-capture-status');

  if (tabMediaRecorder && tabMediaRecorder.state === 'recording') {
    tabMediaRecorder.stop();
    clearInterval(tabCaptureTimer);
    btnLabel.textContent = 'Choisir un onglet & Enregistrer';
    statusEl.classList.add('hidden');
    return;
  }

  try {
    // Request tab/screen capture with audio
    tabCaptureStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true
    });

    const audioTracks = tabCaptureStream.getAudioTracks();
    if (audioTracks.length === 0) {
      tabCaptureStream.getTracks().forEach((t) => t.stop());
      showToast("Attention : Vous devez cocher la case 'Partager l'audio de l'onglet' lors du choix de l'onglet !", 'warning');
      return;
    }

    tabRecordedChunks = [];
    tabCaptureSec = 0;
    tabMediaRecorder = new MediaRecorder(tabCaptureStream);

    tabMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) tabRecordedChunks.push(e.data);
    };

    tabMediaRecorder.onstop = async () => {
      tabCaptureStream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(tabRecordedChunks, { type: 'audio/webm' });
      const arrayBuffer = await blob.arrayBuffer();
      await loadAudioFromArrayBuffer(arrayBuffer, 'Capture Onglet Live', '⚡');
      showToast('Capture terminée avec succès ! Découpez maintenant votre extrait.', 'success');
    };

    tabMediaRecorder.start();
    btnLabel.textContent = 'Arrêter la capture';
    statusEl.classList.remove('hidden');
    statusEl.textContent = 'Enregistrement en direct : 00:00';

    tabCaptureTimer = setInterval(() => {
      tabCaptureSec++;
      const m = String(Math.floor(tabCaptureSec / 60)).padStart(2, '0');
      const s = String(tabCaptureSec % 60).padStart(2, '0');
      statusEl.textContent = `Enregistrement en direct : ${m}:${s}`;
    }, 1000);
  } catch (err) {
    console.warn('Tab capture error:', err);
    showToast('Capture annulée ou non autorisée : ' + err.message, 'info');
  }
}

// ------------------------------------------
// MICROPHONE RECORDING
// ------------------------------------------
let micMediaRecorder = null;
let micRecordedChunks = [];
let micRecordTimer = null;
let micRecordSeconds = 0;

async function toggleMicRecording() {
  const icon = document.getElementById('icon-mic-record');
  const label = document.getElementById('label-record-time');

  if (micMediaRecorder && micMediaRecorder.state === 'recording') {
    micMediaRecorder.stop();
    clearInterval(micRecordTimer);
    icon.setAttribute('data-lucide', 'mic');
    if (window.lucide) lucide.createIcons();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micMediaRecorder = new MediaRecorder(stream);
    micRecordedChunks = [];
    micRecordSeconds = 0;
    label.textContent = '00:00';

    micMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) micRecordedChunks.push(e.data);
    };

    micMediaRecorder.onstop = async () => {
      const blob = new Blob(micRecordedChunks, { type: 'audio/webm' });
      stream.getTracks().forEach((t) => t.stop());
      const arrayBuffer = await blob.arrayBuffer();
      await loadAudioFromArrayBuffer(arrayBuffer, 'Enregistrement Micro', '🎙️');
    };

    micMediaRecorder.start();
    icon.setAttribute('data-lucide', 'square');
    if (window.lucide) lucide.createIcons();

    micRecordTimer = setInterval(() => {
      micRecordSeconds++;
      const m = String(Math.floor(micRecordSeconds / 60)).padStart(2, '0');
      const s = String(micRecordSeconds % 60).padStart(2, '0');
      label.textContent = `${m}:${s}`;
    }, 1000);
  } catch (err) {
    showToast('Accès au microphone refusé ou non supporté : ' + err.message, 'error');
  }
}

function showTrimmerLoading(show, message = 'Chargement...') {
  const el = document.getElementById('trimmer-loading');
  const text = document.getElementById('trimmer-loading-text');
  if (el) {
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }
  if (text) text.textContent = message;
}

// ==========================================
// 6. PRESET SOUNDS GENERATOR (Offline Synthesizer)
// ==========================================
async function generatePresetSounds() {
  showToast('Génération des sons d’exemple...', 'info');

  const presets = [
    {
      name: 'Airhorn Blast',
      category: 'Effets',
      emoji: '🎺',
      color: '#06b6d4',
      duration: 1.2,
      synth: (ctx) => {
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const osc3 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(466.16, 0);
        osc2.type = 'sawtooth';
        osc2.frequency.setValueAtTime(587.33, 0);
        osc3.type = 'sawtooth';
        osc3.frequency.setValueAtTime(698.46, 0);

        gain.gain.setValueAtTime(0.3, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, 1.15);

        osc1.connect(gain);
        osc2.connect(gain);
        osc3.connect(gain);
        gain.connect(ctx.destination);

        osc1.start(0);
        osc2.start(0);
        osc3.start(0);
      }
    },
    {
      name: 'Bruh Jump',
      category: 'Memes',
      emoji: '💀',
      color: '#8b5cf6',
      duration: 0.6,
      synth: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(160, 0);
        osc.frequency.exponentialRampToValueAtTime(70, 0.5);

        gain.gain.setValueAtTime(0.4, 0);
        gain.gain.linearRampToValueAtTime(0.01, 0.55);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
      }
    },
    {
      name: 'Tada Chime',
      category: 'Effets',
      emoji: '🎉',
      color: '#ec4899',
      duration: 1.5,
      synth: (ctx) => {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, idx * 0.12);
          gain.gain.setValueAtTime(0.3, idx * 0.12);
          gain.gain.exponentialRampToValueAtTime(0.001, 1.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(idx * 0.12);
        });
      }
    },
    {
      name: 'Laser Pew',
      category: 'Effets',
      emoji: '💥',
      color: '#10b981',
      duration: 0.5,
      synth: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1200, 0);
        osc.frequency.exponentialRampToValueAtTime(80, 0.45);
        gain.gain.setValueAtTime(0.3, 0);
        gain.gain.exponentialRampToValueAtTime(0.001, 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
      }
    },
    {
      name: 'Sub Bass Drop',
      category: 'Musique',
      emoji: '🔊',
      color: '#f59e0b',
      duration: 1.8,
      synth: (ctx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(180, 0);
        osc.frequency.exponentialRampToValueAtTime(35, 1.5);
        gain.gain.setValueAtTime(0.5, 0);
        gain.gain.linearRampToValueAtTime(0.01, 1.7);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(0);
      }
    },
    {
      name: 'Level Up',
      category: 'Effets',
      emoji: '🎮',
      color: '#6366f1',
      duration: 1.2,
      synth: (ctx) => {
        const notes = [330, 392, 659, 523, 587, 784];
        notes.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, i * 0.09);
          gain.gain.setValueAtTime(0.15, i * 0.09);
          gain.gain.exponentialRampToValueAtTime(0.001, i * 0.09 + 0.3);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(i * 0.09);
        });
      }
    }
  ];

  for (let i = 0; i < presets.length; i++) {
    const p = presets[i];
    const offCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(2, 44100 * p.duration, 44100);
    p.synth(offCtx);
    const audioBuf = await offCtx.startRendering();
    const mp3Blob = await encodeAudioBufferToMp3(audioBuf, 0, p.duration, 128);

    const soundObj = {
      id: 'preset_' + Date.now() + '_' + i,
      name: p.name,
      category: p.category,
      keybind: String(i + 1),
      emoji: p.emoji,
      color: p.color,
      duration: p.duration,
      volume: 1,
      loop: false,
      blob: mp3Blob,
      createdAt: Date.now()
    };
    await dbSaveSound(soundObj);
  }

  await reloadSoundboard();
  showToast('Sons d’exemple ajoutés avec succès !', 'success');
}

// ==========================================
// 7. SOUNDBOARD GRID UI & INTERACTION
// ==========================================
let allSounds = [];
let currentCategoryFilter = 'all';
let currentSearchTerm = '';

async function reloadSoundboard() {
  allSounds = await dbGetAllSounds();
  renderSoundboard();
}

function getFilteredSounds() {
  return allSounds.filter((s) => {
    const matchesCat = currentCategoryFilter === 'all' || s.category === currentCategoryFilter;
    const matchesSearch =
      !currentSearchTerm ||
      s.name.toLowerCase().includes(currentSearchTerm.toLowerCase()) ||
      (s.keybind && s.keybind.toLowerCase() === currentSearchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });
}

function renderSoundboard() {
  const grid = document.getElementById('soundboard-grid');
  const emptyState = document.getElementById('empty-state');
  const countBadge = document.getElementById('sound-count-badge');

  if (countBadge) countBadge.textContent = allSounds.length;

  const filtered = getFilteredSounds();

  if (allSounds.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    emptyState.classList.add('flex');
    return;
  }

  emptyState.classList.add('hidden');
  emptyState.classList.remove('flex');

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-12 text-center text-gray-400 glass-panel rounded-xl">
        <p>Aucun son ne correspond à votre recherche ou catégorie sélectionnée.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((sound) => createSoundCardHtml(sound)).join('');

  filtered.forEach((sound) => {
    const cardEl = document.getElementById(`card-${sound.id}`);
    if (!cardEl) return;

    const playBtn = cardEl.querySelector('.btn-card-play');
    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playSound(sound);
      });
    }

    cardEl.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      playSound(sound);
    });

    const volSlider = cardEl.querySelector('.slider-card-vol');
    if (volSlider) {
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const vol = parseFloat(e.target.value);
        sound.volume = vol;
        if (activePlayers.has(sound.id)) {
          activePlayers.get(sound.id).gain.gain.value = vol;
        }
      });
      volSlider.addEventListener('change', async (e) => {
        sound.volume = parseFloat(e.target.value);
        await dbSaveSound(sound);
      });
    }

    const loopBtn = cardEl.querySelector('.btn-card-loop');
    if (loopBtn) {
      loopBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        sound.loop = !sound.loop;
        loopBtn.classList.toggle('text-cyan-400', sound.loop);
        loopBtn.classList.toggle('text-gray-500', !sound.loop);
        if (activePlayers.has(sound.id)) {
          activePlayers.get(sound.id).source.loop = sound.loop;
        }
        await dbSaveSound(sound);
      });
    }

    const dlBtn = cardEl.querySelector('.btn-card-download');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const fname = `${sound.name.replace(/\s+/g, '_').toLowerCase()}.mp3`;
        downloadBlob(sound.blob, fname);
        showToast(`Téléchargement de "${fname}" lancé !`, 'success');
      });
    }

    const editBtn = cardEl.querySelector('.btn-card-edit');
    if (editBtn) {
      editBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        openTrimmerForSound(sound);
      });
    }

    const delBtn = cardEl.querySelector('.btn-card-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Voulez-vous vraiment supprimer le son "${sound.name}" ?`)) {
          stopSound(sound.id);
          await dbDeleteSound(sound.id);
          await reloadSoundboard();
          showToast(`Son "${sound.name}" supprimé`, 'info');
        }
      });
    }
  });

  if (window.lucide) lucide.createIcons();
}

function createSoundCardHtml(sound) {
  const color = sound.color || '#06b6d4';
  const durationSec = typeof sound.duration === 'number' ? sound.duration.toFixed(1) + 's' : '';
  const keyLabel = sound.keybind ? sound.keybind.toUpperCase() : '';

  return `
    <div id="card-${sound.id}" class="sound-card p-4 flex flex-col justify-between cursor-pointer group" style="--card-color: ${color}; --card-glow: ${color}40;">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1.5">
          ${keyLabel ? `<span class="kbd-badge text-cyan-300" title="Touche raccourci">[${keyLabel}]</span>` : ''}
          <span class="text-[11px] font-mono text-gray-400">${durationSec}</span>
        </div>

        <div class="flex items-center gap-1">
          <button class="btn-card-download p-1 text-gray-400 hover:text-white rounded hover:bg-white/10 transition" title="Télécharger en MP3">
            <i data-lucide="download" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-card-edit p-1 text-gray-400 hover:text-white rounded hover:bg-white/10 transition" title="Modifier / Recouper">
            <i data-lucide="scissors" class="w-3.5 h-3.5"></i>
          </button>
          <button class="btn-card-delete p-1 text-gray-400 hover:text-red-400 rounded hover:bg-red-500/10 transition" title="Supprimer">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>

      <div class="flex items-center gap-3 my-2">
        <button class="btn-card-play w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg transition transform group-hover:scale-105 active:scale-95" style="background-color: ${color};">
          <i data-lucide="play" class="card-play-icon w-6 h-6 fill-current"></i>
        </button>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span class="text-base select-none">${sound.emoji || '🔊'}</span>
            <h4 class="text-sm font-bold text-white truncate" title="${sound.name}">${sound.name}</h4>
          </div>
          <span class="text-[11px] text-gray-400 block truncate">${sound.category || 'Général'}</span>
        </div>
      </div>

      <div class="flex items-center justify-between gap-2 pt-2 border-t border-white/5 mt-2 text-xs">
        <div class="flex items-center gap-1.5 flex-1 max-w-[120px]">
          <i data-lucide="volume-1" class="w-3 h-3 text-gray-500"></i>
          <input type="range" class="slider-card-vol w-full h-1 bg-gray-800 rounded appearance-none cursor-pointer" min="0" max="1" step="0.05" value="${sound.volume !== undefined ? sound.volume : 1}" title="Volume">
        </div>

        <button class="btn-card-loop p-1 rounded transition ${sound.loop ? 'text-cyan-400' : 'text-gray-500 hover:text-gray-300'}" title="Boucler">
          <i data-lucide="repeat" class="w-3.5 h-3.5"></i>
        </button>
      </div>

      <div class="card-progress w-0"></div>
    </div>
  `;
}

function updateCardPlayState(soundId, isPlaying, progressRatio = 0) {
  const card = document.getElementById(`card-${soundId}`);
  if (!card) return;

  const icon = card.querySelector('.card-play-icon');
  const progress = card.querySelector('.card-progress');

  if (isPlaying) {
    card.classList.add('is-playing');
    if (icon) {
      icon.setAttribute('data-lucide', 'square');
      if (window.lucide) lucide.createIcons();
    }
    if (progress) {
      progress.style.width = `${Math.min(100, progressRatio * 100)}%`;
    }
  } else {
    card.classList.remove('is-playing');
    if (icon) {
      icon.setAttribute('data-lucide', 'play');
      if (window.lucide) lucide.createIcons();
    }
    if (progress) {
      progress.style.width = '0%';
    }
  }
}

function getNextAvailableKey() {
  const usedKeys = new Set(allSounds.map((s) => (s.keybind ? s.keybind.toUpperCase() : '')));
  const candidates = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
  for (const k of candidates) {
    if (!usedKeys.has(k)) return k;
  }
  return '';
}

async function openTrimmerForSound(sound) {
  editingSoundId = sound.id;
  const modal = document.getElementById('modal-trimmer');
  modal.classList.remove('hidden');

  document.getElementById('modal-title').textContent = `Modifier "${sound.name}"`;
  document.getElementById('btn-save-text').textContent = 'Mettre à jour le son';

  document.getElementById('input-sound-name').value = sound.name;
  document.getElementById('select-sound-cat').value = sound.category || 'Général';
  document.getElementById('input-sound-key').value = sound.keybind || '';
  document.getElementById('input-sound-emoji').value = sound.emoji || '🔊';

  setSelectedColor(sound.color || '#06b6d4');

  try {
    let arrayBuffer;
    if (sound.blob instanceof Blob) {
      arrayBuffer = await sound.blob.arrayBuffer();
    } else {
      const res = await fetch(sound.blob);
      arrayBuffer = await res.arrayBuffer();
    }
    await loadAudioFromArrayBuffer(arrayBuffer, sound.name, sound.emoji);
  } catch (e) {
    showToast('Erreur chargement pour modification: ' + e.message, 'error');
  }
}

function resetTrimmerModal() {
  editingSoundId = null;
  currentAudioBuffer = null;
  currentSourceFileName = '';
  currentStartSec = 0;
  currentEndSec = 0;
  stopPreview();

  document.getElementById('modal-title').textContent = 'Ajouter & Découper un son';
  document.getElementById('btn-save-text').textContent = 'Ajouter à la Soundboard';
  document.getElementById('input-sound-name').value = '';
  document.getElementById('input-sound-key').value = '';
  document.getElementById('input-sound-emoji').value = '🔊';
  document.getElementById('input-youtube-url').value = '';
  document.getElementById('input-tiktok-url').value = '';
  document.getElementById('input-audio-file').value = '';
  document.getElementById('trimmer-editor').classList.add('hidden');
  document.getElementById('btn-save-to-soundboard').disabled = true;
  document.getElementById('btn-download-mp3-direct').disabled = true;

  setSelectedColor('#06b6d4');
}

let selectedColor = '#06b6d4';
function setSelectedColor(color) {
  selectedColor = color;
  document.querySelectorAll('.color-btn').forEach((btn) => {
    if (btn.dataset.color.toLowerCase() === color.toLowerCase()) {
      btn.classList.add('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-gray-900');
    } else {
      btn.classList.remove('ring-2', 'ring-white', 'ring-offset-2', 'ring-offset-gray-900');
    }
  });
}

// ==========================================
// 8. GLOBAL EVENT LISTENERS & SETUP
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  await initDB();
  await reloadSoundboard();

  // Master Volume
  const masterSlider = document.getElementById('slider-master-volume');
  const masterLabel = document.getElementById('label-master-volume');
  const masterMuteBtn = document.getElementById('btn-master-mute');
  const masterMuteIcon = document.getElementById('icon-master-mute');

  masterSlider.addEventListener('input', (e) => {
    masterVolume = parseFloat(e.target.value);
    masterLabel.textContent = `${Math.round(masterVolume * 100)}%`;
    if (masterGain) masterGain.gain.value = masterVolume;
  });

  let previousVolume = 1;
  masterMuteBtn.addEventListener('click', () => {
    if (masterVolume > 0) {
      previousVolume = masterVolume;
      masterVolume = 0;
      masterSlider.value = 0;
      masterLabel.textContent = '0%';
      masterMuteIcon.setAttribute('data-lucide', 'volume-x');
    } else {
      masterVolume = previousVolume || 1;
      masterSlider.value = masterVolume;
      masterLabel.textContent = `${Math.round(masterVolume * 100)}%`;
      masterMuteIcon.setAttribute('data-lucide', 'volume-2');
    }
    if (masterGain) masterGain.gain.value = masterVolume;
    if (window.lucide) lucide.createIcons();
  });

  document.getElementById('btn-stop-all').addEventListener('click', stopAllSounds);

  const exclusiveBtn = document.getElementById('btn-toggle-exclusive');
  const exclusiveText = document.getElementById('text-exclusive');
  exclusiveBtn.addEventListener('click', () => {
    isExclusiveMode = !isExclusiveMode;
    exclusiveText.textContent = isExclusiveMode ? 'Mode Solo' : 'Multi-sons';
    exclusiveBtn.classList.toggle('border-cyan-500/50', isExclusiveMode);
    exclusiveBtn.classList.toggle('text-cyan-300', isExclusiveMode);
    showToast(isExclusiveMode ? 'Mode Solo activé : coupe le son précédent' : 'Multi-sons activé : sons superposés', 'info');
  });

  // Backup Popover
  const backupBtn = document.getElementById('btn-backup-menu');
  const backupPopover = document.getElementById('backup-popover');
  backupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    backupPopover.classList.toggle('hidden');
    backupPopover.classList.toggle('flex');
  });
  window.addEventListener('click', (e) => {
    if (!backupPopover.contains(e.target) && e.target !== backupBtn) {
      backupPopover.classList.add('hidden');
      backupPopover.classList.remove('flex');
    }
  });

  // Export JSON
  document.getElementById('btn-export-json').addEventListener('click', async () => {
    backupPopover.classList.add('hidden');
    backupPopover.classList.remove('flex');

    if (allSounds.length === 0) {
      showToast('Aucun son à exporter', 'warning');
      return;
    }

    showToast('Préparation de l’export...', 'info');

    const exportData = [];
    for (const sound of allSounds) {
      let b64 = '';
      if (sound.blob instanceof Blob) {
        b64 = await blobToBase64(sound.blob);
      }
      exportData.push({
        id: sound.id,
        name: sound.name,
        category: sound.category,
        keybind: sound.keybind,
        emoji: sound.emoji,
        color: sound.color,
        duration: sound.duration,
        volume: sound.volume,
        loop: sound.loop,
        blobBase64: b64,
        createdAt: sound.createdAt
      });
    }

    const jsonStr = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), sounds: exportData }, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(blob, `snipwave-export-${Date.now()}.json`);
    showToast('Export de la soundboard terminé !', 'success');
  });

  // Import JSON
  const fileImportInput = document.getElementById('file-import-soundboard');
  document.getElementById('btn-trigger-import').addEventListener('click', () => {
    backupPopover.classList.add('hidden');
    backupPopover.classList.remove('flex');
    fileImportInput.click();
  });

  fileImportInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      showToast('Importation de la sauvegarde en cours...', 'info');
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.sounds || !Array.isArray(data.sounds)) {
        throw new Error('Format de fichier invalide');
      }

      for (const s of data.sounds) {
        let blob = null;
        if (s.blobBase64) {
          const res = await fetch(s.blobBase64);
          blob = await res.blob();
        }
        await dbSaveSound({
          id: s.id || 'sound_' + Date.now() + Math.random(),
          name: s.name,
          category: s.category || 'Général',
          keybind: s.keybind || '',
          emoji: s.emoji || '🔊',
          color: s.color || '#06b6d4',
          duration: s.duration || 1,
          volume: s.volume !== undefined ? s.volume : 1,
          loop: !!s.loop,
          blob: blob,
          createdAt: s.createdAt || Date.now()
        });
      }

      await reloadSoundboard();
      showToast('Soundboard importée avec succès !', 'success');
    } catch (err) {
      showToast('Erreur lors de l’importation : ' + err.message, 'error');
    }
    fileImportInput.value = '';
  });

  // Clear Soundboard
  document.getElementById('btn-clear-soundboard').addEventListener('click', async () => {
    backupPopover.classList.add('hidden');
    backupPopover.classList.remove('flex');
    if (confirm('Êtes-vous sûr de vouloir supprimer tous les sons ?')) {
      stopAllSounds();
      await dbClearAllSounds();
      await reloadSoundboard();
      showToast('Soundboard vidée', 'info');
    }
  });

  // Presets load button
  const loadPresetsHandler = async () => {
    backupPopover.classList.add('hidden');
    backupPopover.classList.remove('flex');
    await generatePresetSounds();
  };
  document.getElementById('btn-load-presets').addEventListener('click', loadPresetsHandler);
  document.getElementById('btn-empty-presets').addEventListener('click', loadPresetsHandler);

  // Search & Filter
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    currentSearchTerm = e.target.value;
    renderSoundboard();
  });

  document.querySelectorAll('.cat-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-pill').forEach((p) => {
        p.classList.remove('active', 'bg-cyan-500/20', 'text-cyan-300', 'border-cyan-500/40');
        p.classList.add('bg-gray-900/60', 'text-gray-400');
      });
      btn.classList.add('active', 'bg-cyan-500/20', 'text-cyan-300', 'border-cyan-500/40');
      btn.classList.remove('bg-gray-900/60', 'text-gray-400');
      currentCategoryFilter = btn.dataset.cat;
      renderSoundboard();
    });
  });

  // Modal Open / Close
  const openModalBtn = document.getElementById('btn-open-add-modal');
  const emptyAddBtn = document.getElementById('btn-empty-add');
  const closeModalBtn = document.getElementById('btn-close-modal');
  const cancelModalBtn = document.getElementById('btn-cancel-modal');
  const modal = document.getElementById('modal-trimmer');

  const openModal = () => {
    resetTrimmerModal();
    modal.classList.remove('hidden');
  };

  const closeModal = () => {
    stopPreview();
    modal.classList.add('hidden');
  };

  openModalBtn.addEventListener('click', openModal);
  emptyAddBtn.addEventListener('click', openModal);
  closeModalBtn.addEventListener('click', closeModal);
  cancelModalBtn.addEventListener('click', closeModal);

  // Source Tabs Navigation
  const sourceTabs = [
    { btn: 'tab-btn-file', content: 'tab-content-file' },
    { btn: 'tab-btn-youtube', content: 'tab-content-youtube' },
    { btn: 'tab-btn-tiktok', content: 'tab-content-tiktok' },
    { btn: 'tab-btn-capture', content: 'tab-content-capture' },
    { btn: 'tab-btn-mic', content: 'tab-content-mic' }
  ];

  sourceTabs.forEach(({ btn, content }) => {
    const btnEl = document.getElementById(btn);
    if (!btnEl) return;
    btnEl.addEventListener('click', () => {
      sourceTabs.forEach((t) => {
        const b = document.getElementById(t.btn);
        const c = document.getElementById(t.content);
        if (b) {
          b.classList.remove('bg-cyan-500', 'text-gray-950', 'font-bold');
          b.classList.add('text-gray-400');
        }
        if (c) c.classList.add('hidden');
      });
      btnEl.classList.add('bg-cyan-500', 'text-gray-950', 'font-bold');
      btnEl.classList.remove('text-gray-400');
      const targetContent = document.getElementById(content);
      if (targetContent) targetContent.classList.remove('hidden');
    });
  });

  // File Dropzone
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('input-audio-file');

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      loadAudioFromFile(e.target.files[0]);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dropzone-active');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dropzone-active');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone-active');
    if (e.dataTransfer.files.length > 0) {
      loadAudioFromFile(e.dataTransfer.files[0]);
    }
  });

  // YouTube Extraction Trigger
  const ytInput = document.getElementById('input-youtube-url');
  const ytBtn = document.getElementById('btn-fetch-youtube');
  ytBtn.addEventListener('click', () => {
    loadAudioFromYouTube(ytInput.value);
  });
  ytInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadAudioFromYouTube(ytInput.value);
    }
  });

  // TikTok Extraction Trigger
  const tiktokInput = document.getElementById('input-tiktok-url');
  const tiktokBtn = document.getElementById('btn-fetch-tiktok');
  tiktokBtn.addEventListener('click', () => {
    loadAudioFromTikTok(tiktokInput.value);
  });
  tiktokInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadAudioFromTikTok(tiktokInput.value);
    }
  });

  // Tab Audio Live Capture
  document.getElementById('btn-start-tab-capture').addEventListener('click', toggleTabAudioCapture);

  // Mic Button
  document.getElementById('btn-record-mic').addEventListener('click', toggleMicRecording);

  // Time Stepper buttons (-0.5s, -0.1s, +0.1s, +0.5s)
  document.querySelectorAll('.step-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!currentAudioBuffer) return;
      const target = btn.dataset.target;
      const delta = parseFloat(btn.dataset.delta);

      if (target === 'start') {
        currentStartSec = Math.max(0, Math.min(currentStartSec + delta, currentEndSec - 0.05));
      } else if (target === 'end') {
        currentEndSec = Math.min(currentAudioBuffer.duration, Math.max(currentEndSec + delta, currentStartSec + 0.05));
      }
      drawWaveform();
    });
  });

  // Manual numeric input for Start / End
  const startInput = document.getElementById('input-start-sec');
  const endInput = document.getElementById('input-end-sec');

  startInput.addEventListener('change', (e) => {
    if (!currentAudioBuffer) return;
    const val = parseFloat(e.target.value) || 0;
    currentStartSec = Math.max(0, Math.min(val, currentEndSec - 0.05));
    drawWaveform();
  });

  endInput.addEventListener('change', (e) => {
    if (!currentAudioBuffer) return;
    const val = parseFloat(e.target.value) || 0;
    currentEndSec = Math.min(currentAudioBuffer.duration, Math.max(val, currentStartSec + 0.05));
    drawWaveform();
  });

  // Set Start / End on cursor needle
  document.getElementById('btn-set-start-here').addEventListener('click', () => {
    if (!currentAudioBuffer) return;
    let curTime = currentStartSec;
    if (isPreviewing) {
      const elapsed = getAudioContext().currentTime - previewStartTime;
      curTime = currentStartSec + (elapsed % (currentEndSec - currentStartSec));
    }
    currentStartSec = Math.max(0, Math.min(curTime, currentEndSec - 0.05));
    drawWaveform();
  });

  document.getElementById('btn-set-end-here').addEventListener('click', () => {
    if (!currentAudioBuffer) return;
    let curTime = currentEndSec;
    if (isPreviewing) {
      const elapsed = getAudioContext().currentTime - previewStartTime;
      curTime = currentStartSec + (elapsed % (currentEndSec - currentStartSec));
    }
    currentEndSec = Math.min(currentAudioBuffer.duration, Math.max(curTime, currentStartSec + 0.05));
    drawWaveform();
  });

  // Preview Buttons
  document.getElementById('btn-preview-selection').addEventListener('click', () => {
    if (isPreviewing) {
      stopPreview();
    } else {
      startPreview();
    }
  });

  const previewLoopBtn = document.getElementById('btn-preview-loop');
  previewLoopBtn.addEventListener('click', () => {
    isPreviewLooping = !isPreviewLooping;
    previewLoopBtn.classList.toggle('text-cyan-400', isPreviewLooping);
    previewLoopBtn.classList.toggle('text-gray-400', !isPreviewLooping);
    if (isPreviewing) {
      startPreview();
    }
  });

  // Auto Key button
  document.getElementById('btn-auto-key').addEventListener('click', () => {
    document.getElementById('input-sound-key').value = getNextAvailableKey();
  });

  // Color picker clicks
  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setSelectedColor(btn.dataset.color);
    });
  });

  // Emoji picker clicks
  document.querySelectorAll('.emoji-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.getElementById('input-sound-emoji').value = btn.textContent;
    });
  });

  // Direct MP3 Download button in Modal
  document.getElementById('btn-download-mp3-direct').addEventListener('click', async () => {
    if (!currentAudioBuffer) return;
    const soundName = document.getElementById('input-sound-name').value.trim() || 'sound';
    showToast('Encodage MP3 en cours...', 'info');

    try {
      const mp3Blob = await encodeAudioBufferToMp3(currentAudioBuffer, currentStartSec, currentEndSec, 192);
      const filename = `${soundName.replace(/\s+/g, '_').toLowerCase()}.mp3`;
      downloadBlob(mp3Blob, filename);
      showToast(`Téléchargement de "${filename}" prêt !`, 'success');
    } catch (err) {
      showToast('Erreur encodage MP3 : ' + err.message, 'error');
    }
  });

  // Save to Soundboard Button in Modal
  document.getElementById('btn-save-to-soundboard').addEventListener('click', async () => {
    if (!currentAudioBuffer) return;

    const soundName = document.getElementById('input-sound-name').value.trim() || 'Nouveau Son';
    const category = document.getElementById('select-sound-cat').value;
    const keybind = document.getElementById('input-sound-key').value.trim();
    const emoji = document.getElementById('input-sound-emoji').value.trim() || '🔊';
    const color = selectedColor;

    showToast('Encodage MP3 et sauvegarde en cours...', 'info');

    try {
      const mp3Blob = await encodeAudioBufferToMp3(currentAudioBuffer, currentStartSec, currentEndSec, 192);
      const duration = Math.max(0.1, currentEndSec - currentStartSec);

      const soundId = editingSoundId || 'sound_' + Date.now();
      const existing = editingSoundId ? allSounds.find((s) => s.id === editingSoundId) : null;

      const soundObj = {
        id: soundId,
        name: soundName,
        category: category,
        keybind: keybind,
        emoji: emoji,
        color: color,
        duration: duration,
        volume: existing && existing.volume !== undefined ? existing.volume : 1,
        loop: existing ? !!existing.loop : false,
        blob: mp3Blob,
        createdAt: existing ? existing.createdAt : Date.now()
      };

      await dbSaveSound(soundObj);
      await reloadSoundboard();
      closeModal();
      showToast(`Son "${soundName}" enregistré sur votre Soundboard !`, 'success');
    } catch (err) {
      showToast('Erreur lors de l’enregistrement : ' + err.message, 'error');
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      stopAllSounds();
      return;
    }

    const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
      return;
    }

    const pressedKey = e.key.toUpperCase();
    const matchedSound = allSounds.find((s) => s.keybind && s.keybind.toUpperCase() === pressedKey);
    if (matchedSound) {
      e.preventDefault();
      playSound(matchedSound);
    }
  });

  if (window.lucide) lucide.createIcons();
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toast-text');
  const icon = document.getElementById('toast-icon');

  if (!toast || !text) return;

  text.textContent = message;

  if (type === 'error') {
    icon.className = 'w-4 h-4 text-red-400';
    icon.setAttribute('data-lucide', 'alert-circle');
  } else if (type === 'success') {
    icon.className = 'w-4 h-4 text-emerald-400';
    icon.setAttribute('data-lucide', 'check-circle-2');
  } else if (type === 'warning') {
    icon.className = 'w-4 h-4 text-amber-400';
    icon.setAttribute('data-lucide', 'alert-triangle');
  } else {
    icon.className = 'w-4 h-4 text-cyan-400';
    icon.setAttribute('data-lucide', 'info');
  }

  if (window.lucide) lucide.createIcons();

  toast.classList.remove('translate-y-24', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('translate-y-24', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3500);
}
