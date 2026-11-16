import { backend, events, type RoomInfo } from '../platform/bridge';
import { moveTo, neighbors, placeNew, remove, sanitize, type Placement, type Side } from './Layout';
import { MAX_PLAYERS, parseMessage, PLAYER_COLORS, PROTOCOL_VERSION, type Message, type Player } from './protocol';

export type Role = 'none' | 'host' | 'client';

export interface RoomHandlers {
  /** Joueurs, placement ou rôle modifiés. */
  onChanged(): void;
  /** Message d'un autre joueur (déjà validé ; `from` = expéditeur réel). */
  onMessage(msg: Message, from: string): void;
  /** Un joueur a quitté le salon. */
  onPlayerLeft(id: string): void;
  /** Le salon n'existe plus pour nous (hôte parti, ou on l'a quitté). */
  onClosed(reason: string): void;
  onRooms(rooms: RoomInfo[]): void;
}

const randomId = (): string =>
  [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Salon en étoile : l'hôte connaît tous les joueurs et relaie les messages. Il est seul
 * à décider du placement des écrans, qu'il diffuse à chaque changement.
 */
export class Room {
  readonly myId = randomId();
  role: Role = 'none';
  hostId = '';
  players: Player[] = [];
  layout: Placement = {};
  code: string | null = null;
  private myName: () => string;
  private readonly h: RoomHandlers;
  /** Côté hôte : connexion → joueur. Côté invité : la connexion vers l'hôte. */
  private readonly connPlayer = new Map<number, string | null>();
  private hostConn: number | null = null;

  constructor(myName: () => string, handlers: RoomHandlers) {
    this.myName = myName;
    this.h = handlers;
  }

  async init(): Promise<void> {
    await Promise.all([
      events.onRooms((rooms) => this.h.onRooms(rooms)),
      events.onPeerConnected(({ conn }) => this.onConnected(conn)),
      events.onPeerMessage(({ conn, text }) => this.onRaw(conn, text)),
      events.onPeerDisconnected(({ conn }) => this.onConnClosed(conn)),
    ]);
  }

  get inRoom(): boolean {
    return this.role !== 'none';
  }

  get isHost(): boolean {
    return this.role === 'host';
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** Voisins de mes bords. */
  myLinks(): Partial<Record<Side, string>> {
    return this.inRoom ? neighbors(this.layout, this.myId) : {};
  }

  // --- Cycle de vie ----------------------------------------------------------------

  async create(): Promise<void> {
    const status = await backend.p2pHost(true, this.myName(), 1);
    this.role = 'host';
    this.hostId = this.myId;
    this.players = [{ id: this.myId, name: this.myName(), color: PLAYER_COLORS[0]! }];
    this.layout = placeNew({}, this.myId);
    this.code = status.code;
    this.h.onChanged();
  }

  async browse(on: boolean): Promise<void> {
    await backend.p2pBrowse(on);
  }

  async join(target: string): Promise<void> {
    if (this.inRoom) throw new Error('Tu es déjà dans un salon.');
    const conn = await backend.p2pConnect(target);
    this.role = 'client';
    this.hostConn = conn;
    this.connPlayer.set(conn, null);
    this.sendRaw(conn, { type: 'join', v: PROTOCOL_VERSION, id: this.myId, name: this.myName() });
    this.h.onChanged();
  }

  async leave(): Promise<void> {
    if (this.role === 'host') await backend.p2pHost(false, this.myName(), 1);
    await backend.p2pClose(null);
    this.reset('Tu as quitté le salon.');
  }

  /** Hôte : déplace l'écran d'un joueur à un rang de la file (0 = tout à gauche). */
  move(id: string, index: number): boolean {
    if (!this.isHost) return false;
    const next = moveTo(this.layout, id, index);
    if (!next) return false;
    this.layout = next;
    this.broadcastRoom();
    this.h.onChanged();
    return true;
  }

  // --- Envoi ---------------------------------------------------------------------

  /** Envoie à un joueur (ou à tous avec `'*'`) ; l'hôte relaie si besoin. */
  send(msg: Message): void {
    const to = 'to' in msg ? msg.to : '*';
    const out = { ...msg, from: this.myId };
    if (this.role === 'client' && this.hostConn !== null) {
      this.sendRaw(this.hostConn, out);
    } else if (this.role === 'host') {
      for (const [conn, id] of this.connPlayer) if (id && (to === '*' || to === id)) this.sendRaw(conn, out);
    }
  }

  private sendRaw(conn: number, msg: unknown): void {
    backend.p2pSend(conn, JSON.stringify(msg)).catch((err: unknown) => console.warn('[salon]', err));
  }

  private broadcastRoom(): void {
    const msg: Message = { type: 'room', hostId: this.myId, players: this.players, layout: this.layout };
    for (const [conn, id] of this.connPlayer) if (id) this.sendRaw(conn, msg);
    void backend.p2pHost(true, this.myName(), this.players.length);
  }

  // --- Réception -----------------------------------------------------------------

  private onConnected(conn: number): void {
    // Côté hôte, la connexion n'est associée à un joueur qu'après son message `join`.
    if (this.role === 'host' && !this.connPlayer.has(conn)) this.connPlayer.set(conn, null);
  }

  private onRaw(conn: number, text: string): void {
    const msg = parseMessage(text);
    if (!msg) return;

    if (this.role === 'host') {
      const sender = this.connPlayer.get(conn);
      if (msg.type === 'join') {
        if (!sender && msg.v !== PROTOCOL_VERSION) {
          // Version différente (placement incompatible) : on prévient avant de refuser.
          const text = 'Ce salon utilise une autre version de Desktop Companion : mettez-vous tous à jour.';
          this.sendRaw(conn, { type: 'notice', to: msg.id, text });
          window.setTimeout(() => void backend.p2pClose(conn), 300);
          return;
        }
        if (sender || this.players.length >= MAX_PLAYERS || this.players.some((p) => p.id === msg.id)) {
          void backend.p2pClose(conn);
          return;
        }
        const used = new Set(this.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0]!;
        this.connPlayer.set(conn, msg.id);
        this.players.push({ id: msg.id, name: msg.name, color });
        this.layout = placeNew(this.layout, msg.id);
        this.broadcastRoom();
        this.h.onChanged();
        return;
      }
      if (!sender || msg.type === 'room') return; // pas encore présenté, ou message réservé à l'hôte
      // L'hôte inscrit l'expéditeur réel, puis relaie.
      const stamped = { ...msg, from: sender } as Message & { from: string };
      const to = 'to' in msg ? msg.to : '*';
      if (to === '*' || to !== this.myId) {
        for (const [c, id] of this.connPlayer) if (id && id !== sender && (to === '*' || to === id)) this.sendRaw(c, stamped);
      }
      if (to === '*' || to === this.myId) this.h.onMessage(stamped, sender);
      return;
    }

    if (this.role === 'client' && conn === this.hostConn) {
      if (msg.type === 'room') {
        const ids = msg.players.map((p) => p.id);
        const layout = sanitize(msg.layout, ids);
        if (!layout || !ids.includes(this.myId)) return;
        const left = this.players.filter((p) => !ids.includes(p.id)).map((p) => p.id);
        this.hostId = msg.hostId;
        this.players = msg.players;
        this.layout = layout;
        for (const id of left) this.h.onPlayerLeft(id);
        this.h.onChanged();
        return;
      }
      const from = 'from' in msg && msg.from ? msg.from : this.hostId;
      this.h.onMessage(msg, from);
    }
  }

  private onConnClosed(conn: number): void {
    if (this.role === 'host') {
      const id = this.connPlayer.get(conn);
      this.connPlayer.delete(conn);
      if (!id) return;
      this.players = this.players.filter((p) => p.id !== id);
      this.layout = remove(this.layout, id);
      this.broadcastRoom();
      this.h.onPlayerLeft(id);
      this.h.onChanged();
    } else if (this.role === 'client' && conn === this.hostConn) {
      this.reset('L’hôte a fermé le salon.');
    }
  }

  private reset(reason: string): void {
    const others = this.players.filter((p) => p.id !== this.myId).map((p) => p.id);
    this.role = 'none';
    this.hostConn = null;
    this.connPlayer.clear();
    this.players = [];
    this.layout = {};
    this.code = null;
    for (const id of others) this.h.onPlayerLeft(id);
    this.h.onClosed(reason);
    this.h.onChanged();
  }

}
