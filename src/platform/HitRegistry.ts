import type { Activity, LoopSystem } from '../engine/GameLoop';
import type { HitRect } from './bridge';
import type { HitboxSync } from './HitboxSync';

export type HitProvider = () => readonly HitRect[] | HitRect | null;

/**
 * Rassemble à chaque frame les zones interactives (compagnon, jouets, menus, panneaux)
 * et les transmet au thread de hit-test Rust via HitboxSync (dédupliqué et throttlé).
 * À placer en dernier dans la boucle, après le rendu des entités.
 */
export class HitRegistry implements LoopSystem {
  private readonly providers = new Set<HitProvider>();
  private readonly sync: HitboxSync;

  constructor(sync: HitboxSync) {
    this.sync = sync;
  }

  add(provider: HitProvider): () => void {
    this.providers.add(provider);
    return () => this.providers.delete(provider);
  }

  update(): void {}

  render(): void {
    const rects: HitRect[] = [];
    for (const provider of this.providers) {
      const r = provider();
      if (!r) continue;
      if (Array.isArray(r)) rects.push(...r);
      else rects.push(r as HitRect);
    }
    this.sync.update(rects);
  }

  activity(): Activity {
    return 'dormant';
  }
}
