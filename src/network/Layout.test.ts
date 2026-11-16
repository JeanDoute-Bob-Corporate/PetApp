import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entryPoint, LINE_MAX, moveTo, neighbors, order, placeNew, remove, sanitize, type Placement } from './Layout.ts';

const line = (...ids: string[]): Placement => ids.reduce<Placement>((l, id) => placeNew(l, id), {});

test('les joueurs arrivent au bout de la file, de gauche à droite', () => {
  const layout = line('a', 'b', 'c');
  assert.deepEqual(order(layout), ['a', 'b', 'c']);
  assert.deepEqual(layout['c'], { col: 2, row: 0 });
  // File pleine : le suivant n'est pas placé.
  const full = line(...Array.from({ length: LINE_MAX }, (_, i) => `p${i}`));
  assert.equal(placeNew(full, 'extra'), full);
});

test('seuls les voisins gauche et droite sont reliés, jamais au-dessus ou en dessous', () => {
  const layout = line('a', 'b', 'c');
  assert.deepEqual(neighbors(layout, 'a'), { right: 'b' });
  assert.deepEqual(neighbors(layout, 'b'), { left: 'a', right: 'c' });
  assert.deepEqual(neighbors(layout, 'c'), { left: 'b' });
  assert.deepEqual(neighbors(layout, 'zz'), {});
});

test('déplacer un écran le réinsère dans la file, sans trou', () => {
  const layout = line('a', 'b', 'c', 'd');
  const moved = moveTo(layout, 'a', 2);
  assert.deepEqual(moved && order(moved), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moved && neighbors(moved, 'a'), { left: 'c', right: 'd' });
  assert.equal(moveTo(layout, 'a', 9), null);
  assert.equal(moveTo(layout, 'inconnu', 0), null);
});

test('un départ resserre la file : ses voisins deviennent reliés', () => {
  const layout = remove(line('a', 'b', 'c'), 'b');
  assert.deepEqual(order(layout), ['a', 'c']);
  assert.deepEqual(neighbors(layout, 'a'), { right: 'c' });
  assert.deepEqual(layout['c'], { col: 1, row: 0 });
});

test('un placement reçu du réseau est validé', () => {
  assert.equal(sanitize({ a: { col: 0, row: 0 }, b: { col: 0, row: 0 } }, ['a', 'b']), null); // doublon
  assert.equal(sanitize({ a: { col: 3, row: 0 } }, ['a']), null); // trou / hors file
  assert.equal(sanitize({ a: { col: 0, row: 1 } }, ['a']), null); // pas sur la ligne
  assert.equal(sanitize({ a: { col: 0 } }, ['a']), null); // incomplet
  assert.deepEqual(sanitize({ a: { col: 1, row: 0 }, b: { col: 0, row: 0 }, x: { col: 5, row: 0 } }, ['a', 'b']), {
    a: { col: 1, row: 0 },
    b: { col: 0, row: 0 },
  });
});

test('l’arrivée garde la hauteur relative le long du bord', () => {
  const b = { left: 0, top: 0, right: 1000, bottom: 800 };
  assert.deepEqual(entryPoint(b, 'left', 0.5, 40, 100), { x: 42, y: 400 });
  assert.deepEqual(entryPoint(b, 'right', 1, 40, 100), { x: 958, y: 800 });
  // Pas d'arrivée la tête hors de l'écran.
  assert.equal(entryPoint(b, 'left', 0, 40, 100).y, 100);
});
