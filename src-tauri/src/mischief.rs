//! « Bêtises » du compagnon quand il boude, et manipulation des icônes du bureau.
//!
//! Garde-fous (en plus des réglages, vérifiés à chaque appel) :
//! - fenêtres : uniquement celles suivies par le window tracker (fenêtres
//!   d'application normales), jamais maximisées ni les nôtres ; écart cumulé limité à
//!   300 px par rapport à la taille d'origine, largeur minimale 320 px ;
//! - icônes : seul le *placement* des icônes du bureau change (aucun fichier touché),
//!   et rien si l'organisation automatique est active ;
//! - clic : envoyé uniquement au fond du bureau (jamais à une application), sans
//!   déplacer le curseur de l'utilisateur.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::state::{self, lock, AppState};
use crate::window_tracker::WorldStore;

const MAX_WINDOW_DEVIATION: i32 = 300;
const MIN_WINDOW_WIDTH: i32 = 320;
const MAX_ICONS: usize = 200;

/// Icône brute : index, libellé, rectangle écran (gauche, haut, droite, bas) en px physiques.
type IconEntry = (usize, String, i32, i32, i32, i32);

/// Taille d'origine des fenêtres modifiées (pour borner l'écart cumulé).
#[derive(Default)]
pub struct MischiefState {
    original_widths: Mutex<HashMap<u64, i32>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopIcon {
    pub index: usize,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Conversion px CSS de l'overlay ↔ px physiques d'écran.
#[derive(Clone, Copy)]
struct Geo {
    ox: f64,
    oy: f64,
    scale: f64,
}

impl Geo {
    fn of(app: &AppHandle) -> Self {
        let g = app
            .try_state::<AppState>()
            .map(|s| s.hit.geometry())
            .unwrap_or_default();
        Self { ox: f64::from(g.origin_x), oy: f64::from(g.origin_y), scale: if g.scale > 0.0 { g.scale } else { 1.0 } }
    }
    fn to_phys(self, x: f64, y: f64) -> (i32, i32) {
        ((x * self.scale + self.ox).round() as i32, (y * self.scale + self.oy).round() as i32)
    }
    fn to_css(self, x: i32, y: i32) -> (f64, f64) {
        ((f64::from(x) - self.ox) / self.scale, (f64::from(y) - self.oy) / self.scale)
    }
}

fn behaviors(app: &AppHandle) -> crate::settings::BehaviorToggles {
    state::snapshot(app).map(|s| s.behaviors).unwrap_or_default()
}

/// Tire ou repousse le côté gauche/droit d'une fenêtre de `dx` px CSS.
/// Renvoie le déplacement réellement appliqué (0 si refusé ou à la limite).
pub fn nudge_window(app: &AppHandle, id: u64, edge: &str, dx: f64) -> Result<f64, String> {
    if !behaviors(app).mischief_windows {
        return Err("bêtises sur les fenêtres désactivées".into());
    }
    let tracked = app
        .try_state::<WorldStore>()
        .and_then(|s| lock(&s.0).as_ref().and_then(|w| w.windows.iter().find(|w| w.id == id).cloned()));
    let Some(win) = tracked else {
        return Err("fenêtre inconnue".into());
    };
    if win.maximized {
        return Err("fenêtre maximisée".into());
    }
    let geo = Geo::of(app);
    let dx_phys = (dx * geo.scale).round() as i32;
    let store = app.state::<MischiefState>();
    let mut originals = lock(&store.original_widths);
    platform::nudge(id, edge == "left", dx_phys, &mut originals).map(|applied| f64::from(applied) / geo.scale)
}

pub fn desktop_icons(app: &AppHandle) -> Result<Vec<DesktopIcon>, String> {
    let geo = Geo::of(app);
    let icons = platform::list_icons()?;
    Ok(icons
        .into_iter()
        .map(|(index, name, l, t, r, b)| {
            let (x, y) = geo.to_css(l, t);
            DesktopIcon { index, name, x, y, w: f64::from(r - l) / geo.scale, h: f64::from(b - t) / geo.scale }
        })
        .collect())
}

/// Place le coin haut-gauche de l'icône `index` en (x, y) px CSS.
pub fn move_desktop_icon(app: &AppHandle, index: usize, x: f64, y: f64) -> Result<(), String> {
    let (px, py) = Geo::of(app).to_phys(x, y);
    platform::move_icon(index, px, py)
}

/// Icône du bureau correspondant à un fichier glissé, d'après son nom (le dépôt
/// HTML5 ne fournit pas le chemin). Le nom doit exister dans un dossier Bureau.
pub fn desktop_icon_for_name(app: &AppHandle, file_name: &str) -> Option<usize> {
    if file_name.is_empty() || file_name == "." || file_name == ".." || file_name.contains(['/', '\\']) {
        return None;
    }
    let mut desktops = vec![std::path::PathBuf::from(r"C:\Users\Public\Desktop")];
    if let Ok(d) = app.path().desktop_dir() {
        desktops.push(d);
    }
    if !desktops.iter().any(|d| d.join(file_name).exists()) {
        return None;
    }
    let path = std::path::Path::new(file_name);
    let file_name = file_name.to_lowercase();
    let stem = path.file_stem()?.to_string_lossy().to_lowercase();
    platform::list_icons()
        .ok()?
        .into_iter()
        .find(|(_, name, ..)| {
            let n = name.to_lowercase();
            n == file_name || n == stem
        })
        .map(|(index, ..)| index)
}

/// Clic du compagnon : seulement sur le fond du bureau. Renvoie true si envoyé.
pub fn poke(app: &AppHandle, x: f64, y: f64) -> bool {
    if !behaviors(app).mischief_clicks {
        return false;
    }
    let (px, py) = Geo::of(app).to_phys(x, y);
    platform::poke_desktop(px, py)
}

#[cfg(windows)]
mod platform {
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::core::{w, BOOL, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, POINT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{MapWindowPoints, ScreenToClient};
    use windows::Win32::System::Diagnostics::Debug::{ReadProcessMemory, WriteProcessMemory};
    use windows::Win32::System::Memory::{VirtualAllocEx, VirtualFreeEx, MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_READWRITE};
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_VM_OPERATION, PROCESS_VM_READ, PROCESS_VM_WRITE};
    use windows::Win32::UI::Controls::LVITEMW;
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetWindowLongPtrW, GetWindowRect,
        GetWindowThreadProcessId, IsIconic, IsWindow, IsZoomed, PostMessageW, SendMessageTimeoutW, SetWindowPos,
        WindowFromPoint, GWL_STYLE, SMTO_ABORTIFHUNG, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };

    use super::{MAX_ICONS, MAX_WINDOW_DEVIATION, MIN_WINDOW_WIDTH};

    const LVM_FIRST: u32 = 0x1000;
    const LVM_GETITEMCOUNT: u32 = LVM_FIRST + 4;
    const LVM_GETITEMRECT: u32 = LVM_FIRST + 14;
    const LVM_SETITEMPOSITION: u32 = LVM_FIRST + 15;
    const LVM_GETITEMPOSITION: u32 = LVM_FIRST + 16;
    const LVM_GETITEMTEXTW: u32 = LVM_FIRST + 115;
    const LVIR_BOUNDS: i32 = 0;
    const LVS_AUTOARRANGE: u32 = 0x0100;
    const WM_LBUTTONDOWN: u32 = 0x0201;
    const WM_LBUTTONUP: u32 = 0x0202;
    const MK_LBUTTON: usize = 0x0001;
    const TEXT_CHARS: usize = 260;

    fn hwnd(id: u64) -> HWND {
        HWND(id as usize as *mut c_void)
    }

    fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 64];
        // SAFETY : tampon local de taille connue.
        let len = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..len.max(0) as usize])
    }

    pub(super) fn nudge(id: u64, left: bool, dx: i32, originals: &mut HashMap<u64, i32>) -> Result<i32, String> {
        let h = hwnd(id);
        // SAFETY : appels Win32 sur un HWND qui peut avoir disparu ; ils échouent proprement.
        unsafe {
            if !IsWindow(Some(h)).as_bool() || IsIconic(h).as_bool() || IsZoomed(h).as_bool() {
                return Err("fenêtre indisponible".into());
            }
            let mut r = RECT::default();
            GetWindowRect(h, &mut r).map_err(|e| e.to_string())?;
            let width = r.right - r.left;
            let original = *originals.entry(id).or_insert(width);
            // Tirer le côté gauche vers la gauche (dx < 0) élargit ; vers la droite rétrécit.
            let grow = if left { -dx } else { dx };
            let target = (width + grow)
                .clamp(original - MAX_WINDOW_DEVIATION, original + MAX_WINDOW_DEVIATION)
                .max(MIN_WINDOW_WIDTH);
            let applied = target - width;
            if applied == 0 {
                return Ok(0);
            }
            let new_left = if left { r.left - applied } else { r.left };
            SetWindowPos(
                h,
                None,
                new_left,
                r.top,
                target,
                r.bottom - r.top,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            )
            .map_err(|e| e.to_string())?;
            Ok(if left { -applied } else { applied })
        }
    }

    /// Liste du bureau (SysListView32), sous Progman ou sous un WorkerW.
    fn desktop_listview() -> Option<HWND> {
        // SAFETY : recherches de fenêtres en lecture seule.
        unsafe {
            let progman = FindWindowW(w!("Progman"), None).ok()?;
            let mut defview = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), None).ok();
            if defview.is_none() {
                unsafe extern "system" fn find(h: HWND, data: LPARAM) -> BOOL {
                    // SAFETY : `data` pointe sur l'Option locale de desktop_listview().
                    let out = unsafe { &mut *(data.0 as *mut Option<HWND>) };
                    if let Ok(dv) = unsafe { FindWindowExW(Some(h), None, w!("SHELLDLL_DefView"), None) } {
                        *out = Some(dv);
                        return BOOL::from(false);
                    }
                    BOOL::from(true)
                }
                let _ = EnumWindows(Some(find), LPARAM(&mut defview as *mut _ as isize));
            }
            FindWindowExW(defview, None, w!("SysListView32"), None).ok()
        }
    }

    /// Mémoire allouée dans l'explorateur (les messages de liste écrivent dans son espace).
    struct Remote {
        process: HANDLE,
        ptr: *mut c_void,
        size: usize,
    }

    impl Remote {
        fn new(lv: HWND, size: usize) -> Result<Self, String> {
            let mut pid = 0u32;
            // SAFETY : handle et allocation libérés dans Drop.
            unsafe {
                GetWindowThreadProcessId(lv, Some(&mut pid));
                let process = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE, false, pid)
                    .map_err(|e| format!("accès à l'explorateur refusé : {e}"))?;
                let ptr = VirtualAllocEx(process, None, size, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
                if ptr.is_null() {
                    let _ = CloseHandle(process);
                    return Err("allocation impossible".into());
                }
                Ok(Self { process, ptr, size })
            }
        }
        fn at(&self, offset: usize) -> *mut c_void {
            // SAFETY : décalage borné par l'appelant (structure de taille connue).
            unsafe { self.ptr.cast::<u8>().add(offset).cast() }
        }
        fn write<T>(&self, offset: usize, value: &T) -> bool {
            debug_assert!(offset + size_of::<T>() <= self.size);
            // SAFETY : écriture de size_of::<T>() octets dans la zone allouée.
            unsafe { WriteProcessMemory(self.process, self.at(offset), (value as *const T).cast(), size_of::<T>(), None).is_ok() }
        }
        fn read<T: Default>(&self, offset: usize) -> Option<T> {
            let mut value = T::default();
            // SAFETY : lecture de size_of::<T>() octets depuis la zone allouée.
            unsafe { ReadProcessMemory(self.process, self.at(offset), (&mut value as *mut T).cast(), size_of::<T>(), None).ok()? };
            Some(value)
        }
    }

    impl Drop for Remote {
        fn drop(&mut self) {
            // SAFETY : libération de nos propres ressources.
            unsafe {
                let _ = VirtualFreeEx(self.process, self.ptr, 0, MEM_RELEASE);
                let _ = CloseHandle(self.process);
            }
        }
    }

    fn send(lv: HWND, msg: u32, wparam: usize, lparam: isize) -> Option<usize> {
        let mut result = 0usize;
        // SAFETY : message de liste standard ; délai court si l'explorateur ne répond pas.
        let ok = unsafe { SendMessageTimeoutW(lv, msg, WPARAM(wparam), LPARAM(lparam), SMTO_ABORTIFHUNG, 300, Some(&mut result)) };
        (ok.0 != 0).then_some(result)
    }

    // Disposition de la zone distante : [RECT][POINT][LVITEMW][texte].
    const OFF_RECT: usize = 0;
    const OFF_POINT: usize = 16;
    const OFF_ITEM: usize = 32;
    const OFF_TEXT: usize = OFF_ITEM + size_of::<LVITEMW>() + 8;
    const REMOTE_SIZE: usize = OFF_TEXT + TEXT_CHARS * 2;

    fn item_rect(lv: HWND, remote: &Remote, i: usize) -> Option<RECT> {
        let request = RECT { left: LVIR_BOUNDS, ..Default::default() };
        if !remote.write(OFF_RECT, &request) {
            return None;
        }
        send(lv, LVM_GETITEMRECT, i, remote.at(OFF_RECT) as isize)?;
        let mut rect: RECT = remote.read(OFF_RECT)?;
        // Coordonnées client de la liste → écran.
        let mut pts = [POINT { x: rect.left, y: rect.top }, POINT { x: rect.right, y: rect.bottom }];
        // SAFETY : conversion de deux points locaux.
        unsafe { MapWindowPoints(Some(lv), None, &mut pts) };
        rect = RECT { left: pts[0].x, top: pts[0].y, right: pts[1].x, bottom: pts[1].y };
        Some(rect)
    }

    fn item_text(lv: HWND, remote: &Remote, i: usize) -> String {
        let item = LVITEMW { cchTextMax: TEXT_CHARS as i32, pszText: PWSTR(remote.at(OFF_TEXT).cast()), ..Default::default() };
        if !remote.write(OFF_ITEM, &item) {
            return String::new();
        }
        let Some(len) = send(lv, LVM_GETITEMTEXTW, i, remote.at(OFF_ITEM) as isize) else {
            return String::new();
        };
        let mut buf = [0u16; TEXT_CHARS];
        // SAFETY : lecture du tampon texte distant, de taille fixe.
        let ok = unsafe {
            ReadProcessMemory(remote.process, remote.at(OFF_TEXT), buf.as_mut_ptr().cast(), TEXT_CHARS * 2, None).is_ok()
        };
        if !ok {
            return String::new();
        }
        String::from_utf16_lossy(&buf[..len.min(TEXT_CHARS)])
    }

    pub(super) fn list_icons() -> Result<Vec<super::IconEntry>, String> {
        let lv = desktop_listview().ok_or("bureau introuvable")?;
        let count = send(lv, LVM_GETITEMCOUNT, 0, 0).unwrap_or(0).min(MAX_ICONS);
        let remote = Remote::new(lv, REMOTE_SIZE)?;
        Ok((0..count)
            .filter_map(|i| {
                let r = item_rect(lv, &remote, i)?;
                Some((i, item_text(lv, &remote, i), r.left, r.top, r.right, r.bottom))
            })
            .collect())
    }

    pub(super) fn move_icon(index: usize, x: i32, y: i32) -> Result<(), String> {
        let lv = desktop_listview().ok_or("bureau introuvable")?;
        // SAFETY : lecture du style de la liste.
        let style = unsafe { GetWindowLongPtrW(lv, GWL_STYLE) } as u32;
        if style & LVS_AUTOARRANGE != 0 {
            return Err("organisation automatique des icônes activée".into());
        }
        let remote = Remote::new(lv, REMOTE_SIZE)?;
        let bounds = item_rect(lv, &remote, index).ok_or("icône introuvable")?;
        if !remote.write(OFF_POINT, &POINT::default()) {
            return Err("lecture impossible".into());
        }
        send(lv, LVM_GETITEMPOSITION, index, remote.at(OFF_POINT) as isize).ok_or("position introuvable")?;
        let pos: POINT = remote.read(OFF_POINT).ok_or("position illisible")?;
        // La « position » d'un élément et son rectangle diffèrent d'un décalage fixe.
        let nx = pos.x + (x - bounds.left);
        let ny = pos.y + (y - bounds.top);
        let packed = ((ny as u16 as u32) << 16 | (nx as u16 as u32)) as isize;
        send(lv, LVM_SETITEMPOSITION, index, packed).ok_or("déplacement refusé")?;
        Ok(())
    }

    pub(super) fn poke_desktop(x: i32, y: i32) -> bool {
        // SAFETY : identification de la fenêtre sous le point, puis messages de souris
        // postés uniquement à la surface du bureau (le curseur réel ne bouge pas).
        unsafe {
            let target = WindowFromPoint(POINT { x, y });
            if target.is_invalid() {
                return false;
            }
            let class = class_name(target);
            if !matches!(class.as_str(), "SysListView32" | "SHELLDLL_DefView" | "Progman" | "WorkerW") {
                return false;
            }
            if class == "SysListView32" && Some(target) != desktop_listview() {
                return false; // une liste dans une application, pas le bureau
            }
            let mut p = POINT { x, y };
            if !ScreenToClient(target, &mut p).as_bool() {
                return false;
            }
            let lparam = LPARAM((((p.y as u16 as u32) << 16) | (p.x as u16 as u32)) as isize);
            PostMessageW(Some(target), WM_LBUTTONDOWN, WPARAM(MK_LBUTTON), lparam).is_ok()
                && PostMessageW(Some(target), WM_LBUTTONUP, WPARAM(0), lparam).is_ok()
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use std::collections::HashMap;

    pub(super) fn nudge(_: u64, _: bool, _: i32, _: &mut HashMap<u64, i32>) -> Result<i32, String> {
        Err("non pris en charge".into())
    }
    pub(super) fn list_icons() -> Result<Vec<super::IconEntry>, String> {
        Ok(Vec::new())
    }
    pub(super) fn move_icon(_: usize, _: i32, _: i32) -> Result<(), String> {
        Err("non pris en charge".into())
    }
    pub(super) fn poke_desktop(_: i32, _: i32) -> bool {
        false
    }
}

#[cfg(all(test, windows))]
mod tests {
    /// Lecture seule des icônes du bureau de la machine (ne déplace rien).
    /// `cargo test -- --ignored desktop_icons_are_readable`
    #[test]
    #[ignore = "dépend du bureau de la machine"]
    fn desktop_icons_are_readable() {
        let icons = super::platform::list_icons().expect("liste des icônes");
        for (i, name, l, t, r, b) in &icons {
            println!("#{i} {name:?} ({l},{t})-({r},{b})");
        }
        assert!(icons.iter().all(|(_, _, l, t, r, b)| r > l && b > t));
    }

    /// Redimensionne une fenêtre de test désignée par DC_TEST_HWND, puis la remet.
    #[test]
    #[ignore = "nécessite une fenêtre de test"]
    fn nudge_resizes_and_is_bounded() {
        let id: u64 = std::env::var("DC_TEST_HWND").expect("DC_TEST_HWND").parse().unwrap();
        let mut originals = std::collections::HashMap::new();
        let grown = super::platform::nudge(id, true, -80, &mut originals).expect("tirer");
        assert_eq!(grown, -80, "le bord gauche part de 80 px vers la gauche");
        let capped = super::platform::nudge(id, true, -1000, &mut originals).expect("borne");
        assert_eq!(capped, -(super::MAX_WINDOW_DEVIATION - 80), "écart cumulé borné à 300 px");
        let back = super::platform::nudge(id, true, super::MAX_WINDOW_DEVIATION, &mut originals).expect("retour");
        assert_eq!(back, super::MAX_WINDOW_DEVIATION);
    }
}
