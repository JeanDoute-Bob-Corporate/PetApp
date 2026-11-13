import assert from 'node:assert/strict';
import { test } from 'node:test';

import { entryPoint, moveTo, neighbors, placeNew, remove, sanitize, type Placement } from './Layout.ts';

test('les nouveaux joueurs s’alignent à droite sur la ligne du milieu', () => {
  let layout: Placement = {};
  layout = placeNew(layout, 'a');
  layout = placeNew(layout, 'b');
  layout = placeNew(layout, 'c');
  assert.deepEqual(layout['a'], { col: 2, row: 1 });
  assert.deepEqual(layout['b'], { col: 3, row: 1 });
  assert.deepEqual(layout['c'], { col: 4, row: 1 });
  // Ligne pleine à droite : le suivant va dans une case libre ailleurs.
  layout = placeNew(layout, 'd');
  assert.ok(layout['d'] && !(layout['d'].row === 1 && layout['d'].col >= 2));
});

test('deux écrans côte à côte sont reliés par leurs bords opposés', () => {
  const layout: Placement = { a: { col: 1, row: 1 }, b: { col: 2, row: 1 }, c: { col: 1, row: 2 } };
  assert.deepEqual(neighbors(layout, 'a'), { right: 'b', bottom: 'c' });
  assert.deepEqual(neighbors(layout, 'b'), { left: 'a' });
  assert.deepEqual(neighbors(layout, 'c'), { top: 'a' });
});

test('on ne peut déplacer un écran que vers une case libre de la grille', () => {
  const layout: Placement = { a: { col: 1, row: 1 }, b: { col: 2, row: 1 } };
  assert.equal(moveTo(layout, 'a', { col: 2, row: 1 }), null);
  assert.equal(moveTo(layout, 'a', { col: 9, row: 0 }), null);
  const moved = moveTo(layout, 'a', { col: 3, row: 1 });
  assert.deepEqual(moved && neighbors(moved, 'b'), { right: 'a' });
  assert.deepEqual(remove(layout, 'b'), { a: { col: 1, row: 1 } });
});

test('un placement reçu du réseau est validé', () => {
  assert.equal(sanitize({ a: { col: 1, row: 1 }, b: { col: 1, row: 1 } }, ['a', 'b']), null); // doublon
  assert.equal(sanitize({ a: { col: 7, row: 1 } }, ['a']), null); // hors grille
  assert.equal(sanitize({ a: { col: 1 } }, ['a']), null); // incomplet
  assert.deepEqual(sanitize({ a: { col: 0, row: 0 }, x: { col: 1, row: 1 } }, ['a']), { a: { col: 0, row: 0 } });
});

test('l’arrivée garde la proportion le long du bord', () => {
  const b = { left: 0, top: 0, right: 1000, bottom: 800 };
  assert.deepEqual(entryPoint(b, 'left', 0.5, 40, 100), { x: 42, y: 400 });
  assert.deepEqual(entryPoint(b, 'right', 1, 40, 100), { x: 958, y: 800 });
  assert.deepEqual(entryPoint(b, 'bottom', 0.25, 40, 100), { x: 250, y: 798 });
  // Pas d'arrivée la tête hors de l'écran.
  assert.equal(entryPoint(b, 'left', 0, 40, 100).y, 100);
});
