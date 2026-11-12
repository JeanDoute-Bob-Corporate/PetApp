//! Window tracker : décrit au frontend le « monde » sur lequel le compagnon évolue.
//!
//! À la fréquence du profil (4 / 10 / 20 Hz), un thread :
//! 1. énumère les écrans (zone de travail = sol au-dessus de la barre des tâches) ;
//! 2. énumère les fenêtres visibles de haut en bas (`EnumWindows` suit l'ordre Z) et
//!    lit leurs vraies bordures via `DWMWA_EXTENDED_FRAME_BOUNDS` (sans l'ombre
//!    invisible de 7 px que renvoie `GetWindowRect` sous Windows 10/11) ;
//! 3. calcule, pour chaque fenêtre, les portions de son bord supérieur qui ne sont pas
//!    masquées par une fenêtre située au-dessus : ce sont les plateformes ;
//! 4. détecte une application plein écran (jeu, vidéo, présentation) ;
//! 5. n'émet `world-changed` que si quelque chose a changé, et passe brièvement à
//!    30 Hz après un changement pour suivre une fenêtre qu'on déplace.

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::hit_test::{HitState, OverlayGeometry};
use crate::overlay;
use crate::settings::ProfileParams;
use crate::state::{self, lock};

const MAX_WINDOWS: usize = 48;
/// Taille minimale (px physiques) d'une fenêtre prise en compte.
const MIN_WINDOW_W: i32 = 120;
const MIN_WINDOW_H: i32 = 60;
/// Largeur minimale d'une portion de bord supérieur pour servir de plateforme.
const MIN_SPAN: i32 = 40;
/// Fréquence temporaire après un changement (fenêtre en cours de déplacement).
const BOOST_HZ: u32 = 30;
const BOOST_DURATION: Duration = Duration::from_millis(600);
/// Pendant une pause plein écran, on vérifie seulement s'il faut reprendre.
const PAUSED_POLL: Duration = Duration::from_millis(500);
const HIDDEN_POLL: Duration = Duration::from_millis(500);

/// Rectangle en pixels CSS relatifs à l'overlay.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorArea {
    pub bounds: Rect,
    /// Zone de travail : l'écran moins la barre des tâches.
    pub work: Rect,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackedWindow {
    /// HWND, stable tant que la fenêtre existe.
    pub id: u64,
    pub rect: Rect,
    /// Portions visibles du bord supérieur, `[x1, x2]` en px CSS.
    pub top_spans: Vec<[f64; 2]>,
    pub foreground: bool,
    pub maximized: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldSnapshot {
    pub monitors: Vec<MonitorArea>,
    /// Ordonnées du haut vers le bas de la pile Z.
    pub windows: Vec<TrackedWindow>,
}

/// Dernier état connu, servi au frontend au démarrage (`get_world`).
#[derive(Default)]
pub struct WorldStore(pub Mutex<Option<WorldSnapshot>>);

/// Rectangle en pixels physiques d'écran.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PhysRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl PhysRect {
    fn width(&self) -> i32 {
        self.right - self.left
    }
    fn height(&self) -> i32 {
        self.bottom - self.top
    }
    fn covers(&self, other: &PhysRect) -> bool {
        self.left <= other.left && self.top <= other.top && self.right >= other.right && self.bottom >= other.bottom
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PhysMonitor {
    bounds: PhysRect,
    work: PhysRect,
    primary: bool,
}

#[derive(Debug, Clone)]
struct PhysWindow {
    id: u64,
    rect: PhysRect,
    foreground: bool,
    maximized: bool,
}

struct Scan {
    monitors: Vec<PhysMonitor>,
    windows: Vec<PhysWindow>,
    fullscreen: bool,
}

pub fn spawn(app: AppHandle, hit: Arc<HitState>) {
    let spawned = thread::Builder::new()
        .name("window-tracker".into())
        .spawn(move || run(app, hit));
    if let Err(err) = spawned {
        eprintln!("[tracker] impossible de démarrer le thread : {err}");
    }
}

fn run(app: AppHandle, hit: Arc<HitState>) {
    let own_pid = std::process::id();
    let mut last_snapshot: Option<WorldSnapshot> = None;
    let mut last_monitors: Option<Vec<PhysMonitor>> = None;
    let mut boost_until = Instant::now();

    loop {
        let settings = state::snapshot(&app).unwrap_or_default();
        if !settings.visible {
            overlay::set_paused(&app, false);
            thread::sleep(HIDDEN_POLL);
            continue;
        }
        let params = ProfileParams::resolve(&settings);

        let Some(scan) = platform::scan(own_pid) else {
            thread::sleep(PAUSED_POLL);
            continue;
        };

        // Écran branché / débranché / résolution modifiée : on recale l'overlay.
        if last_monitors.as_ref().is_some_and(|m| *m != scan.monitors) {
            overlay::refit(&app);
        }
        last_monitors = Some(scan.monitors.clone());

        let pause = scan.fullscreen && params.pause_on_fullscreen;
        overlay::set_paused(&app, pause);
        if pause {
            thread::sleep(PAUSED_POLL);
            continue;
        }

        let snapshot = to_css(&scan, hit.geometry());
        if last_snapshot.as_ref() != Some(&snapshot) {
            if let Some(store) = tauri::Manager::try_state::<WorldStore>(&app) {
                *lock(&store.0) = Some(snapshot.clone());
            }
            let _ = app.emit("world-changed", &snapshot);
            last_snapshot = Some(snapshot);
            boost_until = Instant::now() + BOOST_DURATION;
        }

        let hz = if Instant::now() < boost_until {
            params.tracker_hz.max(BOOST_HZ)
        } else {
            params.tracker_hz.max(1)
        };
        thread::sleep(Duration::from_millis(1000 / u64::from(hz)));
    }
}

/// Soustrait aux bords supérieurs les zones masquées par les fenêtres plus hautes en Z.
fn visible_top_spans(windows: &[PhysWindow], index: usize) -> Vec<(i32, i32)> {
    let target = &windows[index].rect;
    let mut spans = vec![(target.left, target.right)];
    for above in &windows[..index] {
        let r = &above.rect;
        // L'autre fenêtre recouvre la ligne du bord (et l'espace juste au-dessus).
        if r.top <= target.top && r.bottom > target.top {
            spans = spans
                .into_iter()
                .flat_map(|(a, b)| {
                    let mut out = Vec::with_capacity(2);
                    if r.left > a {
                        out.push((a, b.min(r.left)));
                    }
                    if r.right < b {
                        out.push((a.max(r.right), b));
                    }
                    out
                })
                .filter(|(a, b)| b > a)
                .collect();
        }
        if spans.is_empty() {
            break;
        }
    }
    spans.retain(|(a, b)| b - a >= MIN_SPAN);
    spans
}

fn to_css(scan: &Scan, geo: OverlayGeometry) -> WorldSnapshot {
    let scale = if geo.scale > 0.0 { geo.scale } else { 1.0 };
    let x = |v: i32| f64::from(v - geo.origin_x) / scale;
    let y = |v: i32| f64::from(v - geo.origin_y) / scale;
    let rect = |r: &PhysRect| Rect {
        x: x(r.left),
        y: y(r.top),
        w: f64::from(r.width()) / scale,
        h: f64::from(r.height()) / scale,
    };

    WorldSnapshot {
        monitors: scan
            .monitors
            .iter()
            .map(|m| MonitorArea { bounds: rect(&m.bounds), work: rect(&m.work), primary: m.primary })
            .collect(),
        windows: scan
            .windows
            .iter()
            .enumerate()
            .map(|(i, w)| TrackedWindow {
                id: w.id,
                rect: rect(&w.rect),
                top_spans: visible_top_spans(&scan.windows, i)
                    .into_iter()
                    .map(|(a, b)| [x(a), x(b)])
                    .collect(),
                foreground: w.foreground,
                maximized: w.maximized,
            })
            .collect(),
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::Graphics::Gdi::{
        EnumDisplayMonitors, GetMonitorInfoW, MonitorFromWindow, HDC, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONULL,
    };
    use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId,
        IsIconic, IsWindowVisible, IsZoomed, GWL_EXSTYLE, GWL_STYLE, MONITORINFOF_PRIMARY, WS_CAPTION,
        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    use super::{PhysMonitor, PhysRect, PhysWindow, Scan, MAX_WINDOWS, MIN_WINDOW_H, MIN_WINDOW_W};

    /// Fenêtres du shell et surfaces système qui ne sont pas de « vraies » fenêtres.
    const IGNORED_CLASSES: &[&str] = &[
        "Progman",
        "WorkerW",
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "NotifyIconOverflowWindow",
        "TopLevelWindowForOverflowXamlIsland",
        "XamlExplorerHostIslandWindow",
        "Xaml_WindowedPopupClass",
        "Windows.UI.Core.CoreWindow",
        "ForegroundStaging",
        "MultitaskingViewFrame",
        "TaskListThumbnailWnd",
        "#32768",
    ];

    impl From<RECT> for PhysRect {
        fn from(r: RECT) -> Self {
            Self { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }
    }

    pub(super) fn scan(own_pid: u32) -> Option<Scan> {
        let monitors = monitors();
        if monitors.is_empty() {
            return None;
        }
        // SAFETY : appel sans paramètre, renvoie un HWND éventuellement nul.
        let foreground = unsafe { GetForegroundWindow() };
        let windows = windows(own_pid, foreground);
        let fullscreen = is_fullscreen_active(foreground, own_pid);
        Some(Scan { monitors, windows, fullscreen })
    }

    fn monitors() -> Vec<PhysMonitor> {
        unsafe extern "system" fn callback(monitor: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
            // SAFETY : `data` pointe sur le Vec passé par `monitors()`, vivant pendant l'énumération.
            let out = unsafe { &mut *(data.0 as *mut Vec<PhysMonitor>) };
            let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            // SAFETY : `info` est correctement initialisé (cbSize renseigné).
            if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
                out.push(PhysMonitor {
                    bounds: info.rcMonitor.into(),
                    work: info.rcWork.into(),
                    primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
                });
            }
            BOOL::from(true)
        }

        let mut out: Vec<PhysMonitor> = Vec::new();
        // SAFETY : le callback ne survit pas à l'appel ; `out` reste valide pendant celui-ci.
        unsafe {
            let _ = EnumDisplayMonitors(None, None, Some(callback), LPARAM(&mut out as *mut _ as isize));
        }
        out
    }

    fn windows(own_pid: u32, foreground: HWND) -> Vec<PhysWindow> {
        unsafe extern "system" fn callback(hwnd: HWND, data: LPARAM) -> BOOL {
            // SAFETY : `data` pointe sur le Vec passé par `windows()`.
            let out = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
            out.push(hwnd);
            BOOL::from(true)
        }

        let mut handles: Vec<HWND> = Vec::with_capacity(256);
        // SAFETY : idem, le callback n'est utilisé que pendant l'appel.
        unsafe {
            let _ = EnumWindows(Some(callback), LPARAM(&mut handles as *mut _ as isize));
        }

        handles
            .into_iter()
            .filter_map(|hwnd| describe(hwnd, own_pid, foreground))
            .take(MAX_WINDOWS)
            .collect()
    }

    fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 64];
        // SAFETY : tampon local de taille connue.
        let len = unsafe { GetClassNameW(hwnd, &mut buf) };
        String::from_utf16_lossy(&buf[..len.max(0) as usize])
    }

    fn window_pid(hwnd: HWND) -> u32 {
        let mut pid = 0u32;
        // SAFETY : `pid` est une variable locale valide.
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid
    }

    fn describe(hwnd: HWND, own_pid: u32, foreground: HWND) -> Option<PhysWindow> {
        // SAFETY : fonctions Win32 en lecture seule sur un HWND reçu d'EnumWindows ;
        // si la fenêtre a disparu entre-temps, elles échouent proprement.
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return None;
            }
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
            // Infobulles, palettes et overlays click-through (le nôtre compris).
            if ex_style & (WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0) != 0 {
                return None;
            }
            // Fenêtres UWP suspendues ou sur un autre bureau virtuel.
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut c_void,
                size_of::<u32>() as u32,
            );
            if cloaked != 0 {
                return None;
            }
            if window_pid(hwnd) == own_pid || IGNORED_CLASSES.contains(&class_name(hwnd).as_str()) {
                return None;
            }

            let mut frame = RECT::default();
            let rect: PhysRect = if DwmGetWindowAttribute(
                hwnd,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut frame as *mut RECT as *mut c_void,
                size_of::<RECT>() as u32,
            )
            .is_ok()
            {
                frame.into()
            } else {
                let mut r = RECT::default();
                GetWindowRect(hwnd, &mut r).ok()?;
                r.into()
            };
            if rect.width() < MIN_WINDOW_W || rect.height() < MIN_WINDOW_H {
                return None;
            }

            Some(PhysWindow {
                id: hwnd.0 as usize as u64,
                rect,
                foreground: hwnd == foreground,
                maximized: IsZoomed(hwnd).as_bool(),
            })
        }
    }

    /// Plein écran = jeu D3D exclusif / mode présentation signalé par le shell, ou
    /// fenêtre au premier plan sans barre de titre qui recouvre tout son écran.
    /// (On ignore `QUNS_BUSY`, que notre propre overlay topmost pourrait provoquer.)
    fn is_fullscreen_active(foreground: HWND, own_pid: u32) -> bool {
        // SAFETY : appels Win32 en lecture seule.
        unsafe {
            if let Ok(state) = SHQueryUserNotificationState() {
                if state == QUNS_RUNNING_D3D_FULL_SCREEN || state == QUNS_PRESENTATION_MODE {
                    return true;
                }
            }
            if foreground.is_invalid() || window_pid(foreground) == own_pid {
                return false;
            }
            if IGNORED_CLASSES.contains(&class_name(foreground).as_str()) {
                return false;
            }
            let style = GetWindowLongPtrW(foreground, GWL_STYLE) as u32;
            if style & WS_CAPTION.0 == WS_CAPTION.0 {
                return false; // fenêtre classique (éventuellement maximisée)
            }
            let monitor = MonitorFromWindow(foreground, MONITOR_DEFAULTTONULL);
            if monitor.is_invalid() {
                return false;
            }
            let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
            let mut rect = RECT::default();
            if !GetMonitorInfoW(monitor, &mut info).as_bool() || GetWindowRect(foreground, &mut rect).is_err() {
                return false;
            }
            PhysRect::from(rect).covers(&info.rcMonitor.into())
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::Scan;

    pub(super) fn scan(_own_pid: u32) -> Option<Scan> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(id: u64, left: i32, top: i32, right: i32, bottom: i32) -> PhysWindow {
        PhysWindow { id, rect: PhysRect { left, top, right, bottom }, foreground: false, maximized: false }
    }

    #[test]
    fn top_edge_is_split_by_window_above() {
        // La fenêtre 1 (au-dessus) masque le milieu du bord haut de la fenêtre 2.
        let windows = vec![win(1, 300, 50, 500, 400), win(2, 100, 100, 800, 600)];
        assert_eq!(visible_top_spans(&windows, 1), vec![(100, 300), (500, 800)]);
    }

    #[test]
    fn window_below_the_edge_does_not_hide_it() {
        let windows = vec![win(1, 300, 200, 500, 400), win(2, 100, 100, 800, 600)];
        assert_eq!(visible_top_spans(&windows, 1), vec![(100, 800)]);
    }

    #[test]
    fn tiny_leftovers_are_dropped() {
        let windows = vec![win(1, 120, 50, 800, 400), win(2, 100, 100, 800, 600)];
        assert!(visible_top_spans(&windows, 1).is_empty());
    }
}
