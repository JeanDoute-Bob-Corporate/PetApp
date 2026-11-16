import { backend, type BehaviorToggles, type PerformanceProfileId, type Settings } from '../platform/bridge';
import { button, heading, toggle } from './kit';
import { h, Section, type Console } from './Panel';

const PROFILES: Array<{ id: PerformanceProfileId; label: string; hint: string }> = [
  { id: 'eco', label: 'Éco', hint: '24 FPS · sans particules · pause en plein écran' },
  { id: 'balanced', label: 'Équilibré', hint: '30 FPS · particules' },
  { id: 'high', label: 'Qualité', hint: '60 FPS · particules et ombres' },
];

const BEHAVIORS: Array<{ key: keyof BehaviorToggles; label: string; hint?: string }> = [
  { key: 'sitOnWindows', label: 'Monter sur les fenêtres', hint: 'S’asseoir et sauter sur les fenêtres' },
  { key: 'climbWindows', label: 'Escalader', hint: 'Escalader et pousser les fenêtres' },
  { key: 'mouseInteractions', label: 'Jeux avec la souris', hint: 'Caresses au survol, poursuite du curseur' },
  { key: 'sounds', label: 'Sons' },
  { key: 'dndFullscreen', label: 'Discret en plein écran', hint: 'Ne dérange pas pendant un jeu ou une vidéo' },
];

/** Bêtises qu'il fait quand il boude (malheureux et délaissé depuis 15 min). */
const MISCHIEF: Array<{ key: keyof BehaviorToggles; label: string; hint: string }> = [
  { key: 'mischiefWindows', label: 'Tirer les fenêtres', hint: 'Tire ou repousse le côté d’une fenêtre (300 px max)' },
  { key: 'mischiefIcons', label: 'Déplacer les icônes', hint: 'Emporte une icône du bureau ailleurs' },
  { key: 'mischiefClicks', label: 'Cliquer', hint: 'Seulement sur le fond du bureau' },
];

const MULTIPLAYER: Array<{ key: keyof BehaviorToggles; label: string; hint: string }> = [
  { key: 'edgeMarkers', label: 'Couleur des bords reliés', hint: 'Lueur et nom du voisin sur les bords de l’écran qui mènent chez un ami' },
];

/** Réglages : chaque changement est appliqué et sauvegardé immédiatement. */
export class SettingsPanel extends Section {
  private settings: Settings;
  private readonly profileButtons = new Map<PerformanceProfileId, HTMLButtonElement>();
  private readonly profileHint: HTMLElement;
  private readonly behaviorInputs = new Map<keyof BehaviorToggles, HTMLInputElement>();
  private readonly autostartInput: HTMLInputElement;

  constructor(hub: Console, initial: Settings) {
    super(hub, { id: 'settings', icon: 'settings', label: 'Réglages' });
    this.settings = initial;

    const segmented = h('div.segmented', { role: 'radiogroup', 'aria-label': 'Profil de performance' });
    for (const p of PROFILES) {
      const b = h('button', { type: 'button', role: 'radio', title: p.hint }, p.label);
      b.addEventListener('click', () => this.apply({ ...this.settings, performanceProfile: p.id }));
      this.profileButtons.set(p.id, b);
      segmented.append(b);
    }
    this.profileHint = h('p.hint');

    const list = (items: typeof BEHAVIORS): HTMLElement => {
      const box = h('div.switches');
      for (const b of items) {
        const t = toggle(
          b.label,
          (on) => this.apply({ ...this.settings, behaviors: { ...this.settings.behaviors, [b.key]: on } }),
          b.hint,
        );
        this.behaviorInputs.set(b.key, t.input);
        box.append(t.row);
      }
      return box;
    };

    const autostart = toggle('Lancer avec Windows', (on) => {
      backend
        .setAutostart(on)
        .then((enabled) => (this.autostartInput.checked = enabled))
        .catch(console.warn);
    });
    this.autostartInput = autostart.input;

    const mischiefTitle = heading('Bêtises');
    mischiefTitle.title = 'Quand il boude : malheureux et délaissé depuis 15 min';

    this.body.append(
      heading('Performance'),
      segmented,
      this.profileHint,
      heading('Comportement'),
      list(BEHAVIORS),
      mischiefTitle,
      list(MISCHIEF),
      heading('Multijoueur'),
      list(MULTIPLAYER),
      heading('Système'),
      h('div.switches', {}, autostart.row),
      this.updateRow,
    );
    this.render();
  }

  /** Version installée et bouton « Rechercher une mise à jour ». */
  private readonly updateRow: HTMLElement = h('div.row');

  /** Branche la recherche manuelle de mise à jour (renvoie le message à afficher). */
  setUpdater(version: string, check: () => Promise<string>): void {
    const label = h('span.muted', {}, `Version ${version}`);
    const status = h('span.muted');
    const run = button('Rechercher une mise à jour', () => {
      run.disabled = true;
      status.textContent = '';
      check()
        .then((message) => (status.textContent = message))
        .catch((err: unknown) => (status.textContent = `Impossible de vérifier (${String(err)})`))
        .finally(() => {
          run.disabled = false;
          this.measure();
        });
    }, { kind: 'ghost', icon: 'import' });
    this.updateRow.replaceChildren(h('div.row-main', {}, label, status), run);
  }

  override onShow(): void {
    backend
      .getAutostart()
      .then((enabled) => (this.autostartInput.checked = enabled))
      .catch(console.warn);
  }

  /** Réglages modifiés ailleurs (tray, autre panneau). */
  update(settings: Settings): void {
    this.settings = settings;
    this.render();
  }

  setAutostart(enabled: boolean): void {
    this.autostartInput.checked = enabled;
  }

  private apply(next: Settings): void {
    this.settings = next;
    this.render();
    backend.updateSettings(next).catch(console.warn);
  }

  private render(): void {
    for (const [id, b] of this.profileButtons) b.setAttribute('aria-checked', String(id === this.settings.performanceProfile));
    this.profileHint.textContent = PROFILES.find((p) => p.id === this.settings.performanceProfile)?.hint ?? '';
    for (const [key, input] of this.behaviorInputs) input.checked = this.settings.behaviors[key];
  }
}
