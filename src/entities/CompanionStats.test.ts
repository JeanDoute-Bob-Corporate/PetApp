import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CompanionStats, NEGLECT_AFTER_MS } from './CompanionStats.ts';

const BASE = { strength: 5, agility: 6, endurance: 4, technique: 7 };
const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;

test('les jauges baissent avec le temps et le sommeil rend de l’énergie', () => {
  const s = CompanionStats.create('dev.default.byte', 'Byte', BASE, T0);
  s.tick(3600, false, T0 + HOUR);
  assert.equal(Math.round(s.needs.hunger), 74);
  assert.equal(Math.round(s.needs.energy), 85);
  s.tick(3600, true, T0 + 2 * HOUR);
  assert.equal(Math.round(s.needs.energy), 100);
});

test('un compagnon délaissé perd du bonheur plus vite', () => {
  const a = CompanionStats.create('p', 'A', BASE, T0);
  const b = CompanionStats.create('p', 'B', BASE, T0);
  b.interact(T0 + NEGLECT_AFTER_MS + 1000);
  const now = T0 + NEGLECT_AFTER_MS + 2000;
  a.tick(600, false, now);
  b.tick(600, false, now);
  assert.ok(a.needs.happiness < b.needs.happiness);
  assert.ok(a.isNeglected(now));
});

test('chaque aliment a un effet distinct', () => {
  const s = CompanionStats.create('p', 'A', BASE, T0);
  s.data.needs.hunger = 40;
  s.data.needs.energy = 40;
  s.feed('kibble', T0);
  assert.equal(s.needs.hunger, 70);
  s.feed('coffee', T0);
  assert.equal(s.needs.energy, 62);
  assert.equal(s.data.counters.meals, 2);
});

test('un compagnon affamé et épuisé progresse moins vite à l’entraînement', () => {
  const fit = CompanionStats.create('p', 'A', BASE, T0);
  const weak = CompanionStats.create('p', 'B', BASE, T0);
  fit.data.needs = { hunger: 95, energy: 95, happiness: 95 };
  weak.data.needs = { hunger: 5, energy: 5, happiness: 50 };
  const g1 = fit.train('strength', 20).gain;
  const g2 = weak.train('strength', 20).gain;
  assert.ok(fit.condition() > 1 && weak.condition() < 0.6);
  assert.ok(g1 > g2 * 1.8, `${g1} vs ${g2}`);
});

test('le passage à l’entier suivant est signalé', () => {
  const s = CompanionStats.create('p', 'A', { ...BASE, strength: 5.99 }, T0);
  assert.equal(s.train('strength', 5).levelUp, 6);
  assert.equal(s.train('strength', 1).levelUp, null);
});

test('la restauration borne les valeurs et applique le temps hors ligne', () => {
  const raw = {
    version: 1,
    packId: 'p',
    name: 'Byte',
    bornAt: T0,
    savedAt: T0,
    lastInteractionAt: T0,
    needs: { hunger: 50, energy: 10, happiness: 500 },
    stats: { strength: -3, agility: 6, endurance: 4, technique: 7 },
    toys: [{ kind: 'ball', x: 10, y: 20 }, { nope: true }],
  };
  const s = CompanionStats.restore(raw, T0 + 10 * HOUR);
  assert.ok(s);
  assert.equal(s.stats.strength, 1);
  assert.equal(s.needs.hunger, 20); // 50 − 3 × 10 h
  assert.equal(s.needs.energy, 100); // il a dormi
  assert.equal(s.needs.happiness, 85); // 100 − 1,5 × 10 h
  assert.equal(s.data.toys.length, 1);
});

test('une sauvegarde invalide est rejetée', () => {
  assert.equal(CompanionStats.restore({ version: 2 }), null);
  assert.equal(CompanionStats.restore('n’importe quoi'), null);
  assert.equal(CompanionStats.restore({ version: 1, packId: 'p', needs: { hunger: 'x' }, stats: {} }), null);
});

test('la faim ne descend pas sous un plancher pendant une longue absence', () => {
  const s = CompanionStats.create('p', 'A', BASE, T0);
  const restored = CompanionStats.restore(s.snapshot(T0), T0 + 72 * HOUR);
  assert.ok(restored);
  assert.equal(restored.needs.hunger, 10);
});
