/**
 * Icônes pixel-art de l'interface « Byte OS » (cases de 16×16, une ligne dans
 * public/ui/icons.png). L'ordre fixe la colonne de chaque icône : partagé entre le
 * générateur (scripts/build-ui-icons.ts) et l'interface. Module pur, sans dépendance.
 */
export const ICON_NAMES = [
  'feed',
  'treat',
  'apple',
  'coffee',
  'ball',
  'sleep',
  'note',
  'stats',
  'palette',
  'link',
  'toys',
  'settings',
  'pet',
  'fight',
  'home',
  'recall',
  'close',
  'copy',
  'import',
  'trash',
  'console',
  'bug',
  'bag',
  'terminal',
  'bowl',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
export const ICON_SIZE = 16;
