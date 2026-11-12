// Pas de console attachée en release : l'app vit dans le System Tray.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    desktop_companion_lib::run();
}
