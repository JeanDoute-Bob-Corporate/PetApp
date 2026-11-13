# Format de pack `.companion` — v1

> **Pour créer un pack**, lis plutôt le guide pas à pas :
> [`GUIDE_PACK_COMPANION.md`](GUIDE_PACK_COMPANION.md). Il contient le rôle et les
> conventions de dessin de chaque animation, un modèle (`examples/template/`), la
> commande `npm run pack -- <dossier>` et un brief prêt à transmettre à un artiste ou à
> une IA. Cette page est la référence technique condensée.

Un pack `.companion` est une **archive ZIP renommée** qui change l'apparence et la
personnalité du compagnon. Ses statistiques acquises (jauges, entraînement) ne sont
jamais stockées dans le pack : appliquer un pack les conserve.

Schémas formels : [`schemas/companion-manifest.schema.json`](../schemas/companion-manifest.schema.json)
et [`schemas/companion-animations.schema.json`](../schemas/companion-animations.schema.json)
(JSON Schema 2020-12). Exemple complet : [`public/companions/default/`](../public/companions/default), généré
par `npm run companion` (planche et animations.json produites depuis une seule table,
donc toujours cohérentes).

## Installer un pack

Double-clic sur le compagnon → **Console** → onglet **Look** → *Parcourir*, ou glisser
le fichier `.companion` sur le compagnon ou sur la Console. En cas de problème, toutes les
erreurs sont listées (fichier › champ : explication). Un pack d'exemple valide est
fourni : `examples/byte-sakura.companion` (`npm run examples`).

## Contenu de l'archive

```
mon-pack.companion
├─ manifest.json        (obligatoire)
├─ animations.json      (obligatoire)
├─ spritesheet.png      (obligatoire — nom déclaré dans manifest.sprite.file)
└─ sfx/                 (optionnel)
   ├─ jump.ogg
   └─ punch.wav
```

## `manifest.json`

```jsonc
{
  "formatVersion": 1,
  "id": "dev.default.byte",          // identifiant inversé, unique, minuscules
  "name": "Byte",
  "author": "Desktop Companion",
  "version": "1.0.0",                 // SemVer
  "description": "Petit robot développeur.",
  "minAppVersion": "0.1.0",
  "accentColor": "#4dfcb0",           // facultatif : couleur de l'interface quand il est actif
  "sprite": {
    "file": "spritesheet.png",
    "frameWidth": 32, "frameHeight": 32,   // taille d'une case de la grille
    "scale": 3,                            // agrandissement par défaut à l'écran
    "facing": "right"                      // sens du dessin d'origine (le moteur miroite)
  },
  "hitbox": { "x": 3, "y": 0, "width": 26, "height": 32 },  // dans la case, en px sprite
  "anchorPoints": {                   // points d'attache, en px sprite
    "feet":      { "x": 16, "y": 32 },      // obligatoire : contact avec le sol
    "bubble":    { "x": 16, "y": 0 },       // obligatoire : position des bulles
    "head":      { "x": 16, "y": 8 },
    "handRight": { "x": 25, "y": 24 },
    "handLeft":  { "x": 7,  "y": 24 }
  },
  "baseStats": { "strength": 5, "agility": 6, "endurance": 4, "technique": 7 },
  "personalityWeights": {             // multiplicateurs de l'IA utilitaire (0 à 3, défaut 1)
    "playful": 1.2, "lazy": 0.8, "curious": 1.5,
    "social": 1.0, "brave": 0.9, "glutton": 1.0, "mischievous": 1.1
  },
  "sounds": { "jump": "sfx/jump.ogg" }  // id → fichier, référencés par les events
}
```

## `animations.json`

Une ligne de la planche = une animation. Les frames se lisent de gauche à droite à
partir de `startColumn`.

```jsonc
{
  "formatVersion": 1,
  "animations": {
    "idle": { "row": 0, "frameCount": 4, "fps": 4, "loop": true },
    "jump": {
      "row": 3, "frameCount": 4, "fps": 12, "loop": false,
      "next": "fall",                                   // enchaînement en fin d'anim
      "events": [ { "frame": 1, "type": "sound", "id": "jump" } ]
    },
    "attack_heavy": {
      "row": 15, "frameCount": 6, "fps": 12, "loop": false, "next": "idle",
      "frameDurations": [120, 80, 80, 60, 140, 120],    // optionnel, en ms, remplace fps
      "events": [
        { "frame": 4, "type": "hit" },                  // instant où les dégâts s'appliquent
        { "frame": 4, "type": "particle", "id": "impact", "anchor": "handRight" }
      ]
    }
  }
}
```

**États obligatoires (18)** : `idle`, `walk`, `run`, `jump`, `fall`, `climb`,
`sit_window`, `grab_edge`, `sleep`, `eat`, `play`, `train`, `dragged`, `attack_light`,
`attack_heavy`, `hurt`, `victory`, `defeat`. Des états supplémentaires en `snake_case`
sont autorisés (ignorés par le moteur s'il ne les connaît pas).

**Types d'événements** :

| `type` | Champs | Effet |
|---|---|---|
| `sound` | `id` (clé de `manifest.sounds`) | joue le bruitage (si sons activés) |
| `particle` | `id`, `anchor?`, `offset?` | émet une particule (si profil ≠ Éco) |
| `hit` | — | instant de l'impact : coup, tir dans la balle, lâcher d'une note, clic |
| `footstep` | — | petit nuage de poussière pendant la course |
| `emote` | `id` | comme `particle`, mais affichée même en profil Éco |
| `custom` | `id` | réservé (accepté, sans effet) |

Particules : `zzz`, `heart`, `impact`, `sweat`, `star`, `anger`, `note`, `food`,
`sparkle`, `alert`, `dust`, `sick`.

Sans `next` et `loop: false`, l'animation reste figée sur sa dernière frame.

## Règles de validation (au-delà du schéma)

Le chargeur (E4, `package_loader.rs`) applique ces règles et renvoie des messages
d'erreur en français indiquant le fichier et le champ fautifs :

**Archive**
- taille ≤ 10 Mo, ≤ 64 entrées, aucun chemin absolu, aucun `..`, aucun lien symbolique ;
- extensions autorisées uniquement : `.json`, `.png`, `.ogg`, `.wav` ;
- chaque `.ogg`/`.wav` ≤ 512 Ko.

**Spritesheet**
- PNG valide, ≤ 2048 × 2048 px ;
- largeur et hauteur multiples de `frameWidth` / `frameHeight`.

**Cohérence croisée**
- pour chaque animation : `row < hauteur / frameHeight` et
  `startColumn + frameCount ≤ largeur / frameWidth` ;
- `frameDurations`, s'il existe, a exactement `frameCount` éléments ;
- chaque `events[].frame < frameCount` ;
- chaque event `sound` référence une clé de `manifest.sounds`, dont le fichier existe ;
- chaque `anchor` d'event référence une clé de `anchorPoints` ;
- chaque `next` référence une animation définie ;
- `hitbox` et `anchorPoints` sont contenus dans la case (`0..frameWidth`, `0..frameHeight`).

**Sécurité** : le pack ne contient **aucun code**. Les JSON sont lus en mode strict
(champs inconnus refusés dans le manifeste) et les images sont décodées côté Rust avant
d'être servies à la webview depuis le cache d'extraction.
