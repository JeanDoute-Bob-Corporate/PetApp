/**
 * IA utilitaire : chaque action candidate reçoit un score (0 = impossible) calculé à
 * partir des besoins, de la personnalité et du contexte. On tire ensuite au hasard parmi
 * les meilleures, pondéré par le carré du score : le compagnon reste prévisible dans ses
 * priorités (il mange quand il a très faim) sans être mécanique.
 */

export interface Consideration<C> {
  /** Nom de l'état à lancer. */
  readonly action: string;
  score(ctx: C): number;
  params?(ctx: C): unknown;
}

export interface Decision {
  action: string;
  params: unknown;
  score: number;
}

const TOP_CANDIDATES = 4;

export class UtilityAI<C> {
  private readonly considerations: readonly Consideration<C>[];
  /** Derniers scores calculés (affichés dans la fiche du compagnon). */
  lastScores: Array<{ action: string; score: number }> = [];

  constructor(considerations: readonly Consideration<C>[]) {
    this.considerations = considerations;
  }

  choose(ctx: C, random: () => number = Math.random): Decision {
    const scored = this.considerations
      .map((c) => ({ c, score: Math.max(0, c.score(ctx)) }))
      .filter((s) => s.score > 0 && Number.isFinite(s.score))
      .sort((a, b) => b.score - a.score);
    this.lastScores = scored.map((s) => ({ action: s.c.action, score: s.score }));

    const top = scored.slice(0, TOP_CANDIDATES);
    if (top.length === 0) return { action: 'idle', params: undefined, score: 0 };

    const total = top.reduce((sum, s) => sum + s.score * s.score, 0);
    let pick = random() * total;
    const chosen = top.find((s) => (pick -= s.score * s.score) <= 0) ?? top[0]!;
    return { action: chosen.c.action, params: chosen.c.params?.(ctx), score: chosen.score };
  }
}
