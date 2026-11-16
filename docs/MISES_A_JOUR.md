# Publier une mise à jour

Depuis la version **0.1.1**, l'application se met à jour toute seule :
- **Quand elle vérifie** : 20 s après le démarrage, puis toutes les 6 h. On peut aussi
  vérifier à la main dans Console › Réglages › *Rechercher une mise à jour*.
- **Ce qu'elle propose** : s'il existe une version plus récente, une petite fenêtre
  propose de l'installer. Rien n'est installé sans un clic sur **Installer**.
- **Installation** : la mise à jour se fait en arrière-plan, puis l'application redémarre.
  Le compagnon, ses statistiques et ses réglages sont conservés.

## Comment ça marche

- L'application lit
  `https://github.com/JeanDoute-Bob-Corporate/PetApp/releases/latest/download/latest.json`,
  soit la dernière « Release » publiée du dépôt. **Le dépôt doit être public** : sinon le
  fichier est introuvable et aucune mise à jour n'est proposée.
- Chaque installateur est **signé**. L'application vérifie la signature avec la clé
  publique inscrite dans `src-tauri/tauri.conf.json` et refuse tout fichier modifié.

## La clé de signature — à sauvegarder absolument

- Clé privée : `%USERPROFILE%\.tauri\desktop-companion.key` (hors du dépôt, ne jamais
  la publier ni la commiter).
- **Fais-en une copie de sauvegarde** (clé USB, gestionnaire de mots de passe). Sans
  elle, impossible de signer une nouvelle version : les applications déjà installées ne
  pourront plus se mettre à jour, et tes amis devraient réinstaller à la main.

## Publier une version, étape par étape

1. **Augmente la version** au même numéro dans les trois fichiers suivants :
   - `package.json` ;
   - `src-tauri/tauri.conf.json` ;
   - `src-tauri/Cargo.toml`.

   Exemple : 0.1.1 → 0.1.2. Une application ne se met à jour que vers une version **plus
   grande**.
2. Lance :

   ```bash
   npm run release -- "Ce qui change, en une phrase"
   ```

   Résultat : le dossier `release/publier-<version>/` avec l'installateur signé et
   `latest.json`.
3. Sur GitHub : **Releases › Draft a new release**.
   - Tag : `v<version>`, par exemple `v0.1.2`. Le « v » est obligatoire.
   - Dépose les **deux fichiers** du dossier : l'installateur et `latest.json`.
   - Laisse cochée **Set as the latest release**, puis **Publish release**.
4. C'est tout. Les applications installées proposeront la mise à jour au prochain
   démarrage, ou dans les 6 h.

## Multijoueur

Un salon n'accepte que des joueurs **de la même version**. Un ami resté sur une ancienne
version reçoit un message lui demandant de se mettre à jour. Avec les mises à jour
automatiques, cela ne dure que le temps d'accepter la mise à jour.
