# 🔊 SoundBoard Studio

> **Créez votre propre Soundboard personnalisée, découpez vos sons & téléchargez-les directement en MP3.**  
> Hébergé gratuitement et 100% côté client sur **GitHub Pages**.

🌐 **Accès en ligne :** [https://naloulii.github.io/soundboard/](https://naloulii.github.io/soundboard/)

---

## ✨ Fonctionnalités

- 📁 **Import Fichier Local** : Compatible avec tous les formats audio et vidéo (`.mp3`, `.wav`, `.ogg`, `.aac`, `.m4a`, `.flac`, `.mp4`, `.webm`, etc.).
- 🔗 **Import par URL Vidéo / Audio** : Entrez le lien direct d'un fichier audio ou vidéo du web (avec fallback proxy automatique en cas de restriction CORS).
- 🎙️ **Enregistrement Micro** : Enregistrez directement votre voix ou un bruitage depuis votre microphone.
- ✂️ **Découpeur Audio Visuel (Trimmer)** :
  - Forme d'onde interactive (Waveform) fluide.
  - Définition précise du point de départ et du point de fin (au millième de seconde).
  - Boutons de pas rapides (`-0.5s`, `-0.1s`, `+0.1s`, `+0.5s`) et capture du curseur de lecture.
  - Pré-écoute de l'extrait en boucle ou normale.
- 💾 **Téléchargement direct en MP3** : Encodage MP3 instantané 100% dans le navigateur grâce à LameJS (aucun serveur externe requis).
- 🎹 **Raccourcis Clavier** : Déclenchez vos sons instantanément au clavier (`1`, `2`, `A`, `B`, etc.).
- 🎛️ **Contrôles Audio Avancés** :
  - Volume individuel par son et curseur de volume général (Master).
  - Mode Solo (coupe le son précédent) ou Multi-sons (superposition).
  - Bouton d'arrêt d'urgence (`Échap` ou bouton *Arrêter tout*).
  - Boucle (Loop) activable sur chaque son.
- 🎨 **Personnalisation** : Choisissez le nom, la catégorie (Memes, Effets, Musique, Voix), un emoji et la couleur d'accent néon de chaque bouton.
- 🗄️ **Sauvegarde automatique** : Tous vos sons sont stockés dans votre navigateur via **IndexedDB** (conservés même après rechargement).
- 📦 **Export / Import** : Sauvegardez toute votre soundboard dans un fichier `.json` et réimportez-la en un clic.

---

## 🚀 Hébergement sur GitHub Pages

Le projet est conçu pour fonctionner sans aucun backend ni serveur Node.js.

Pour l'héberger :
1. Créez un dépôt GitHub public ou privé.
2. Allez dans les paramètres du dépôt : **Settings** > **Pages**.
3. Dans **Build and deployment**, sélectionnez la source :
   - Soit **GitHub Actions** (workflow déjà inclus dans `.github/workflows/deploy.yml`).
   - Soit **Deploy from a branch** -> branche `main` / dossier `/ (root)`.
4. Votre Soundboard est instantanément accessible à l'adresse :  
   `https://<votre-pseudo>.github.io/<nom-du-repo>/`

---

## 💻 Utilisation Locale

Vous pouvez également lancer le projet en local sans installation complexe :
- Ouvrez simplement le fichier `index.html` dans votre navigateur (Chrome, Firefox, Edge, Safari, Brave...).
- Ou utilisez un mini serveur HTTP :
  ```bash
  # Avec Python
  python -m http.server 8000
  
  # Avec Node (npx)
  npx serve .
  ```
  Puis ouvrez `http://localhost:8000`.

---

## 🛠️ Technologies Utilisées

- **HTML5 & CSS3** moderne avec Glassmorphism et effets néon.
- **Tailwind CSS** (via CDN).
- **Web Audio API** (décodage, routage audio, synthèse de sons).
- **LameJS** (encodage MP3 côté client).
- **IndexedDB** (stockage persistant des fichiers et métadonnées).
- **Lucide Icons** pour des icônes vectorielles nettes.

---

Licence MIT — Amusez-vous bien avec votre Soundboard ! 🎉
