# ⚡ SnipWave Studio

> **Créez votre propre Soundboard personnalisée, importez depuis YouTube, TikTok ou vos fichiers locaux, découpez vos sons & téléchargez-les directement en MP3.**  
> Hébergé gratuitement et 100% côté client sur **GitHub Pages**.

🌐 **Accès en ligne :** [https://naloulii.github.io/SnipWave/](https://naloulii.github.io/SnipWave/)

---

## ✨ Fonctionnalités

- 🔴 **Import Vidéo YouTube & Shorts** : Collez simplement un lien YouTube (`youtube.com/watch?v=...`, `youtu.be/...` ou `youtube.com/shorts/...`). SnipWave extrait automatiquement le titre et le flux audio !
- ♪ **Import Vidéo TikTok** : Collez un lien TikTok (`tiktok.com/@...` ou `vm.tiktok.com/...`) pour extraire directement la piste musicale ou la vidéo sans filigrane.
- 📁 **Import Fichier Local** : Compatible avec tous les formats audio et vidéo (`.mp3`, `.wav`, `.ogg`, `.aac`, `.m4a`, `.flac`, `.mp4`, `.webm`, `.mov`, etc.).
- 🖥️ **Capture d'Onglet Live (Tab Audio Capture)** : Enregistrez le flux audio de n'importe quel onglet en direct (YouTube, TikTok, Twitch, Spotify...) avec un taux de réussite de 100%.
- 🎙️ **Enregistrement Microphone** : Enregistrez directement votre voix ou un bruitage depuis votre micro.
- ✂️ **Découpeur Audio Visuel (Waveform Trimmer)** :
  - Forme d'onde interactive fluide avec curseur de lecture en temps réel.
  - Définition du début et de la fin au centième de seconde.
  - Boutons de pas rapides (`-0.5s`, `-0.1s`, `+0.1s`, `+0.5s`) et capture du curseur (*« Poser sur curseur »*).
  - Pré-écoute de l'extrait en boucle ou normale.
- 💾 **Téléchargement direct en MP3** : Encodage MP3 instantané 100% dans le navigateur grâce à LameJS (aucun serveur externe requis).
- 🎹 **Raccourcis Clavier** : Déclenchez vos sons instantanément au clavier (`1`, `2`, `A`, `B`, etc.).
- 🎛️ **Contrôles Audio Avancés** :
  - Volume individuel par son et curseur de volume général (Master).
  - Mode Solo (coupe le son précédent) ou Multi-sons (superposition).
  - Bouton d'arrêt d'urgence (`Échap` / *Arrêter tout*).
  - Boucle (Loop) activable sur chaque son.
- 🎨 **Personnalisation** : Nom, catégorie (Memes, Effets, Musique, Voix), emoji et couleur d'accent néon de chaque bouton.
- 🗄️ **Sauvegarde automatique** : Tous vos sons sont stockés dans votre navigateur via **IndexedDB** (conservés même après rechargement).
- 📦 **Export / Import** : Sauvegardez toute votre soundboard dans un fichier `.json` et réimportez-la en un clic.

---

## 🛠️ Technologies Utilisées

- **HTML5 & CSS3** moderne avec Glassmorphism et effets néon.
- **Tailwind CSS** (via CDN).
- **Web Audio API** (décodage, routage audio, synthèse de sons).
- **MediaStream / getDisplayMedia** (capture live d'onglets).
- **LameJS** (encodage MP3 côté client).
- **IndexedDB** (stockage persistant des fichiers et métadonnées).
- **Lucide Icons** pour des icônes vectorielles nettes.

---

Licence MIT — Amusez-vous bien avec **SnipWave** ! ⚡
