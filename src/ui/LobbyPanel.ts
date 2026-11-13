import { GRID_COLS, GRID_ROWS, type Cell, type Side } from '../network/Layout';
import type { Room } from '../network/Room';
import type { RoomInfo } from '../platform/bridge';
import { button, chip, heading } from './kit';
import { h, Section, type Console } from './Panel';

export interface LobbyActions {
  create(): void;
  join(target: string): void;
  leave(): void;
  recall(): void;
  browse(on: boolean): void;
  keyboard(enabled: boolean): void;
}

const SIDE_ARROWS: Record<Side, string> = { left: '◀', right: '▶', top: '▲', bottom: '▼' };

/**
 * Salon : créer ou rejoindre, puis placer les écrans sur une grille. Deux écrans
 * voisins sont reliés par leurs bords. Seul l'hôte déplace les écrans.
 */
export class LobbyPanel extends Section {
  private readonly room: Room;
  private readonly actions: LobbyActions;
  private readonly outside: HTMLElement;
  private readonly inside: HTMLElement;
  private readonly roomList: HTMLUListElement;
  private readonly codeInput: HTMLInputElement;
  private readonly codeBox: HTMLElement;
  private readonly codeRow: HTMLElement;
  private readonly players: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly gridTitle: HTMLElement;
  private readonly links: HTMLElement;
  private readonly awayLine: HTMLElement;
  private readonly message: HTMLElement;
  private selected: string | null = null;
  private away: string | null = null;

  constructor(hub: Console, room: Room, actions: LobbyActions) {
    super(hub, { id: 'room', icon: 'link', label: 'Salon' });
    this.room = room;
    this.actions = actions;

    // --- Hors salon ---
    this.roomList = h('ul.list');
    this.codeInput = h('input.field.code', {
      type: 'text',
      placeholder: 'K7Q2M-4XA9P',
      maxlength: '13',
      'aria-label': 'Code de session',
    });
    this.codeInput.addEventListener('focus', () => this.actions.keyboard(true));
    this.codeInput.addEventListener('blur', () => this.actions.keyboard(false));
    const doJoin = (): void => {
      const code = this.codeInput.value.trim();
      if (code) this.actions.join(code);
    };
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doJoin();
    });
    const createTitle = heading('Héberger');
    createTitle.title = 'Reliez vos bureaux : compagnons, jouets et notes passent d’un écran à l’autre par les bords';
    this.outside = h(
      'div',
      {},
      createTitle,
      h('div.row', {}, h('span.muted', {}, 'Les autres te rejoignent'), button('Créer un salon', () => this.actions.create(), { icon: 'link' })),
      heading('À proximité'),
      this.roomList,
      heading('Avec un code'),
      h('div.row', {}, this.codeInput, button('Rejoindre', doJoin)),
    );

    // --- Dans un salon ---
    this.codeBox = h('code.big-code', { title: 'À partager avec tes amis' });
    const copy = button('', () => {
      if (this.room.code) void navigator.clipboard?.writeText(this.room.code).then(() => this.say('Code copié'));
    }, { icon: 'copy', title: 'Copier le code' });
    this.codeRow = h('div.row', {}, this.codeBox, copy);
    this.players = h('div.players');
    this.grid = h('div.screen-grid', { role: 'grid', 'aria-label': 'Placement des écrans' });
    this.grid.style.setProperty('--cols', String(GRID_COLS));
    this.gridTitle = heading('Écrans');
    this.links = h('div.edges');
    this.awayLine = h('p.away-line');
    this.inside = h(
      'div',
      { hidden: true },
      this.codeRow,
      heading('Joueurs'),
      this.players,
      this.gridTitle,
      this.grid,
      this.links,
      this.awayLine,
      h(
        'div.row',
        {},
        button('Quitter', () => this.actions.leave(), { kind: 'ghost' }),
        button('Rappeler', () => this.actions.recall(), { icon: 'recall', title: 'Ramène ton compagnon et tes jouets' }),
      ),
    );

    this.message = h('p.status-line', { role: 'status' });
    this.body.append(this.outside, this.inside, this.message);
    this.setRooms([]);
    this.render();
  }

  override onShow(): void {
    this.actions.browse(!this.room.inRoom);
  }

  override onHide(): void {
    this.actions.browse(false);
  }

  setRooms(rooms: RoomInfo[]): void {
    if (rooms.length === 0) {
      this.roomList.replaceChildren(h('li.empty', {}, h('span.blink', {}, '▌'), ' recherche…'));
    } else {
      this.roomList.replaceChildren(
        ...rooms.map((r) =>
          h(
            'li',
            {},
            h('div.row-main', {}, h('strong', {}, r.name), h('small', {}, `${r.players} joueur${r.players > 1 ? 's' : ''}`)),
            button('Rejoindre', () => this.actions.join(r.id)),
          ),
        ),
      );
    }
    this.measure();
  }

  /** Chez qui se trouve notre compagnon (null : à la maison). */
  setAway(name: string | null): void {
    this.away = name;
    this.render();
  }

  say(text: string): void {
    this.message.textContent = text;
    this.measure();
  }

  render(): void {
    const room = this.room;
    this.outside.hidden = room.inRoom;
    this.inside.hidden = !room.inRoom;
    if (room.inRoom) {
      this.codeRow.hidden = !room.isHost || !room.code;
      this.codeBox.textContent = room.code ?? '';
      this.players.replaceChildren(
        ...room.players.map((p) => {
          const el = h('span.player', {}, h('i.dot'), p.name);
          el.style.setProperty('--player', p.color);
          if (p.id === room.hostId) el.append(chip('Hôte'));
          if (p.id === room.myId) el.classList.add('me');
          return el;
        }),
      );
      this.renderGrid();
      const links = room.myLinks();
      const items = (Object.keys(SIDE_ARROWS) as Side[])
        .filter((s) => links[s])
        .map((s) => h('span.edge', {}, `${SIDE_ARROWS[s]} ${room.player(links[s]!)?.name ?? '?'}`));
      this.links.replaceChildren(...(items.length > 0 ? items : [h('span.muted', {}, 'Aucun bord relié')]));
      this.awayLine.textContent = this.away ? `Ton compagnon est chez ${this.away}` : '';
    }
    this.measure();
  }

  private renderGrid(): void {
    const room = this.room;
    const host = room.isHost;
    this.gridTitle.title = host
      ? 'Clique un écran puis une case libre pour le déplacer. Deux écrans voisins sont reliés.'
      : 'Seul l’hôte déplace les écrans';
    const at = new Map<string, string>();
    for (const [id, c] of Object.entries(room.layout)) at.set(`${c.col},${c.row}`, id);
    const cells: HTMLElement[] = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const id = at.get(`${col},${row}`);
        const player = id ? room.player(id) : undefined;
        const cell = h(
          'button.grid-cell',
          { type: 'button', disabled: !host, 'aria-label': player ? `Écran de ${player.name}` : 'Case libre' },
          player ? player.name.slice(0, 8) : '',
        );
        if (player) {
          cell.classList.add('taken');
          cell.style.setProperty('--player', player.color);
          if (id === room.myId) cell.classList.add('mine');
          if (id === this.selected) cell.classList.add('selected');
        }
        cell.addEventListener('click', () => this.onCell(id ?? null, { col, row }));
        cells.push(cell);
      }
    }
    this.grid.replaceChildren(...cells);
  }

  private onCell(id: string | null, cell: Cell): void {
    if (!this.room.isHost) return;
    if (id) {
      this.selected = this.selected === id ? null : id;
    } else if (this.selected) {
      if (!this.room.move(this.selected, cell)) this.say('Case indisponible');
      this.selected = null;
    }
    this.render();
  }
}
