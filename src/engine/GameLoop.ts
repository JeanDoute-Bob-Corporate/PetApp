/**
 * Boucle de jeu basse consommation.
 *
 * - Simulation à pas fixe (1/60 s) : physique stable, indépendante du FPS affiché.
 * - Rendu capé selon le niveau d'activité déclaré par les systèmes :
 *     active  → FPS cible du profil (drag, saut, combat)
 *     idle    → FPS réduit (respiration, clignement)
 *     dormant → plus aucun tick jusqu'au prochain `wake()`
 * - En dessous de 50 FPS on cadence avec `setTimeout` plutôt qu'un rAF qui sauterait
 *   des frames : un rAF réveille le JS à chaque vsync (60×/s) même pour ne rien faire.
 */

export type Activity = 'dormant' | 'idle' | 'active';

export interface LoopSystem {
  update(dt: number): void;
  render(alpha: number): void;
  activity(): Activity;
}

export interface LoopTiming {
  targetFps: number;
  idleFps: number;
}

const STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 8;
const MAX_FRAME_DT = 0.25;
const RAF_THRESHOLD_FPS = 50;
const ACTIVITY_RANK: Record<Activity, number> = { dormant: 0, idle: 1, active: 2 };

export class GameLoop {
  private readonly systems: LoopSystem[];
  private timing: LoopTiming;
  private running = false;
  private timeoutId: number | undefined;
  private rafId: number | undefined;
  private lastTime = 0;
  private accumulator = 0;
  private activity: Activity = 'active';

  constructor(systems: LoopSystem[], timing: LoopTiming) {
    this.systems = systems;
    this.timing = timing;
  }

  get currentActivity(): Activity {
    return this.running ? this.activity : 'dormant';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.activity = 'active';
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    this.cancel();
  }

  /** Sort du mode dormant / idle immédiatement (interaction, événement tray…). */
  wake(): void {
    if (!this.running) return;
    const wasDormant = this.timeoutId === undefined && this.rafId === undefined;
    this.activity = 'active';
    if (wasDormant) this.lastTime = performance.now();
    this.cancel();
    this.schedule(0);
  }

  setTiming(timing: LoopTiming): void {
    this.timing = timing;
    this.wake();
  }

  private cancel(): void {
    if (this.timeoutId !== undefined) window.clearTimeout(this.timeoutId);
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.timeoutId = undefined;
    this.rafId = undefined;
  }

  private schedule(delayMs: number): void {
    const fps = this.activity === 'active' ? this.timing.targetFps : this.timing.idleFps;
    if (fps >= RAF_THRESHOLD_FPS) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.timeoutId = window.setTimeout(this.tick, Math.max(0, delayMs));
    }
  }

  private readonly tick = (): void => {
    this.timeoutId = undefined;
    this.rafId = undefined;
    if (!this.running) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, MAX_FRAME_DT);
    this.lastTime = now;

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      for (const system of this.systems) system.update(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;

    const alpha = this.accumulator / STEP;
    let activity: Activity = 'dormant';
    for (const system of this.systems) {
      system.render(alpha);
      const a = system.activity();
      if (ACTIVITY_RANK[a] > ACTIVITY_RANK[activity]) activity = a;
    }
    this.activity = activity;

    if (activity === 'dormant') return; // en veille jusqu'au prochain wake()

    const fps = activity === 'active' ? this.timing.targetFps : this.timing.idleFps;
    const spent = performance.now() - now;
    this.schedule(1000 / fps - spent);
  };
}
