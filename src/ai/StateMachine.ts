import type { Activity } from '../engine/GameLoop';
import type { AnimEvent } from '../engine/pack';

/** Suite d'un état : un autre état, ou `done` pour laisser l'IA choisir la suite. */
export type Next = { to: string; params?: unknown } | 'done';

/**
 * Un état est instancié à chaque entrée (ses champs sont donc son état local).
 * - `activity` : cadence de rendu demandée à la boucle pendant cet état ;
 * - `airborne` : l'état gère lui-même la gravité (chute, escalade…) ;
 * - `priority` : un état ne peut être interrompu que par une priorité supérieure.
 */
export interface State<C> {
  readonly activity: Activity;
  readonly airborne?: boolean;
  readonly priority?: number;
  enter?(ctx: C): void;
  update(ctx: C, dt: number): Next | void;
  exit?(ctx: C): void;
  /** Événement de frame d'animation (impact d'un coup, pas…). */
  onAnimEvent?(ctx: C, event: AnimEvent): void;
}

export type StateFactory<C> = (params?: unknown) => State<C>;

/** Machine à états finis minimale, sans allocation hors des changements d'état. */
export class StateMachine<C> {
  private readonly ctx: C;
  private readonly factories: Record<string, StateFactory<C>>;
  private readonly onDone: () => Next;
  private state: State<C>;
  private stateName: string;
  private elapsed = 0;

  constructor(ctx: C, factories: Record<string, StateFactory<C>>, initial: string, onDone: () => Next) {
    this.ctx = ctx;
    this.factories = factories;
    this.onDone = onDone;
    this.stateName = initial;
    this.state = this.create(initial);
  }

  /** À appeler une fois le contexte prêt (le constructeur n'entre pas dans l'état). */
  start(): void {
    this.state.enter?.(this.ctx);
  }

  get name(): string {
    return this.stateName;
  }

  get current(): State<C> {
    return this.state;
  }

  /** Secondes passées dans l'état courant. */
  get time(): number {
    return this.elapsed;
  }

  go(name: string, params?: unknown): void {
    this.state.exit?.(this.ctx);
    this.stateName = this.factories[name] ? name : 'idle';
    this.state = this.create(this.stateName, params);
    this.elapsed = 0;
    this.state.enter?.(this.ctx);
  }

  /** Tente une interruption : refusée si l'état courant est plus prioritaire. */
  interrupt(name: string, priority: number, params?: unknown): boolean {
    if ((this.state.priority ?? 0) >= priority) return false;
    this.go(name, params);
    return true;
  }

  update(dt: number): void {
    this.elapsed += dt;
    let next = this.state.update(this.ctx, dt);
    // Plusieurs `done` d'affilée ne doivent pas boucler indéfiniment dans une frame.
    for (let guard = 0; next && guard < 4; guard++) {
      const target = next === 'done' ? this.onDone() : next;
      if (target === 'done') return;
      this.go(target.to, target.params);
      next = undefined;
    }
  }

  private create(name: string, params?: unknown): State<C> {
    const factory = this.factories[name] ?? this.factories['idle'];
    if (!factory) throw new Error(`État « ${name} » inconnu`);
    return factory(params);
  }
}
