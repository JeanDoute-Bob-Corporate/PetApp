//! Fenêtre overlay transparente couvrant l'ensemble des écrans.

use std::error::Error;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

use crate::hit_test::{HitState, OverlayGeometry};
use crate::state::{self, AppState};

pub const OVERLAY_LABEL: &str = "overlay";

pub fn setup(app: &AppHandle, hit: &Arc<HitState>, visible: bool) -> Result<(), Box<dyn Error>> {
    let win = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or("fenêtre overlay introuvable dans tauri.conf.json")?;

    fit_to_virtual_screen(&win)?;
    refresh_geometry(&win, hit);
    // Click-through par défaut : le thread de hit-test réactive la souris au besoin.
    win.set_ignore_cursor_events(true)?;
    crate::webview_memory::apply_low_memory_target(&win);

    let events_win = win.clone();
    let events_hit = Arc::clone(hit);
    win.on_window_event(move |event| match event {
        // Alt+F4 masque le compagnon au lieu de quitter ; seul le tray quitte.
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            set_visible(events_win.app_handle(), false);
        }
        WindowEvent::Moved(pos) => events_hit.update_geometry(|geo| {
            geo.origin_x = pos.x;
            geo.origin_y = pos.y;
        }),
        WindowEvent::ScaleFactorChanged { scale_factor, .. } => {
            events_hit.update_geometry(|geo| geo.scale = *scale_factor);
            // Windows redimensionne la fenêtre lors d'un changement de DPI : on la
            // remet aux dimensions du bureau virtuel, hors du callback d'événement.
            let win = events_win.clone();
            let hit = Arc::clone(&events_hit);
            thread::spawn(move || {
                if let Err(err) = fit_to_virtual_screen(&win) {
                    eprintln!("[overlay] recalage impossible : {err}");
                }
                refresh_geometry(&win, &hit);
            });
        }
        _ => {}
    });

    hit.set_visible(visible);
    if visible {
        win.show()?;
    }
    Ok(())
}

/// Place la fenêtre sur la boîte englobante de tous les moniteurs (coordonnées physiques).
fn fit_to_virtual_screen(win: &WebviewWindow) -> tauri::Result<()> {
    let monitors = win.available_monitors()?;
    let mut bounds: Option<(i32, i32, i32, i32)> = None;
    for monitor in &monitors {
        let pos = monitor.position();
        let size = monitor.size();
        let (l, t) = (pos.x, pos.y);
        let (r, b) = (l + size.width as i32, t + size.height as i32);
        bounds = Some(match bounds {
            None => (l, t, r, b),
            Some((bl, bt, br, bb)) => (bl.min(l), bt.min(t), br.max(r), bb.max(b)),
        });
    }
    let Some((left, top, right, bottom)) = bounds else {
        return Ok(());
    };

    win.set_position(PhysicalPosition::new(left, top))?;
    // -1 px : une fenêtre topmost recouvrant exactement l'écran serait traitée par
    // Windows comme une application plein écran (barre des tâches masquée, etc.).
    let width = (right - left).max(1) as u32;
    let height = ((bottom - top).max(2) as u32) - 1;
    win.set_size(PhysicalSize::new(width, height))?;
    Ok(())
}

fn refresh_geometry(win: &WebviewWindow, hit: &HitState) {
    if let (Ok(origin), Ok(scale)) = (win.inner_position(), win.scale_factor()) {
        hit.set_geometry(OverlayGeometry {
            origin_x: origin.x,
            origin_y: origin.y,
            scale,
        });
    }
}

/// Recale l'overlay après un changement de configuration des écrans.
pub fn refit(app: &AppHandle) {
    let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    if let Err(err) = fit_to_virtual_screen(&win) {
        eprintln!("[overlay] recalage impossible : {err}");
    }
    if let Some(app_state) = app.try_state::<AppState>() {
        refresh_geometry(&win, &app_state.hit);
    }
}

/// Masquage temporaire (application plein écran), distinct du choix de l'utilisateur.
static PAUSED: AtomicBool = AtomicBool::new(false);

/// Choix de l'utilisateur (persisté), indépendamment d'une pause plein écran.
pub fn is_visible(app: &AppHandle) -> bool {
    state::snapshot(app).is_some_and(|s| s.visible)
}

/// Affiche ou masque réellement la fenêtre et prévient le frontend.
fn apply_shown(app: &AppHandle, shown: bool) {
    let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    let result = if shown {
        // Réaffirme le topmost : d'autres fenêtres topmost peuvent être passées devant.
        win.show().and_then(|()| win.set_always_on_top(true))
    } else {
        win.hide()
    };
    if let Err(err) = result {
        eprintln!("[overlay] changement de visibilité impossible : {err}");
        return;
    }
    if let Some(app_state) = app.try_state::<AppState>() {
        app_state.hit.set_visible(shown);
    }
    let _ = app.emit("visibility-changed", shown);
}

pub fn set_visible(app: &AppHandle, visible: bool) {
    if is_visible(app) != visible {
        state::mutate_settings(app, |s| s.visible = visible);
    }
    apply_shown(app, visible && !PAUSED.load(Ordering::Relaxed));
}

/// Pause automatique pendant qu'une application plein écran est active.
pub fn set_paused(app: &AppHandle, paused: bool) {
    if PAUSED.swap(paused, Ordering::Relaxed) == paused {
        return;
    }
    if is_visible(app) {
        apply_shown(app, !paused);
    }
}

pub fn toggle_visibility(app: &AppHandle) {
    set_visible(app, !is_visible(app));
}
