//! Click-through dynamique.
//!
//! La fenêtre overlay ignore la souris par défaut. Un thread léger lit la position du
//! curseur (`GetCursorPos`, quelques microsecondes) et ne réactive les événements
//! souris que lorsque le curseur survole une zone interactive publiée par le frontend
//! (compagnon, jouet, menu). L'appel `set_ignore_cursor_events` n'a lieu qu'aux
//! transitions dedans/dehors, jamais à chaque tick.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::overlay::OVERLAY_LABEL;
use crate::state::lock;

const MAX_RECTS: usize = 64;
/// Marge autour des hitbox : couvre la latence entre le mouvement et la publication.
const HIT_MARGIN: f64 = 4.0;
/// Curseur en mouvement ou au-dessus d'une zone interactive.
const FAST_TICK: Duration = Duration::from_millis(16);
/// Curseur immobile, rien d'interactif dessous.
const IDLE_TICK: Duration = Duration::from_millis(60);
/// Overlay masqué.
const HIDDEN_TICK: Duration = Duration::from_millis(250);
/// Durée d'un « bail » de capture : le frontend le renouvelle tant qu'il en a besoin.
/// S'il ne le fait plus (page rechargée, script bloqué, relâchement perdu), l'overlay
/// redevient transparent aux clics tout seul : il ne peut jamais bloquer le PC.
const CAPTURE_LEASE: Duration = Duration::from_secs(3);
/// Débit maximal de l'événement `cursor-moved` vers la webview (~30 Hz).
const CURSOR_EMIT_INTERVAL: Duration = Duration::from_millis(33);

/// Rectangle interactif en pixels CSS, relatif au coin haut-gauche de l'overlay.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl HitRect {
    fn is_valid(&self) -> bool {
        [self.x, self.y, self.w, self.h].iter().all(|v| v.is_finite()) && self.w > 0.0 && self.h > 0.0
    }

    fn distance(&self, px: f64, py: f64) -> f64 {
        let dx = (self.x - px).max(px - (self.x + self.w)).max(0.0);
        let dy = (self.y - py).max(py - (self.y + self.h)).max(0.0);
        dx.hypot(dy)
    }

    fn contains(&self, px: f64, py: f64, margin: f64) -> bool {
        px >= self.x - margin
            && px <= self.x + self.w + margin
            && py >= self.y - margin
            && py <= self.y + self.h + margin
    }
}

/// Position physique de l'overlay et facteur d'échelle de sa webview.
#[derive(Debug, Clone, Copy)]
pub struct OverlayGeometry {
    pub origin_x: i32,
    pub origin_y: i32,
    pub scale: f64,
}

impl Default for OverlayGeometry {
    fn default() -> Self {
        Self { origin_x: 0, origin_y: 0, scale: 1.0 }
    }
}

/// Au-delà de cette distance des zones interactives, le curseur n'intéresse pas le
/// compagnon : on n'envoie qu'un dernier événement `near: false`.
const CURSOR_NEAR_RADIUS: f64 = 400.0;

#[derive(Clone, Copy, Serialize)]
struct CursorPayload {
    x: f64,
    y: f64,
    near: bool,
}

pub struct HitState {
    rects: Mutex<Vec<HitRect>>,
    geometry: Mutex<OverlayGeometry>,
    /// Forcé par le frontend pendant un drag ou une visée, jusqu'à cette échéance.
    capture_until: Mutex<Option<Instant>>,
    visible: AtomicBool,
    cursor_tracking: AtomicBool,
}

impl Default for HitState {
    fn default() -> Self {
        Self::new()
    }
}

impl HitState {
    pub fn new() -> Self {
        Self {
            rects: Mutex::new(Vec::new()),
            geometry: Mutex::new(OverlayGeometry::default()),
            capture_until: Mutex::new(None),
            visible: AtomicBool::new(true),
            cursor_tracking: AtomicBool::new(false),
        }
    }

    pub fn set_rects(&self, mut rects: Vec<HitRect>) {
        rects.retain(HitRect::is_valid);
        rects.truncate(MAX_RECTS);
        *lock(&self.rects) = rects;
    }

    pub fn set_capture(&self, active: bool) {
        *lock(&self.capture_until) = active.then(|| Instant::now() + CAPTURE_LEASE);
    }

    fn capturing(&self) -> bool {
        let mut until = lock(&self.capture_until);
        match *until {
            Some(t) if Instant::now() < t => true,
            Some(_) => {
                *until = None; // bail expiré : on rend la souris au bureau
                false
            }
            None => false,
        }
    }

    pub fn set_visible(&self, visible: bool) {
        self.visible.store(visible, Ordering::Relaxed);
    }

    pub fn set_cursor_tracking(&self, enabled: bool) {
        self.cursor_tracking.store(enabled, Ordering::Relaxed);
    }

    pub fn set_geometry(&self, geometry: OverlayGeometry) {
        *lock(&self.geometry) = geometry;
    }

    pub fn geometry(&self) -> OverlayGeometry {
        *lock(&self.geometry)
    }

    pub fn update_geometry(&self, update: impl FnOnce(&mut OverlayGeometry)) {
        update(&mut lock(&self.geometry));
    }

    fn is_near(&self, x: f64, y: f64) -> bool {
        lock(&self.rects).iter().any(|r| r.distance(x, y) <= CURSOR_NEAR_RADIUS)
    }

    fn wants_cursor(&self, x: f64, y: f64) -> bool {
        self.capturing()
            || lock(&self.rects).iter().any(|r| r.contains(x, y, HIT_MARGIN))
    }
}

pub fn spawn(app: AppHandle, state: Arc<HitState>) {
    let spawned = thread::Builder::new()
        .name("hit-test".into())
        .spawn(move || run(app, state));
    if let Err(err) = spawned {
        eprintln!("[hit-test] impossible de démarrer le thread : {err}");
    }
}

fn run(app: AppHandle, state: Arc<HitState>) {
    let Some(win) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };
    // État réellement appliqué à la fenêtre. `None` = inconnu : le style posé avant
    // `show()` peut être perdu, on le réapplique donc au démarrage et à chaque
    // réaffichage au lieu de supposer que la fenêtre est déjà click-through.
    let mut interactive: Option<bool> = None;
    let mut last_cursor: Option<(i32, i32)> = None;
    let mut last_emit = Instant::now();
    let mut was_near = false;

    loop {
        if !state.visible.load(Ordering::Relaxed) {
            interactive = None;
            last_cursor = None;
            thread::sleep(HIDDEN_TICK);
            continue;
        }

        let Some((cx, cy)) = cursor_position() else {
            thread::sleep(IDLE_TICK);
            continue;
        };

        let geo = *lock(&state.geometry);
        let scale = if geo.scale > 0.0 { geo.scale } else { 1.0 };
        let x = f64::from(cx - geo.origin_x) / scale;
        let y = f64::from(cy - geo.origin_y) / scale;

        let wants = state.wants_cursor(x, y);
        if interactive != Some(wants) && win.set_ignore_cursor_events(!wants).is_ok() {
            interactive = Some(wants);
        }

        let moved = last_cursor != Some((cx, cy));
        if moved && state.cursor_tracking.load(Ordering::Relaxed) && last_emit.elapsed() >= CURSOR_EMIT_INTERVAL {
            let near = state.is_near(x, y);
            if near || was_near {
                let _ = app.emit("cursor-moved", CursorPayload { x, y, near });
                last_emit = Instant::now();
            }
            was_near = near;
        }
        last_cursor = Some((cx, cy));

        thread::sleep(if moved || wants { FAST_TICK } else { IDLE_TICK });
    }
}

#[cfg(windows)]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT::default();
    // SAFETY : `point` est un POINT valide, possédé exclusivement pendant l'appel.
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some((point.x, point.y))
}

/// Cible principale : Windows. Ailleurs, l'overlay reste simplement click-through.
#[cfg(not(windows))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_is_a_lease_that_can_be_released() {
        let state = HitState::new();
        assert!(!state.wants_cursor(10.0, 10.0));
        state.set_capture(true);
        assert!(state.wants_cursor(10.0, 10.0), "capture active : tout l'overlay est interactif");
        state.set_capture(false);
        assert!(!state.wants_cursor(10.0, 10.0));
    }

    #[test]
    fn expired_lease_gives_the_mouse_back() {
        let state = HitState::new();
        *lock(&state.capture_until) = Some(Instant::now() - Duration::from_millis(1));
        assert!(!state.wants_cursor(10.0, 10.0), "bail expiré : click-through");
        assert!(lock(&state.capture_until).is_none());
    }

    #[test]
    fn hitboxes_still_work_without_capture() {
        let state = HitState::new();
        state.set_rects(vec![HitRect { x: 100.0, y: 100.0, w: 50.0, h: 50.0 }]);
        assert!(state.wants_cursor(120.0, 120.0));
        assert!(!state.wants_cursor(10.0, 10.0));
    }
}
