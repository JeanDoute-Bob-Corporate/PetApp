//! Backend Rust de Desktop Companion.
//!
//! Le backend fait tout ce qui touche l'OS ou doit tourner quand la webview dort :
//! fenêtre overlay, click-through, tray, persistance. Le rendu reste côté TypeScript.

mod commands;
mod hit_test;
mod mischief;
mod overlay;
mod p2p_bridge;
mod package_loader;
mod persistence;
mod settings;
mod state;
mod tray;
mod webview_memory;
mod window_tracker;

use std::sync::{Arc, Mutex};

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

use crate::hit_test::HitState;
use crate::state::AppState;
use crate::window_tracker::WorldStore;

/// Seconde instance de test (`DC_INSTANCE=2`) : données séparées, pas de verrou
/// d'instance unique. Sert à essayer le multijoueur sur une seule machine.
pub fn test_instance() -> Option<String> {
    std::env::var("DC_INSTANCE").ok().filter(|v| !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric()))
}

pub fn run() {
    let mut builder = tauri::Builder::default();
    if test_instance().is_none() {
        // Doit être le premier plugin : un second lancement (autostart + lancement
        // manuel, par exemple) réaffiche simplement le compagnon existant.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            overlay::set_visible(app, true);
        }));
    }
    builder
        // Mises à jour : vérifiées depuis le frontend, signées (clé publique dans tauri.conf.json).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::update_settings,
            commands::set_hitboxes,
            commands::set_pointer_capture,
            commands::set_cursor_tracking,
            commands::get_world,
            commands::load_companion,
            commands::save_companion,
            commands::get_autostart,
            commands::set_autostart,
            commands::debug_log,
            commands::dev_autotest,
            commands::nudge_window,
            commands::desktop_icons,
            commands::move_desktop_icon,
            commands::desktop_icon_for_name,
            commands::poke_screen,
            commands::set_keyboard_focus,
            commands::import_companion,
            commands::list_packs,
            commands::pack_file,
            commands::delete_pack,
            commands::p2p_status,
            commands::p2p_host,
            commands::p2p_browse,
            commands::p2p_connect,
            commands::p2p_send,
            commands::p2p_close,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let settings = persistence::load_settings(&handle);
            let hit = Arc::new(HitState::new());

            app.manage(AppState {
                settings: Mutex::new(settings.clone()),
                hit: Arc::clone(&hit),
            });
            app.manage(WorldStore::default());
            app.manage(mischief::MischiefState::default());
            app.manage(Arc::new(p2p_bridge::P2pState::new()));

            overlay::setup(&handle, &hit, settings.visible)?;
            tray::setup(&handle, &settings)?;
            window_tracker::spawn(handle.clone(), Arc::clone(&hit));
            hit_test::spawn(handle, hit);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Desktop Companion");
}
