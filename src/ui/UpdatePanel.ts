import type { AvailableUpdate } from '../platform/updates';
import { button } from './kit';
import { h, Panel } from './Panel';

/**
 * Petite fenêtre « Nouvelle version » : apparaît en bas à droite de l'écran principal
 * quand une mise à jour existe. « Installer » télécharge (barre de progression),
 * vérifie la signature, installe et relance ; « Plus tard » la masque jusqu'au
 * prochain démarrage.
 */
export class UpdatePanel extends Panel {
  private readonly text: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly status: HTMLElement;
  private update: AvailableUpdate | null = null;
  private busy = false;
  private readonly beforeInstall: () => void;

  constructor(stage: HTMLElement, beforeInstall: () => void, onToggle: (open: boolean) => void) {
    super(stage, 'Mise à jour', onToggle, 'import');
    this.beforeInstall = beforeInstall;
    this.el.classList.add('update-win');
    this.text = h('p.update-text');
    this.notes = h('p.update-notes');
    this.fill = h('i.gauge-fill');
    this.bar = h('div.update-bar', { hidden: true }, h('span.gauge-track', {}, this.fill));
    this.status = h('p.status-line');
    this.actions = h(
      'div.row',
      {},
      button('Plus tard', () => this.close(), { kind: 'ghost' }),
      button('Installer', () => void this.install(), { icon: 'import' }),
    );
    this.body.append(this.text, this.notes, this.bar, this.status, this.actions);
  }

  offer(update: AvailableUpdate, at: { x: number; y: number }): void {
    if (this.busy) return;
    this.update = update;
    this.text.replaceChildren('La version ', h('strong', {}, update.version), ' est disponible.');
    const notes = update.notes.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' · ');
    this.notes.textContent = notes;
    this.notes.hidden = !notes;
    this.status.textContent = '';
    this.bar.hidden = true;
    this.actions.hidden = false;
    this.open(at);
  }

  private async install(): Promise<void> {
    if (!this.update || this.busy) return;
    this.busy = true;
    this.actions.hidden = true;
    this.bar.hidden = false;
    this.fill.style.width = '0%';
    this.status.textContent = 'Téléchargement…';
    this.measure();
    this.beforeInstall();
    try {
      await this.update.install((ratio) => {
        this.fill.style.width = `${Math.round((ratio ?? 0.5) * 100)}%`;
        if (ratio === 1) this.status.textContent = 'Installation… l’application va redémarrer.';
      });
    } catch (err) {
      this.busy = false;
      this.bar.hidden = true;
      this.actions.hidden = false;
      this.status.textContent = `Échec : ${String(err)}`;
      this.measure();
    }
  }
}
