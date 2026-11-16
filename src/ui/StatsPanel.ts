import { STATE_LABELS } from '../ai/behaviors';
import type { Companion } from '../entities/Companion';
import { NEED_KEYS, NEED_LABELS, STAT_KEYS, STAT_LABELS, type Mood, type NeedKey } from '../entities/CompanionStats';
import type { IconName } from './iconNames';
import { chip, gauge, heading, type Gauge } from './kit';
import { h, Section, type Console } from './Panel';

const MOOD: Record<Mood, { text: string; tone: string }> = {
  joyeux: { text: 'Joyeux', tone: 'good' },
  content: { text: 'Content', tone: 'good' },
  affamé: { text: 'Affamé', tone: 'warn' },
  fatigué: { text: 'Fatigué', tone: 'warn' },
  triste: { text: 'Triste', tone: 'bad' },
  boudeur: { text: 'Boudeur', tone: 'bad' },
};

const NEED_ICONS: Record<NeedKey, IconName> = { hunger: 'bowl', energy: 'sleep', happiness: 'pet' };
const NEED_TONES: Record<NeedKey, string> = { hunger: 'amber', energy: 'blue', happiness: 'coral' };

/** Fiche du compagnon : humeur, soins, entraînement ; rafraîchie à 1 Hz quand visible. */
export class StatsPanel extends Section {
  private readonly companion: Companion;
  private readonly needs = new Map<string, Gauge>();
  private readonly stats = new Map<string, Gauge>();
  private readonly name: HTMLElement;
  private readonly mood: HTMLElement;
  private readonly doing: HTMLElement;
  private readonly form: HTMLElement;
  private readonly counters: HTMLElement;
  private timer: number | undefined;

  constructor(hub: Console, companion: Companion) {
    super(hub, { id: 'stats', icon: 'stats', label: 'Fiche' });
    this.companion = companion;
    this.name = h('strong.id-name');
    this.mood = h('span');
    this.doing = h('span.id-doing');
    this.form = h('span.chip');
    this.form.title = 'Forme : multiplie la puissance en combat (moral, faim, fatigue)';
    this.counters = h('div.counters');

    const needs = h('div.gauges');
    for (const k of NEED_KEYS) {
      const g = gauge(NEED_LABELS[k], NEED_TONES[k], NEED_ICONS[k]);
      this.needs.set(k, g);
      needs.append(g.row);
    }
    const stats = h('div.gauges');
    for (const k of STAT_KEYS) {
      const g = gauge(STAT_LABELS[k], 'accent');
      this.stats.set(k, g);
      stats.append(g.row);
    }

    this.body.append(
      h('div.id-card', {}, h('div.id-line', {}, this.name, this.mood), h('div.id-line', {}, this.doing, this.form)),
      heading('Soins'),
      needs,
      heading('Entraînement'),
      stats,
      this.counters,
    );
  }

  override onShow(): void {
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 1000);
  }

  override onHide(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private refresh(): void {
    const s = this.companion.stats;
    for (const k of NEED_KEYS) this.needs.get(k)?.set(s.needs[k], Math.round(s.needs[k]).toString(), s.needs[k] < 25);
    for (const k of STAT_KEYS) this.stats.get(k)?.set(s.stats[k], s.stats[k].toFixed(1));

    this.name.textContent = s.data.name;
    const mood = MOOD[s.mood()];
    this.mood.replaceChildren(chip(mood.text, mood.tone));
    this.doing.textContent = STATE_LABELS[this.companion.state] ?? this.companion.state;
    const c = s.condition();
    this.form.textContent = `Forme ×${c.toFixed(2)}`;
    this.form.className = `chip ${c >= 1.05 ? 'good' : c < 0.8 ? 'bad' : ''}`;
    const days = Math.floor((Date.now() - s.data.bornAt) / 86_400_000);
    const n = s.data.counters;
    const stat = (value: number, label: string): HTMLElement => h('span.counter', {}, h('strong', {}, String(value)), label);
    this.counters.replaceChildren(
      stat(days, days > 1 ? 'jours' : 'jour'),
      stat(n.meals, 'repas'),
      stat(n.trainings, 'séances'),
      stat(n.pets, 'câlins'),
      stat(n.bugs, 'bugs'),
    );
  }
}
