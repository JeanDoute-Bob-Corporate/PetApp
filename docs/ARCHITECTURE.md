# Desktop Companion — Architecture (Étapes 1 à 4)

Ce document fixe les choix structurants du projet : arborescence, flux de données,
budget de ressources et stratégie d'optimisation. Le format des packs est décrit dans
[COMPANION_FORMAT.md](COMPANION_FORMAT.md).

---

## 1. Arborescence complète

Toutes les étapes du plan sont implémentées.

```
PetApp/
├─ index.html                     # Page unique de l'overlay (aucun framework)
├─ package.json / tsconfig.json / vite.config.ts
├─ docs/
│  ├─ ARCHITECTURE.md             # Ce document
│  └─ COMPANION_FORMAT.md         # Spécification du format .companion
├─ schemas/
│  ├─ companion-manifest.schema.json     # JSON Schema 2020-12 de manifest.json
│  └─ companion-animations.schema.json   # JSON Schema 2020-12 de animations.json
├─ public/companions/default/     # Compagnon « Byte » livré avec l'app (servi tel quel)
│  ├─ manifest.json               # écrit à la main
│  ├─ animations.json             # généré par `npm run companion`
│  └─ spritesheet.png             # généré par `npm run companion` (192×864, 27 lignes)
├─ public/toys/                   # toys.png (11 sprites 24×24) + toys.json, générés aussi
├─ scripts/
│  ├─ lib/robotPainter.ts         # Robot pixel-art procédural, une frame = un FrameSpec
│  ├─ lib/toyPainter.ts           # Jouets et aliments procéduraux
│  ├─ lib/png.ts                  # Encodeur PNG sans dépendance
│  ├─ lib/byteAnimations.ts       # Table des animations de Byte + rendu de planche
│  ├─ lib/zip.ts                  # Écriture ZIP minimale (packs d'exemple)
│  ├─ build-default-companion.ts  # Planche + animations.json du pack par défaut, jouets
│  ├─ build-example-packs.ts      # examples/byte-sakura.companion (valide) + pack-invalide
│  ├─ gen-icon.ts                 # Icône de l'app depuis le sprite
│  └─ measure-memory.ps1          # Mémoire/CPU par processus (`npm run measure`)
├─ src/                           # Frontend TypeScript strict
│  ├─ main.ts                     # Bootstrap : réglages, pack, monde, boucle, événements
│  ├─ styles.css
│  ├─ platform/
│  │  ├─ bridge.ts                # Wrappers typés des commandes/événements Tauri
│  │  ├─ HitRegistry.ts           # Réunit les zones interactives (robot, jouets, menus)
│  │  └─ HitboxSync.ts            # Envoi dédupliqué/throttlé (10 Hz) des hitbox
│  ├─ engine/
│  │  ├─ GameLoop.ts              # Pas fixe 60 Hz, rendu capé, 3 niveaux d'activité
│  │  ├─ SpriteLayer.ts           # Petit canvas par entité, déplacé par transform GPU
│  │  ├─ pack.ts                  # Chargement + contrôle d'un pack (manifest, planche)
│  │  ├─ Animator.ts              # Lecture de animations.json, next, events de frame
│  │  ├─ World.ts                 # Sols (zones de travail) + plateformes (haut des fenêtres)
│  │  ├─ Physics.ts               # Gravité, friction, rebonds, sauts balistiques, suivi
│  │  └─ Particles.ts             # Particules DOM animées en CSS (désactivées en Éco)
│  ├─ audio/Sfx.ts                # Bruitages 8-bit synthétisés (WebAudio, aucun fichier)
│  ├─ entities/
│  │  ├─ Companion.ts             # Acteur : primitives (marcher, sauter, parler) + souris
│  │  ├─ CompanionStats.ts        # Jauges, stats, coefficient d'état (testé, pur)
│  │  └─ Toy.ts                   # Balle, sac, terminal, gamelle, aliments, bugs
│  ├─ ai/
│  │  ├─ StateMachine.ts          # FSM générique (états instanciés, priorités)
│  │  ├─ UtilityAI.ts             # Scores pondérés, tirage parmi les meilleurs
│  │  └─ behaviors.ts             # ~28 états + leurs scores d'utilité
│  ├─ network/
│  │  ├─ protocol.ts              # Messages entre pairs, validés et bornés
│  │  ├─ Layout.ts                # Grille de placement, bords reliés (5 tests)
│  │  ├─ Room.ts                  # Salon en étoile : joueurs, relais, placement
│  │  ├─ Multiplayer.ts           # Traversée des bords, visiteurs, rappel, synchro
│  │  ├─ Combat.ts                # Moteur de combat (6 tests)
│  │  └─ CombatDirector.ts        # Combat automatique, répliques, PV flottants
│  └─ ui/
│     ├─ Bubble.ts                # Bulle de dialogue au-dessus du compagnon
│     ├─ DebugOverlay.ts          # Sols/plateformes visibles (navigateur ou `?debug`)
│     ├─ Panel.ts                 # Fenêtre déplaçable, Console à onglets, Section
│     ├─ kit.ts / iconNames.ts    # Icônes pixel, boutons, interrupteurs, jauges segmentées
│     ├─ theme.ts                 # Couleur d'accent tirée du compagnon actif
│     ├─ RadialMenu.ts            # Menu radial (double-clic) + étiquette au survol
│     ├─ StatsPanel.ts            # Onglet Fiche : humeur, soins, entraînement
│     ├─ ToyBoxPanel.ts           # Onglet Jouets : poser/ranger, garde-manger
│     ├─ PackPanel.ts             # Onglet Look : import .companion, appliquer, supprimer
│     ├─ LobbyPanel.ts            # Onglet Salon : créer/rejoindre, grille des écrans, rappel
│     ├─ SettingsPanel.ts         # Onglet Réglages : profil, comportements, bêtises
│     └─ Notes.ts                 # Note : saisie, visée, lecture
└─ src-tauri/                     # Backend Rust (Tauri v2)
   ├─ Cargo.toml / build.rs / tauri.conf.json
   ├─ capabilities/default.json   # Permissions minimales de la webview
   ├─ icons/                      # Générées par `npm run icons`
   └─ src/
      ├─ main.rs                  # Point d'entrée binaire (sous-système Windows)
      ├─ lib.rs                   # Assemblage : plugins, état, setup
      ├─ settings.rs              # Modèle des réglages + profils de performance
      ├─ state.rs                 # État partagé + mutation centralisée des réglages
      ├─ persistence.rs           # Écriture JSON atomique (tmp + fsync + rename)
      ├─ overlay.rs               # Fenêtre overlay multi-écrans, visibilité
      ├─ hit_test.rs              # Thread de click-through dynamique
      ├─ tray.rs                  # Icône System Tray + menu
      ├─ commands.rs              # Commandes IPC exposées au frontend
      ├─ webview_memory.rs        # WebView2 en niveau mémoire « Low »
      ├─ window_tracker.rs        # EnumWindows + DWM + occlusion + plein écran
      ├─ mischief.rs              # Bêtises (fenêtres, icônes, clic) + icônes du bureau
      ├─ package_loader.rs        # Lecture, validation, extraction des .companion
      └─ p2p_bridge.rs            # Découverte LAN (UDP), code de session, transport TCP
```

---

## 2. Répartition des responsabilités

| Domaine | Rust (`src-tauri`) | TypeScript (`src`) |
|---|---|---|
| Fenêtre overlay | taille/position multi-écrans, topmost, visibilité | — |
| Click-through | **thread de hit-test** (curseur → bascule `ignore_cursor_events`) | publie les hitbox des entités |
| Fenêtres Windows | énumération Win32, filtrage, occlusion des bords, plein écran | physique de collision |
| Rendu / animation | — | boucle, sprites, particules |
| IA / stats | — | machine à états, IA utilitaire |
| Persistance | **source de vérité** (écriture atomique) | demande des sauvegardes |
| Packs `.companion` | (E4) ZIP, validation, extraction en cache | chargement des assets extraits |
| P2P | (E4) découverte LAN + échange de signalisation | (E4) WebRTC DataChannels |

Principe : **Rust fait ce qui touche l'OS ou doit tourner même quand la webview dort ;
TypeScript fait tout ce qui se dessine.** Les échanges IPC sont rares, petits et
dédupliqués.

### Flux de données de l'étape 1

```
            ┌──────────────── Rust ───────────────────┐
 GetCursorPos ─▶ hit_test thread ──(transition)──▶ set_ignore_cursor_events
                    ▲        │ (opt-in, ≤30 Hz)
       set_hitboxes │        └──▶ event "cursor-moved"
 set_pointer_capture│
            └───────┼─────────────────────────────────┘
                    │ IPC (uniquement si la hitbox change)
            ┌───────┴──────── WebView ────────────────┐
            │ GameLoop ─▶ Companion ─▶ SpriteLayer     │
            │      ▲ events: settings-changed,         │
            │      │ tray-action, visibility-changed   │
            └──────┴───────────────────────────────────┘
 Tray menu ─▶ tray.rs ─▶ state::mutate_settings ─▶ persistence (atomique)
                                               └▶ emit "settings-changed"
```

---

## 3. Fenêtre overlay & click-through dynamique

**Configuration** (`tauri.conf.json`) : `transparent`, `decorations: false`,
`alwaysOnTop`, `skipTaskbar`, `shadow: false`, `focus: false`, `visible: false`
(affichée seulement une fois dimensionnée, pas de flash).

**Couverture multi-écrans** (`overlay.rs`) : au démarrage on calcule la boîte englobante
de tous les moniteurs (coordonnées physiques) et on y place la fenêtre. La hauteur est
réduite d'1 px : une fenêtre topmost qui recouvre exactement un écran est traitée par
Windows comme une application plein écran (barre des tâches masquée, notifications
supprimées). Sur changement de DPI, la géométrie est recalculée.

**Click-through** (`hit_test.rs`) — c'est le cœur de la contrainte CPU :

1. La fenêtre ignore la souris par défaut (`set_ignore_cursor_events(true)`).
2. Le frontend publie la liste des rectangles interactifs (`set_hitboxes`) en
   coordonnées CSS de la fenêtre — **uniquement quand ils changent**, au plus ~30×/s.
3. Un thread Rust dédié lit `GetCursorPos` (quelques µs, aucun aller-retour vers la
   webview), convertit en coordonnées logiques et teste les rectangles (marge 4 px).
4. L'appel `set_ignore_cursor_events` n'est fait **que lors d'une transition**
   dedans/dehors.
5. Pendant un drag ou un menu ouvert, `set_pointer_capture(true)` force le mode
   interactif même si le curseur sort de la hitbox.

Cadence adaptative : 60 Hz quand le curseur bouge ou survole le compagnon, ~16 Hz
quand il est immobile, 4 Hz quand l'overlay est masqué. Coût mesuré attendu : bien
en dessous de 0,1 % CPU.

Le suivi du curseur par la webview (pour que le compagnon le regarde) est **opt-in**
(`set_cursor_tracking`) et limité à 30 Hz : quand aucun comportement n'en a besoin, la
webview n'est jamais réveillée par la souris.

---

## 4. Boucle de rendu basse consommation

`engine/GameLoop.ts` :

- **Simulation à pas fixe** 1/60 s (physique stable et déterministe, indépendante du FPS
  d'affichage), au plus 8 pas par frame pour éviter la spirale de rattrapage.
- **Trois niveaux d'activité**, chaque système déclare le sien et la boucle prend le max :
  - `active` → FPS cible du profil (drag, saut, combat…) ;
  - `idle` → FPS réduit (respiration, clignement : 6–15 FPS suffisent) ;
  - `dormant` → **plus aucun tick**. La boucle se rendort jusqu'à un `wake()`
    (événement tray, clic, IA programmée).
- **Ordonnancement** : `requestAnimationFrame` seulement si la cible ≥ 50 FPS ; en dessous
  on utilise `setTimeout` calé sur l'intervalle, ce qui évite de réveiller le JS à chaque
  vsync (un rAF qui « saute » des frames coûte 60 réveils/s pour rien).
- Arrêt complet quand l'overlay est masqué (`visibilitychange` + événement Rust).

`engine/SpriteLayer.ts` :

- **Un petit canvas par entité** à la résolution native du sprite (32×32), agrandi en CSS
  avec `image-rendering: pixelated` et `imageSmoothingEnabled = false`. L'échelle est
  « accrochée » pour que chaque pixel du sprite fasse un nombre entier de pixels écran.
- Déplacement par `transform: translate3d` sur une couche composée (`will-change`) :
  bouger le compagnon ne redessine **rien**, c'est le compositeur GPU qui translate.
- Le canvas n'est redessiné **que quand la frame d'animation change** (≈ 4–12 fois/s),
  jamais quand seule la position change.
- On n'a jamais de canvas plein écran : pas de `clearRect` sur 8 millions de pixels.

---

## 5. Profils de performance

Source de vérité unique en Rust (`settings.rs`), envoyée au frontend avec les réglages.

| Profil | FPS actif | FPS idle | Window tracker | Particules / ombres | Pause plein écran |
|---|---|---|---|---|---|
| `eco` | 24 | 6 | 4 Hz | non / non | **toujours** |
| `balanced` (défaut) | 30 | 10 | 10 Hz (30 Hz pendant 600 ms après un changement) | oui / non | selon réglage *Ne pas déranger* |
| `high` | 60 | 15 | 20 Hz (30 Hz après un changement) | oui / oui | selon réglage |

---

## 6. Budget mémoire et CPU — mesures réelles

Mesures avec `npm run measure` (colonne *Mémoire* du Gestionnaire des tâches =
ensemble de travail privé), **build release**, profil Équilibré, 1 écran 1920×1200 à
125 %, 20 cœurs, compagnon en activité normale (marche, sauts, assis), tracker actif.

| Configuration | Mémoire totale | CPU | Retenue |
|---|---|---|---|
| Étape 1 (avant optimisations, debug) | 98 Mo | — | |
| GPU + niveau mémoire Low + hitbox 10 Hz + 30 FPS | **75–88 Mo** | **8,3 % d'un cœur** (0,41 % machine) | ✅ |
| Rendu logiciel (`--disable-gpu --in-process-gpu`) | 64–67 Mo | 16 % d'un cœur (0,80 % machine) | ❌ |
| Étape 3 (IA, jouets, panneaux), surtout au repos | 86–92 Mo | 11,6 % d'un cœur (0,58 % machine) | ✅ |
| Étape 3, utilisateur qui joue avec le robot | — | jusqu'à ~24 % d'un cœur | — |

Le coût CPU est proportionnel au temps où quelque chose bouge (chaque image en
mouvement recompose l'overlay plein écran) ; au repos, rien n'est redessiné. En mode
dev, \`npm run tauri dev\` affiche toutes les 15 s la répartition des états et de la
cadence de la boucle (\`[webview] loop=…\`) pour diagnostiquer une consommation.

Répartition typique (GPU) : app Rust 7–13 Mo, navigateur WebView2 10–14 Mo, processus
GPU 6–32 Mo (fluctue, réduit périodiquement par le niveau Low), renderer 18–24 Mo,
utilitaires réseau/stockage/crashpad ~5 Mo.

**Pourquoi le GPU :** en rendu logiciel, Chromium recopie la surface transparente
plein écran à chaque frame où le compagnon bouge. On gagne ~15 Mo de RAM mais on double
le CPU, soit ~4 % en continu sur un portable 4 cœurs : c'est la batterie qui paie.

**L'objectif < 45 Mo n'est pas atteint** avec une fenêtre WebView2 plein écran ; le
plancher incompressible de WebView2 (navigateur + renderer + utilitaires) est d'environ
40 Mo à lui seul. Pistes restantes, par gain décroissant :

1. **Fenêtre qui suit le compagnon** (≈ 200×200 px au lieu du bureau entier) : surface
   GPU minuscule et coût de composition quasi nul, mais refonte du placement (la
   fenêtre se déplace avec le personnage) ; à évaluer si l'objectif reste prioritaire.
2. Rendu logiciel en option dans les paramètres (machines avec beaucoup de cœurs, ou
   pour qui la RAM prime), au prix d'un redémarrage de la fenêtre.

Leviers appliqués :

- `additionalBrowserArgs` : services Edge inutiles désactivés, un seul renderer.
- `ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW)` en permanence (`webview_memory.rs`).
- Hitbox publiée à 10 Hz au lieu de 30 (chaque appel IPC traverse renderer → navigateur
  → app) ; elle est élargie de la distance parcourue en 150 ms pour rester juste.
- Profil Équilibré à 30 FPS ; aucun canvas plein écran ; redessin seulement au
  changement de frame d'animation.

---

## 7. Monde physique (étape 2)

**Window tracker** (`window_tracker.rs`, thread dédié) :

- `EnumDisplayMonitors` + `GetMonitorInfoW` → bornes et **zone de travail** de chaque
  écran ; le bas de la zone de travail est le sol (haut de la barre des tâches).
- `EnumWindows` (ordre Z, du haut vers le bas) avec filtres : visible, non réduite, non
  « cloaked » (`DWMWA_CLOAKED` : UWP suspendues, autres bureaux virtuels), pas de
  `WS_EX_TOOLWINDOW` ni `WS_EX_TRANSPARENT`, pas de fenêtres du shell, ≥ 120×60 px,
  pas nos propres fenêtres ; 48 fenêtres au plus.
- Bordures réelles via `DWMWA_EXTENDED_FRAME_BOUNDS` (sans l'ombre invisible).
- **Occlusion** : le bord supérieur de chaque fenêtre est découpé par les fenêtres plus
  hautes en Z ; seules les portions visibles ≥ 40 px deviennent des plateformes
  (testé : `cargo test`).
- **Plein écran** : jeu D3D exclusif / mode présentation (`SHQueryUserNotificationState`)
  ou fenêtre au premier plan sans barre de titre couvrant son écran → l'overlay est
  masqué temporairement (sans toucher au réglage de visibilité), puis réaffiché.
- Changement d'écrans détecté → l'overlay est recalé sur le nouveau bureau virtuel.
- `world-changed` n'est émis qu'en cas de changement ; la cadence passe à 30 Hz pendant
  600 ms après un changement pour suivre une fenêtre qu'on déplace.

**Physique** (`World.ts`, `Physics.ts`) : gravité 2200 px/s², vitesse terminale,
friction au sol, plateformes à sens unique (on les traverse en montant), rebond au sol
au-delà de 950 px/s, rebond sur les bords du bureau, réapparition si le compagnon tombe
dans un vide entre deux écrans. Un compagnon posé sur une fenêtre mémorise son écart au
bord gauche de celle-ci : quand la fenêtre bouge, il la suit ; quand elle disparaît, est
réduite ou recouverte, il tombe.

**Comportement provisoire** (`Companion.ts`, remplacé par l'IA à l'étape 3) : marcher,
s'arrêter, sauter (trajectoire balistique calculée vers le haut d'une fenêtre à portée),
s'asseoir sur une barre de titre, en redescendre ; accroupissement d'anticipation avant
le saut et ~90 ms avant l'atterrissage ; lancer à la souris avec la vitesse du geste.

---

## 8. IA, soins et jouets (étape 3)

**Architecture de décision** : une machine à états (`StateMachine.ts`) dont chaque
état est instancié à l'entrée (son état local est dans ses champs) et déclare sa cadence
de rendu (`active` / `idle`), s'il gère lui-même la gravité, et sa priorité. Quand un
état se termine, l'IA utilitaire (`UtilityAI.ts`) note toutes les actions possibles à
partir des besoins, de la personnalité du pack (`personalityWeights`), des jouets
présents et de délais anti-répétition, puis tire parmi les 4 meilleures, pondéré par
le carré du score.

**Interruptions** (par priorité) : glisser > menu ouvert > chute/saut > escalade >
célébration > sursaut > caresse > bug à chasser > repas si affamé > sommeil si épuisé >
comportements normaux. Les actions vers un objet (manger, jouer, s'entraîner, coder,
chasser un bug) reprennent automatiquement après un saut ou une chute.

**Soins** (`CompanionStats.ts`, 8 tests `npm test`) :

| Jauge | Évolution (par heure, app ouverte) | Effets |
|---|---|---|
| Faim | −6 éveillé, −3 endormi | croquettes +30, pomme +18, cookie +10, café +2 |
| Énergie | −5 éveillé, +120 endormi | café +22 ; entraînement −0,25/s, jeu −0,15/s |
| Bonheur | −1, −5 si délaissé > 30 min, −3 si affamé/épuisé | caresse +6, balle +4/tir, bug +8, cookie +12 |

Application fermée : le temps écoulé (24 h max) est rattrapé avec indulgence (il a dormi,
faim −3/h sans descendre sous 10).

**Coefficient d'état** (0,4 à 1,15) : malus si faim, énergie ou bonheur < 30 ; bonus de
moral jusqu'à +15 % si tout est > 70. Il multiplie les gains d'entraînement et servira
au calcul du combat à l'étape 4. Gains avec rendements décroissants (`1 − stat/120`).

| Jouet | Activité | Statistique |
|---|---|---|
| Sac de frappe | coups (`train`), le sac oscille | Force |
| Balle | tirs, poursuite | Agilité, bonheur |
| Terminal | frappe au clavier (`type`), petites répliques de dev | Technique |
| Course, escalade | — | Endurance (+ un peu de force) |
| Bugs (spontanés toutes les 6–15 min) | chasse et écrasement | Technique, agilité, bonheur |

**Escalade** : vue de profil, mains et pieds contre le mur (sprite retourné pour un
bord gauche). Côté de fenêtre : il grimpe, s'accroche au rebord et se hisse dessus.
Bord d'écran : deux fois sur trois jusqu'en haut, puis (70 %) suspendu au plafond façon
Tarzan, main après main, avant de se laisser tomber ; sinon pause agrippé et saut en
arrière.

**Coucou** (`wave`) : à l'apparition (démarrage, réaffichage depuis le tray) et quand il
manque d'attention (aucune interaction depuis 10 min et bonheur ≤ 55, au plus toutes
les 90 s), avant de finir par bouder s'il reste délaissé.

**Secoué** : si on le secoue fort en le tenant (plus de 3 200 px parcourus et au moins
5 changements de direction en 1,2 s), il a le tournis en se posant puis vomit (faim −12,
bonheur −6). Un simple lancer rapide ne compte pas.

**Mécontentement et bêtises** : malheureux et délaissé depuis 15 min, il boude (bras
croisés, il tape du pied) puis peut faire une bêtise, au plus toutes les 2 minutes ;
chacune se désactive dans les Paramètres (`mischief.rs`) :

| Bêtise | Garde-fous |
|---|---|
| Tirer/repousser le côté d'une fenêtre | fenêtres suivies par le tracker uniquement, jamais maximisées ni les nôtres ; écart cumulé ≤ 300 px par fenêtre, largeur ≥ 320 px |
| Chiper une icône du bureau (super-saut, il la porte, la pose ailleurs) | seule la position de l'icône change, aucun fichier ; rien si l'organisation automatique est active |
| Cliquer avec l'index (onde visuelle) | le vrai clic n'est envoyé qu'au fond du bureau, jamais à une application, et sans bouger le curseur |

**Fichier glissé sur lui** : il le prend dans ses bras, l'étudie (technique) et va le
déposer ailleurs. Fichier du bureau : il déplace sa vraie icône. Autre fichier : rien
n'est copié ni déplacé sur le disque, il pose une feuille qui disparaît.

**Notes** : ✏️ dans le menu radial → saisie (l'overlay prend le focus clavier le temps
de la saisie seulement) → visée à la souris → il lance une boule de papier qui suit la
physique, se prend et se lance à la souris, et est sauvegardée. Double-clic : elle
s'ouvre et le mot s'affiche puis s'efface en fondu. Prévu pour le multijoueur.

**Souris** : caresse (va-et-vient sur le robot), glisser-lancer avec seuil de 6 px (un
double-clic n'est pas un glisser), double-clic = menu radial, sursaut si le curseur
passe très vite tout près, poursuite du curseur, il tourne la tête vers lui. Rust
n'envoie la position du curseur que lorsqu'il est à moins de 400 px d'une zone
interactive : loin du robot, la webview n'est jamais réveillée.

**Focus clavier** : l'overlay est `focusable: false` (`WS_EX_NOACTIVATE`) ; cliquer sur
le robot, un jouet ou un panneau ne vole jamais le focus de la fenêtre où l'on tape.

**Sauvegarde** : `companion.json` toutes les 30 s si quelque chose a changé, 2 s après
une modification des jouets, quand l'overlay est masqué, et avant de quitter (le tray
émet `flush-save` et attend 400 ms).

---

## 9. Packs .companion et multijoueur (étape 4)

**Import** (`package_loader.rs`) : l'archive est envoyée en binaire (corps IPC brut),
lue en mémoire avec des limites (10 Mo, 64 entrées, 24 Mo décompressés, JSON ≤ 256 Ko,
sons ≤ 512 Ko), sans chemin absolu ni `..` ni lien symbolique, extensions .json/.png/
.ogg/.wav uniquement. Toutes les règles de COMPANION_FORMAT.md sont vérifiées (champs
inconnus refusés, bornes, cohérence planche ↔ animations ↔ sons ↔ points d'attache) et
**toutes** les erreurs sont listées en français. Un pack valide est extrait dans
`<données>/packs/<id>/` puis relu par `pack_file` (réponse binaire → Blob). Appliquer
un pack recharge l'overlay ; la progression est conservée.

**Multijoueur : bureaux reliés.** Le multijoueur étend le terrain de jeu : les bureaux
d'un salon (jusqu'à 8 joueurs) sont reliés par leurs bords. Ce qui franchit un bord
relié — compagnon, jouet, boule de papier — quitte l'écran et arrive chez le voisin,
à la même hauteur relative et avec sa vitesse (un lancer continue sa trajectoire).

- **Placement** (`Layout.ts`, 5 tests) : une grille 5 × 3. Deux écrans voisins sont
  reliés (droite ↔ gauche, bas ↔ haut). L'hôte place les écrans ; chacun voit à qui mène
  chacun de ses bords (repère lumineux à la couleur du voisin, avec son nom). Le sol
  reste solide : on ne sort par le bas qu'en tombant, les liaisons verticales servent
  aux lancers vers le haut.
- **Chaque machine ne simule et n'affiche que son propre écran.** Un compagnon en visite
  est simulé là où il se trouve (il y mange, joue, se fait caresser, peut faire des
  bêtises selon les réglages *de cette machine*). Ses statistiques remontent à son
  propriétaire toutes les 20 s et à son retour ; si la liaison coupe, il rentre chez lui
  avec la dernière copie reçue.
- **Rappel** : « 📣 Rappeler mon compagnon et mes jouets » les fait revenir de partout.
- **Combat** : double-clic sur le compagnon d'un autre joueur présent sur ton écran →
  ⚔️ Combattre (si le tien est là aussi). Combat entièrement automatique, simulé par la
  machine où il a lieu (`Combat.ts` en mode automatique), commenté en bulles ; le
  propriétaire du visiteur est prévenu de l'issue. Aucune intervention des joueurs.
- Un compagnon qui se promène ne franchit un bord relié que s'il part explorer
  (une promenade sur six, jamais dans la minute qui suit son arrivée).
- **Seul un geste voulu traverse un bord relié** (`Body.crossLinks`) : un compagnon ou un
  jouet lancé à la souris, une note lancée, ou un compagnon parti explorer. Sinon le bord
  relié fait mur : un compagnon qui court après la balle ou un jouet poussé ne part
  pas par accident (sinon la balle faisait des allers-retours entre les deux écrans).
- L'état « secoué » voyage avec le compagnon : lancé juste après une secousse, il arrive
  étourdi chez le voisin et y vomit.

**Réseau** — écart assumé avec le cahier des charges : pas de WebRTC.

| Besoin | Choix | Pourquoi |
|---|---|---|
| Trouver un salon | annonce UDP sur le LAN (port 47820) par l'hôte | aucune configuration |
| Code de session court | IPv4 + port en 10 caractères Crockford (`K7Q2M-4XA9P`) | partageable à l'oral ; LAN ou VPN |
| Transport | salon en étoile : TCP direct vers l'hôte, qui relaie et inscrit l'expéditeur réel | WebRTC exige un serveur de signalisation (ou un échange de SDP de plusieurs centaines de caractères) et STUN/TURN hors LAN |

Rien n'écoute avant la création d'un salon ou une recherche ; une connexion entrante
n'est acceptée que salon ouvert ; chaque message est validé et borné (`protocol.ts`).

**Tester sur une seule machine** : `DC_INSTANCE=<nom>` lance une instance de test
(données séparées, sans verrou d'instance unique) ; en build de développement,
`DC_AUTOTEST=host|join|pack` déroule un scénario automatique journalisé. Vérifié avec
2 puis 3 instances : note et compagnon qui traversent les bords (y compris relayés par
l'hôte entre deux invités), combat automatique, rappel, statistiques revenues.

---

## 10. Persistance

`persistence.rs` : `write_json_atomic` écrit dans `fichier.json.tmp`, fait `fsync`,
conserve l'ancienne version en `.bak`, puis `rename` (remplacement atomique sous
Windows via `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`). Au chargement, un fichier
corrompu bascule automatiquement sur le `.bak`, puis sur les valeurs par défaut.

Fichiers (dans `%APPDATA%\dev.desktopcompanion.core\`) :

- `settings.json` — profil, comportements, visibilité (étape 1) ;
- `companion.json` — jauges, stats, inventaire (E3), sauvegardé à intervalle et à la
  fermeture ;
- `packs/<id>/` — packs extraits (E4).

JSON plutôt que SQLite : les volumes sont minuscules (quelques Ko) et on évite ~1 Mo de
binaire et une dépendance native.

---

## 11. Démarrage & tray

- `tauri-plugin-single-instance` : un second lancement réaffiche simplement le compagnon.
- `tauri-plugin-autostart` : entrée *Lancer au démarrage* cochable dans le tray
  (clé `HKCU\…\Run` sous Windows), lance l'app avec `--autostart`.
- Clic gauche sur l'icône : afficher/masquer. Clic droit : menu complet.
- `Alt+F4` sur l'overlay ne ferme pas l'app : il la masque. Seul *Quitter* termine.

## 12. Interface

**Direction artistique : « console de poche » pixel-art.** L'interface doit convenir à
n'importe quel compagnon (robot, animal, créature…), elle reste donc neutre :
- fonds sombres gris-bleu ;
- cadres crantés comme des sprites, ombres dures ;
- typographie monospace ;
- icônes dessinées au pixel (`npm run ui-icons` → `public/ui/icons.png`).

**Une seule couleur d'accent**, celle du compagnon actif (`ui/theme.ts`) : le champ
`accentColor` du manifeste, ou à défaut la couleur vive dominante de sa planche. Les
fonds en reçoivent une légère teinte (`color-mix`). Byte est menthe, Sakura est rose.

**Structure :**
- le menu radial ne garde que les actions rapides (nourrir, friandise, jouer, sieste,
  note, jouets, Console) ; le nom de l'action survolée s'affiche dessous ;
- une seule fenêtre, la **Console**, regroupe les rubriques en onglets (Fiche, Jouets,
  Look, Salon, Réglages) ; chaque rubrique est une `Section` qui reçoit
  `onShow`/`onHide` (rafraîchissement 1 Hz de la fiche, recherche de salons…) ;
- les textes sont courts ; les explications passent en infobulles (`title`).

**Accessibilité** : avec « animations désactivées » dans Windows
(`prefers-reduced-motion`), les animations CSS sont coupées. Tout élément éphémère
(particules, papier d'une note, dégâts) est donc retiré par minuterie, et pas seulement
sur `animationend`.
