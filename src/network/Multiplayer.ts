import type { Sfx } from '../audio/Sfx';
import type { Activity, LoopSystem } from '../engine/GameLoop';
import { loadPackWith, type CompanionPack } from '../engine/pack';
import type { Particles } from '../engine/Particles';
import type { Side, World } from '../engine/World';
import { Companion, type DesktopServices } from '../entities/Companion';
import { CompanionStats } from '../entities/CompanionStats';
import type { Toy, ToyBox } from '../entities/Toy';
import type { BehaviorToggles, HitRect, ProfileParams, RoomInfo } from '../platform/bridge';
import { Bubble } from '../ui/Bubble';
import type { CombatDirector } from './CombatDirector';
import { entryPoint, OPPOSITE } from './Layout';
import { fromBase64, type Exit, type Message, type PackPayload, type Traveller } from './protocol';
import { Room } from './Room';

/** Les statistiques d'un compagnon en visite remontent à son propriétaire régulièrement. */
const SYNC_EVERY_S = 20;

interface Visitor {
  owner: string;
  companion: Companion;
  bubble: Bubble;
  pack: PackPayload;
}

export interface MultiplayerDeps {
  stage: HTMLElement;
  world: World;
  toys: ToyBox;
  particles: Particles;
  sfx: Sfx;
  desktop: DesktopServices;
  director: CombatDirector;
  me: () => Companion;
  myName: () => string;
  myPack: () => Promise<PackPayload>;
  settings: () => { behaviors: BehaviorToggles; profile: ProfileParams };
  capture: (on: boolean) => void;
  wake: () => void;
  say: (text: string, seconds?: number) => void;
  /** Double-clic sur un compagnon visiteur : son menu radial. */
  openVisitorMenu: (c: Companion) => void;
  /** Salon, joueurs ou placement modifiés (rafraîchir le panneau). */
  onChanged: () => void;
  onRooms: (rooms: RoomInfo[]) => void;
  log?: (text: string) => void;
}

/**
 * Terrain de jeu étendu : les bureaux d'un salon sont reliés par leurs bords. Ce qui
 * franchit un bord relié (compagnon, jouet, note) quitte cet écran et arrive chez le
 * voisin, avec sa vitesse. Chaque machine simule et affiche uniquement son propre écran :
 * un compagnon en visite est simulé ici, et ses statistiques remontent à son
 * propriétaire.
 */
export class Multiplayer implements LoopSystem {
  readonly room: Room;
  private readonly d: MultiplayerDeps;
  private readonly visitors = new Map<string, Visitor>();
  private readonly edges = new Map<Side, HTMLElement>();
  /** Joueur chez qui se trouve notre compagnon (null : à la maison). */
  private awayAt: string | null = null;
  private syncTimer = 0;
  private friendTimer = 0;

  constructor(deps: MultiplayerDeps) {
    this.d = deps;
    this.room = new Room(deps.myName, {
      onChanged: () => {
        this.refreshLinks();
        deps.onChanged();
      },
      onMessage: (msg, from) => this.onMessage(msg, from),
      onPlayerLeft: (id) => this.onPlayerLeft(id),
      onClosed: (reason) => this.onClosed(reason),
      onRooms: deps.onRooms,
    });
  }

  async init(): Promise<void> {
    await this.room.init();
    this.d.toys.setCrossHandler((toy, side) => this.crossToy(toy, side));
  }

  get myCompanionAway(): boolean {
    return this.awayAt !== null;
  }

  /** Nom du joueur chez qui se trouve notre compagnon. */
  get awayAtName(): string | null {
    return this.awayAt ? this.room.player(this.awayAt)?.name ?? null : null;
  }

  visitorList(): Companion[] {
    return [...this.visitors.values()].map((v) => v.companion);
  }

  ownerOf(c: Companion): { id: string; name: string } | null {
    for (const v of this.visitors.values()) {
      if (v.companion === c) return { id: v.owner, name: this.room.player(v.owner)?.name ?? '?' };
    }
    return null;
  }

  // --- Actions du joueur --------------------------------------------------------------

  /** Rappelle notre compagnon et nos jouets, où qu'ils soient dans le salon. */
  recall(): void {
    if (!this.room.inRoom) return;
    this.room.send({ type: 'recall', to: '*', owner: this.room.myId });
    this.d.say(this.awayAt ? 'Je l’appelle… 📣' : 'Tes jouets reviennent ! 📣', 2);
  }

  /** Renvoie chez lui un compagnon en visite. */
  sendHome(c: Companion): void {
    const owner = this.ownerOf(c);
    if (owner) void this.sendCompanion(c, owner.id, 'home', 0, 0, 0);
  }

  // --- Traversée des bords --------------------------------------------------------------

  /** Branché sur `onCross` de chaque compagnon présent ici. */
  crossCompanion(c: Companion, side: Side): void {
    const neighbor = this.room.myLinks()[side];
    if (!neighbor) return;
    const t = this.d.world.edgeRatio(side, c.body.x, c.body.y);
    void this.sendCompanion(c, neighbor, side, t, c.body.vx, c.body.vy);
  }

  private async sendCompanion(c: Companion, to: string, exit: Exit, t: number, vx: number, vy: number): Promise<void> {
    const me = this.d.me();
    const mine = c === me;
    const visitor = mine ? null : [...this.visitors.values()].find((v) => v.companion === c);
    if (!mine && !visitor) return;
    if (this.d.director.involves(c)) this.d.director.abort();
    const queasy = c.queasy;

    // Il quitte l'écran tout de suite (pas de double départ pendant l'envoi).
    if (mine) {
      me.goAway();
      this.awayAt = to;
    } else if (visitor) {
      this.visitors.delete(visitor.owner);
      visitor.companion.destroy();
      visitor.bubble.destroy();
    }
    const owner = mine ? this.room.myId : visitor!.owner;
    const item: Traveller = {
      kind: 'companion',
      owner,
      ownerName: mine ? this.d.myName() : this.room.player(owner)?.name ?? '?',
      facing: c.facing,
      stats: c.stats.snapshot(),
      pack: mine ? await this.d.myPack() : visitor!.pack,
      queasy,
    };
    this.room.send({ type: 'transfer', to, item, exit, t, vx, vy });
    this.d.log?.(`compagnon de ${item.ownerName} envoyé vers ${this.room.player(to)?.name} (${exit})`);
    if (mine && exit !== 'home') this.d.say(`${this.d.myName()} part chez ${this.room.player(to)?.name ?? 'un ami'} !`, 2.5);
    this.d.onChanged();
  }

  private crossToy(toy: Toy, side: Side): void {
    const neighbor = this.room.myLinks()[side];
    if (!neighbor) return;
    this.sendToy(toy, neighbor, side, this.d.world.edgeRatio(side, toy.x, toy.y), toy.body.vx, toy.body.vy);
  }

  private sendToy(toy: Toy, to: string, exit: Exit, t: number, vx: number, vy: number): void {
    if (toy.kind === 'bug' || toy.kind === 'file' || toy.removed) return;
    const item: Traveller = {
      kind: 'toy',
      owner: toy.owner || this.room.myId,
      toy: toy.kind,
      food: toy.food,
      text: toy.text,
    };
    toy.squash();
    this.room.send({ type: 'transfer', to, item, exit, t, vx, vy });
    this.d.log?.(`${toy.kind} envoyé vers ${this.room.player(to)?.name} (${exit})`);
  }

  // --- Réception -----------------------------------------------------------------

  private onMessage(msg: Message, from: string): void {
    switch (msg.type) {
      case 'transfer':
        void this.receive(msg, from);
        return;
      case 'recall':
        this.onRecall(msg.owner);
        return;
      case 'sync':
        if (msg.owner === this.room.myId && this.awayAt) {
          const copy = CompanionStats.restore(msg.stats);
          if (copy) this.d.me().stats.adopt(copy);
        }
        return;
      case 'notice':
        this.d.say(msg.text, 4);
        return;
      default:
        return;
    }
  }

  /** Position d'arrivée : même proportion le long du bord opposé, ou chute « à la maison ». */
  private arrival(exit: Exit, t: number, half: number, height: number): { x: number; y: number } {
    const b = this.d.world.bounds;
    if (exit === 'home') {
      const floor = this.d.world.floors[0];
      return { x: floor ? (floor.x1 + floor.x2) / 2 : (b.left + b.right) / 2, y: b.top + height + 10 };
    }
    return entryPoint(b, OPPOSITE[exit], t, half, height);
  }

  private async receive(msg: Extract<Message, { type: 'transfer' }>, from: string): Promise<void> {
    const { item, exit, t } = msg;
    const vx = exit === 'home' ? 0 : msg.vx;
    const vy = exit === 'home' ? 0 : msg.vy;

    if (item.kind === 'toy') {
      const pos = this.arrival(exit, t, 20, 34);
      const toy = this.d.toys.spawn(item.toy, pos.x, pos.y, item.food, item.owner === this.room.myId ? '' : item.owner);
      toy.text = item.text;
      toy.body.launch(vx, vy);
      toy.body.crossLinks = exit !== 'home'; // il finit son vol ; il ne repart pas une fois posé
      this.d.log?.(`${item.toy} reçu de ${this.room.player(from)?.name}${item.text ? ` : « ${item.text} »` : ''}`);
      this.d.wake();
      return;
    }

    const me = this.d.me();
    if (item.owner === this.room.myId) {
      // Notre compagnon revient, avec ce qu'il a vécu chez le voisin.
      const copy = CompanionStats.restore(item.stats);
      if (copy) me.stats.adopt(copy);
      const pos = this.arrival(exit, t, me.halfW, me.h);
      me.comeBack({ ...pos, vx, vy, facing: item.facing, queasy: item.queasy === true });
      this.awayAt = null;
      this.d.log?.(`notre compagnon est revenu (${exit})`);
      if (exit === 'home') this.d.say('Me revoilà ! 🏠', 2.5);
      this.d.onChanged();
      return;
    }

    // Compagnon d'un autre joueur : il visite notre écran.
    const old = this.visitors.get(item.owner);
    if (old) {
      old.companion.destroy();
      old.bubble.destroy();
      this.visitors.delete(item.owner);
    }
    let pack: CompanionPack;
    try {
      pack = await this.decodePack(item.pack);
    } catch (err) {
      console.warn('[salon] apparence illisible', err);
      return;
    }
    const stats =
      CompanionStats.restore(item.stats) ??
      CompanionStats.create(pack.manifest.id, item.ownerName, pack.manifest.baseStats);
    const player = this.room.player(item.owner);
    let companion: Companion | null = null;
    const bubble = new Bubble(this.d.stage, () => (companion ? companion.bubbleAnchor() : { x: 0, y: 0 }));
    const c: Companion = new Companion(
      this.d.stage,
      pack,
      {
        desktop: this.d.desktop,
        world: this.d.world,
        toys: this.d.toys,
        stats,
        particles: this.d.particles,
        sfx: this.d.sfx,
        say: (text, seconds) => bubble.say(text, seconds),
        onDragStateChanged: this.d.capture,
        onDoubleClick: () => this.d.openVisitorMenu(c),
        requestWake: this.d.wake,
        onCross: (who, side) => this.crossCompanion(who, side),
      },
      this.d.settings(),
      {
        spawn: { ...this.arrival(exit, t, 40, 100), vx, vy, facing: item.facing },
        label: { text: player?.name ?? item.ownerName, color: player?.color ?? '#4dfcb0' },
      },
    );
    companion = c;
    if (item.queasy) c.makeQueasy();
    this.visitors.set(item.owner, { owner: item.owner, companion: c, bubble, pack: item.pack });
    if (exit === 'home') c.greet(`Coucou ! Je viens de chez ${item.ownerName}`);
    else c.say(`Coucou ! 👋`, 2);
    this.d.log?.(`visiteur arrivé : ${stats.data.name} (à ${item.ownerName}, ${exit})`);
    this.d.wake();
  }

  private async decodePack(payload: PackPayload): Promise<CompanionPack> {
    const files: Record<string, ArrayBuffer> = {
      'manifest.json': new TextEncoder().encode(payload.manifest).buffer,
      'animations.json': new TextEncoder().encode(payload.animations).buffer,
    };
    const sheet = (JSON.parse(payload.manifest) as { sprite?: { file?: unknown } }).sprite?.file;
    if (typeof sheet !== 'string') throw new Error('apparence invalide');
    files[sheet] = fromBase64(payload.sheet);
    return loadPackWith(async (file) => {
      const data = files[file];
      if (!data) throw new Error(`${file} absent`);
      return data;
    });
  }

  private onRecall(owner: string): void {
    const visitor = this.visitors.get(owner);
    if (visitor) void this.sendCompanion(visitor.companion, owner, 'home', 0, 0, 0);
    for (const toy of [...this.d.toys.items]) {
      if (toy.owner === owner && !toy.held) this.sendToy(toy, owner, 'home', 0, 0, 0);
    }
  }

  // --- Départs ---------------------------------------------------------------------

  private onPlayerLeft(id: string): void {
    const visitor = this.visitors.get(id);
    if (visitor) {
      if (this.d.director.involves(visitor.companion)) this.d.director.abort();
      visitor.companion.destroy();
      visitor.bubble.destroy();
      this.visitors.delete(id);
    }
    for (const toy of this.d.toys.items) if (toy.owner === id) toy.squash();
    // Notre compagnon était chez lui : il rentre avec ses dernières statistiques connues.
    if (this.awayAt === id) this.comeHome();
    this.d.wake();
  }

  private onClosed(reason: string): void {
    for (const id of [...this.visitors.keys()]) this.onPlayerLeft(id);
    for (const toy of this.d.toys.items) if (toy.owner) toy.squash();
    if (this.awayAt) this.comeHome();
    this.d.say(reason, 3);
  }

  private comeHome(): void {
    const me = this.d.me();
    const pos = this.arrival('home', 0, me.halfW, me.h);
    me.comeBack({ ...pos, vx: 0, vy: 0, facing: 1 });
    this.awayAt = null;
    this.d.say('Me revoilà ! 🏠', 2.5);
    this.d.onChanged();
  }

  // --- Bords reliés ----------------------------------------------------------------

  private refreshLinks(): void {
    const links = this.room.myLinks();
    this.d.world.links = new Set(Object.keys(links) as Side[]);
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const neighbor = links[side];
      let el = this.edges.get(side);
      if (!neighbor) {
        el?.remove();
        this.edges.delete(side);
        continue;
      }
      if (!el) {
        el = document.createElement('div');
        el.className = `edge-link edge-${side}`;
        this.d.stage.append(el);
        this.edges.set(side, el);
      }
      const player = this.room.player(neighbor);
      el.style.setProperty('--player', player?.color ?? '#4dfcb0');
      el.dataset['label'] = `${side === 'left' ? '← ' : side === 'top' ? '↑ ' : side === 'bottom' ? '↓ ' : ''}${player?.name ?? ''}${side === 'right' ? ' →' : ''}`;
      this.placeEdge(el, side);
    }
  }

  private placeEdge(el: HTMLElement, side: Side): void {
    const b = this.d.world.bounds;
    const s = el.style;
    s.left = `${side === 'right' ? b.right - 4 : b.left}px`;
    s.top = `${side === 'bottom' ? b.bottom - 4 : b.top}px`;
    s.width = side === 'left' || side === 'right' ? '4px' : `${b.right - b.left}px`;
    s.height = side === 'top' || side === 'bottom' ? '4px' : `${b.bottom - b.top}px`;
  }

  /** Le bureau a changé de taille : on replace les repères de bords. */
  onWorldChanged(): void {
    for (const [side, el] of this.edges) this.placeEdge(el, side);
  }

  // --- Boucle : les visiteurs ------------------------------------------------------------

  update(dt: number): void {
    for (const v of this.visitors.values()) {
      v.companion.update(dt);
      v.bubble.update(dt);
    }
    this.friendTimer += dt;
    if (this.friendTimer >= 1) {
      this.friendTimer = 0;
      this.pairFriends();
    }
    this.syncTimer += dt;
    if (this.syncTimer >= SYNC_EVERY_S) {
      this.syncTimer = 0;
      for (const v of this.visitors.values()) {
        this.room.send({ type: 'sync', to: v.owner, owner: v.owner, stats: v.companion.stats.snapshot() });
      }
    }
  }

  /** Chaque compagnon présent connaît le plus proche des autres (pour aller le saluer). */
  private pairFriends(): void {
    const all = [this.d.me(), ...this.visitorList()].filter((c) => !c.away);
    for (const c of all) {
      let best: Companion | null = null;
      for (const o of all) {
        if (o !== c && (!best || Math.abs(o.body.x - c.body.x) < Math.abs(best.body.x - c.body.x))) best = o;
      }
      const friend = best;
      c.friend = friend ? () => ({ x: friend.body.x, y: friend.body.y, name: friend.stats.data.name }) : null;
    }
  }

  render(): void {
    for (const v of this.visitors.values()) {
      v.companion.render();
      v.bubble.render();
    }
  }

  activity(): Activity {
    let level: Activity = 'dormant';
    for (const v of this.visitors.values()) {
      const a = v.companion.activity();
      if (a === 'active') return 'active';
      if (a === 'idle') level = 'idle';
    }
    return level;
  }

  hitRects(): HitRect[] {
    return this.visitorList()
      .map((c) => c.hitRect())
      .filter((r): r is HitRect => r !== null);
  }

  setSettings(behaviors: BehaviorToggles, profile: ProfileParams): void {
    for (const c of this.visitorList()) {
      c.setBehaviors(behaviors);
      c.setProfile(profile);
    }
  }
}
