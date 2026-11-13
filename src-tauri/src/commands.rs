//! Commandes IPC exposées au frontend. Elles restent minces : la logique vit dans
//! les modules métier.

use tauri::{AppHandle, Manager, State};

use crate::hit_test::HitRect;
use crate::settings::{Settings, SettingsPayload};
use crate::state::{self, AppState};
use crate::overlay::OVERLAY_LABEL;
use std::sync::Arc;

use crate::p2p_bridge::{self, P2pState};
use crate::{mischief, package_loader, persistence, tray};
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

#[tauri::command]
pub fn nudge_window(app: AppHandle, id: u64, edge: String, dx: f64) -> Result<f64, String> {
    mischief::nudge_window(&app, id, &edge, dx)
}

#[tauri::command]
pub fn desktop_icons(app: AppHandle) -> Result<Vec<mischief::DesktopIcon>, String> {
    mischief::desktop_icons(&app)
}

#[tauri::command]
pub fn move_desktop_icon(app: AppHandle, index: usize, x: f64, y: f64) -> Result<(), String> {
    mischief::move_desktop_icon(&app, index, x, y)
}

#[tauri::command]
pub fn desktop_icon_for_name(app: AppHandle, name: String) -> Option<usize> {
    mischief::desktop_icon_for_name(&app, &name)
}

#[tauri::command]
pub fn poke_screen(app: AppHandle, x: f64, y: f64) -> bool {
    mischief::poke(&app, x, y)
}

/// L'overlay ne prend jamais le focus… sauf pendant la saisie d'une note.
#[tauri::command]
pub fn set_keyboard_focus(app: AppHandle, enabled: bool) -> Result<(), String> {
    let win = app.get_webview_window(OVERLAY_LABEL).ok_or("overlay introuvable")?;
    win.set_focusable(enabled).map_err(|e| e.to_string())?;
    if enabled {
        win.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Import d'un pack : le corps de la requête est l'archive brute (pas de JSON).
#[tauri::command]
pub fn import_companion(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<package_loader::PackInfo, Vec<String>> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(vec!["requête invalide : archive attendue".into()]);
    };
    package_loader::import(&app, bytes)
}

#[tauri::command]
pub fn list_packs(app: AppHandle) -> Vec<package_loader::PackInfo> {
    package_loader::list(&app)
}

/// Fichier d'un pack installé, renvoyé en binaire (planche, JSON, sons).
#[tauri::command]
pub fn pack_file(app: AppHandle, id: String, file: String) -> Result<tauri::ipc::Response, String> {
    package_loader::read_file(&app, &id, &file).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn delete_pack(app: AppHandle, id: String) -> Result<(), String> {
    package_loader::delete(&app, &id)?;
    // Si c'était le pack actif, on revient au compagnon par défaut.
    if state::snapshot(&app).and_then(|s| s.active_pack).as_deref() == Some(id.as_str()) {
        state::mutate_settings(&app, |s| s.active_pack = None);
    }
    Ok(())
}

// --- Multijoueur ------------------------------------------------------------------

#[tauri::command]
pub fn p2p_status(p2p: State<'_, Arc<P2pState>>) -> p2p_bridge::P2pStatus {
    p2p_bridge::status(&p2p)
}

/// Ouvre / met à jour / ferme le salon dont on est l'hôte.
#[tauri::command]
pub fn p2p_host(app: AppHandle, p2p: State<'_, Arc<P2pState>>, open: bool, name: String, players: u32) -> Result<p2p_bridge::P2pStatus, String> {
    p2p_bridge::host(&app, &p2p, open, &name, players)
}

#[tauri::command]
pub fn p2p_browse(app: AppHandle, p2p: State<'_, Arc<P2pState>>, on: bool) -> p2p_bridge::P2pStatus {
    p2p_bridge::browse(&app, &p2p, on)
}

/// `target` : identifiant d'un salon découvert, ou code de session. Renvoie la connexion.
#[tauri::command]
pub async fn p2p_connect(app: AppHandle, target: String) -> Result<u32, String> {
    // Connexion bloquante (jusqu'à 4 s) : hors du thread principal.
    let p2p = Arc::clone(&*app.state::<Arc<P2pState>>());
    tauri::async_runtime::spawn_blocking(move || p2p_bridge::connect(&app, &p2p, &target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn p2p_send(p2p: State<'_, Arc<P2pState>>, conn: u32, message: String) -> Result<(), String> {
    p2p_bridge::send(&p2p, conn, &message)
}

/// Ferme une connexion, ou toutes si `conn` est absent.
#[tauri::command]
pub fn p2p_close(p2p: State<'_, Arc<P2pState>>, conn: Option<u32>) {
    p2p_bridge::close(&p2p, conn);
}

/// Pilote de test multijoueur (builds de développement uniquement) : `DC_AUTOTEST`.
#[tauri::command]
pub fn dev_autotest() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("DC_AUTOTEST").ok()
    } else {
        None
    }
}

/// Journal de diagnostic du frontend (builds de développement uniquement).
#[tauri::command]
pub fn debug_log(message: String) {
    if cfg!(debug_assertions) {
        println!("[webview] {}", message.chars().take(2000).collect::<String>());
    }
}

#[tauri::command]
pub fn load_companion(app: AppHandle) -> Option<serde_json::Value> {
    persistence::load_companion(&app)
}

#[tauri::command]
pub fn save_companion(app: AppHandle, data: serde_json::Value) -> Result<(), String> {
    if !data.is_object() {
        return Err("la progression doit être un objet JSON".into());
    }
    let size = serde_json::to_vec(&data).map_err(|e| e.to_string())?.len();
    if size > persistence::MAX_COMPANION_BYTES {
        return Err(format!("progression trop volumineuse ({size} octets)"));
    }
    persistence::save_companion(&app, &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    tray::autostart_enabled(&app)
}

/// Renvoie l'état réel après la tentative (l'OS peut refuser).
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> bool {
    tray::set_autostart(&app, enabled)
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
