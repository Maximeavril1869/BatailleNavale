/* Bataille navale — moteur de jeu : flotte, placement, tirs, ordinateur (3 niveaux).
   Aucune dépendance. Fonctionne dans le navigateur (window.Engine) et sous Node (module.exports).

   Modèle de données (tout est sérialisable en JSON) :
   - navire  : { id, name, len, cells: [[r,c], ...] }
   - inc     : matrice 10x10 des tirs REÇUS par un joueur (0 = rien, 1 = à l'eau, 2 = touché)
   - sunk    : navires coulés d'un joueur (révélés à tous)                                      */
(function (root) {
  'use strict';

  var SIZE = 10;
  var FLEET = [
    { id: 'pa', name: 'Porte-avions', len: 5 },
    { id: 'cr', name: 'Croiseur', len: 4 },
    { id: 'ct', name: 'Contre-torpilleur', len: 3 },
    { id: 'sm', name: 'Sous-marin', len: 3 },
    { id: 'to', name: 'Torpilleur', len: 2 }
  ];
  var COLS = 'ABCDEFGHIJ';

  function fleetDef(id) { for (var i = 0; i < FLEET.length; i++) if (FLEET[i].id === id) return FLEET[i]; return null; }
  function coord(r, c) { return COLS.charAt(c) + (r + 1); }

  /* ---------- Matrices ---------- */
  function emptyMatrix() {
    var m = [], r, c;
    for (r = 0; r < SIZE; r++) { var row = []; for (c = 0; c < SIZE; c++) row.push(0); m.push(row); }
    return m;
  }
  function inside(r, c) { return r >= 0 && c >= 0 && r < SIZE && c < SIZE; }

  /* ---------- Placement ---------- */
  // Cases occupées par un navire de longueur len posé en (r, c), horizontal ou vertical.
  function shipCells(len, r, c, horiz) {
    var cells = [], k;
    for (k = 0; k < len; k++) cells.push(horiz ? [r, c + k] : [r + k, c]);
    return cells;
  }
  // Grille d'occupation : 0 = libre, sinon (index du navire + 1).
  function occupancy(ships) {
    var m = emptyMatrix();
    ships.forEach(function (s, i) { s.cells.forEach(function (p) { m[p[0]][p[1]] = i + 1; }); });
    return m;
  }
  // Un navire de longueur len peut-il être posé en (r, c) sans sortir de la grille ni en chevaucher un autre ?
  function canPlace(ships, len, r, c, horiz) {
    var cells = shipCells(len, r, c, horiz), occ = occupancy(ships), i;
    for (i = 0; i < cells.length; i++) {
      var p = cells[i];
      if (!inside(p[0], p[1]) || occ[p[0]][p[1]]) return false;
    }
    return true;
  }
  function placeShip(ships, def, r, c, horiz) {
    if (!canPlace(ships, def.len, r, c, horiz)) return null;
    var s = { id: def.id, name: def.name, len: def.len, cells: shipCells(def.len, r, c, horiz) };
    ships.push(s);
    return s;
  }
  function removeShip(ships, id) {
    for (var i = 0; i < ships.length; i++) if (ships[i].id === id) { return ships.splice(i, 1)[0]; }
    return null;
  }
  function isComplete(ships) { return ships.length === FLEET.length; }

  // Flotte complète posée au hasard (rng : fonction renvoyant un réel dans [0,1)).
  function randomFleet(rng) {
    rng = rng || Math.random;
    for (var attempt = 0; attempt < 1000; attempt++) {
      var ships = [], ok = true;
      for (var i = 0; i < FLEET.length && ok; i++) {
        var def = FLEET[i], placed = null;
        for (var t = 0; t < 200 && !placed; t++) {
          var horiz = rng() < 0.5;
          var r = Math.floor(rng() * (horiz ? SIZE : SIZE - def.len + 1));
          var c = Math.floor(rng() * (horiz ? SIZE - def.len + 1 : SIZE));
          placed = placeShip(ships, def, r, c, horiz);
        }
        if (!placed) ok = false;
      }
      if (ok) return ships;
    }
    return null;
  }

  /* ---------- Tirs ---------- */
  function shipAt(ships, r, c) {
    for (var i = 0; i < ships.length; i++)
      for (var k = 0; k < ships[i].cells.length; k++)
        if (ships[i].cells[k][0] === r && ships[i].cells[k][1] === c) return ships[i];
    return null;
  }
  function isSunk(ship, inc) {
    for (var k = 0; k < ship.cells.length; k++) if (inc[ship.cells[k][0]][ship.cells[k][1]] !== 2) return false;
    return true;
  }
  // Applique un tir sur la flotte `ships` ; met à jour `inc` (tirs reçus) et ajoute le navire coulé à `sunk`.
  // Renvoie { r, c, res: 'miss'|'hit'|'sunk', ship (si touché/coulé), allSunk } ou null si la case a déjà été visée.
  function fire(ships, inc, sunk, r, c) {
    if (!inside(r, c) || inc[r][c] !== 0) return null;
    var ship = shipAt(ships, r, c);
    if (!ship) { inc[r][c] = 1; return { r: r, c: c, res: 'miss', allSunk: false }; }
    inc[r][c] = 2;
    if (isSunk(ship, inc)) {
      sunk.push({ id: ship.id, name: ship.name, len: ship.len, cells: ship.cells });
      return { r: r, c: c, res: 'sunk', ship: { id: ship.id, name: ship.name, len: ship.len, cells: ship.cells }, allSunk: sunk.length === FLEET.length };
    }
    return { r: r, c: c, res: 'hit', ship: { id: ship.id, name: ship.name, len: ship.len }, allSunk: false };
  }
  // Côté « public » (iPad en mode téléphone) : on enregistre un résultat annoncé par le propriétaire de la flotte.
  function applyResult(inc, sunk, res) {
    if (!inside(res.r, res.c) || inc[res.r][res.c] !== 0) return false;
    inc[res.r][res.c] = res.res === 'miss' ? 1 : 2;
    if (res.res === 'sunk' && res.ship) sunk.push(res.ship);
    return true;
  }

  /* ---------- Ordinateur ---------- */
  // Longueurs des navires encore à flot, d'après les navires déjà coulés.
  function remainingLens(sunk) {
    var gone = {}, res = [];
    sunk.forEach(function (s) { gone[s.id] = true; });
    FLEET.forEach(function (d) { if (!gone[d.id]) res.push(d.len); });
    return res;
  }
  // Cases touchées mais dont le navire n'est pas encore coulé.
  function openHits(inc, sunk) {
    var covered = emptyMatrix(), res = [], r, c;
    sunk.forEach(function (s) { s.cells.forEach(function (p) { covered[p[0]][p[1]] = 1; }); });
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) if (inc[r][c] === 2 && !covered[r][c]) res.push([r, c]);
    return res;
  }
  function unshot(inc) {
    var res = [], r, c;
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) if (inc[r][c] === 0) res.push([r, c]);
    return res;
  }
  function pick(list, rng) { return list[Math.floor(rng() * list.length)]; }
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  function neighbours(inc, r, c) {
    var res = [];
    DIRS.forEach(function (d) { var rr = r + d[0], cc = c + d[1]; if (inside(rr, cc) && inc[rr][cc] === 0) res.push([rr, cc]); });
    return res;
  }

  // Niveau 1 (débutant) : au hasard, avec une chance sur deux de viser à côté d'un touché.
  function aiLevel1(inc, sunk, rng) {
    var hits = openHits(inc, sunk), cand = [];
    if (hits.length && rng() < 0.5) {
      var h = pick(hits, rng);
      cand = neighbours(inc, h[0], h[1]);
    }
    return cand.length ? pick(cand, rng) : pick(unshot(inc), rng);
  }

  // Niveau 2 (normal) : chasse en damier, puis poursuite : on prolonge la ligne des touchés, sinon on tâte les voisins.
  function aiLevel2(inc, sunk, rng) {
    var hits = openHits(inc, sunk), cand = [], i, j;
    if (hits.length) {
      // deux touchés alignés (voisins) : on prolonge aux deux bouts
      for (i = 0; i < hits.length; i++) for (j = 0; j < hits.length; j++) {
        if (i === j) continue;
        var dr = hits[j][0] - hits[i][0], dc = hits[j][1] - hits[i][1];
        if (Math.abs(dr) + Math.abs(dc) === 1) {
          // prolonger dans le sens i -> j au-delà de j, et dans le sens opposé au-delà de i
          var a = [hits[j][0] + dr, hits[j][1] + dc], b = [hits[i][0] - dr, hits[i][1] - dc];
          while (inside(a[0], a[1]) && inc[a[0]][a[1]] === 2) { a = [a[0] + dr, a[1] + dc]; }
          while (inside(b[0], b[1]) && inc[b[0]][b[1]] === 2) { b = [b[0] - dr, b[1] - dc]; }
          if (inside(a[0], a[1]) && inc[a[0]][a[1]] === 0) cand.push(a);
          if (inside(b[0], b[1]) && inc[b[0]][b[1]] === 0) cand.push(b);
        }
      }
      if (!cand.length) hits.forEach(function (h) { neighbours(inc, h[0], h[1]).forEach(function (p) { cand.push(p); }); });
      if (cand.length) return pick(cand, rng);
    }
    var all = unshot(inc);
    var parity = all.filter(function (p) { return (p[0] + p[1]) % 2 === 0; });
    return pick(parity.length ? parity : all, rng);
  }

  // Niveau 3 (fort) : densité de probabilité. Pour chaque navire restant et chaque position encore possible,
  // on compte les cases ; les positions qui recouvrent des touchés non expliqués pèsent beaucoup plus.
  function aiLevel3(inc, sunk, rng) {
    var lens = remainingLens(sunk), hits = openHits(inc, sunk), score = emptyMatrix(), covered = emptyMatrix();
    var r, c, horiz;
    sunk.forEach(function (s) { s.cells.forEach(function (p) { covered[p[0]][p[1]] = 1; }); });
    lens.forEach(function (len) {
      for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) for (var h = 0; h < 2; h++) {
        horiz = h === 0;
        var cells = shipCells(len, r, c, horiz), ok = true, nh = 0, k;
        for (k = 0; k < cells.length && ok; k++) {
          var p = cells[k];
          if (!inside(p[0], p[1]) || inc[p[0]][p[1]] === 1 || covered[p[0]][p[1]]) ok = false;
          else if (inc[p[0]][p[1]] === 2) nh++;
        }
        if (!ok) continue;
        var w = nh ? Math.pow(40, nh) : 1;
        cells.forEach(function (q) { if (inc[q[0]][q[1]] === 0) score[q[0]][q[1]] += w; });
      }
    });
    var best = -1, bests = [];
    for (r = 0; r < SIZE; r++) for (c = 0; c < SIZE; c++) {
      if (inc[r][c] !== 0) continue;
      if (score[r][c] > best) { best = score[r][c]; bests = [[r, c]]; }
      else if (score[r][c] === best) bests.push([r, c]);
    }
    return bests.length ? pick(bests, rng) : pick(unshot(inc), rng);
  }

  function aiChoose(level, inc, sunk, rng) {
    rng = rng || Math.random;
    if (level >= 3) return aiLevel3(inc, sunk, rng);
    if (level === 2) return aiLevel2(inc, sunk, rng);
    return aiLevel1(inc, sunk, rng);
  }

  var Engine = {
    SIZE: SIZE, FLEET: FLEET, COLS: COLS,
    fleetDef: fleetDef, coord: coord, emptyMatrix: emptyMatrix, inside: inside,
    shipCells: shipCells, occupancy: occupancy, canPlace: canPlace, placeShip: placeShip, removeShip: removeShip,
    isComplete: isComplete, randomFleet: randomFleet,
    shipAt: shipAt, isSunk: isSunk, fire: fire, applyResult: applyResult,
    remainingLens: remainingLens, openHits: openHits, aiChoose: aiChoose
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  else root.Engine = Engine;
})(typeof window !== 'undefined' ? window : this);
