import type { AnimEvent, AnimationDef } from './pack';

export type AnimEventHandler = (event: AnimEvent, animation: string) => void;

/**
 * Lecteur d'animations piloté par animations.json : fps ou durées par frame,
 * boucle, enchaînement (`next`) et événements déclenchés à l'entrée d'une frame.
 */
export class Animator {
  private readonly defs: Record<string, AnimationDef>;
  private readonly onEvent: AnimEventHandler;
  private current: string;
  private def: AnimationDef;
  private frame = 0;
  private elapsed = 0;
  private held = false;
  private finished = false;

  constructor(defs: Record<string, AnimationDef>, initial: string, onEvent: AnimEventHandler) {
    this.defs = defs;
    this.onEvent = onEvent;
    this.current = initial;
    this.def = this.lookup(initial);
    this.emitFrameEvents();
  }

  get name(): string {
    return this.current;
  }

  get frameIndex(): number {
    return this.frame;
  }

  /** Vrai quand une animation non bouclée sans `next` est arrivée à sa dernière frame. */
  get isFinished(): boolean {
    return this.finished;
  }

  /** Colonne / ligne de la frame courante dans la planche. */
  get cell(): { col: number; row: number } {
    return { col: (this.def.startColumn ?? 0) + this.frame, row: this.def.row };
  }

  /** Lance une animation (sans effet si elle joue déjà, sauf `restart`). */
  play(name: string, restart = false, startFrame = 0): void {
    if (name === this.current && !restart && !this.held) return;
    this.current = name;
    this.def = this.lookup(name);
    this.frame = Math.min(Math.max(0, startFrame), this.def.frameCount - 1);
    this.elapsed = 0;
    this.held = false;
    this.finished = false;
    this.emitFrameEvents();
  }

  /** Fige une frame précise (anticipation d'un saut ou d'un atterrissage). */
  hold(name: string, frame: number): void {
    this.current = name;
    this.def = this.lookup(name);
    this.frame = Math.min(Math.max(0, frame), this.def.frameCount - 1);
    this.elapsed = 0;
    this.held = true;
    this.finished = false;
  }

  update(dt: number): void {
    if (this.held || this.finished) return;
    this.elapsed += dt * 1000;
    let duration = this.frameDuration();
    while (this.elapsed >= duration) {
      this.elapsed -= duration;
      if (this.frame + 1 < this.def.frameCount) {
        this.frame++;
      } else if (this.def.loop) {
        this.frame = 0;
      } else if (this.def.next && this.defs[this.def.next]) {
        this.play(this.def.next, true);
        return;
      } else {
        this.finished = true;
        return;
      }
      this.emitFrameEvents();
      duration = this.frameDuration();
    }
  }

  /** Millisecondes avant le prochain changement de frame (pour la mise en veille). */
  msUntilNextFrame(): number {
    if (this.held || this.finished) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.frameDuration() - this.elapsed);
  }

  private frameDuration(): number {
    return this.def.frameDurations?.[this.frame] ?? 1000 / this.def.fps;
  }

  private emitFrameEvents(): void {
    for (const event of this.def.events ?? []) {
      if (event.frame === this.frame) this.onEvent(event, this.current);
    }
  }

  private lookup(name: string): AnimationDef {
    const def = this.defs[name] ?? this.defs['idle'];
    if (!def) throw new Error(`Animation « ${name} » introuvable`);
    return def;
  }
}
