//! État partagé de l'application et point unique de mutation des réglages.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Emitter, Manager};

use crate::hit_test::HitState;
use crate::persistence;
use crate::settings::{Settings, SettingsPayload};
use crate::tray;

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub hit: Arc<HitState>,
}

/// Verrouille sans paniquer : un thread qui a paniqué en tenant le verrou ne doit
/// pas rendre l'application inutilisable (les données restent cohérentes ici).
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

pub fn snapshot(app: &AppHandle) -> Option<Settings> {
    app.try_state::<AppState>()
        .map(|state| lock(&state.settings).clone())
}

/// Modifie les réglages, les sauvegarde atomiquement, synchronise le tray et
/// notifie le frontend. Toute modification de réglage passe par ici.
pub fn mutate_settings(app: &AppHandle, mutate: impl FnOnce(&mut Settings)) -> SettingsPayload {
    let updated = match app.try_state::<AppState>() {
        Some(state) => {
            let mut guard = lock(&state.settings);
            mutate(&mut guard);
            guard.clone()
        }
        None => {
            let mut fallback = Settings::default();
            mutate(&mut fallback);
            fallback
        }
    };

    if let Err(err) = persistence::save_settings(app, &updated) {
        eprintln!("[settings] sauvegarde impossible : {err}");
    }
    tray::sync(app, &updated);

    let payload = SettingsPayload::from(&updated);
    if let Err(err) = app.emit("settings-changed", &payload) {
        eprintln!("[settings] notification impossible : {err}");
    }
    payload
}
