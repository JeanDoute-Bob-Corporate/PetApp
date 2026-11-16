/**
 * Mises à jour automatiques (plugin updater de Tauri).
 *
 * L'application lit `latest.json` sur la dernière « Release » GitHub du projet. Chaque
 * installateur est signé : la signature est vérifiée avec la clé publique de
 * tauri.conf.json avant toute installation, un fichier modifié est refusé.
 * Hors Tauri (navigateur, tests), aucune mise à jour n'est jamais proposée.
 */
import { isTauri } from './bridge';

export interface AvailableUpdate {
  version: string;
  notes: string;
  /** Télécharge, vérifie et installe ; `onProgress` reçoit 0–1 (null si taille inconnue). */
  install(onProgress: (ratio: number | null) => void): Promise<void>;
}

export async function appVersion(): Promise<string> {
  if (!isTauri) return 'dev';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** Cherche une version plus récente ; null s'il n'y en a pas ou en cas de souci réseau. */
export async function findUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check({ timeout: 15_000 });
  if (!update) return null;
  return {
    version: update.version,
    notes: (update.body ?? '').trim(),
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        if (event.event === 'Progress') {
          done += event.data.chunkLength;
          onProgress(total > 0 ? Math.min(1, done / total) : null);
        }
        if (event.event === 'Finished') onProgress(1);
      });
      // Sous Windows l'installateur ferme l'application et la relance lui-même ;
      // ailleurs, on redémarre explicitement.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}
