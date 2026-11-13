import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCombat, maxHp, playTurn, simulate, type FighterStats } from './Combat.ts';

const base: FighterStats = { name: 'A', strength: 10, agility: 10, endurance: 10, technique: 10, condition: 1, energy: 80 };

test('même graine et mêmes choix : exactement le même combat des deux côtés', () => {
  const b = { ...base, name: 'B', agility: 12 };
  const one = createCombat(base, b);
  const two = createCombat(base, b);
  const choices = [['attack', 'auto'], ['heavy', 'guard'], ['auto', 'auto'], ['guard', 'heavy']] as const;
  for (let i = 0; i < 30; i++) {
    const c = choices[i % choices.length]!;
    assert.deepEqual(playTurn(one, [base, b], c, 1234), playTurn(two, [base, b], c, 1234));
  }
  assert.deepEqual(one, two);
});

test('une graine différente donne un autre combat', () => {
  const b = { ...base, name: 'B' };
  assert.notDeepEqual(simulate(base, b, 1).fighters, simulate(base, b, 2).fighters);
});

test('un compagnon affamé et épuisé perd nettement plus souvent', () => {
  const fit = { ...base, condition: 1.1, energy: 90 };
  const weak = { ...base, name: 'B', condition: 0.5, energy: 10 };
  let fitWins = 0;
  for (let seed = 1; seed <= 300; seed++) if (simulate(fit, weak, seed).winner === 0) fitWins++;
  assert.ok(fitWins > 240, `${fitWins}/300`);
});

test('à forme égale, le plus entraîné gagne la plupart du temps', () => {
  const strong = { ...base, strength: 25, endurance: 20 };
  let wins = 0;
  for (let seed = 1; seed <= 300; seed++) if (simulate(strong, { ...base, name: 'B' }, seed).winner === 0) wins++;
  assert.ok(wins > 220, `${wins}/300`);
});

test('les PV dépendent de l’endurance et de la forme', () => {
  assert.ok(maxHp({ ...base, endurance: 20 }) > maxHp(base));
  assert.ok(maxHp({ ...base, condition: 0.5 }) < maxHp(base));
});

test('un combat se termine toujours (limite de tours)', () => {
  const tank = { ...base, strength: 1, endurance: 30 };
  const state = simulate(tank, { ...tank, name: 'B' }, 99);
  assert.notEqual(state.winner, null);
  assert.ok(state.turn <= 40);
});
