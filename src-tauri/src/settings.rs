//! Modèle des réglages persistés et profils de performance.
//!
//! Les paramètres concrets de chaque profil vivent ici (source de vérité unique) et
//! sont envoyés au frontend avec les réglages, pour éviter toute divergence.

use serde::{Deserialize, Serialize};

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PerformanceProfile {
    Eco,
    #[default]
    Balanced,
    High,
}

impl PerformanceProfile {
    pub const ALL: [PerformanceProfile; 3] = [Self::Eco, Self::Balanced, Self::High];

    pub fn id(self) -> &'static str {
        match self {
            Self::Eco => "eco",
            Self::Balanced => "balanced",
            Self::High => "high",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Eco => "Éco",
            Self::Balanced => "Équilibré",
            Self::High => "Haute qualité",
        }
    }
}

/// Paramètres résolus d'un profil, consommés par la boucle de rendu et le tracker.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileParams {
    /// FPS quand une animation rapide est en cours (drag, saut, combat).
    pub target_fps: u32,
    /// FPS quand seules des micro-animations tournent (respiration, clignement).
    pub idle_fps: u32,
    /// Fréquence de scan des fenêtres Win32 (étape 2).
    pub tracker_hz: u32,
    pub particles: bool,
    pub shadows: bool,
    pub pause_on_fullscreen: bool,
}

impl ProfileParams {
    pub fn resolve(settings: &Settings) -> Self {
        let dnd = settings.behaviors.dnd_fullscreen;
        match settings.performance_profile {
            PerformanceProfile::Eco => Self {
                target_fps: 24,
                idle_fps: 6,
                tracker_hz: 4,
                particles: false,
                shadows: false,
                pause_on_fullscreen: true,
            },
            PerformanceProfile::Balanced => Self {
                target_fps: 30,
                idle_fps: 10,
                tracker_hz: 10,
                particles: true,
                shadows: false,
                pause_on_fullscreen: dnd,
            },
            PerformanceProfile::High => Self {
                target_fps: 60,
                idle_fps: 15,
                tracker_hz: 20,
                particles: true,
                shadows: true,
                pause_on_fullscreen: dnd,
            },
        }
    }
}

/// Interrupteurs granulaires des comportements (panneau de paramètres, étape 3).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BehaviorToggles {
    pub climb_windows: bool,
    pub sit_on_windows: bool,
    pub mouse_interactions: bool,
    pub sounds: bool,
    /// Mode « Ne pas déranger » : pause quand une app plein écran est active.
    pub dnd_fullscreen: bool,
    /// Bêtises quand il boude : tirer sur les côtés des fenêtres.
    pub mischief_windows: bool,
    /// Bêtises : déplacer les icônes du bureau.
    pub mischief_icons: bool,
    /// Bêtises : cliquer (uniquement sur le fond du bureau).
    pub mischief_clicks: bool,
}

impl Default for BehaviorToggles {
    fn default() -> Self {
        Self {
            climb_windows: true,
            sit_on_windows: true,
            mouse_interactions: true,
            sounds: false,
            dnd_fullscreen: true,
            mischief_windows: true,
            mischief_icons: true,
            mischief_clicks: true,
        }
    }
}

/// `#[serde(default)]` : un fichier d'une version antérieure, auquel il manque des
/// champs, se charge sans erreur avec les valeurs par défaut.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub performance_profile: PerformanceProfile,
    pub behaviors: BehaviorToggles,
    pub visible: bool,
    /// Pack d'apparence appliqué (`None` = compagnon par défaut).
    pub active_pack: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            performance_profile: PerformanceProfile::default(),
            behaviors: BehaviorToggles::default(),
            visible: true,
            active_pack: None,
        }
    }
}

/// Ce que reçoit le frontend : les réglages bruts + le profil résolu.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    pub settings: Settings,
    pub profile: ProfileParams,
}

impl From<&Settings> for SettingsPayload {
    fn from(settings: &Settings) -> Self {
        Self {
            settings: settings.clone(),
            profile: ProfileParams::resolve(settings),
        }
    }
}
