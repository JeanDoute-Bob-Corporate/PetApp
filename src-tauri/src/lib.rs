//! Backend Rust de Desktop Companion.
//!
//! Le backend fait tout ce qui touche l'OS ou doit tourner quand la webview dort :
//! fenêtre overlay, click-through, tray, persistance. Le rendu reste côté TypeScript.

mod commands;
mod hit_test;
mod overlay;
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

pub fn run() {
    tauri::Builder::default()
        // Doit être le premier plugin : un second lancement (autostart + lancement
        // manuel, par exemple) réaffiche simplement le compagnon existant.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            overlay::set_visible(app, true);
        }))
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

            overlay::setup(&handle, &hit, settings.visible)?;
            tray::setup(&handle, &settings)?;
            window_tracker::spawn(handle.clone(), Arc::clone(&hit));
            hit_test::spawn(handle, hit);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("échec du démarrage de Desktop Companion");
}
