# Mises à jour automatiques

Depuis la version **0.1.1**, tout se fait tout seul :

```text
tu pousses sur main ──► GitHub construit, signe et publie la version ──► l'app de tes amis la propose
   (version augmentée)       (.github/workflows/release.yml, ~10 min)        (au démarrage ou sous 6 h)
```

- **Côté joueurs** : l'application vérifie 20 s après le démarrage, puis toutes les 6 h.
  On peut aussi vérifier à la main dans Console › Réglages › *Rechercher une mise à
  jour*. Une petite fenêtre propose d'**installer** : rien ne s'installe sans ce clic.
  Le compagnon, ses statistiques et ses réglages sont conservés.
- **Côté publication** : GitHub ne publie que si le **numéro de version a changé**.
  Tu peux donc pousser du travail en cours sans envoyer de mise à jour à tes amis.

## Publier une nouvelle version

```bash
npm run bump
```

Le numéro augmente partout d'un coup (0.1.1 → 0.1.2). Ensuite, commite et pousse sur
`main`, et c'est tout. Les notes de version sont générées à partir des messages de
commit.

- Pour des nouveautés plus importantes : `npm run bump -- minor` (0.1.x → 0.2.0).
- Pour suivre la publication : onglet **Actions** du dépôt, workflow « Publication ».
  Une fois au vert, la Release `v0.1.2` apparaît dans **Releases**.

## À faire une seule fois

### 1. Rendre le dépôt public
*Settings › General › Danger Zone › Change visibility › Make public.* Sans cela, les
applications de tes amis ne peuvent pas lire les Releases.

### 2. Donner la clé de signature à GitHub
GitHub a besoin de la clé privée pour signer les versions.

1. Copie la clé dans le presse-papiers. Dans PowerShell :

   ```powershell
   Get-Content "$env:USERPROFILE\.tauri\desktop-companion.key" -Raw | Set-Clipboard
   ```

2. Sur GitHub, ouvre **Settings › Secrets and variables › Actions › New repository secret**.
3. Remplis le secret :
   - **Name** : `TAURI_SIGNING_PRIVATE_KEY`
   - **Secret** : colle le contenu copié.
4. Clique sur **Add secret**.

GitHub chiffre ce secret, et personne ne peut le relire, même dans un dépôt public. Si
le secret manque, le workflow s'arrête avec un message clair au lieu de publier une
version non signée.

### 3. Faire installer la 0.1.1 une dernière fois à la main
Les versions 0.1.0 déjà installées ne savent pas encore se mettre à jour. Dès que la
0.1.1 est publiée, toi et tes amis l'installez une fois depuis la page **Releases**.
Ensuite, plus jamais.

## La clé de signature — à sauvegarder absolument

- Fichier : `%USERPROFILE%\.tauri\desktop-companion.key`. Il est hors du dépôt : ne le
  commite jamais et ne le publie jamais.
- **Fais-en une copie de sauvegarde** (clé USB, gestionnaire de mots de passe). Sans
  elle, plus aucune mise à jour n'est possible pour les applications déjà installées.

## Sécurité

Chaque installateur est **signé**. L'application vérifie la signature avec la clé
publique inscrite dans `src-tauri/tauri.conf.json` et refuse tout fichier modifié. Même
quelqu'un qui pirate la page Releases ne peut pas faire installer autre chose.

## Plan B : publier à la main

Sans GitHub Actions, `npm run release -- "notes"` produit, dans
`release/publier-<version>/`, l'installateur signé et `latest.json`. Il suffit de les
déposer dans une Release GitHub `v<version>`.

## Multijoueur

Un salon n'accepte que des joueurs **de la même version**. Un joueur en retard est
prévenu ; avec les mises à jour automatiques, le décalage ne dure que le temps
d'accepter la mise à jour.
