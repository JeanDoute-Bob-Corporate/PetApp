//! Commandes IPC exposées au frontend. Elles restent minces : la logique vit dans
//! les modules métier.

use tauri::{AppHandle, State};

use crate::hit_test::HitRect;
use crate::settings::{Settings, SettingsPayload};
use crate::state::{self, AppState};
use crate::window_tracker::{WorldSnapshot, WorldStore};

#[tauri::command]
pub fn get_settings(app_state: State<'_, AppState>) -> SettingsPayload {
    SettingsPayload::from(&*state::lock(&app_state.settings))
}

/// Remplace les réglages (la visibilité reste pilotée par le tray).
#[tauri::command]
pub fn update_settings(app: AppHandle, settings: Settings) -> SettingsPayload {
    state::mutate_settings(&app, move |current| {
        let visible = current.visible;
        *current = settings;
        current.visible = visible;
    })
}

/// Zones interactives en pixels CSS de l'overlay. Appelée seulement quand elles changent.
#[tauri::command]
pub fn set_hitboxes(app_state: State<'_, AppState>, rects: Vec<HitRect>) {
    app_state.hit.set_rects(rects);
}

/// Force le mode interactif (drag en cours, menu ouvert).
#[tauri::command]
pub fn set_pointer_capture(app_state: State<'_, AppState>, active: bool) {
    app_state.hit.set_capture(active);
}

/// Dernier état du monde (écrans + fenêtres), pour l'initialisation du frontend.
#[tauri::command]
pub fn get_world(store: State<'_, WorldStore>) -> Option<WorldSnapshot> {
    state::lock(&store.0).clone()
}

/// Active l'événement `cursor-moved` (≤ 30 Hz) quand un comportement en a besoin.
#[tauri::command]
pub fn set_cursor_tracking(app_state: State<'_, AppState>, enabled: bool) {
    app_state.hit.set_cursor_tracking(enabled);
}
