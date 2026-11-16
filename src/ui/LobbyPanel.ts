import { order, type Side } from '../network/Layout';
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

const SIDE_ARROWS: Partial<Record<Side, string>> = { left: '←', right: '→' };

/**
 * Salon : créer ou rejoindre, puis ordonner les écrans dans une file de gauche à
 * droite. Deux écrans voisins sont reliés par leurs bords. Seul l'hôte réordonne.
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
  private readonly strip: HTMLElement;
  private readonly stripTitle: HTMLElement;
  private readonly links: HTMLElement;
  private readonly awayLine: HTMLElement;
  private readonly message: HTMLElement;
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
    this.strip = h('ol.screen-strip', { 'aria-label': 'Écrans reliés, de gauche à droite' });
    this.stripTitle = heading('Écrans reliés');
    this.links = h('div.edges');
    this.awayLine = h('p.away-line');
    this.inside = h(
      'div',
      { hidden: true },
      this.codeRow,
      this.stripTitle,
      this.strip,
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
      this.renderStrip();
      const links = room.myLinks();
      const items = (['left', 'right'] as const)
        .filter((s) => links[s])
        .map((s) => h('span.edge', {}, s === 'left' ? `${SIDE_ARROWS.left} ${room.player(links[s]!)?.name ?? '?'}` : `${room.player(links[s]!)?.name ?? '?'} ${SIDE_ARROWS.right}`));
      this.links.replaceChildren(
        ...(items.length > 0 ? [h('span.muted', {}, 'Tes bords :'), ...items] : [h('span.muted', {}, 'Personne à côté de toi pour l’instant')]),
      );
      this.awayLine.textContent = this.away ? `Ton compagnon est chez ${this.away}` : '';
    }
    this.measure();
  }

  /** La file des écrans, de gauche à droite ; l'hôte les décale avec les flèches. */
  private renderStrip(): void {
    const room = this.room;
    const host = room.isHost;
    this.stripTitle.title = host
      ? 'Ordre des écrans, de gauche à droite : le bord droit d’un écran mène au suivant. Utilise les flèches pour réordonner.'
      : 'Ordre des écrans, de gauche à droite. Seul l’hôte peut le changer.';
    const line = order(room.layout);
    const cards: HTMLElement[] = [];
    line.forEach((id, i) => {
      const p = room.player(id);
      if (!p) return;
      if (i > 0) cards.push(h('li.strip-link', { 'aria-hidden': 'true' }));
      const screen = h('div.strip-screen', {}, h('span.strip-name', {}, p.name));
      const tags = h('div.strip-tags');
      if (id === room.myId) tags.append(chip('Toi'));
      if (id === room.hostId) tags.append(chip('Hôte'));
      const card = h('li.strip-card', { title: p.name }, screen, tags);
      card.style.setProperty('--player', p.color);
      if (id === room.myId) card.classList.add('me');
      if (host && line.length > 1) {
        const moves = h('div.strip-moves');
        const left = button('', () => this.shift(id, i - 1), { title: `Décaler ${p.name} à gauche` });
        left.append('‹');
        left.disabled = i === 0;
        const right = button('', () => this.shift(id, i + 1), { title: `Décaler ${p.name} à droite` });
        right.append('›');
        right.disabled = i === line.length - 1;
        moves.append(left, right);
        card.append(moves);
      }
      cards.push(card);
    });
    this.strip.replaceChildren(...cards);
  }

  private shift(id: string, index: number): void {
    if (!this.room.move(id, index)) this.say('Déplacement impossible');
    this.render();
  }
}
