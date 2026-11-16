//! Import des packs `.companion` (archive ZIP renommée).
//!
//! Tout le contenu est non fiable : l'archive est lue en mémoire avec des limites
//! strictes, chaque règle de docs/COMPANION_FORMAT.md est vérifiée, et les erreurs
//! sont renvoyées en français (fichier + champ fautif). Un pack valide est extrait dans
//! `<données>/packs/<id>/` ; le frontend lit ensuite ses fichiers via `pack_file`.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::persistence;

const MAX_ARCHIVE_BYTES: usize = 10 * 1024 * 1024;
const MAX_ENTRIES: usize = 64;
/// Garde-fou contre les « bombes » ZIP : total décompressé.
const MAX_UNPACKED_BYTES: u64 = 24 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 256 * 1024;
const MAX_SFX_BYTES: u64 = 512 * 1024;
const MAX_SHEET_SIDE: u32 = 2048;
const ALLOWED_EXTENSIONS: [&str; 4] = ["json", "png", "ogg", "wav"];

pub const DEFAULT_PACK_ID: &str = "dev.default.byte";

const REQUIRED_ANIMATIONS: [&str; 18] = [
    "idle", "walk", "run", "jump", "fall", "climb", "sit_window", "grab_edge", "sleep", "eat", "play", "train",
    "dragged", "attack_light", "attack_heavy", "hurt", "victory", "defeat",
];
const PERSONALITY_TRAITS: [&str; 7] = ["playful", "lazy", "curious", "social", "brave", "glutton", "mischievous"];
const EVENT_TYPES: [&str; 6] = ["sound", "particle", "hit", "footstep", "emote", "custom"];

// --- Schéma (lecture stricte : champs inconnus refusés dans le manifeste) ------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    #[serde(rename = "$schema")]
    _schema: Option<String>,
    format_version: u32,
    id: String,
    name: String,
    author: String,
    version: String,
    description: Option<String>,
    license: Option<String>,
    min_app_version: Option<String>,
    tags: Option<Vec<String>>,
    /// Couleur d'accent de l'interface quand ce compagnon est actif (« #rrggbb »).
    accent_color: Option<String>,
    sprite: Sprite,
    hitbox: Hitbox,
    anchor_points: HashMap<String, Point>,
    base_stats: BaseStats,
    personality_weights: HashMap<String, f64>,
    sounds: Option<HashMap<String, String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Sprite {
    file: String,
    frame_width: u32,
    frame_height: u32,
    scale: Option<u32>,
    facing: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Hitbox {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Point {
    x: u32,
    y: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BaseStats {
    strength: u32,
    agility: u32,
    endurance: u32,
    technique: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnimationFile {
    #[serde(rename = "$schema")]
    _schema: Option<String>,
    format_version: u32,
    animations: HashMap<String, Animation>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Animation {
    row: u32,
    start_column: Option<u32>,
    frame_count: u32,
    fps: f64,
    #[serde(rename = "loop")]
    _loop: bool,
    frame_durations: Option<Vec<u32>>,
    next: Option<String>,
    events: Option<Vec<AnimEvent>>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AnimEvent {
    frame: u32,
    #[serde(rename = "type")]
    kind: String,
    id: Option<String>,
    anchor: Option<String>,
    offset: Option<serde_json::Value>,
}

/// Résumé d'un pack installé (liste du gestionnaire).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub author: String,
    pub version: String,
    pub description: String,
    pub builtin: bool,
}

// --- Validation -----------------------------------------------------------------------

fn is_identifier(s: &str) -> bool {
    // ^[a-z0-9]+(?:[.-][a-z0-9]+)+$
    let parts: Vec<&str> = s.split(['.', '-']).collect();
    s.len() >= 3
        && s.len() <= 64
        && parts.len() >= 2
        && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()))
}

fn is_snake(s: &str) -> bool {
    // ^[a-z][a-z0-9_]{0,31}$
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && s.len() <= 32
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn is_semver(s: &str) -> bool {
    let core = s.split('-').next().unwrap_or("");
    let nums: Vec<&str> = core.split('.').collect();
    nums.len() == 3
        && nums
            .iter()
            .all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()) && (n.len() == 1 || !n.starts_with('0')))
}

/// Chemin d'entrée sûr : relatif, sans `..`, extension autorisée.
fn safe_entry(name: &str) -> Result<Option<String>, String> {
    if name.ends_with('/') {
        return Ok(None); // dossier
    }
    if name.starts_with('/') || name.starts_with('\\') || name.contains(':') || name.contains('\\') {
        return Err(format!("chemin interdit dans l'archive : « {name} »"));
    }
    if name.split('/').any(|seg| seg == ".." || seg == "." || seg.is_empty()) {
        return Err(format!("chemin interdit dans l'archive : « {name} »"));
    }
    let ext = Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("type de fichier interdit : « {name} » (seuls .json, .png, .ogg, .wav)"));
    }
    Ok(Some(name.to_string()))
}

/// Lit l'archive en mémoire en respectant toutes les limites.
fn read_archive(bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, Vec<String>> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(vec![format!("archive trop volumineuse ({} Mo, maximum 10 Mo)", bytes.len() / 1_048_576)]);
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| vec![format!("ce fichier n'est pas une archive .companion valide ({e})")])?;
    if zip.len() > MAX_ENTRIES {
        return Err(vec![format!("trop de fichiers dans l'archive ({}, maximum {MAX_ENTRIES})", zip.len())]);
    }
    let mut files = HashMap::new();
    let mut errors = Vec::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = match zip.by_index(i) {
            Ok(e) => e,
            Err(e) => {
                errors.push(format!("entrée {i} illisible ({e})"));
                continue;
            }
        };
        if entry.is_symlink() {
            errors.push(format!("lien symbolique interdit : « {} »", entry.name()));
            continue;
        }
        let name = match safe_entry(entry.name()) {
            Ok(Some(n)) => n,
            Ok(None) => continue,
            Err(e) => {
                errors.push(e);
                continue;
            }
        };
        let limit = if name.ends_with(".json") {
            MAX_JSON_BYTES
        } else if name.starts_with("sfx/") {
            MAX_SFX_BYTES
        } else {
            MAX_ARCHIVE_BYTES as u64
        };
        if entry.size() > limit {
            errors.push(format!("« {name} » est trop volumineux ({} Ko, maximum {} Ko)", entry.size() / 1024, limit / 1024));
            continue;
        }
        // Lecture bornée : on ne fait pas confiance à la taille déclarée.
        let mut data = Vec::new();
        if let Err(e) = (&mut entry).take(limit + 1).read_to_end(&mut data) {
            errors.push(format!("« {name} » illisible ({e})"));
            continue;
        }
        if data.len() as u64 > limit {
            errors.push(format!("« {name} » dépasse la taille autorisée"));
            continue;
        }
        total += data.len() as u64;
        if total > MAX_UNPACKED_BYTES {
            return Err(vec!["contenu décompressé trop volumineux (archive suspecte)".into()]);
        }
        files.insert(name, data);
    }
    if errors.is_empty() {
        Ok(files)
    } else {
        Err(errors)
    }
}

fn png_size(data: &[u8]) -> Result<(u32, u32), String> {
    let decoder = png::Decoder::new(Cursor::new(data));
    let mut reader = decoder.read_info().map_err(|e| format!("image PNG invalide ({e})"))?;
    let (w, h) = (reader.info().width, reader.info().height);
    if w > MAX_SHEET_SIDE || h > MAX_SHEET_SIDE {
        return Err(format!("planche trop grande ({w}×{h}, maximum {MAX_SHEET_SIDE}×{MAX_SHEET_SIDE})"));
    }
    // Décodage complet : une image tronquée ou corrompue est refusée ici.
    let mut buf = vec![0; reader.output_buffer_size()];
    reader.next_frame(&mut buf).map_err(|e| format!("image PNG corrompue ({e})"))?;
    Ok((w, h))
}

/// Valide un pack complet ; renvoie le manifeste ou la liste de toutes les erreurs.
fn validate(files: &HashMap<String, Vec<u8>>) -> Result<Manifest, Vec<String>> {
    let mut errors = Vec::new();
    let mut err = |e: String| errors.push(e);

    let Some(manifest_bytes) = files.get("manifest.json") else {
        return Err(vec!["manifest.json manquant à la racine de l'archive".into()]);
    };
    let Some(anim_bytes) = files.get("animations.json") else {
        return Err(vec!["animations.json manquant à la racine de l'archive".into()]);
    };
    let m: Manifest = match serde_json::from_slice(manifest_bytes) {
        Ok(m) => m,
        Err(e) => return Err(vec![format!("manifest.json : {e}")]),
    };
    let a: AnimationFile = match serde_json::from_slice(anim_bytes) {
        Ok(a) => a,
        Err(e) => return Err(vec![format!("animations.json : {e}")]),
    };

    // Manifeste.
    if m.format_version != 1 {
        err(format!("manifest.json › formatVersion : {} non pris en charge (attendu : 1)", m.format_version));
    }
    if !is_identifier(&m.id) {
        err(format!("manifest.json › id : « {} » invalide (ex. « dev.auteur.nom », minuscules)", m.id));
    }
    if m.id == DEFAULT_PACK_ID {
        err("manifest.json › id : réservé au compagnon par défaut".into());
    }
    if m.name.trim().is_empty() || m.name.chars().count() > 32 {
        err("manifest.json › name : 1 à 32 caractères".into());
    }
    if m.author.trim().is_empty() || m.author.chars().count() > 64 {
        err("manifest.json › author : 1 à 64 caractères".into());
    }
    if !is_semver(&m.version) {
        err(format!("manifest.json › version : « {} » n'est pas au format 1.2.3", m.version));
    }
    if m.description.as_ref().is_some_and(|d| d.chars().count() > 280) {
        err("manifest.json › description : 280 caractères maximum".into());
    }
    if m.license.as_ref().is_some_and(|l| l.chars().count() > 64) {
        err("manifest.json › license : 64 caractères maximum".into());
    }
    if m.min_app_version.as_ref().is_some_and(|v| !is_semver(v)) {
        err("manifest.json › minAppVersion : format 1.2.3 attendu".into());
    }
    if m.tags.as_ref().is_some_and(|t| t.len() > 8) {
        err("manifest.json › tags : 8 maximum".into());
    }
    if let Some(c) = &m.accent_color {
        let hex = c.strip_prefix('#').unwrap_or("");
        if hex.len() != 6 || !hex.chars().all(|ch| ch.is_ascii_hexdigit()) {
            err(format!("manifest.json › accentColor : « {c} » doit être une couleur #rrggbb"));
        }
    }

    let s = &m.sprite;
    let file_ok = s.file.ends_with(".png") && !s.file.contains('/') && s.file.len() <= 68;
    if !file_ok {
        err(format!("manifest.json › sprite.file : « {} » doit être un .png à la racine", s.file));
    }
    if !(8..=256).contains(&s.frame_width) || !(8..=256).contains(&s.frame_height) {
        err("manifest.json › sprite.frameWidth/frameHeight : entre 8 et 256 px".into());
    }
    if s.scale.is_some_and(|v| !(1..=8).contains(&v)) {
        err("manifest.json › sprite.scale : entre 1 et 8".into());
    }
    if s.facing.as_deref().is_some_and(|f| f != "left" && f != "right") {
        err("manifest.json › sprite.facing : « left » ou « right »".into());
    }
    let (fw, fh) = (s.frame_width, s.frame_height);
    let h = &m.hitbox;
    if h.width == 0 || h.height == 0 || h.x + h.width > fw || h.y + h.height > fh {
        err(format!("manifest.json › hitbox : doit tenir dans la case {fw}×{fh}"));
    }
    for required in ["feet", "bubble"] {
        if !m.anchor_points.contains_key(required) {
            err(format!("manifest.json › anchorPoints.{required} : obligatoire"));
        }
    }
    if m.anchor_points.len() > 16 {
        err("manifest.json › anchorPoints : 16 maximum".into());
    }
    for (name, p) in &m.anchor_points {
        if p.x > fw || p.y > fh {
            err(format!("manifest.json › anchorPoints.{name} : ({}, {}) hors de la case {fw}×{fh}", p.x, p.y));
        }
    }
    let b = &m.base_stats;
    for (name, v) in [("strength", b.strength), ("agility", b.agility), ("endurance", b.endurance), ("technique", b.technique)] {
        if !(1..=20).contains(&v) {
            err(format!("manifest.json › baseStats.{name} : entre 1 et 20 (reçu {v})"));
        }
    }
    for (name, v) in &m.personality_weights {
        if !PERSONALITY_TRAITS.contains(&name.as_str()) {
            err(format!("manifest.json › personalityWeights.{name} : trait inconnu"));
        } else if !(0.0..=3.0).contains(v) {
            err(format!("manifest.json › personalityWeights.{name} : entre 0 et 3"));
        }
    }
    let sounds = m.sounds.clone().unwrap_or_default();
    if sounds.len() > 32 {
        err("manifest.json › sounds : 32 maximum".into());
    }
    for (id, path) in &sounds {
        if !is_snake(id) {
            err(format!("manifest.json › sounds.{id} : identifiant invalide (minuscules, chiffres, _)"));
        }
        let valid = path.starts_with("sfx/") && (path.ends_with(".ogg") || path.ends_with(".wav"));
        if !valid {
            err(format!("manifest.json › sounds.{id} : « {path} » doit être sfx/<nom>.ogg|.wav"));
        } else if !files.contains_key(path) {
            err(format!("manifest.json › sounds.{id} : fichier « {path} » absent de l'archive"));
        }
    }

    // Planche.
    let sheet = files.get(&s.file).map(|d| png_size(d));
    let (cols, rows) = match sheet {
        None => {
            err(format!("planche « {} » absente de l'archive", s.file));
            (0, 0)
        }
        Some(Err(e)) => {
            err(format!("{} : {e}", s.file));
            (0, 0)
        }
        Some(Ok((w, h))) => {
            if fw > 0 && fh > 0 && (w % fw != 0 || h % fh != 0) {
                err(format!("{} : {w}×{h} n'est pas un multiple de la case {fw}×{fh}", s.file));
            }
            (w.checked_div(fw).unwrap_or(0), h.checked_div(fh).unwrap_or(0))
        }
    };

    // Animations.
    if a.format_version != 1 {
        err(format!("animations.json › formatVersion : {} non pris en charge", a.format_version));
    }
    for required in REQUIRED_ANIMATIONS {
        if !a.animations.contains_key(required) {
            err(format!("animations.json › état obligatoire « {required} » manquant"));
        }
    }
    if a.animations.len() > 64 {
        err("animations.json : 64 animations maximum".into());
    }
    let names: HashSet<&String> = a.animations.keys().collect();
    for (name, anim) in &a.animations {
        let at = format!("animations.json › {name}");
        if !is_snake(name) {
            err(format!("{at} : nom invalide (minuscules, chiffres, _)"));
        }
        if !(1..=32).contains(&anim.frame_count) {
            err(format!("{at}.frameCount : entre 1 et 32"));
        }
        if !(anim.fps > 0.0 && anim.fps <= 30.0) {
            err(format!("{at}.fps : entre 0 (exclu) et 30"));
        }
        if rows > 0 && anim.row >= rows {
            err(format!("{at}.row : ligne {} hors de la planche ({rows} lignes)", anim.row));
        }
        let start = anim.start_column.unwrap_or(0);
        if cols > 0 && start + anim.frame_count > cols {
            err(format!("{at} : {} frames depuis la colonne {start} dépassent la largeur ({cols} colonnes)", anim.frame_count));
        }
        if let Some(d) = &anim.frame_durations {
            if d.len() != anim.frame_count as usize {
                err(format!("{at}.frameDurations : {} valeurs attendues (frameCount)", anim.frame_count));
            }
            if d.iter().any(|ms| !(16..=5000).contains(ms)) {
                err(format!("{at}.frameDurations : chaque durée entre 16 et 5000 ms"));
            }
        }
        if let Some(next) = &anim.next {
            if !names.contains(next) {
                err(format!("{at}.next : animation « {next} » inexistante"));
            }
        }
        for (i, ev) in anim.events.iter().flatten().enumerate() {
            let at = format!("{at}.events[{i}]");
            if ev.frame >= anim.frame_count {
                err(format!("{at}.frame : {} ≥ frameCount ({})", ev.frame, anim.frame_count));
            }
            if !EVENT_TYPES.contains(&ev.kind.as_str()) {
                err(format!("{at}.type : « {} » inconnu", ev.kind));
            }
            let needs_id = matches!(ev.kind.as_str(), "sound" | "particle" | "emote" | "custom");
            if needs_id && ev.id.is_none() {
                err(format!("{at}.id : obligatoire pour le type « {} »", ev.kind));
            }
            if ev.kind == "sound" {
                if let Some(id) = &ev.id {
                    if !sounds.contains_key(id) {
                        err(format!("{at}.id : son « {id} » absent de manifest.sounds"));
                    }
                }
            }
            if let Some(anchor) = &ev.anchor {
                if !m.anchor_points.contains_key(anchor) {
                    err(format!("{at}.anchor : point d'attache « {anchor} » inexistant"));
                }
            }
            if let Some(off) = &ev.offset {
                let ok = off.get("x").and_then(|v| v.as_i64()).is_some_and(|v| (-256..=256).contains(&v))
                    && off.get("y").and_then(|v| v.as_i64()).is_some_and(|v| (-256..=256).contains(&v));
                if !ok {
                    err(format!("{at}.offset : {{ x, y }} entiers entre -256 et 256"));
                }
            }
        }
    }

    if errors.is_empty() {
        Ok(m)
    } else {
        errors.sort();
        Err(errors)
    }
}

// --- Stockage -----------------------------------------------------------------------

fn packs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = persistence::data_dir(app).map_err(|e| e.to_string())?.join("packs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Valide puis installe un pack ; remplace une version existante du même id.
pub fn import(app: &AppHandle, bytes: &[u8]) -> Result<PackInfo, Vec<String>> {
    let files = read_archive(bytes)?;
    let manifest = validate(&files)?;
    let root = packs_dir(app).map_err(|e| vec![e])?;
    let final_dir = root.join(&manifest.id);
    let tmp_dir = root.join(format!("{}.tmp", manifest.id));
    let io = |e: std::io::Error| vec![format!("écriture du pack impossible : {e}")];
    let _ = fs::remove_dir_all(&tmp_dir);
    for (name, data) in &files {
        let path = tmp_dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(io)?;
        }
        fs::write(&path, data).map_err(io)?;
    }
    let _ = fs::remove_dir_all(&final_dir);
    fs::rename(&tmp_dir, &final_dir).map_err(io)?;
    Ok(info_of(&manifest, false))
}

fn info_of(m: &Manifest, builtin: bool) -> PackInfo {
    PackInfo {
        id: m.id.clone(),
        name: m.name.clone(),
        author: m.author.clone(),
        version: m.version.clone(),
        description: m.description.clone().unwrap_or_default(),
        builtin,
    }
}

pub fn list(app: &AppHandle) -> Vec<PackInfo> {
    let mut packs = vec![PackInfo {
        id: DEFAULT_PACK_ID.into(),
        name: "Byte".into(),
        author: "Desktop Companion".into(),
        version: "1.0.0".into(),
        description: "Petit robot développeur (livré avec l'application).".into(),
        builtin: true,
    }];
    let Ok(root) = packs_dir(app) else {
        return packs;
    };
    let Ok(entries) = fs::read_dir(root) else {
        return packs;
    };
    for entry in entries.flatten() {
        let manifest = entry.path().join("manifest.json");
        if let Some(m) = fs::read(&manifest).ok().and_then(|b| serde_json::from_slice::<Manifest>(&b).ok()) {
            packs.push(info_of(&m, false));
        }
    }
    packs.sort_by(|a, b| b.builtin.cmp(&a.builtin).then(a.name.cmp(&b.name)));
    packs
}

/// Lit un fichier d'un pack installé (chemin relatif vérifié).
pub fn read_file(app: &AppHandle, id: &str, file: &str) -> Result<Vec<u8>, String> {
    if !is_identifier(id) {
        return Err("identifiant de pack invalide".into());
    }
    let Ok(Some(rel)) = safe_entry(file) else {
        return Err("chemin de fichier invalide".into());
    };
    let path = packs_dir(app)?.join(id).join(rel);
    fs::read(path).map_err(|e| format!("fichier de pack illisible : {e}"))
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    if !is_identifier(id) || id == DEFAULT_PACK_ID {
        return Err("ce pack ne peut pas être supprimé".into());
    }
    fs::remove_dir_all(packs_dir(app)?.join(id)).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_and_versions() {
        assert!(is_identifier("dev.auteur.mon-pack"));
        assert!(!is_identifier("Dev.Pack"));
        assert!(!is_identifier("seul"));
        assert!(is_semver("1.2.3") && is_semver("0.1.0-beta.1"));
        assert!(!is_semver("1.2") && !is_semver("01.2.3"));
    }

    #[test]
    fn dangerous_paths_are_rejected() {
        for bad in ["../evil.json", "/abs.png", "C:/x.png", "a\\b.png", "sfx/../../x.wav", "script.js", "a//b.png"] {
            assert!(safe_entry(bad).is_err(), "{bad} devrait être refusé");
        }
        assert_eq!(safe_entry("sfx/jump.ogg").unwrap().as_deref(), Some("sfx/jump.ogg"));
        assert_eq!(safe_entry("sfx/").unwrap(), None);
    }

    fn example(name: &str) -> Vec<u8> {
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples").join(name))
            .expect("lancer d'abord : npm run examples")
    }

    #[test]
    fn example_pack_is_valid() {
        let files = read_archive(&example("byte-sakura.companion")).expect("archive");
        let manifest = validate(&files).unwrap_or_else(|e| panic!("{e:#?}"));
        assert_eq!(manifest.id, "dev.exemple.sakura");
    }

    #[test]
    fn braise_pack_is_valid() {
        let files = read_archive(&example("braise.companion")).expect("archive");
        let manifest = validate(&files).unwrap_or_else(|e| panic!("{e:#?}"));
        assert_eq!(manifest.id, "dev.exemple.braise");
        assert_eq!(manifest.accent_color.as_deref(), Some("#f0805c"));
    }

    #[test]
    fn broken_pack_lists_every_error() {
        // Le chemin « ../../evil.json » fait échouer la lecture de l'archive elle-même.
        let errors = read_archive(&example("pack-invalide.companion")).unwrap_err();
        assert!(errors.iter().any(|e| e.contains("chemin interdit")), "{errors:#?}");
    }

    #[test]
    fn broken_manifest_and_animations_are_detailed() {
        let mut files = read_archive(&example("byte-sakura.companion")).unwrap();
        let mut m: serde_json::Value = serde_json::from_slice(&files["manifest.json"]).unwrap();
        m["id"] = "Mon Pack !".into();
        m["baseStats"]["strength"] = 99.into();
        let mut a: serde_json::Value = serde_json::from_slice(&files["animations.json"]).unwrap();
        a["animations"].as_object_mut().unwrap().remove("defeat");
        a["animations"]["walk"]["row"] = 99.into();
        a["animations"]["jump"]["next"] = "voler".into();
        files.insert("manifest.json".into(), serde_json::to_vec(&m).unwrap());
        files.insert("animations.json".into(), serde_json::to_vec(&a).unwrap());
        let errors = validate(&files).err().expect("doit échouer");
        for expected in ["id :", "baseStats.strength", "« defeat » manquant", "walk.row", "jump.next"] {
            assert!(errors.iter().any(|e| e.contains(expected)), "{expected} absent de {errors:#?}");
        }
    }

    #[test]
    fn not_a_zip_is_reported() {
        let err = read_archive(b"pas un zip").unwrap_err();
        assert!(err[0].contains("archive .companion"));
    }
}
