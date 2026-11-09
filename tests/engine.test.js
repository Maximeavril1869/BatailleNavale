'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

// Générateur pseudo-aléatoire reproductible (mulberry32)
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('la flotte fait 17 cases (5+4+3+3+2)', () => {
  assert.strictEqual(E.FLEET.reduce((n, d) => n + d.len, 0), 17);
});

test('placement : refuse les sorties de grille et les chevauchements', () => {
  const ships = [];
  assert.ok(E.placeShip(ships, E.FLEET[0], 0, 0, true));            // porte-avions A1..E1
  assert.strictEqual(E.placeShip(ships, E.FLEET[1], 0, 3, false), null); // croiseur en D1 vertical : chevauche
  assert.strictEqual(E.placeShip(ships, E.FLEET[1], 0, 8, true), null);  // dépasse à droite
  assert.strictEqual(E.placeShip(ships, E.FLEET[1], 8, 0, false), null); // dépasse en bas
  assert.ok(E.placeShip(ships, E.FLEET[1], 1, 0, true));            // touche l'autre sans chevaucher : permis
});

test('flotte aléatoire : toujours valide (200 tirages)', () => {
  for (let i = 0; i < 200; i++) {
    const ships = E.randomFleet(seeded(i + 1));
    assert.ok(E.isComplete(ships));
    const occ = E.emptyMatrix();
    ships.forEach(s => {
      assert.strictEqual(s.cells.length, s.len);
      s.cells.forEach(([r, c]) => { assert.ok(E.inside(r, c)); assert.strictEqual(occ[r][c], 0); occ[r][c] = 1; });
    });
  }
});

test('tirs : à l\'eau, touché, coulé, case déjà visée, fin de partie', () => {
  const ships = [];
  E.FLEET.forEach((d, i) => E.placeShip(ships, d, i * 2, 0, true));   // lignes 0,2,4,6,8 à partir de la colonne A
  const inc = E.emptyMatrix(), sunk = [];
  assert.strictEqual(E.fire(ships, inc, sunk, 1, 0).res, 'miss');
  assert.strictEqual(E.fire(ships, inc, sunk, 1, 0), null);          // déjà visée
  assert.strictEqual(E.fire(ships, inc, sunk, 8, 0).res, 'hit');     // torpilleur (2 cases)
  const r = E.fire(ships, inc, sunk, 8, 1);
  assert.strictEqual(r.res, 'sunk'); assert.strictEqual(r.ship.id, 'to'); assert.strictEqual(r.allSunk, false);
  // on coule tout le reste
  let last;
  ships.forEach(s => s.cells.forEach(([rr, cc]) => { if (inc[rr][cc] === 0) last = E.fire(ships, inc, sunk, rr, cc); }));
  assert.strictEqual(last.allSunk, true); assert.strictEqual(sunk.length, 5);
});

test('applyResult (côté public) reproduit fire sans connaître la flotte', () => {
  const ships = E.randomFleet(seeded(7));
  const inc = E.emptyMatrix(), sunk = [], pinc = E.emptyMatrix(), psunk = [];
  const rng = seeded(11);
  for (let n = 0; n < 100; n++) {
    const [r, c] = E.aiChoose(2, pinc, psunk, rng);
    const res = E.fire(ships, inc, sunk, r, c);
    assert.ok(res);
    assert.ok(E.applyResult(pinc, psunk, JSON.parse(JSON.stringify(res))));
    if (res.allSunk) break;
  }
  assert.deepStrictEqual(pinc, inc);
  assert.strictEqual(psunk.length, sunk.length);
});

// Nombre de tirs nécessaires à l'ordinateur pour couler une flotte aléatoire.
function shotsToWin(level, seed) {
  const rng = seeded(seed);
  const ships = E.randomFleet(rng);
  const inc = E.emptyMatrix(), sunk = [], seen = new Set();
  for (let n = 1; n <= 100; n++) {
    const [r, c] = E.aiChoose(level, inc, sunk, rng);
    assert.ok(E.inside(r, c), 'tir dans la grille');
    assert.ok(!seen.has(r + ',' + c), 'ne retire jamais sur la même case');
    seen.add(r + ',' + c);
    const res = E.fire(ships, inc, sunk, r, c);
    if (res.allSunk) return n;
  }
  assert.fail('partie non terminée en 100 tirs');
}

test('ordinateur : finit toujours la partie, et les niveaux sont bien ordonnés', () => {
  const N = 300, avg = [0, 0, 0, 0];
  for (let level = 1; level <= 3; level++) {
    let tot = 0;
    for (let i = 0; i < N; i++) tot += shotsToWin(level, 1000 + i);
    avg[level] = tot / N;
  }
  console.log('Tirs moyens pour gagner — débutant %s, normal %s, fort %s', avg[1].toFixed(1), avg[2].toFixed(1), avg[3].toFixed(1));
  assert.ok(avg[1] > avg[2] + 5, 'normal nettement meilleur que débutant');
  assert.ok(avg[2] > avg[3] + 3, 'fort nettement meilleur que normal');
});
