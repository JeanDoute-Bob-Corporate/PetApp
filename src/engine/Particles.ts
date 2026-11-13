/**
 * Particules légères : quelques éléments DOM animés en CSS (le compositeur fait tout
 * le travail, aucune frame JS). Désactivées dans le profil Éco.
 */
export type ParticleKind =
  | 'zzz' | 'heart' | 'impact' | 'sweat' | 'star' | 'anger' | 'note' | 'food' | 'sparkle' | 'alert' | 'dust'
  | 'sick' | 'ripple';

const GLYPHS: Record<ParticleKind, string> = {
  zzz: '💤',
  heart: '❤️',
  impact: '💥',
  sweat: '💦',
  star: '⭐',
  anger: '💢',
  note: '♪',
  food: '🍖',
  sparkle: '✨',
  alert: '❗',
  dust: '💨',
  sick: '🤢',
  ripple: '',
};

export const isParticleKind = (id: string): id is ParticleKind => id in GLYPHS && id !== 'ripple';

const MAX_LIVE = 24;

export class Particles {
  private readonly stage: HTMLElement;
  private live = 0;
  enabled = true;

  constructor(stage: HTMLElement) {
    this.stage = stage;
  }

  /** `force` : affichée même si les particules sont désactivées (retour d'action utile). */
  emit(kind: ParticleKind, x: number, y: number, force = false): void {
    if ((!this.enabled && !force) || this.live >= MAX_LIVE) return;
    const el = document.createElement('span');
    el.className = `particle particle-${kind}`;
    el.textContent = GLYPHS[kind];
    const drift = (Math.random() - 0.5) * 30;
    el.style.setProperty('--x', `${Math.round(x)}px`);
    el.style.setProperty('--y', `${Math.round(y)}px`);
    el.style.setProperty('--dx', `${Math.round(drift)}px`);
    this.live++;
    let done = false;
    const end = (): void => {
      if (done) return;
      done = true;
      el.remove();
      this.live--;
    };
    // animationend ne vient jamais si les animations sont désactivées : minuterie de secours.
    el.addEventListener('animationend', end, { once: true });
    window.setTimeout(end, 2500);
    this.stage.append(el);
  }
}
