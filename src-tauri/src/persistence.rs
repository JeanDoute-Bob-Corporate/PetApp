//! Persistance locale en JSON avec écriture atomique.
//!
//! Stratégie : écrire `x.json.tmp` → `fsync` → copier l'ancien fichier en `x.json.bak`
//! → `rename(tmp, x.json)`. Sous Windows, `std::fs::rename` utilise
//! `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` : le fichier final est toujours soit
//! l'ancienne version complète, soit la nouvelle — jamais un fichier tronqué, même en
//! cas de coupure de courant pendant la sauvegarde.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::settings::Settings;

const SETTINGS_FILE: &str = "settings.json";

pub fn data_dir(app: &AppHandle) -> io::Result<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| io::Error::new(io::ErrorKind::NotFound, err.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

/// `Ok(None)` si le fichier n'existe pas encore (premier lancement).
pub fn read_json<T: DeserializeOwned>(path: &Path) -> io::Result<Option<T>> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err)),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err),
    }
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    {
        let mut file = File::create(&tmp)?;
        serde_json::to_writer_pretty(&mut file, value).map_err(io::Error::other)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    if path.exists() {
        // Best effort : l'absence de sauvegarde ne doit pas bloquer l'écriture.
        let _ = fs::copy(path, backup_path(path));
    }
    fs::rename(&tmp, path)
}

/// Charge les réglages ; un fichier corrompu bascule sur le `.bak`, puis sur les défauts.
pub fn load_settings(app: &AppHandle) -> Settings {
    let path = match data_dir(app) {
        Ok(dir) => dir.join(SETTINGS_FILE),
        Err(err) => {
            eprintln!("[persistence] dossier de données indisponible : {err}");
            return Settings::default();
        }
    };

    match read_json::<Settings>(&path) {
        Ok(Some(settings)) => settings,
        Ok(None) => Settings::default(),
        Err(err) => {
            eprintln!("[persistence] {SETTINGS_FILE} illisible ({err}), tentative avec la sauvegarde");
            read_json::<Settings>(&backup_path(&path))
                .ok()
                .flatten()
                .unwrap_or_default()
        }
    }
}

pub fn save_settings(app: &AppHandle, settings: &Settings) -> io::Result<()> {
    let path = data_dir(app)?.join(SETTINGS_FILE);
    write_json_atomic(&path, settings)
}
