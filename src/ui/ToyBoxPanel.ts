import { FOODS, type FoodKind, type ToyKind } from '../entities/CompanionStats';
import type { ToyBox } from '../entities/Toy';
import type { IconName } from './iconNames';
import { button, heading, icon } from './kit';
import { h, Section, type Console } from './Panel';

const TOYS: Array<{ kind: ToyKind; icon: IconName; label: string; hint: string }> = [
  { kind: 'bowl', icon: 'bowl', label: 'Gamelle', hint: 'Remplie de croquettes : il vient y manger' },
  { kind: 'ball', icon: 'ball', label: 'Balle', hint: 'Il joue avec : bonheur et agilité' },
  { kind: 'bag', icon: 'bag', label: 'Sac', hint: 'Sac de frappe : force' },
  { kind: 'terminal', icon: 'terminal', label: 'Terminal', hint: 'Il y code : technique' },
];

const FOOD_ICONS: Record<FoodKind, IconName> = { kibble: 'feed', cookie: 'treat', apple: 'apple', coffee: 'coffee' };

export interface ToyBoxActions {
  place(kind: ToyKind): void;
  feed(food: FoodKind): void;
  releaseBug(): void;
}

/** Jouets (poser/ranger d'un clic) et garde-manger. */
export class ToyBoxPanel extends Section {
  private readonly toys: ToyBox;
  private readonly tiles = new Map<ToyKind, HTMLButtonElement>();

  constructor(hub: Console, toys: ToyBox, actions: ToyBoxActions) {
    super(hub, { id: 'toys', icon: 'toys', label: 'Jouets' });
    this.toys = toys;

    const toyGrid = h('div.tiles');
    for (const t of TOYS) {
      const tile = h('button.tile', { type: 'button', title: `${t.hint}\nClic : poser / ranger` }, icon(t.icon, 2), h('span', {}, t.label), h('small.tile-state'));
      tile.addEventListener('click', () => {
        if (this.toys.hasOwn(t.kind)) this.toys.remove(t.kind);
        else actions.place(t.kind);
        this.render();
      });
      this.tiles.set(t.kind, tile);
      toyGrid.append(tile);
    }

    const foodGrid = h('div.tiles');
    for (const [kind, info] of Object.entries(FOODS) as Array<[FoodKind, (typeof FOODS)[FoodKind]]>) {
      const tile = h('button.tile.food', { type: 'button', title: foodHint(info) }, icon(FOOD_ICONS[kind], 2), h('span', {}, info.label));
      tile.addEventListener('click', () => actions.feed(kind));
      foodGrid.append(tile);
    }

    this.body.append(
      heading('Jouets'),
      toyGrid,
      heading('Garde-manger'),
      foodGrid,
      h('div.row-end', {}, button('Lâcher un bug', () => actions.releaseBug(), { icon: 'bug', kind: 'ghost', title: 'Un bug à attraper : technique' })),
    );
    toys.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    for (const [kind, tile] of this.tiles) {
      const placed = this.toys.hasOwn(kind);
      tile.classList.toggle('on', placed);
      tile.querySelector('.tile-state')!.textContent = placed ? 'Posé' : 'Rangé';
    }
  }
}

function foodHint(info: { hunger: number; energy: number; happiness: number }): string {
  const parts: string[] = [];
  if (info.hunger) parts.push(`faim +${info.hunger}`);
  if (info.energy) parts.push(`énergie +${info.energy}`);
  if (info.happiness) parts.push(`bonheur +${info.happiness}`);
  return parts.join(' · ');
}
