//! Réglage de la consommation mémoire de WebView2.
//!
//! `ICoreWebView2_19::SetMemoryUsageTargetLevel(LOW)` demande à WebView2 de rendre au
//! système un maximum de mémoire (caches, tas JS compactés, pages de travail
//! inactives). Notre page est minuscule et ne charge presque rien : le coût en
//! performance est négligeable, on l'applique donc en permanence.

use tauri::WebviewWindow;

#[cfg(windows)]
pub fn apply_low_memory_target(win: &WebviewWindow) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    };
    use windows::core::Interface;

    let result = win.with_webview(|webview| {
        // SAFETY : appelé sur le thread UI par `with_webview`, interfaces COM valides.
        let applied = unsafe {
            webview
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_19>())
                .and_then(|core| core.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW))
        };
        if let Err(err) = applied {
            eprintln!("[webview] niveau mémoire bas indisponible : {err}");
        }
    });
    if let Err(err) = result {
        eprintln!("[webview] accès à la webview impossible : {err}");
    }
}

#[cfg(not(windows))]
pub fn apply_low_memory_target(_win: &WebviewWindow) {}
