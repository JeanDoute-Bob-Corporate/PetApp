/**
 * Modèle de soin et d'entraînement du compagnon (Tamagotchi + RPG).
 *
 * Module pur (aucune dépendance, syntaxe effaçable) : testé directement par
 * `node --test`, et sérialisé tel quel dans companion.json par le backend Rust.
 * Toutes les durées sont en secondes, les horodatages en millisecondes (Date.now()).
 */

export type NeedKey = 'hunger' | 'energy' | 'happiness';
export type StatKey = 'strength' | 'agility' | 'endurance' | 'technique';
export type FoodKind = 'kibble' | 'cookie' | 'apple' | 'coffee';
export type ToyKind = 'ball' | 'bag' | 'terminal' | 'bowl';
export type Mood = 'joyeux' | 'content' | 'affamé' | 'fatigué' | 'triste' | 'boudeur';

export const NEED_KEYS: readonly NeedKey[] = ['hunger', 'energy', 'happiness'];
export const STAT_KEYS: readonly StatKey[] = ['strength', 'agility', 'endurance', 'technique'];

export const NEED_LABELS: Record<NeedKey, string> = { hunger: 'Faim', energy: 'Énergie', happiness: 'Bonheur' };
export const STAT_LABELS: Record<StatKey, string> = {
  strength: 'Force',
  agility: 'Agilité',
  endurance: 'Endurance',
  technique: 'Technique',
};

export interface FoodInfo {
  label: string;
  hunger: number;
  energy: number;
  happiness: number;
}

/** Chaque aliment a un effet distinct sur les jauges. */
export const FOODS: Record<FoodKind, FoodInfo> = {
  kibble: { label: 'Croquettes', hunger: 30, energy: 0, happiness: 2 },
  cookie: { label: 'Cookie', hunger: 10, energy: 2, happiness: 12 },
  apple: { label: 'Pomme', hunger: 18, energy: 4, happiness: 4 },
  coffee: { label: 'Café', hunger: 2, energy: 22, happiness: 3 },
};

export const STAT_MAX = 100;
export const NEED_MAX = 100;

/** Pertes et gains par heure (temps réel, application ouverte). */
const RATES = {
  hungerAwake: 6,
  hungerAsleep: 3,
  energyAwake: 5,
  energyAsleep: 120,
  happinessBase: 1,
  happinessNeglected: 5,
  happinessDistress: 3,
} as const;

/** Application fermée : le compagnon « se repose », on reste indulgent. */
const OFFLINE = { maxHours: 24, hunger: 3, happiness: 1.5, energy: 35, hungerFloor: 10 } as const;

/** Sans caresse, jeu ni repas depuis 30 min, le compagnon se sent délaissé. */
export const NEGLECT_AFTER_MS = 30 * 60 * 1000;

/** Coût par seconde d'activité. */
export const ACTIVITY_COST = {
  train: { energy: 0.25, hunger: 0.12 },
  play: { energy: 0.15, hunger: 0.06 },
  code: { energy: 0.1, hunger: 0.05 },
  run: { energy: 0.12, hunger: 0.06 },
} as const;
export type ActivityKind = keyof typeof ACTIVITY_COST;

/** Gain de base par seconde d'entraînement, avant état et rendements décroissants. */
const TRAIN_RATE = 0.03;

export interface PlacedToy {
  kind: ToyKind | 'note';
  x: number;
  y: number;
  /** Gamelle uniquement : aliment qu'elle contient. */
  food?: FoodKind | null;
  /** Boule de papier : texte de la note. */
  text?: string;
}

export const NOTE_MAX_LENGTH = 140;

export interface CompanionSave {
  version: 1;
  packId: string;
  name: string;
  bornAt: number;
  savedAt: number;
  lastInteractionAt: number;
  needs: Record<NeedKey, number>;
  stats: Record<StatKey, number>;
  toys: PlacedToy[];
  counters: { meals: number; trainings: number; pets: number; bugs: number };
}

export interface TrainResult {
  gain: number;
  /** Nouvelle valeur entière atteinte (pour la célébration), sinon null. */
  levelUp: number | null;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class CompanionStats {
  readonly data: CompanionSave;
  private dirty = false;

  private constructor(data: CompanionSave) {
    this.data = data;
  }

  static create(
    packId: string,
    name: string,
    baseStats: Record<StatKey, number>,
    now = Date.now(),
  ): CompanionStats {
    return new CompanionStats({
      version: 1,
      packId,
      name,
      bornAt: now,
      savedAt: now,
      lastInteractionAt: now,
      needs: { hunger: 80, energy: 90, happiness: 75 },
      stats: { ...baseStats },
      toys: [],
      counters: { meals: 0, trainings: 0, pets: 0, bugs: 0 },
    });
  }

  /**
   * Restaure une sauvegarde (données non fiables : tout est vérifié et borné) puis
   * applique l'évolution pendant que l'application était fermée.
   * Renvoie null si la sauvegarde est inutilisable.
   */
  static restore(raw: unknown, now = Date.now()): CompanionStats | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Partial<CompanionSave>;
    if (r.version !== 1 || typeof r.packId !== 'string' || !r.needs || !r.stats) return null;

    const needs = {} as Record<NeedKey, number>;
    for (const k of NEED_KEYS) {
      const v = (r.needs as Record<string, unknown>)[k];
      if (!isNum(v)) return null;
      needs[k] = clamp(v, 0, NEED_MAX);
    }
    const stats = {} as Record<StatKey, number>;
    for (const k of STAT_KEYS) {
      const v = (r.stats as Record<string, unknown>)[k];
      if (!isNum(v)) return null;
      stats[k] = clamp(v, 1, STAT_MAX);
    }
    const toys = Array.isArray(r.toys)
      ? r.toys
          .filter((t): t is PlacedToy => !!t && typeof t.kind === 'string' && isNum(t.x) && isNum(t.y))
          .map((t) => (typeof t.text === 'string' ? { ...t, text: t.text.slice(0, NOTE_MAX_LENGTH) } : t))
          .slice(0, 24)
      : [];
    const c = r.counters ?? { meals: 0, trainings: 0, pets: 0, bugs: 0 };

    const stats_ = new CompanionStats({
      version: 1,
      packId: r.packId,
      name: typeof r.name === 'string' ? r.name.slice(0, 32) : 'Byte',
      bornAt: isNum(r.bornAt) ? r.bornAt : now,
      savedAt: isNum(r.savedAt) ? r.savedAt : now,
      lastInteractionAt: isNum(r.lastInteractionAt) ? r.lastInteractionAt : now,
      needs,
      stats,
      toys,
      counters: {
        meals: isNum(c.meals) ? c.meals : 0,
        trainings: isNum(c.trainings) ? c.trainings : 0,
        pets: isNum(c.pets) ? c.pets : 0,
        bugs: isNum(c.bugs) ? c.bugs : 0,
      },
    });
    stats_.applyOffline(now);
    return stats_;
  }

  get needs(): Readonly<Record<NeedKey, number>> {
    return this.data.needs;
  }

  get stats(): Readonly<Record<StatKey, number>> {
    return this.data.stats;
  }

  /** Vrai si des changements n'ont pas encore été sauvegardés ; remis à zéro à la lecture. */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** Évolution continue des jauges. `asleep` : le compagnon dort. */
  tick(seconds: number, asleep: boolean, now = Date.now()): void {
    const h = seconds / 3600;
    const n = this.data.needs;
    n.hunger = clamp(n.hunger - (asleep ? RATES.hungerAsleep : RATES.hungerAwake) * h, 0, NEED_MAX);
    n.energy = clamp(n.energy + (asleep ? RATES.energyAsleep : -RATES.energyAwake) * h, 0, NEED_MAX);

    let sad = RATES.happinessBase;
    if (this.isNeglected(now)) sad += RATES.happinessNeglected;
    if (n.hunger < 25 || n.energy < 15) sad += RATES.happinessDistress;
    n.happiness = clamp(n.happiness - sad * h, 0, NEED_MAX);
    this.dirty = true;
  }

  private applyOffline(now: number): void {
    const hours = clamp((now - this.data.savedAt) / 3_600_000, 0, OFFLINE.maxHours);
    if (hours <= 0) return;
    const n = this.data.needs;
    n.hunger = Math.max(Math.min(n.hunger, OFFLINE.hungerFloor), n.hunger - OFFLINE.hunger * hours);
    n.energy = clamp(n.energy + OFFLINE.energy * hours, 0, NEED_MAX);
    n.happiness = clamp(n.happiness - OFFLINE.happiness * hours, 0, NEED_MAX);
    this.data.savedAt = now;
    this.dirty = true;
  }

  /** Caresse, jeu, repas : le compagnon n'est plus délaissé. */
  interact(now = Date.now()): void {
    this.data.lastInteractionAt = now;
    this.dirty = true;
  }

  isNeglected(now = Date.now()): boolean {
    return now - this.data.lastInteractionAt > NEGLECT_AFTER_MS;
  }

  feed(food: FoodKind, now = Date.now()): void {
    const f = FOODS[food];
    const n = this.data.needs;
    // Trop manger quand on n'a pas faim rend moins heureux (gourmandise mise à part).
    const overfed = n.hunger > 90 && food !== 'cookie';
    n.hunger = clamp(n.hunger + f.hunger, 0, NEED_MAX);
    n.energy = clamp(n.energy + f.energy, 0, NEED_MAX);
    n.happiness = clamp(n.happiness + (overfed ? -2 : f.happiness), 0, NEED_MAX);
    this.data.counters.meals++;
    this.interact(now);
  }

  pet(now = Date.now()): void {
    this.data.needs.happiness = clamp(this.data.needs.happiness + 6, 0, NEED_MAX);
    this.data.counters.pets++;
    this.interact(now);
  }

  /** Coût en énergie et en faim d'une activité. */
  spend(kind: ActivityKind, seconds: number): void {
    const cost = ACTIVITY_COST[kind];
    const n = this.data.needs;
    n.energy = clamp(n.energy - cost.energy * seconds, 0, NEED_MAX);
    n.hunger = clamp(n.hunger - cost.hunger * seconds, 0, NEED_MAX);
    this.dirty = true;
  }

  addHappiness(amount: number): void {
    this.data.needs.happiness = clamp(this.data.needs.happiness + amount, 0, NEED_MAX);
    this.dirty = true;
  }

  /**
   * Entraîne une statistique pendant `seconds`. Le gain dépend de l'état du compagnon
   * (affamé ou épuisé : il progresse mal) et décroît à mesure que la stat monte.
   */
  train(stat: StatKey, seconds: number, talent = 1): TrainResult {
    const before = this.data.stats[stat];
    const efficiency = this.condition() * talent * Math.max(0.05, 1 - before / (STAT_MAX * 1.2));
    const gain = TRAIN_RATE * seconds * efficiency;
    const after = clamp(before + gain, 1, STAT_MAX);
    this.data.stats[stat] = after;
    this.dirty = true;
    return { gain: after - before, levelUp: Math.floor(after) > Math.floor(before) ? Math.floor(after) : null };
  }

  countTraining(): void {
    this.data.counters.trainings++;
    this.dirty = true;
  }

  countBug(): void {
    this.data.counters.bugs++;
    this.dirty = true;
  }

  /**
   * Coefficient d'état (0,4 à 1,15) : malus si affamé, épuisé ou malheureux, bonus de
   * moral si tout va bien. Multiplie l'entraînement et, à l'étape 4, le combat.
   */
  condition(): number {
    const { hunger, energy, happiness } = this.data.needs;
    let c = 1;
    if (hunger < 30) c -= 0.25 * (1 - hunger / 30);
    if (energy < 30) c -= 0.3 * (1 - energy / 30);
    if (happiness < 30) c -= 0.2 * (1 - happiness / 30);
    if (hunger > 70 && energy > 70 && happiness > 70) c += 0.05 + 0.1 * ((happiness - 70) / 30);
    return clamp(c, 0.4, 1.15);
  }

  mood(now = Date.now()): Mood {
    const { hunger, energy, happiness } = this.data.needs;
    if (happiness < 25 && this.isNeglected(now)) return 'boudeur';
    if (hunger < 25) return 'affamé';
    if (energy < 20) return 'fatigué';
    if (happiness < 35) return 'triste';
    if (hunger > 60 && energy > 50 && happiness > 70) return 'joyeux';
    return 'content';
  }

  /** Secoué trop fort : il a vomi son repas. */
  vomit(): void {
    const n = this.data.needs;
    n.hunger = clamp(n.hunger - 12, 0, NEED_MAX);
    n.happiness = clamp(n.happiness - 6, 0, NEED_MAX);
    this.dirty = true;
  }

  /** Reprend l'état d'une copie (compagnon revenu d'un autre écran, synchronisation). */
  adopt(other: CompanionStats): void {
    const toys = this.data.toys;
    Object.assign(this.data, structuredClone(other.data));
    this.data.toys = toys; // les jouets restent ceux de notre bureau
    this.dirty = true;
  }

  setToys(toys: PlacedToy[]): void {
    this.data.toys = toys.slice(0, 24);
    this.dirty = true;
  }

  /** Instantané sérialisable pour companion.json. */
  snapshot(now = Date.now()): CompanionSave {
    this.data.savedAt = now;
    return structuredClone(this.data);
  }
}
