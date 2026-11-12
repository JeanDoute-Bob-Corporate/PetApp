# Desktop Companion — Architecture (Étapes 1 et 2)

Ce document fixe les choix structurants du projet : arborescence, flux de données,
budget de ressources et stratégie d'optimisation. Le format des packs est décrit dans
[COMPANION_FORMAT.md](COMPANION_FORMAT.md).

---

## 1. Arborescence complète

Les fichiers marqués `(E3)`, `(E4)` seront créés aux étapes suivantes.

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
│  └─ spritesheet.png             # généré par `npm run companion` (192×576, 18 lignes)
├─ scripts/
│  ├─ lib/robotPainter.ts         # Robot pixel-art procédural, une frame = un FrameSpec
│  ├─ lib/png.ts                  # Encodeur PNG sans dépendance
│  ├─ build-default-companion.ts  # Table des 18 animations → planche + animations.json
│  ├─ gen-icon.ts                 # Icône de l'app depuis le sprite
│  └─ measure-memory.ps1          # Mémoire/CPU par processus (`npm run measure`)
├─ src/                           # Frontend TypeScript strict
│  ├─ main.ts                     # Bootstrap : réglages, pack, monde, boucle, événements
│  ├─ styles.css
│  ├─ platform/
│  │  ├─ bridge.ts                # Wrappers typés des commandes/événements Tauri
│  │  └─ HitboxSync.ts            # Envoi dédupliqué/throttlé (10 Hz) des hitbox
│  ├─ engine/
│  │  ├─ GameLoop.ts              # Pas fixe 60 Hz, rendu capé, 3 niveaux d'activité
│  │  ├─ SpriteLayer.ts           # Petit canvas par entité, déplacé par transform GPU
│  │  ├─ pack.ts                  # Chargement + contrôle d'un pack (manifest, planche)
│  │  ├─ Animator.ts              # Lecture de animations.json, next, events de frame
│  │  ├─ World.ts                 # Sols (zones de travail) + plateformes (haut des fenêtres)
│  │  └─ Physics.ts               # Gravité, friction, rebonds, sauts balistiques, suivi
│  ├─ entities/
│  │  ├─ Companion.ts             # Physique + animations + contrôleur provisoire
│  │  └─ Toy.ts                   (E3)
│  ├─ ai/
│  │  ├─ StateMachine.ts          (E3)
│  │  └─ UtilityAI.ts             (E3)
│  ├─ network/
│  │  ├─ P2PManager.ts            (E4) WebRTC DataChannels
│  │  └─ Combat.ts                (E4) simulation déterministe
│  └─ ui/
│     ├─ Bubble.ts                # Bulle de dialogue au-dessus du compagnon
│     ├─ DebugOverlay.ts          # Sols/plateformes visibles (navigateur ou `?debug`)
│     ├─ RadialMenu.ts            (E3)
│     ├─ SettingsPanel.ts         (E3)
│     ├─ PackManager.ts           (E4)
│     └─ Lobby.ts                 (E4)
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
      ├─ package_loader.rs        (E4) lecture/validation/extraction .companion
      └─ p2p_bridge.rs            (E4) découverte LAN (UDP broadcast) + signalisation
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

## 8. Persistance

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

## 9. Démarrage & tray

- `tauri-plugin-single-instance` : un second lancement réaffiche simplement le compagnon.
- `tauri-plugin-autostart` : entrée *Lancer au démarrage* cochable dans le tray
  (clé `HKCU\…\Run` sous Windows), lance l'app avec `--autostart`.
- Clic gauche sur l'icône : afficher/masquer. Clic droit : menu complet.
- `Alt+F4` sur l'overlay ne ferme pas l'app : il la masque. Seul *Quitter* termine.
