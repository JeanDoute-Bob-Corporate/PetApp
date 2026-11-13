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
npm test             # tests du modèle de soins et d'entraînement
npm run companion    # régénère les planches (robot + jouets) et animations.json
npm run examples     # packs d'exemple dans examples/ (un valide, un invalide)
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

**Étape 3** :
- IA : machine à états + IA utilitaire pondérée par les besoins et la personnalité ;
- jauges Faim / Énergie / Bonheur, 4 aliments aux effets distincts, sommeil ;
- stats Force / Agilité / Endurance / Technique, entraînées avec les jouets ;
- jouets à poser : balle, sac de frappe, terminal de code, gamelle ; bugs à chasser ;
- escalade des bords d'écran et des fenêtres, poussée, trébuchements, bâillements,
  bouderie, célébrations ;
- souris : caresses, glisser-lancer, sursaut, poursuite du curseur ;
- double-clic : menu radial d'actions rapides et **Console** à onglets (Fiche, Jouets,
  Look, Salon, Réglages), en pixel art, aux couleurs du compagnon actif ;
- sons 8-bit optionnels, particules, sauvegarde automatique de la progression.

**Étape 4** :
- packs `.companion` : import (bouton, glisser sur le compagnon ou sur la Console),
  validation détaillée en français, application en conservant la progression ;
  exemple valide `examples/byte-sakura.companion` ; **guide de création**
  [`docs/GUIDE_PACK_COMPANION.md`](docs/GUIDE_PACK_COMPANION.md), modèle
  `examples/template/` et `npm run pack -- <dossier>` (assemble et pré-vérifie) ;
- **bureaux reliés** : jusqu'à 8 joueurs dans un salon (réseau local ou code court) ;
  l'hôte place les écrans sur une grille, et ce qui franchit un bord relié (compagnon,
  jouets, boules de papier) passe sur l'écran du voisin avec sa vitesse ; rappel de
  son compagnon et de ses jouets ;
- combat automatique entre compagnons d'un même écran (double-clic sur celui d'un
  autre joueur → ⚔️), basé sur les stats entraînées × la forme, commenté en bulles.

Essayer le multijoueur sur une seule machine : lancer une seconde instance avec
`DC_INSTANCE=2` (données séparées).
