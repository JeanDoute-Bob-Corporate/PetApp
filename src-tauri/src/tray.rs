//! Icône System Tray et menu rapide.

use std::thread;
use std::time::Duration;

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::overlay;
use crate::settings::{PerformanceProfile, Settings};
use crate::state;

const TRAY_ID: &str = "companion-tray";
const PROFILE_PREFIX: &str = "profile:";

/// Actions relayées telles quelles au frontend via l'événement `tray-action`.
const FRONTEND_ACTIONS: [&str; 4] = ["feed", "toys", "multiplayer", "settings"];

/// Poignées conservées pour resynchroniser les cases à cocher.
pub struct TrayHandles {
    profiles: Vec<(PerformanceProfile, CheckMenuItem<Wry>)>,
    autostart: CheckMenuItem<Wry>,
}

pub fn setup(app: &AppHandle, settings: &Settings) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Afficher / Masquer", true, None::<&str>)?;
    let feed = MenuItem::with_id(app, "feed", "Nourrir", true, None::<&str>)?;
    let toys = MenuItem::with_id(app, "toys", "Jouets", true, None::<&str>)?;
    let multiplayer = MenuItem::with_id(app, "multiplayer", "Multijoueur P2P", true, None::<&str>)?;

    let profiles = PerformanceProfile::ALL
        .into_iter()
        .map(|profile| {
            CheckMenuItem::with_id(
                app,
                format!("{PROFILE_PREFIX}{}", profile.id()),
                profile.label(),
                true,
                profile == settings.performance_profile,
                None::<&str>,
            )
            .map(|item| (profile, item))
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let profile_items: Vec<&dyn IsMenuItem<Wry>> = profiles
        .iter()
        .map(|(_, item)| item as &dyn IsMenuItem<Wry>)
        .collect();
    let profile_menu = Submenu::with_id_and_items(app, "profile", "Profil de performance", true, &profile_items)?;

    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(app, "autostart", "Lancer au démarrage", true, autostart_enabled, None::<&str>)?;
    let settings_item = MenuItem::with_id(app, "settings", "Paramètres…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle,
            &PredefinedMenuItem::separator(app)?,
            &feed,
            &toys,
            &multiplayer,
            &PredefinedMenuItem::separator(app)?,
            &profile_menu,
            &autostart,
            &settings_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Desktop Companion")
        .menu(&menu)
        // Clic gauche = afficher/masquer ; clic droit = menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                overlay::toggle_visibility(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayHandles { profiles, autostart });
    Ok(())
}

/// Délai laissé au frontend pour sauvegarder la progression avant de quitter.
const QUIT_FLUSH_DELAY: Duration = Duration::from_millis(400);

fn quit(app: &AppHandle) {
    let _ = app.emit("flush-save", ());
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(QUIT_FLUSH_DELAY);
        app.exit(0);
    });
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    match id {
        "toggle" => overlay::toggle_visibility(app),
        "autostart" => {
            let enabled = autostart_enabled(app);
            set_autostart(app, !enabled);
        }
        "quit" => quit(app),
        action if FRONTEND_ACTIONS.contains(&action) => {
            if !overlay::is_visible(app) {
                overlay::set_visible(app, true);
            }
            let _ = app.emit("tray-action", action);
        }
        other => {
            if let Some(profile) = other.strip_prefix(PROFILE_PREFIX).and_then(PerformanceProfile::from_id) {
                state::mutate_settings(app, |s| s.performance_profile = profile);
            }
        }
    }
}

pub fn autostart_enabled(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Active/désactive le lancement au démarrage ; renvoie l'état réel de l'OS.
pub fn set_autostart(app: &AppHandle, enabled: bool) -> bool {
    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if let Err(err) = result {
        eprintln!("[tray] autostart : {err}");
    }
    // On affiche l'état réel de l'OS, pas l'état souhaité.
    let now_enabled = launcher.is_enabled().unwrap_or(!enabled);
    if let Some(handles) = app.try_state::<TrayHandles>() {
        let _ = handles.autostart.set_checked(now_enabled);
    }
    let _ = app.emit("autostart-changed", now_enabled);
    now_enabled
}

/// Les CheckMenuItem se cochent tout seuls au clic : on impose le comportement radio.
pub fn sync(app: &AppHandle, settings: &Settings) {
    if let Some(handles) = app.try_state::<TrayHandles>() {
        for (profile, item) in &handles.profiles {
            let _ = item.set_checked(*profile == settings.performance_profile);
        }
    }
}
