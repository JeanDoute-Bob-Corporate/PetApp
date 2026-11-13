import type { Sfx } from '../audio/Sfx';
import type { Activity, LoopSystem } from '../engine/GameLoop';
import type { Particles } from '../engine/Particles';
import type { Companion } from '../entities/Companion';
import { h } from '../ui/Panel';
import { createCombat, playTurn, type ActionEvent, type CombatState, type FighterStats } from './Combat';

type Phase = 'idle' | 'staging' | 'fighting' | 'ended';

/** Rythme : un échange toutes les 1,5 s, chaque coup animé en 0,7 s. */
const TURN_GAP_MS = 1500;
const STEP_MS = 700;
const STAGING_TIMEOUT_MS = 6000;

const LINES = {
  start: ['En garde !', 'Tu vas voir !', 'Prêt ? ⚔️', 'On y va !'],
  hit: ['Prends ça !', 'Hiya !', 'Bim !', 'Et toc !'],
  heavy: ['Coup spécial !', 'HAAA !', 'Attaque lourde !'],
  crit: ['COUP CRITIQUE ! ✨', 'Dans le mille !'],
  hurt: ['Aïe !', 'Ouch…', 'Hé !', 'Pas mal…'],
  blocked: ['Paré ! 🛡️', 'Même pas mal !'],
  miss: ['Raté…', 'Zut !'],
  dodge: ['Trop lent !', 'Raté ! 😜', 'Hop, esquivé !'],
  rest: ['Pff… je souffle…', 'Une seconde…', 'Hof hof…'],
  guard: ['Je me protège !', 'Viens donc !'],
  low: ['Je ne lâche rien !', 'C’est pas fini…'],
  win: ['Victoire ! 🏆', 'Trop fort !', 'Qui est le meilleur ?'],
  lose: ['Bien joué…', 'La prochaine fois…', 'J’ai la tête qui tourne…'],
} as const;

const pick = (lines: readonly string[]): string => lines[Math.floor(Math.random() * lines.length)]!;

export interface DirectorDeps {
  stage: HTMLElement;
  particles: Particles;
  sfx: Sfx;
  wake: () => void;
  /** Fin du combat (notifications aux propriétaires, journal). */
  onEnd?: (winner: Companion, loser: Companion) => void;
  log?: (text: string) => void;
}

/**
 * Combat automatique entre deux compagnons présents sur cet écran. Les joueurs
 * n'interviennent pas : le moteur (Combat.ts) décide de chaque coup à partir des
 * statistiques entraînées et de la forme, et les compagnons commentent en bulles.
 */
export class CombatDirector implements LoopSystem {
  private readonly d: DirectorDeps;
  private readonly bars: [HTMLElement, HTMLElement];
  private phase: Phase = 'idle';
  private fighters: [Companion, Companion] | null = null;
  private stats: [FighterStats, FighterStats] | null = null;
  private state: CombatState | null = null;
  private seed = 0;
  private queue: ActionEvent[] = [];
  private nextAt = 0;
  private stagedAt = 0;
  private lowSaid: [boolean, boolean] = [false, false];

  constructor(deps: DirectorDeps) {
    this.d = deps;
    const bar = (): HTMLElement => h('div.hp-bar', { hidden: true }, h('div.hp-fill'));
    this.bars = [bar(), bar()];
    deps.stage.append(...this.bars);
  }

  get active(): boolean {
    return this.phase !== 'idle';
  }

  involves(c: Companion): boolean {
    return !!this.fighters && this.fighters.includes(c);
  }

  /** Lance un combat ; refusé si l'un des deux est absent ou occupé. */
  start(a: Companion, b: Companion): boolean {
    if (this.active || a === b || a.away || b.away) return false;
    const card = (c: Companion): FighterStats => ({
      name: c.stats.data.name,
      ...c.stats.stats,
      condition: c.stats.condition(),
      energy: c.stats.needs.energy,
    });
    this.fighters = [a, b];
    this.stats = [card(a), card(b)];
    this.state = createCombat(this.stats[0], this.stats[1]);
    this.seed = Math.floor(Math.random() * 0xffffffff);
    this.queue = [];
    this.lowSaid = [false, false];

    // Arène : sur le sol, entre les deux, face à face, sans approcher des bords.
    const floor = a.world.floorAt(a.body.x) ?? a.world.floors[0];
    const gap = Math.max(a.h, b.h) * 0.75;
    const margin = gap + Math.max(a.h, b.h);
    const lo = (floor?.x1 ?? a.world.bounds.left) + margin;
    const hi = (floor?.x2 ?? a.world.bounds.right) - margin;
    const mid = Math.min(hi, Math.max(lo, (a.body.x + b.body.x) / 2));
    const aLeft = a.body.x <= b.body.x;
    a.fightTargetX = mid + (aLeft ? -gap : gap);
    b.fightTargetX = mid + (aLeft ? gap : -gap);
    a.fsm.go('fight');
    b.fsm.go('fight');
    this.phase = 'staging';
    this.stagedAt = performance.now();
    this.d.log?.(`combat : ${this.stats[0].name} contre ${this.stats[1].name}`);
    this.d.wake();
    return true;
  }

  /** Un combattant est parti (autre écran, déconnexion) : combat interrompu. */
  abort(): void {
    if (this.phase === 'idle') return;
    this.release();
  }

  update(): void {
    if (this.phase === 'idle' || !this.fighters || !this.state) return;
    const [a, b] = this.fighters;
    if (a.away || b.away || a.fsm.name !== 'fight' || b.fsm.name !== 'fight') {
      if (this.phase !== 'ended') return this.release();
    }
    const now = performance.now();

    if (this.phase === 'staging') {
      const ready = a.fightTargetX === null && b.fightTargetX === null;
      if (ready || now - this.stagedAt > STAGING_TIMEOUT_MS) {
        a.fightTargetX = null;
        b.fightTargetX = null;
        a.facing = a.body.x < b.body.x ? 1 : -1;
        b.facing = -a.facing as 1 | -1;
        a.anim('idle');
        b.anim('idle');
        a.say(pick(LINES.start), 1.5);
        window.setTimeout(() => b.say(pick(LINES.start), 1.5), 500);
        this.phase = 'fighting';
        this.nextAt = now + 1200;
      }
      return;
    }

    if (this.phase === 'fighting' && now >= this.nextAt) {
      if (this.queue.length === 0) {
        if (this.state.winner !== null) return this.end(this.state.winner);
        this.queue = playTurn(this.state, this.stats!, ['auto', 'auto'], this.seed);
        const [f0, f1] = this.state.fighters;
        this.d.log?.(`tour ${this.state.turn} pv=${f0.hp}/${f1.hp} ${this.queue.map((e) => `${e.actor}:${e.outcome}${e.damage}`).join(',')}`);
      }
      const event = this.queue.shift();
      if (event) this.animate(event);
      this.nextAt = now + (this.queue.length > 0 ? STEP_MS : TURN_GAP_MS);
      return;
    }

    if (this.phase === 'ended' && now >= this.nextAt) this.release();
  }

  render(): void {
    if (this.phase === 'idle' || !this.fighters || !this.state) return;
    this.fighters.forEach((c, i) => {
      const bar = this.bars[i]!;
      const f = this.state!.fighters[i]!;
      bar.hidden = this.phase === 'staging' || c.away;
      const fill = bar.firstElementChild as HTMLElement;
      const pct = Math.max(0, (f.hp / f.maxHp) * 100);
      fill.style.width = `${pct}%`;
      fill.classList.toggle('low', pct < 30);
      bar.style.transform = `translate3d(${Math.round(c.body.x)}px, ${Math.round(c.body.y - c.h - 14)}px, 0) translate(-50%, 0)`;
    });
  }

  activity(): Activity {
    return this.phase === 'idle' ? 'dormant' : 'active';
  }

  // --- Animation -------------------------------------------------------------------

  private animate(e: ActionEvent): void {
    const [a, b] = this.fighters!;
    const attacker = e.actor === 0 ? a : b;
    const defender = e.actor === 0 ? b : a;
    const target = { x: defender.body.x, y: defender.body.y - defender.h * 0.6 };

    switch (e.outcome) {
      case 'rest':
        attacker.anim('idle');
        attacker.emit('sweat', true);
        attacker.say(pick(LINES.rest), 1.3);
        return;
      case 'guard':
        attacker.anim('carry_idle');
        attacker.say(pick(LINES.guard), 1.3);
        return;
      case 'miss':
        attacker.anim(e.action === 'heavy' ? 'attack_heavy' : 'attack_light', true);
        defender.anim('jump', true);
        attacker.say(pick(LINES.miss), 1.2);
        window.setTimeout(() => defender.say(pick(LINES.dodge), 1.2), 300);
        return;
      default: {
        attacker.anim(e.action === 'heavy' ? 'attack_heavy' : 'attack_light', true);
        attacker.say(e.outcome === 'crit' ? pick(LINES.crit) : pick(e.action === 'heavy' ? LINES.heavy : LINES.hit), 1.2);
        window.setTimeout(() => {
          defender.anim('hurt', true);
          this.d.particles.emit(e.outcome === 'crit' ? 'star' : 'impact', target.x, target.y, true);
          this.popDamage(e.damage, target.x, target.y, e.outcome === 'crit');
          this.d.sfx.play('hit');
          const idx = e.actor === 0 ? 1 : 0;
          const f = this.state!.fighters[idx];
          if (f.hp > 0 && f.hp < f.maxHp * 0.25 && !this.lowSaid[idx]) {
            this.lowSaid[idx] = true;
            defender.say(pick(LINES.low), 1.4);
          } else {
            defender.say(e.outcome === 'blocked' ? pick(LINES.blocked) : pick(LINES.hurt), 1.1);
          }
        }, 280);
      }
    }
  }

  private popDamage(amount: number, x: number, y: number, crit: boolean): void {
    const el = h('span.damage-pop', {}, `−${amount}`);
    if (crit) el.classList.add('crit');
    el.style.setProperty('--x', `${Math.round(x)}px`);
    el.style.setProperty('--y', `${Math.round(y)}px`);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 1500);
    this.d.stage.append(el);
  }

  private end(winnerIndex: 0 | 1): void {
    const [a, b] = this.fighters!;
    const winner = winnerIndex === 0 ? a : b;
    const loser = winnerIndex === 0 ? b : a;
    this.phase = 'ended';
    this.nextAt = performance.now() + 3500;
    winner.anim('victory', true);
    loser.anim('defeat', true);
    winner.say(pick(LINES.win), 2.5);
    window.setTimeout(() => loser.say(pick(LINES.lose), 2.5), 700);
    winner.emit('star', true);
    this.d.sfx.play('levelup');

    // Récompenses : chacun progresse, le vainqueur un peu plus (et en est ravi).
    winner.stats.addHappiness(6);
    winner.stats.train('technique', 4, 1);
    winner.stats.train('strength', 3, 1);
    loser.stats.addHappiness(-2);
    loser.stats.train('endurance', 4, 1);
    for (const c of [winner, loser]) {
      c.stats.spend('train', 8);
      c.stats.countTraining();
      c.stats.interact();
    }
    this.d.log?.(`fin du combat : vainqueur ${winner.stats.data.name}`);
    this.d.onEnd?.(winner, loser);
  }

  private release(): void {
    const fighters = this.fighters;
    this.phase = 'idle';
    this.fighters = null;
    this.state = null;
    for (const bar of this.bars) bar.hidden = true;
    for (const c of fighters ?? []) {
      c.fightTargetX = null;
      if (!c.away && c.fsm.name === 'fight') c.fsm.go('idle', { duration: 2 });
    }
  }
}
