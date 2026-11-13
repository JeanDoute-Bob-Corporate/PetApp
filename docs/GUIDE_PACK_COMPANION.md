# Créer un pack `.companion` — guide complet

Ce guide explique **tout ce qu'il faut pour créer un compagnon valide** : dessins,
fichiers, règles vérifiées par l'application et méthode de test. Il est autonome : tu
peux le transmettre tel quel à un·e artiste ou à une IA. La [section 10](#10-brief-à-copier-pour-une-ia-ou-un-artiste)
contient un brief prêt à copier.

> **Version du format : 1.** Référence technique condensée :
> [`COMPANION_FORMAT.md`](COMPANION_FORMAT.md). Schémas JSON : [`schemas/`](../schemas).

---

## 0. L'essentiel en 12 points

1. Un pack est une **archive ZIP renommée en `.companion`**. Elle contient
   `manifest.json`, `animations.json` et une planche PNG, plus un dossier `sfx/` facultatif.
2. La planche est une **grille de cases de même taille**, par exemple 32 × 32 px.
   **Une ligne = une animation** ; ses images se lisent de gauche à droite.
3. Le compagnon est **dessiné de profil, tourné vers la droite**. Le moteur retourne
   l'image pour l'autre sens.
4. Dans chaque case, **les pieds touchent la dernière ligne de pixels**. Le point
   `feet` se place au milieu du bas de la case.
5. Le fond est **transparent** et le dessin en **pixel art net** : ni flou, ni anticrénelage.
6. Les **18 animations obligatoires** doivent toutes exister (voir la [section 4](#4-les-animations)).
7. Les **20 animations facultatives** donnent vie au compagnon. Si l'une d'elles manque,
   l'animation `idle` la remplace.
8. `attack_light`, `attack_heavy`, `poke` et `throw` ont besoin d'un **événement `hit`**,
   et `train` d'un **événement `particle` `impact`**. Sans eux, il ne frappe pas la balle,
   ne cogne pas le sac, et ainsi de suite.
9. Pour l'**`id`**, choisis un identifiant inversé en minuscules (`dev.pseudo.nom`).
   La **`version`** suit le format `1.0.0`.
10. Limites : **10 Mo** maximum, planche **2048 × 2048** maximum, **64 fichiers** maximum,
    seulement des fichiers `.json`, `.png`, `.ogg` et `.wav`.
11. `npm run pack -- mon-dossier` assemble le pack et le pré-vérifie.
12. L'**import dans l'application** fait la vérification finale (Console › Look, ou
    glisser le fichier sur le compagnon). En cas de refus, il liste chaque erreur.

---

## 1. Démarrer en 2 minutes

```text
examples/template/        ← modèle à copier (pack valide tel quel)
├─ manifest.json
├─ animations.json        ← même disposition que Byte : 38 lignes, 6 colonnes
└─ spritesheet.png        ← gabarit : cases grises à repeindre
```

1. Copie `examples/template/` vers un nouveau dossier, par exemple `mes-packs/renard/`.
2. Édite `manifest.json` : `id`, `name`, `author`, `description`, et la couleur
   `accentColor` si tu en veux une.
3. Repeins `spritesheet.png`. Chaque **case grise** est une image à dessiner, et les
   cases vides (transparentes) ne servent pas. Repères du gabarit :
   - le cadre **rouge** montre la hitbox ;
   - le trait **vert** montre l'endroit des pieds ;
   - le point **bleu** montre la position de la bulle.

   Efface ces repères en dessinant.
4. Assemble le pack :

   ```bash
   npm run pack -- mes-packs/renard
   ```

   Le résultat est `mes-packs/renard.companion`.
5. Glisse ce fichier sur ton compagnon. Ses statistiques et sa progression sont conservées.

Sans les outils du projet, il suffit de **zipper le contenu du dossier** puis de
renommer le `.zip` en `.companion`. Les fichiers doivent être à la racine de l'archive,
pas dans un sous-dossier.

---

## 2. La planche (spritesheet)

### 2.1 Grille

```text
            colonne 0   colonne 1   colonne 2   colonne 3 …
ligne 0   [  idle 0  ][  idle 1  ][  idle 2  ][  idle 3  ]…
ligne 1   [  walk 0  ][  walk 1  ][  walk 2  ][  walk 3  ]
ligne 2   [  run 0   ][  run 1   ]…
…
```

- **Toutes les cases ont la même taille**, déclarée dans `manifest.sprite`
  (`frameWidth` × `frameHeight`, de 8 à 256 px). 32 × 32 est un bon choix ; 48 × 48
  ou 64 × 64 conviennent pour plus de détails.
- **Dimensions de la planche** : largeur et hauteur doivent être des **multiples exacts**
  de la case. Exemple : 6 colonnes × 38 lignes de 32 px donnent 192 × 1216 px.
- Une animation occupe **une ligne** et commence à la colonne `startColumn` (0 par défaut).
- La planche fait **2048 × 2048 px au maximum**.
- **PNG RGBA** : le fond doit être transparent, sans halo autour du personnage.
- À l'écran, chaque pixel est agrandi `scale` fois (3 par défaut) **sans lissage**.
  Dessine donc en vrai pixel art, avec des pixels nets et une palette limitée.

### 2.2 Orientation et pieds

- Dessine le compagnon **tourné vers la droite**, et déclare `"facing": "right"`. Si
  ton dessin regarde vers la gauche, déclare `"facing": "left"`.
- **Les pieds (ou le bas du corps) reposent sur la dernière ligne de pixels de la case.**
  Si les pieds « flottent » au-dessus du bas, le compagnon flotte au-dessus des fenêtres.
- Garde le personnage **à la même place d'une case à l'autre**. Le point `feet` est
  fixe : un personnage qui se décale dans sa case paraît glisser.
- Laisse quelques pixels libres en haut de la case pour les sauts et les bras levés.

### 2.3 Points clés de la case

Toutes les coordonnées sont **en pixels de la case**, mesurées depuis son **coin
supérieur gauche** (x vers la droite, y vers le bas) :

```text
 (0,0) ┌────────────────────────────┐
       │            • bubble        │  ← départ des bulles de dialogue (au-dessus de la tête)
       │     ┌──────────────┐       │
       │     │   • head     │       │  ← tête (particules « zzz », émotes)
       │     │              │       │
       │     │ •handLeft  •handRight│  ← mains (objets portés, impacts)
       │     │   hitbox     │       │  ← zone cliquable / attrapable
       │     │              │       │
       └─────┴──────•───────┴───────┘ (frameWidth, frameHeight)
                   feet  ← contact avec le sol : (frameWidth/2, frameHeight)
```

| Point | Obligatoire | Rôle |
|---|---|---|
| `feet` | **oui** | Point posé sur le sol, les fenêtres et la barre des tâches. En général `(frameWidth/2, frameHeight)`. |
| `bubble` | **oui** | Point d'ancrage des bulles de dialogue. Place-le juste au-dessus de la tête. |
| `head`, `handLeft`, `handRight` | non | Utilisés par les événements `particle`/`emote` qui précisent un `anchor`. |
| autres (`tail`, `hat`…) | non | Libres, jusqu'à 16 points, utilisables comme `anchor` d'événement. |

**La hitbox** (`x`, `y`, `width`, `height`) est la zone où la souris peut
attraper, caresser ou double-cliquer le compagnon. Elle doit tenir dans la case.
Fais-la correspondre au corps visible : trop petite, il devient difficile à attraper ;
trop grande, elle « mange » les clics sur les fenêtres derrière lui.

---

## 3. Le moteur en deux mots (pour bien dessiner)

- Le compagnon vit sur le bureau : il marche sur la barre des tâches et sur le haut des
  fenêtres, saute de l'une à l'autre et escalade les bords de l'écran. On peut
  l'attraper, le lancer ou le secouer.
- Chaque **état** de son comportement joue une animation du même nom. Il marche avec
  `walk` et dort avec `sleep`. Une animation facultative absente est remplacée par `idle`.
- **Le dessin ne déplace pas le compagnon** : c'est le moteur qui le fait avancer. Une
  marche se dessine donc « sur place », comme un tapis roulant.
- Les animations non bouclées (`loop: false`) enchaînent sur `next` à la fin. Sans
  `next`, elles restent figées sur leur dernière image.

---

## 4. Les animations

Colonnes de « Byte » (référence) : nombre d'images (**img**) et images par seconde
(**fps**). Tu peux en mettre plus ou moins, jusqu'à 32 images par animation et 30 fps
au maximum.

### 4.1 Obligatoires (18) — le pack est refusé s'il en manque une

| Nom | img | fps | Boucle | Quand | Ce qu'il faut dessiner |
|---|---|---|---|---|---|
| `idle` | 6 | 4 | oui | au repos | Respiration légère, clignement d'yeux. **Animation de secours** de toutes les autres. |
| `walk` | 4 | 8 | oui | promenade | Cycle de marche sur place, de profil. Événements `footstep` facultatifs. |
| `run` | 4 | 12 | oui | course, poursuite | Cycle de course plus ample, penché vers l'avant. |
| `jump` | 4 | 12 | non → `fall` | impulsion | Accroupi puis détente vers le haut. **L'image 0 est la pose accroupie**, figée avant chaque saut. |
| `fall` | 2 | 8 | oui | en l'air | Bras écartés ou levés, corps tendu. |
| `climb` | 4 | 6 | oui | escalade d'un mur | **Profil, tourné vers la droite, collé à un mur imaginaire au bord droit de la case.** Mains en haut (~70 % de la hauteur), dans la dernière colonne. Le moteur le retourne pour le mur de gauche. |
| `sit_window` | 4 | 3 | oui | assis sur une fenêtre | Assis, les fesses sur la dernière ligne. Jambes repliées devant ou pendantes : elles ne doivent pas dépasser sous la case. |
| `grab_edge` | 3 | 6 | oui | accroché au rebord d'une fenêtre | Profil vers la droite, **mains vers le quart supérieur de la case** (le rebord), corps pendu en dessous. |
| `sleep` | 4 | 2 | oui | sieste | Allongé ou recroquevillé. Prévoir l'événement `particle` `zzz`. |
| `eat` | 4 | 6 | non → `idle` | repas | Mâche, savoure. |
| `play` | 6 | 10 | oui | joue | Joie, petits bonds. |
| `train` | 6 | 12 | oui | frappe le sac | Enchaînement de coups vers la droite. **Événement `particle` `impact` à l'image du coup** : il fait osciller le sac. |
| `dragged` | 4 | 10 | oui | tenu par la souris | Gigote, pieds dans le vide. |
| `attack_light` | 4 | 14 | non → `idle` | coup rapide, tir dans la balle | **Événement `hit` à l'image du contact** : c'est cet instant qui frappe la balle et inflige les dégâts. |
| `attack_heavy` | 6 | 12 | non → `idle` | coup puissant | Élan puis frappe. **Événement `hit`** au contact (+ `particle` `impact` conseillé). |
| `hurt` | 3 | 10 | non → `idle` | touché | Recul, grimace. |
| `victory` | 6 | 8 | oui | victoire | Bras levés, saut de joie. `emote` `star` conseillé. |
| `defeat` | 4 | 6 | non | défaite | S'effondre ; reste sur la dernière image. |

### 4.2 Facultatives (20) — fortement conseillées

| Nom | img | fps | Boucle | Quand | Ce qu'il faut dessiner |
|---|---|---|---|---|---|
| `wave` | 4 | 6 | oui | arrivée, réclame de l'attention | Coucou de la main, face au joueur ou de trois quarts. |
| `wall_hang` | 3 | 2 | oui | pause sur un mur | Même pose que `climb`, immobile, il souffle. |
| `hang_ceiling` | 4 | 5 | oui | suspendu au plafond (« Tarzan ») | Profil vers la droite, **mains en haut de la case (ligne 0)**, corps pendu, il avance main sur main. |
| `dizzy` | 2 | 4 | oui | après avoir été secoué | Tête qui tourne, yeux en spirale, titube. |
| `vomit` | 4 | 4 | non → `idle` | suite de `dizzy` | Penché en avant, malade. |
| `grumpy` | 4 | 4 | oui | boude, fait des bêtises | Bras croisés, sourcils froncés. |
| `sulk` | 2 | 1 | oui | délaissé | Assis, dos voûté, triste. |
| `carry` | 4 | 8 | oui | marche en portant un objet | Marche, **les deux bras tendus devant lui à ~1/3 de la hauteur** : l'objet porté y est dessiné par le moteur. |
| `carry_idle` | 2 | 2 | oui | tient un objet, garde en combat | Même pose de bras que `carry`, sur place. |
| `throw` | 4 | 6 | non → `idle` | lance une note en boule de papier | Armé puis lancer vers la droite. **Événement `hit` à l'image du lâcher.** |
| `poke` | 4 | 6 | non → `idle` | clique sur l'écran (bêtise) | Tend le bras et appuie. **Événement `hit` à l'image du clic.** |
| `push` | 2 | 4 | oui | pousse une fenêtre | Profil, mains contre un mur à droite, effort. |
| `pull` | 2 | 4 | oui | tire une fenêtre | Profil, penché en arrière, tire vers la gauche. |
| `pet` | 2 | 4 | oui | caressé | Yeux fermés, ravi. |
| `yawn` | 4 | 4 | non → `idle` | fatigue | Bâille. |
| `stretch` | 4 | 4 | non → `idle` | réveil | S'étire. |
| `look` | 6 | 3 | oui | observe | Regarde à gauche, à droite, en l'air. |
| `scared` | 3 | 6 | non → `idle` | sursaute (souris brusque) | Sursaut, poils/antennes dressés. |
| `trip` | 4 | 6 | non → `idle` | trébuche | Trébuche et se rattrape. |
| `type` | 4 | 6 | oui | code au terminal | Assis ou debout, tape sur un clavier. |

Tu peux ajouter **d'autres animations** (noms en `snake_case`) : elles sont acceptées
et ignorées par le moteur, ce qui est pratique pour préparer une future version.

---

## 5. `animations.json`

```jsonc
{
  "formatVersion": 1,
  "animations": {
    "idle": { "row": 0, "frameCount": 6, "fps": 4, "loop": true },
    "jump": { "row": 3, "frameCount": 4, "fps": 12, "loop": false, "next": "fall" },
    "attack_light": {
      "row": 13, "frameCount": 4, "fps": 14, "loop": false, "next": "idle",
      "events": [{ "frame": 2, "type": "hit" }]
    },
    "attack_heavy": {
      "row": 14, "frameCount": 6, "fps": 12, "loop": false, "next": "idle",
      "frameDurations": [120, 80, 80, 60, 140, 120],
      "events": [
        { "frame": 4, "type": "hit" },
        { "frame": 4, "type": "particle", "id": "impact", "anchor": "handRight" }
      ]
    }
  }
}
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `row` | oui | Ligne de la planche (0 = première). |
| `startColumn` | non | Première colonne (0 par défaut). `startColumn + frameCount` ≤ nombre de colonnes. |
| `frameCount` | oui | 1 à 32. |
| `fps` | oui | > 0 et ≤ 30. |
| `loop` | oui | `true` (boucle) ou `false`. |
| `next` | non | Animation jouée à la fin (seulement si `loop: false`). Doit exister. |
| `frameDurations` | non | Durée de chaque image en ms (16 à 5000), **exactement `frameCount` valeurs**. Remplace `fps`. |
| `events` | non | Liste d'événements déclenchés à une image donnée (voir ci-dessous). |

Aucun autre champ n'est accepté.

### Événements

| `type` | Champs | Effet |
|---|---|---|
| `hit` | — | Instant de l'impact : frappe la balle, inflige les dégâts, lâche la note, clique. |
| `particle` | `id`, `anchor?`, `offset?` | Affiche une particule (si le profil n'est pas « Éco »). |
| `emote` | `id`, `anchor?`, `offset?` | Comme `particle`, mais toujours affichée. |
| `sound` | `id` | Joue le son `id` de `manifest.sounds` (si les sons sont activés). |
| `footstep` | — | Pas : petit nuage de poussière pendant la course. |
| `custom` | `id` | Réservé (accepté, sans effet aujourd'hui). |

- `frame` doit être **strictement inférieur à `frameCount`** (la première image vaut 0).
- **Particules disponibles** (`id`) : `zzz`, `heart`, `impact`, `sweat`, `star`,
  `anger`, `note`, `food`, `sparkle`, `alert`, `dust`, `sick`.
- `anchor` doit être un point de `anchorPoints`. `offset` vaut `{ "x": …, "y": … }`,
  en pixels de case, entre −256 et 256.

---

## 6. `manifest.json`

```jsonc
{
  "formatVersion": 1,
  "id": "dev.pseudo.renard",             // unique, minuscules, au moins un point ou tiret
  "name": "Roux",                         // 1 à 32 caractères (son nom par défaut)
  "author": "Pseudo",                     // 1 à 64 caractères
  "version": "1.0.0",                     // format 1.2.3
  "description": "Un renard curieux.",    // facultatif, 280 caractères max
  "license": "CC-BY-4.0",                 // facultatif, 64 caractères max
  "minAppVersion": "0.1.0",               // facultatif
  "tags": ["animal", "renard"],           // facultatif, 8 max
  "accentColor": "#ff8a3d",               // facultatif : couleur de l'interface (#rrggbb)
  "sprite": {
    "file": "spritesheet.png",            // un .png à la racine de l'archive
    "frameWidth": 32, "frameHeight": 32,  // 8 à 256
    "scale": 3,                            // facultatif, 1 à 8 (agrandissement à l'écran)
    "facing": "right"                      // facultatif : sens du dessin d'origine
  },
  "hitbox": { "x": 6, "y": 4, "width": 20, "height": 28 },
  "anchorPoints": {
    "feet":   { "x": 16, "y": 32 },
    "bubble": { "x": 16, "y": 2 },
    "head":   { "x": 16, "y": 10 },
    "handLeft":  { "x": 8,  "y": 22 },
    "handRight": { "x": 24, "y": 22 }
  },
  "baseStats": { "strength": 5, "agility": 5, "endurance": 5, "technique": 5 },
  "personalityWeights": {
    "playful": 1, "lazy": 1, "curious": 1, "social": 1,
    "brave": 1, "glutton": 1, "mischievous": 1
  },
  "sounds": { "boing": "sfx/boing.ogg" }   // facultatif
}
```

Le manifeste est lu **strictement** : un champ inconnu ou mal orthographié fait refuser
le pack. Le champ `"$schema"` est toléré.

### Couleur de l'interface (`accentColor`)

Quand ton compagnon est actif, toute l'interface prend sa couleur : la Console, les
boutons, les jauges et le menu radial. Choisis une couleur **assez claire et vive** :
elle sert de fond aux boutons, avec du texte foncé par-dessus. Sans `accentColor`,
l'application prend la couleur vive la plus présente sur ta planche.

### Statistiques de départ (`baseStats`)

Chaque statistique vaut de 1 à 20. Elles servent au combat et progressent ensuite par
l'entraînement. Pour un compagnon équilibré, vise un **total de 20 à 24**. Exemple :
`4 / 8 / 5 / 6` pour un compagnon agile.

### Personnalité (`personalityWeights`)

Chaque trait est un multiplicateur de 0 à 3 (1 = normal ; 0 = jamais ; 2 = souvent).
Un trait absent vaut 1.

| Trait | Influence |
|---|---|
| `playful` | jouer à la balle, poursuivre le curseur |
| `lazy` | rester au repos, s'asseoir, bâiller, faire la sieste |
| `curious` | se promener, explorer les fenêtres, regarder autour, coder au terminal |
| `social` | réclamer de l'attention, aller voir les compagnons des amis |
| `brave` | escalader, s'entraîner |
| `glutton` | manger |
| `mischievous` | chasser les bugs, faire des bêtises (si elles sont activées) |

---

## 7. Sons (facultatif)

- Les fichiers vont dans `sfx/`, au format `.ogg` (conseillé) ou `.wav`, **512 Ko
  maximum chacun**.
- Déclare-les dans `manifest.sounds` : un identifiant (`snake_case`) associé à un chemin
  `sfx/…`.
- Joue-les avec un événement : `{ "frame": 1, "type": "sound", "id": "boing" }`.
- Garde des sons **courts et discrets** : le compagnon vit sur le bureau de quelqu'un.

---

## 8. Règles de validation (liste complète)

L'application vérifie tout cela à l'import et **liste chaque erreur**, au format
« fichier › champ : explication ».

**Archive**
- Fichier ZIP valide de 10 Mo maximum, avec 64 entrées au maximum et 24 Mo une fois
  décompressé.
- `manifest.json` et `animations.json` **à la racine** : pas de dossier englobant.
- Seulement des fichiers `.json` (256 Ko max), `.png`, `.ogg` et `.wav`.
- Pas de chemin absolu, de `..`, d'antislash ni de lien symbolique.

**Manifeste**
- `formatVersion` vaut 1.
- `id` est en minuscules, de la forme `a.b` ou `a-b` (3 à 64 caractères), et différent
  de `dev.default.byte`.
- `name` fait 1 à 32 caractères et `author` 1 à 64.
- `version` (et `minAppVersion`) suivent le format `1.2.3`.
- `description` fait 280 caractères au maximum, `license` 64 au maximum, et il y a
  8 `tags` au maximum.
- `accentColor` est au format `#rrggbb`.
- Pour le sprite :
  - `sprite.file` est un `.png` à la racine ;
  - les cases mesurent de 8 à 256 px ;
  - `scale` vaut de 1 à 8 ;
  - `facing` vaut `left` ou `right`.
- `hitbox` est non vide et contenue dans la case.
- `anchorPoints` contient `feet` et `bubble`, 16 points au maximum, tous dans la case.
- Chaque `baseStats` est un entier de 1 à 20.
- `personalityWeights` : seulement les 7 traits connus, de 0 à 3.
- Pour les `sounds` : 32 au maximum, `id` en `snake_case`, chemins de la forme
  `sfx/….ogg|.wav`, et chaque fichier présent dans l'archive.

**Planche**
- PNG valide et non corrompu, de 2048 × 2048 maximum.
- Largeur et hauteur multiples exacts de la case.

**Animations**
- `formatVersion` vaut 1.
- Les 18 animations obligatoires sont présentes, avec 64 animations au maximum et des
  noms en `snake_case`.
- `frameCount` vaut de 1 à 32 et `fps` est > 0 et ≤ 30.
- `row` est dans la planche et `startColumn + frameCount` ≤ nombre de colonnes.
- `frameDurations` contient exactement `frameCount` valeurs, de 16 à 5000 ms.
- `next` désigne une animation existante.
- Pour les événements :
  - `frame` < `frameCount` ;
  - `type` est connu, et `id` est obligatoire pour `sound`, `particle`, `emote` et `custom` ;
  - un `sound` désigne une clé de `manifest.sounds` ;
  - un `anchor` désigne un point existant ;
  - `offset` est dans −256…256.

**Erreurs fréquentes**

| Message | Cause | Correction |
|---|---|---|
| `manifest.json manquant à la racine de l'archive` | Le dossier a été zippé, pas son contenu. | Zippe les fichiers eux-mêmes. |
| `… n'est pas un multiple de la case 32×32` | Planche recadrée ou marge ajoutée. | Ajuste la taille au multiple exact. |
| `… frames depuis la colonne 0 dépassent la largeur` | `frameCount` trop grand pour la planche. | Élargis la planche ou réduis `frameCount`. |
| `état obligatoire « … » manquant` | Animation absente ou mal nommée (`Idle`, `walking`…). | Respecte les noms exacts. |
| `champ inconnu` / `unknown field` | Faute de frappe dans un nom de champ. | Compare avec le modèle. |
| `id : « Mon Pack » invalide` | Majuscules, espaces ou pas de point. | `dev.pseudo.monpack`. |

---

## 9. Tester son pack

1. `npm run pack -- mon-dossier` vérifie les règles principales et crée le `.companion`.
2. Dans l'application, ouvre **Console › Look** et importe le fichier, ou glisse-le sur
   le compagnon. Les erreurs éventuelles s'affichent.
3. Clique sur **Appliquer**. Le compagnon change d'apparence ; ses statistiques ne
   bougent pas.
4. Vérifie ces points :
   - ses pieds touchent bien les fenêtres ;
   - la bulle est au-dessus de sa tête ;
   - il reste facile à attraper ;
   - il escalade le bord de l'écran sans décalage ;
   - il tire dans la balle (`attack_light` + `hit`) et cogne le sac (`train` + `impact`).
5. Pour revenir au compagnon d'origine, choisis **Byte** dans Console › Look.

---

## 10. Brief à copier pour une IA ou un artiste

> Copie le bloc ci-dessous et remplace les `<…>`.

```text
Je veux un personnage pour l'application de compagnon de bureau « Desktop Companion »,
livré au format de pack « .companion » (version 1).

PERSONNAGE
- Concept : <ex. un petit renard roux curieux, avec une écharpe bleue>
- Nom : <Roux>   Auteur : <pseudo>   Couleur d'interface : <#ff8a3d>
- Personnalité (0 à 3, 1 = normal) : playful <1.5>, lazy <0.8>, curious <1.6>,
  social <1.2>, brave <1>, glutton <1.3>, mischievous <1.1>
- Statistiques de départ (1 à 20, total conseillé 20 à 24) : force <5>, agilité <7>,
  endurance <5>, technique <5>

CONTRAINTES DE DESSIN
- Pixel art net (pas de flou ni d'anticrénelage), fond transparent, palette limitée.
- Cases de <32×32> px, toutes identiques. Une ligne de la planche = une animation ;
  images de gauche à droite à partir de la colonne 0.
- Personnage de profil, TOURNÉ VERS LA DROITE (le moteur le retourne pour aller à gauche).
- Les pieds touchent la dernière ligne de pixels de chaque case, centrés horizontalement ;
  le personnage ne se décale pas dans sa case d'une image à l'autre.
- Marche et course dessinées sur place.
- climb / wall_hang : de profil, collé à un mur imaginaire au bord DROIT de la case,
  mains en haut (~70 % de la hauteur) dans la dernière colonne.
- grab_edge : pendu par les mains à un rebord situé au quart supérieur de la case.
- hang_ceiling : pendu par les mains à la ligne 0 (plafond), avance main sur main.
- carry / carry_idle : bras tendus devant lui à ~1/3 de la hauteur (le moteur dessine l'objet).
- sit_window : assis, fesses sur la dernière ligne, rien ne dépasse sous la case.

ANIMATIONS (nom : images, fps, boucle)
Obligatoires : idle 6/4/oui · walk 4/8/oui · run 4/12/oui · jump 4/12/non→fall (image 0 =
accroupi) · fall 2/8/oui · climb 4/6/oui · sit_window 4/3/oui · grab_edge 3/6/oui ·
sleep 4/2/oui · eat 4/6/non→idle · play 6/10/oui · train 6/12/oui · dragged 4/10/oui ·
attack_light 4/14/non→idle · attack_heavy 6/12/non→idle · hurt 3/10/non→idle ·
victory 6/8/oui · defeat 4/6/non
Facultatives : wave 4/6 · wall_hang 3/2 · hang_ceiling 4/5 · dizzy 2/4 · vomit 4/4→idle ·
grumpy 4/4 · sulk 2/1 · carry 4/8 · carry_idle 2/2 · throw 4/6→idle · poke 4/6→idle ·
push 2/4 · pull 2/4 · pet 2/4 · yawn 4/4→idle · stretch 4/4→idle · look 6/3 ·
scared 3/6→idle · trip 4/6→idle · type 4/6

ÉVÉNEMENTS INDISPENSABLES (dans animations.json)
- attack_light, attack_heavy, poke, throw : { "type": "hit" } à l'image de l'impact.
- train : { "type": "particle", "id": "impact" } à l'image du coup.
- sleep : { "type": "particle", "id": "zzz" } à l'image 0.

LIVRABLES
1. spritesheet.png : <6> colonnes × <38> lignes de cases, dans l'ordre du tableau
   (même disposition que examples/template/animations.json).
2. manifest.json et animations.json conformes au guide docs/GUIDE_PACK_COMPANION.md
   (champs exacts, aucun champ en plus, id du type « dev.pseudo.nom », version « 1.0.0 »).
3. Le tout zippé (fichiers à la racine, pas de dossier) et renommé en <roux>.companion.
Vérifie chaque règle de la section 8 du guide avant de livrer.
```

> **Conseil pour une IA générative d'images** : demande d'abord **une seule image** de
> référence (personnage de profil, vers la droite, en pixel art à la taille finale).
> Fais ensuite produire les animations **ligne par ligne** à partir de cette référence.
> Réassemble la planche toi-même, en respectant la grille au pixel près. Les IA ont
> tendance à dériver en taille et en position d'une image à l'autre : vérifie les pieds
> sur la dernière ligne.

---

## 11. Questions fréquentes

**Mon pack n'a pas toutes les animations facultatives, est-ce grave ?**
Non. Une animation absente est remplacée par `idle`. Le compagnon fonctionne, mais il
est moins expressif. `npm run pack` liste celles qui manquent.

**Puis-je utiliser des cases non carrées, par exemple 32 × 48 ?**
Oui. `frameWidth` et `frameHeight` sont indépendants.

**Le multijoueur affiche-t-il mon pack chez mes amis ?**
Oui. Quand ton compagnon passe sur l'écran d'un ami, son apparence voyage avec lui.
Les sons, eux, restent chez toi.

**Les statistiques sont-elles perdues si je change de pack ?**
Non. Elles appartiennent au compagnon, pas au pack. Seules `baseStats` servent pour un
compagnon tout neuf.

**Le pack peut-il contenir du code ?**
Non. Un pack ne contient que des images, des sons et des données JSON. Tout est vérifié
avant d'être affiché.
