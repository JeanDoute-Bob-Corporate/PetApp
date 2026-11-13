import { backend, type PackInfo } from '../platform/bridge';
import { button, chip, heading, icon } from './kit';
import { h, Section, type Console } from './Panel';

const MAX_SHOWN_ERRORS = 20;

/**
 * Apparence : packs installés, import d'un .companion (bouton ou glisser-déposer)
 * avec erreurs de validation détaillées, application (les statistiques sont
 * conservées) et suppression.
 */
export class PackPanel extends Section {
  private readonly list: HTMLUListElement;
  private readonly status: HTMLElement;
  private readonly getActive: () => string;
  private readonly onApply: (id: string) => void;
  private confirmDelete: string | null = null;

  constructor(hub: Console, getActive: () => string, onApply: (id: string) => void) {
    super(hub, { id: 'packs', icon: 'palette', label: 'Look' });
    this.getActive = getActive;
    this.onApply = onApply;
    this.list = h('ul.list');
    this.status = h('div.status', { role: 'status' });

    const input = h('input', { type: 'file', accept: '.companion', hidden: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) void this.importFile(file);
    });
    const drop = h(
      'div.dropzone',
      { title: 'Ses statistiques et sa progression sont conservées' },
      icon('import', 2),
      h('span', {}, 'Dépose un .companion'),
      button('Parcourir', () => input.click(), { kind: 'ghost' }),
    );

    this.body.append(heading('Packs installés'), this.list, drop, input, this.status);
  }

  override onShow(): void {
    void this.refresh();
  }

  /** Accepte aussi un dépôt de fichier sur la console. */
  contains(x: number, y: number): boolean {
    const r = this.hitRect();
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  async importFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.companion')) {
      this.showErrors(`« ${file.name} » n’est pas un .companion`, []);
      return;
    }
    this.setStatus('pending', `Vérification de « ${file.name} »…`);
    try {
      const info = await backend.importCompanion(new Uint8Array(await file.arrayBuffer()));
      this.status.className = 'status ok';
      this.status.replaceChildren(
        h('p', {}, `« ${info.name} » ${info.version} importé`),
        button('Appliquer', () => this.onApply(info.id), { icon: 'palette' }),
      );
      await this.refresh();
    } catch (err) {
      const errors = Array.isArray(err) ? err.map(String) : [String(err)];
      this.showErrors(`« ${file.name} » refusé`, errors);
    }
    this.measure();
  }

  private async refresh(): Promise<void> {
    const packs = await backend.listPacks().catch((): PackInfo[] => []);
    const active = this.getActive();
    this.list.replaceChildren(...packs.map((p) => this.row(p, p.id === active)));
    this.measure();
  }

  private row(pack: PackInfo, active: boolean): HTMLLIElement {
    const actions = h('div.row-actions');
    if (active) {
      actions.append(chip('Actif', 'good'));
    } else {
      actions.append(button('Appliquer', () => this.onApply(pack.id)));
    }
    if (!pack.builtin && !active) {
      const confirming = this.confirmDelete === pack.id;
      const del = confirming
        ? button('Sûr ?', () => this.remove(pack), { kind: 'danger', title: 'Supprimer définitivement' })
        : button('', () => {
            this.confirmDelete = pack.id;
            void this.refresh();
          }, { icon: 'trash', title: 'Supprimer ce pack' });
      actions.append(del);
    }
    const meta = h('div.row-main', {}, h('strong', {}, pack.name), h('small', {}, `v${pack.version} · ${pack.author}`));
    if (pack.description) meta.title = pack.description;
    return h(`li${active ? '.active' : ''}`, {}, meta, actions);
  }

  private remove(pack: PackInfo): void {
    this.confirmDelete = null;
    backend
      .deletePack(pack.id)
      .then(() => this.setStatus('ok', `« ${pack.name} » supprimé`))
      .catch((e: unknown) => this.setStatus('error', String(e)))
      .finally(() => void this.refresh());
  }

  private setStatus(kind: 'ok' | 'error' | 'pending', text: string): void {
    this.status.className = `status ${kind}`;
    this.status.replaceChildren(h('p', {}, text));
    this.measure();
  }

  private showErrors(title: string, errors: string[]): void {
    const shown = errors.slice(0, MAX_SHOWN_ERRORS);
    const more = errors.length - shown.length;
    this.status.className = 'status error';
    this.status.replaceChildren(
      h('p', {}, title),
      ...(shown.length > 0 ? [h('ul.error-list', {}, ...shown.map((e) => h('li', {}, e)))] : []),
      ...(more > 0 ? [h('p', {}, `… et ${more} autre(s)`)] : []),
    );
    this.measure();
  }
}
