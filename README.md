# Desktop Companion

Petit compagnon 2D pixel-art qui vit par-dessus vos fenêtres Windows (Tauri v2 + Rust +
TypeScript, Canvas 2D).

- Architecture et choix de performance : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Format des packs `.companion` : [docs/COMPANION_FORMAT.md](docs/COMPANION_FORMAT.md)

## Prérequis (Windows)

1. [Rust](https://rustup.rs) (toolchain stable MSVC) ;
2. Visual Studio Build Tools avec la charge « Développement Desktop en C++ » ;
3. WebView2 Runtime (préinstallé sur Windows 10/11) ;
4. Node.js ≥ 23.6.

## Lancer

```bash
npm install
npm run icons        # génère src-tauri/icons/* depuis le sprite du robot
npm run tauri dev
```

Itérer sur le rendu seul, sans Rust, dans un navigateur : `npm run dev` puis
<http://localhost:1420>. Les appels au backend retombent sur des valeurs par défaut et un
monde factice (un écran, trois fenêtres) est dessiné en surimpression. Dans l'app,
ajouter `?debug` à l'URL affiche aussi les sols et plateformes détectés.

Autres commandes utiles :

```bash
npm run companion    # régénère la planche et animations.json du robot par défaut
npm run measure      # mémoire et CPU de l'app et de WebView2 (app lancée)
npm run tauri build -- --no-bundle   # exécutable release seul
```

## Fonctionnalités actuelles

**Étape 1** : overlay transparent topmost multi-écrans, click-through dynamique,
System Tray (afficher/masquer, profils, lancement au démarrage, quitter), réglages
persistés de façon atomique dans `%APPDATA%\dev.desktopcompanion.core\`.

**Étape 2** :
- compagnon « Byte » complet : 18 animations générées procéduralement ;
- détection des fenêtres Win32 (vraies bordures DWM, occlusion entre fenêtres) ;
- physique : gravité, rebonds, sauts balistiques vers le haut des fenêtres ;
- il s'assoit sur les barres de titre et **suit la fenêtre quand on la déplace** ;
  il tombe si elle est fermée, réduite ou recouverte ;
- lancer à la souris, ombre portée (profil Haute qualité) ;
- pause automatique pendant une application plein écran.
