/* Bataille navale — interface. Tout est local : la partie est sauvegardée dans le navigateur (localStorage).
   Quatre modes : contre l'ordinateur ('solo'), à deux en se passant l'appareil ('passe'),
   à deux face à face sur un iPad posé à plat ('duo'), et à deux avec une flotte secrète sur chaque
   téléphone, l'iPad servant de plateau ('tel'). Un téléphone ouvre la même page avec #j=<code> (rôle « phone »). */
(function () {
  'use strict';
  var E = window.Engine, Net = window.Net;
  var SAVE_KEY = 'bn_partie_v1', PREF_KEY = 'bn_prefs_v1', PHONE_KEY = 'bn_phone_v1';
  var LEVELS = ['', 'Débutant', 'Normal', 'Fort'];

  var G = null;               // état de la partie (sérialisable) — sur l'iPad ou l'appareil local
  var sel = null;             // case visée, pas encore tirée : [r, c]
  var busy = false;           // l'ordinateur joue, ou on attend la réponse d'un téléphone
  var flash = '';             // message passager
  var ui = { horiz: true, ship: null };   // placement : orientation et navire sélectionné
  var PL = null;              // contexte de placement (local ou téléphone)
  var host = null, slots = [null, null], pending = null, shotSeq = 0;   // mode téléphone, côté iPad
  var Ph = null, phNet = null;                                          // mode téléphone, côté téléphone
  var overOpen = false;
  var prefs = { mode: 'solo', level: 2, rejoue: false, n1: 'Joueur 1', n2: 'Joueur 2', pname: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function qa(sel2, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel2)); }
  function baseUrl() { return location.href.split('#')[0].split('?')[0]; }

  /* ---------- Sauvegarde ---------- */
  function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {} }
  function loadSave() { try { var s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY));
      if (!p) return;
      if (['solo', 'passe', 'duo', 'tel'].indexOf(p.mode) >= 0) prefs.mode = p.mode;
      prefs.level = Math.min(3, Math.max(1, p.level || 2));
      prefs.rejoue = !!p.rejoue;
      if (p.n1) prefs.n1 = p.n1; if (p.n2) prefs.n2 = p.n2; if (p.pname) prefs.pname = p.pname;
    } catch (e) {}
  }
  function savePhone() { try { localStorage.setItem(PHONE_KEY, JSON.stringify(Ph)); } catch (e) {} }
  function loadPhone() { try { var s = localStorage.getItem(PHONE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function clearPhone() { try { localStorage.removeItem(PHONE_KEY); } catch (e) {} }

  /* ---------- Écrans ---------- */
  var SCREENS = ['home', 'place', 'battle', 'duo', 'telhost', 'phone'];
  function show(id) { SCREENS.forEach(function (s) { $(s).hidden = s !== id; }); }

  /* ---------- Grille en HTML ----------
     o : id, inc (tirs reçus), ships (flotte à afficher), sunk (navires coulés, toujours visibles),
         last (dernier tir à entourer), armed (la grille peut être visée), tgt (case visée) */
  function gridHTML(o) {
    var S = E.SIZE, occ = o.ships && o.ships.length ? E.occupancy(o.ships) : null, sk = null, r, c;
    if (o.sunk && o.sunk.length) {
      sk = E.emptyMatrix();
      o.sunk.forEach(function (s) { s.cells.forEach(function (p) { sk[p[0]][p[1]] = 1; }); });
    }
    var h = '<div class="grid' + (o.armed ? ' armed' : '') + '" data-g="' + o.id + '"><i class="lb"></i>';
    for (c = 0; c < S; c++) h += '<i class="lb">' + E.COLS.charAt(c) + '</i>';
    for (r = 0; r < S; r++) {
      h += '<i class="lb">' + (r + 1) + '</i>';
      for (c = 0; c < S; c++) {
        var v = o.inc ? o.inc[r][c] : 0, cl = 'c';
        if (occ && occ[r][c]) cl += ' hull';
        if (sk && sk[r][c]) cl += ' sk';
        if (v === 1) cl += ' miss'; else if (v === 2) cl += ' hit';
        if (o.armed && v === 0) cl += ' free';
        if (o.last && o.last.r === r && o.last.c === c) cl += ' last';
        if (o.tgt && o.tgt[0] === r && o.tgt[1] === c) cl += ' tgt';
        h += '<b class="' + cl + '" data-r="' + r + '" data-c="' + c + '"></b>';
      }
    }
    return h + '</div>';
  }
  function cellOf(ev) {
    var t = ev.target.closest ? ev.target.closest('b.c') : null;
    return t ? { r: +t.getAttribute('data-r'), c: +t.getAttribute('data-c'), g: t.parentNode.getAttribute('data-g') } : null;
  }
  function fleetChips(sunk) {
    var gone = {};
    (sunk || []).forEach(function (s) { gone[s.id] = true; });
    return E.FLEET.map(function (d) {
      var pips = ''; for (var i = 0; i < d.len; i++) pips += '<i></i>';
      return '<span class="shipchip' + (gone[d.id] ? ' gone' : '') + '"><span class="pips">' + pips + '</span>' + esc(d.name) + '</span>';
    }).join('');
  }
  function shipsLeft(sunk) { return E.FLEET.length - sunk.length; }

  /* ---------- Phrases ---------- */
  function resText(last) {
    if (last.res === 'miss') return 'à l\'eau.';
    if (last.res === 'hit') return 'touché !';
    return 'coulé : ' + (last.name || 'navire') + ' !';
  }
  // Dernier tir, vu par le joueur `viewer` (null : vu de l'extérieur).
  function lastText(viewer) {
    if (!G.last) return '';
    var who = G.last.by === viewer ? 'Tu as tiré' : G.names[G.last.by] + ' a tiré';
    return who + ' en ' + E.coord(G.last.r, G.last.c) + ' : ' + resText(G.last);
  }
  function setFlash(t) { flash = t; renderAll(); setTimeout(function () { if (flash === t) { flash = ''; renderAll(); } }, 4500); }

  /* ================= Nouvelle partie ================= */
  function newGame() {
    var mode = prefs.mode;
    G = {
      v: 1, mode: mode, level: prefs.level, rejoue: prefs.rejoue,
      names: mode === 'solo' ? ['Toi', 'Ordinateur'] : [prefs.n1.trim() || 'Joueur 1', prefs.n2.trim() || 'Joueur 2'],
      phase: 'place', placing: 0, veil: null, turn: 0, view: 0, await: false,
      fleets: [[], []], inc: [E.emptyMatrix(), E.emptyMatrix()], sunk: [[], []],
      last: null, winner: -1, shots: [0, 0], ready: [false, false], tokens: [null, null], hostId: null
    };
    sel = null; busy = false; flash = ''; ui.ship = null; ui.horiz = true; overOpen = false;
    if (mode === 'tel') { G.fleets = [null, null]; openHost(null); }
    setPlacement();
    save(); renderAll();
  }

  /* ================= Placement ================= */
  function setPlacement() {
    if (!G || G.mode === 'tel') return;
    PL = {
      get: function () { return G.fleets[G.placing]; },
      set: function (a) { G.fleets[G.placing] = a; },
      title: function () { return G.mode === 'solo' ? 'Place ta flotte' : G.names[G.placing] + ' : place ta flotte'; },
      sub: function () { return G.mode === 'solo' ? 'L\'ordinateur place la sienne en secret' : 'Les autres ne regardent pas l\'écran'; },
      rot: function () { return G.mode === 'duo' && G.placing === 1; },
      persist: save, onOk: commitFleet
    };
  }
  function nextUnplaced(ships) {
    for (var i = 0; i < E.FLEET.length; i++) {
      var id = E.FLEET[i].id;
      if (!ships.some(function (s) { return s.id === id; })) return id;
    }
    return null;
  }
  function plMsg(t) { $('plMsg').innerHTML = '<span>' + t + '</span>'; }

  function renderPlace() {
    if (!PL) return;
    var ships = PL.get();
    if (ui.ship && ships.some(function (s) { return s.id === ui.ship; })) ui.ship = null;
    if (!ui.ship) ui.ship = nextUnplaced(ships);
    $('place').classList.toggle('rot', PL.rot());
    $('plTitle').textContent = PL.title();
    $('plSub').textContent = PL.sub();
    $('plGrid').innerHTML = gridHTML({ id: 'pl', inc: E.emptyMatrix(), ships: ships });
    $('plFleet').innerHTML = E.FLEET.map(function (d) {
      var placed = ships.some(function (s) { return s.id === d.id; }), pips = '';
      for (var i = 0; i < d.len; i++) pips += '<i></i>';
      return '<button class="shipchip' + (placed ? ' done' : '') + (ui.ship === d.id ? ' sel' : '') + '" data-id="' + d.id + '"><span class="pips">' + pips + '</span>' + esc(d.name) + '</button>';
    }).join('');
    var done = E.isComplete(ships);
    $('plOk').disabled = !done;
    if (done) plMsg('Flotte complète. Touche un navire pour le déplacer, puis valide.');
    else if (ui.ship) plMsg('Pose le <b>' + esc(E.fleetDef(ui.ship).name.toLowerCase()) + '</b> (' + E.fleetDef(ui.ship).len + ' cases, ' + (ui.horiz ? 'horizontal' : 'vertical') + ') : touche sa case de départ.');
  }
  function placeTap(r, c) {
    var ships = PL.get();
    var at = E.shipAt(ships, r, c);
    if (at) {                                                  // on reprend un navire déjà posé
      var s = E.removeShip(ships, at.id);
      ui.ship = s.id;
      ui.horiz = s.cells.length > 1 ? s.cells[0][0] === s.cells[1][0] : ui.horiz;
      PL.persist(); renderPlace(); return;
    }
    if (!ui.ship) { plMsg('Tous les navires sont posés. Touche-en un pour le déplacer.'); return; }
    var def = E.fleetDef(ui.ship), rr = r, cc = c;
    if (ui.horiz) cc = Math.min(cc, E.SIZE - def.len); else rr = Math.min(rr, E.SIZE - def.len);   // on recale pour rester dans la grille
    if (!E.placeShip(ships, def, rr, cc, ui.horiz)) { plMsg('<span style="color:var(--flare)">Cet emplacement chevauche un autre navire.</span> Essaie ailleurs ou pivote.'); return; }
    ui.ship = null;
    PL.persist(); renderPlace();
  }
  function commitFleet() {
    var p = G.placing;
    if (!E.isComplete(G.fleets[p])) return;
    if (G.mode === 'solo') { G.fleets[1] = E.randomFleet(); startBattle(); return; }
    if (p === 0) { G.placing = 1; ui.ship = null; G.veil = { kind: 'place', who: 1 }; save(); renderAll(); return; }
    startBattle();
  }
  function startBattle() {
    G.phase = 'battle'; G.placing = -1; G.turn = Math.random() < 0.5 ? 0 : 1; G.view = G.turn; G.await = false;
    if (G.mode === 'passe') G.veil = { kind: 'turn', who: G.turn, start: true };
    else G.veil = null;
    sel = null; save(); renderAll(); maybeBot();
  }

  /* ================= Tirs ================= */
  function canAim(p, target) {
    // `p` peut-il viser la grille de `target` en ce moment ?
    if (!G || G.phase !== 'battle' || busy || G.veil || G.await) return false;
    if (G.turn !== p || target !== 1 - p) return false;
    if (G.mode === 'tel' && !telBothConnected()) return false;
    return true;
  }
  function aim(p, target, r, c) {
    if (!canAim(p, target) || G.inc[target][r][c] !== 0) return;
    if (sel && sel[0] === r && sel[1] === c) { fireSelected(); return; }
    sel = [r, c]; renderAll();
  }
  function fireSelected() {
    if (!sel) return;
    var p = G.turn, r = sel[0], c = sel[1];
    if (G.mode === 'tel') { telFire(p, r, c); return; }
    var t = 1 - p, res = E.fire(G.fleets[t], G.inc[t], G.sunk[t], r, c);
    if (res) afterShot(p, res);
  }
  function afterShot(p, res) {
    sel = null; G.shots[p]++;
    G.last = { by: p, r: res.r, c: res.c, res: res.res, name: res.ship ? res.ship.name : null };
    var again = !res.allSunk && G.rejoue && res.res !== 'miss';
    if (res.allSunk) { G.phase = 'over'; G.winner = p; G.await = false; }
    else if (!again) { G.turn = 1 - p; if (G.mode === 'passe') G.await = true; }
    save();
    if (G.mode === 'tel') telBroadcast();
    renderAll();
    if (G.phase === 'battle') maybeBot();
  }
  function maybeBot() {
    if (!G || G.mode !== 'solo' || G.phase !== 'battle' || G.turn !== 1 || busy) return;
    busy = true; renderAll();
    setTimeout(function () {
      if (!G || G.mode !== 'solo' || G.phase !== 'battle' || G.turn !== 1) { busy = false; return; }
      var pos = E.aiChoose(G.level, G.inc[0], G.sunk[0]);
      var res = E.fire(G.fleets[0], G.inc[0], G.sunk[0], pos[0], pos[1]);
      busy = false;
      if (res) afterShot(1, res);
    }, 900 + Math.random() * 500);
  }

  /* ================= Affichage : un joueur devant l'appareil (ordinateur, passe-passe) ================= */
  function viewer() { return G.mode === 'solo' ? 0 : G.view; }
  function renderBattle() {
    var v = viewer(), o = 1 - v, over = G.phase === 'over', myTurn = canAim(v, o);
    $('bTitle').textContent = G.mode === 'solo' ? 'Bataille navale' : G.names[v];
    $('bSub').textContent = (G.mode === 'solo' ? 'Ordinateur : ' + LEVELS[G.level] + ' · ' : '') + 'tes tirs : ' + G.shots[v];
    $('bCap1').innerHTML = '<b>Eaux de ' + esc(G.names[o]) + '</b><span>' + shipsLeft(G.sunk[o]) + ' navires à flot</span>';
    $('bCap2').innerHTML = '<b>Ta flotte</b><span>' + shipsLeft(G.sunk[v]) + ' navires à flot</span>';
    $('bTarget').innerHTML = gridHTML({ id: 'bt', inc: G.inc[o], sunk: G.sunk[o], ships: over ? G.fleets[o] : null,
      last: G.last && G.last.by === v ? G.last : null, armed: myTurn, tgt: myTurn ? sel : null });
    $('bOwn').innerHTML = gridHTML({ id: 'bo', inc: G.inc[v], sunk: G.sunk[v], ships: G.fleets[v],
      last: G.last && G.last.by === o ? G.last : null });
    $('bFleet').innerHTML = fleetChips(G.sunk[o]);
    var line = '', small = G.last ? lastText(v) : '';
    if (flash) line = flash;
    else if (over) line = G.winner === v ? 'Victoire ! Toute la flotte adverse est coulée.' : 'Ta flotte est coulée.';
    else if (G.await) line = 'Tour terminé. Passe l\'appareil à ' + G.names[G.turn] + '.';
    else if (G.turn === v) line = sel ? 'Cible : <b>' + E.coord(sel[0], sel[1]) + '</b>. Touche encore la case ou « Feu ! ».' : 'À toi de tirer : touche une case des eaux de ' + esc(G.names[o]) + '.';
    else line = G.names[G.turn] + ' vise…';
    $('bMsg').innerHTML = '<span>' + line + '</span>' + (small && !over ? '<small>' + esc(small) + '</small>' : '');
    $('bMsg').className = 'msg' + (G.turn === v && !G.await && !over ? ' alert' : '');
    var b = $('bAction'); b.disabled = true; b.className = 'btn fire';
    if (over) { b.textContent = 'Voir le résultat'; b.disabled = false; b.className = 'btn gold'; }
    else if (G.await) { b.textContent = 'Passer l\'appareil à ' + G.names[G.turn]; b.disabled = false; b.className = 'btn gold'; }
    else if (myTurn && sel) { b.textContent = 'Feu en ' + E.coord(sel[0], sel[1]) + ' !'; b.disabled = false; }
    else if (G.turn === v) b.textContent = 'Choisis une case à viser';
    else b.textContent = 'Au tour de ' + G.names[G.turn] + '…';
  }

  /* ================= Affichage : face à face (iPad à plat) ================= */
  function renderDuo() {
    var over = G.phase === 'over', tel = G.mode === 'tel';
    for (var p = 0; p < 2; p++) {
      var seat = $('seat' + p), o = 1 - p, armed = canAim(o, p);
      seat.classList.toggle('turn', G.phase === 'battle' && G.turn === p);
      seat.querySelector('.seathead b').textContent = G.names[p];
      seat.querySelector('.seathead span').textContent = shipsLeft(G.sunk[p]) + ' navires à flot';
      seat.querySelector('.gridwrap').innerHTML = gridHTML({ id: 'd' + p, inc: G.inc[p], sunk: G.sunk[p],
        ships: over && !tel ? G.fleets[p] : null, last: G.last && G.last.by === o ? G.last : null,
        armed: armed, tgt: armed ? sel : null });
      var line = '', small = G.last ? lastText(p) : '';
      if (flash) line = flash;
      else if (over) line = G.winner === p ? 'Victoire en ' + G.shots[p] + ' tirs !' : G.names[o] + ' a coulé toute ta flotte.';
      else if (tel && !telBothConnected()) line = 'Un téléphone est déconnecté : le jeu reprend dès qu\'il revient.';
      else if (busy && G.turn === p) line = 'Tir en cours…';
      else if (G.turn === p) line = sel ? 'Cible : <b>' + E.coord(sel[0], sel[1]) + '</b>. Touche « Feu ! » ou la case.' : 'À toi : touche une case de la grille de ' + esc(G.names[o]) + '.';
      else line = 'Au tour de ' + esc(G.names[o]) + '…';
      var m = seat.querySelector('.msg');
      m.innerHTML = '<span>' + line + '</span>' + (small && !over ? '<small>' + esc(small) + '</small>' : '');
      m.className = 'msg' + (G.turn === p && !over ? ' alert' : '');
      var b = seat.querySelector('.fire');
      b.disabled = !(canAim(p, o) && sel);
      b.textContent = over ? 'Terminé' : (sel && G.turn === p ? 'Feu en ' + E.coord(sel[0], sel[1]) + ' !' : 'Feu !');
    }
  }

  /* ================= Voile « passe l'appareil » ================= */
  function renderVeil() {
    var v = G && G.veil;
    $('veil').hidden = !v;
    if (!v) return;
    var n = G.names[v.who];
    $('veil').classList.toggle('rot', G.mode === 'duo' && v.who === 1);
    if (v.kind === 'place') {
      $('veilTitle').textContent = 'À ' + n + ' de placer sa flotte';
      $('veilText').textContent = 'Passe l\'appareil à ' + n + '. Que l\'autre joueur détourne les yeux.';
      $('btnVeil').textContent = 'Je suis prêt';
    } else {
      $('veilTitle').textContent = 'À ' + n + ' de jouer';
      $('veilText').textContent = v.start ? 'Le hasard a désigné ' + n + ' pour commencer. Passe-lui l\'appareil.' : 'Passe l\'appareil à ' + n + '.';
      $('btnVeil').textContent = 'Voir ma grille';
    }
  }
  function dismissVeil() {
    if (!G || !G.veil) return;
    if (G.veil.kind === 'turn') G.view = G.veil.who;
    G.veil = null; sel = null; save(); renderAll();
  }

  /* ================= Fin de partie ================= */
  function showOver() {
    if (overOpen || !G || G.phase !== 'over') return;
    overOpen = true;
    var w = G.winner, txt;
    if (G.mode === 'solo') txt = w === 0 ? 'Victoire ! Tu as coulé toute la flotte en ' + G.shots[0] + ' tirs.' : 'Défaite. L\'ordinateur a coulé ta flotte en ' + G.shots[1] + ' tirs.';
    else txt = esc(G.names[w]) + ' gagne en ' + G.shots[w] + ' tirs !';
    var h = '<h2 class="cond">' + (G.mode === 'solo' ? (w === 0 ? 'Victoire' : 'Défaite') : 'Partie terminée') + '</h2><p>' + txt + '</p>' +
            '<p>Tirs : ' + esc(G.names[0]) + ' ' + G.shots[0] + ' · ' + esc(G.names[1]) + ' ' + G.shots[1] + '</p>' +
            '<button class="btn gold" id="ovAgain" style="max-width:none">Rejouer</button>' +
            '<button class="btn ghost" id="ovHome" style="max-width:none">Accueil</button>' +
            '<button class="btn ghost" id="ovClose" style="max-width:none">Revoir les grilles</button>';
    $('overBody').innerHTML = h;
    var d = $('dlgOver'); if (!d.open) d.showModal();
    $('ovAgain').onclick = function () { d.close(); overOpen = false; if (G.mode === 'tel') telRematch(); else newGame(); };
    $('ovHome').onclick = function () { d.close(); goHome(); };
    $('ovClose').onclick = function () { d.close(); };
  }

  /* ================= Dispatch d'affichage ================= */
  function renderAll() {
    if (!G) return;
    if (G.phase === 'place') {
      if (G.mode === 'tel') { show('telhost'); renderTelHost(); }
      else { show('place'); renderPlace(); }
    } else if (G.mode === 'duo' || G.mode === 'tel') { show('duo'); renderDuo(); }
    else { show('battle'); renderBattle(); }
    renderVeil();
    if (G.phase === 'over') showOver();
  }

  /* ================= Accueil ================= */
  function goHome() {
    if (host) { host.close(); host = null; slots = [null, null]; }
    $('dlgMenu').open && $('dlgMenu').close();
    show('home'); renderHome();
  }
  function renderHome() {
    qa('#segMode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === prefs.mode); });
    qa('#segLevel button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-l') === prefs.level); });
    $('optLevel').hidden = prefs.mode !== 'solo';
    $('optNames').hidden = prefs.mode !== 'passe' && prefs.mode !== 'duo';
    $('swRejoue').classList.toggle('on', prefs.rejoue);
    $('n1').value = prefs.n1; $('n2').value = prefs.n2;
    var s = loadSave();
    $('btnResume').hidden = !s || s.v !== 1 || (s.phase === 'over');
  }
  function resume() {
    var s = loadSave();
    if (!s) return;
    G = s; sel = null; busy = false; flash = ''; ui.ship = null; overOpen = false;
    if (G.mode === 'tel') { slots = [null, null]; openHost(G.hostId); }
    setPlacement();
    renderAll(); maybeBot();
  }

  /* ================= Mode téléphone : côté iPad ================= */
  function telBothConnected() { return !!(slots[0] && slots[0].connected && slots[1] && slots[1].connected); }
  function openHost(id) {
    if (host) host.close();
    if (!Net || !Net.available()) { if (G) { G.hostErr = 'La liaison entre appareils n\'a pas pu se charger.'; } return; }
    G.hostErr = '';
    host = Net.createHost({
      id: id,
      onOpen: function (pid) { G.hostId = pid; save(); renderAll(); },
      onMessage: telOnMessage,
      onClose: function (conn) {
        for (var i = 0; i < 2; i++) if (slots[i] && slots[i].conn === conn) { slots[i].connected = false; }
        renderAll();
      },
      onError: function (err) {
        G.hostErr = err && err.type === 'network' ? 'Pas de connexion au service de mise en relation. Vérifie le Wi-Fi.' : 'Liaison impossible (' + (err && err.type || 'erreur') + ').';
        renderAll();
      }
    });
  }
  function telState(slot) {
    return { t: 'state', slot: slot, names: G.names, phase: G.phase, turn: G.turn, winner: G.winner, last: G.last, ready: G.ready };
  }
  function telBroadcast() {
    for (var i = 0; i < 2; i++) if (slots[i] && slots[i].connected) { try { slots[i].conn.send(telState(i)); } catch (e) {} }
  }
  function telOnMessage(conn, m) {
    if (!G || G.mode !== 'tel' || !m) return;
    if (m.t === 'hello') {
      var i = -1, k;
      for (k = 0; k < 2; k++) if (G.tokens[k] && G.tokens[k] === m.token) i = k;
      if (i < 0) for (k = 0; k < 2; k++) if (!G.tokens[k]) { i = k; break; }
      if (i < 0) { try { conn.send({ t: 'full' }); } catch (e) {} return; }
      G.tokens[i] = m.token;
      slots[i] = { conn: conn, connected: true };
      if (m.name && (G.phase === 'place' && !G.ready[i])) G.names[i] = String(m.name).slice(0, 14);
      save(); renderAll();
      try { conn.send(telState(i)); } catch (e) {}
      telBroadcast();
    } else if (m.t === 'ready') {
      var s = slotOf(conn); if (s < 0) return;
      if (G.phase === 'place') G.ready[s] = true;
      if (G.phase === 'place' && G.ready[0] && G.ready[1] && telBothConnected()) {
        G.phase = 'battle'; G.turn = Math.random() < 0.5 ? 0 : 1; G.last = null;
      }
      save(); telBroadcast(); renderAll();
    } else if (m.t === 'res') {
      if (!pending || m.seq !== pending.seq) return;
      clearTimeout(pending.timer);
      var p = pending.p; pending = null; busy = false;
      if (m.res && E.applyResult(G.inc[1 - p], G.sunk[1 - p], m.res)) afterShot(p, m.res);
      else renderAll();
    }
  }
  function slotOf(conn) { for (var i = 0; i < 2; i++) if (slots[i] && slots[i].conn === conn) return i; return -1; }
  function telFire(p, r, c) {
    var t = 1 - p, slot = slots[t];
    if (!slot || !slot.connected) { setFlash('Le téléphone de ' + G.names[t] + ' est déconnecté.'); return; }
    busy = true; var seq = ++shotSeq;
    pending = { seq: seq, p: p };
    try { slot.conn.send({ t: 'shot', seq: seq, r: r, c: c }); } catch (e) { busy = false; pending = null; setFlash('Envoi impossible. Réessaie.'); return; }
    pending.timer = setTimeout(function () {
      if (pending && pending.seq === seq) { pending = null; busy = false; sel = null; setFlash('Pas de réponse du téléphone de ' + G.names[t] + '. Réessaie.'); }
    }, 8000);
    renderAll();
  }
  function telRematch() {
    G.phase = 'place'; G.inc = [E.emptyMatrix(), E.emptyMatrix()]; G.sunk = [[], []]; G.last = null; G.winner = -1;
    G.shots = [0, 0]; G.ready = [false, false]; G.turn = 0; sel = null; busy = false; overOpen = false;
    save();
    for (var i = 0; i < 2; i++) if (slots[i] && slots[i].connected) { try { slots[i].conn.send({ t: 'newgame' }); slots[i].conn.send(telState(i)); } catch (e) {} }
    renderAll();
  }
  function renderTelHost() {
    $('thSub').textContent = G.hostId ? 'Les deux téléphones sur le même Wi-Fi que l\'iPad' : 'Ouverture de la liaison…';
    var box = $('qr');
    if (G.hostId && window.qrcode) {
      var url = baseUrl() + '#j=' + G.hostId;
      if (box.getAttribute('data-url') !== url) {
        var qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
        box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
        box.setAttribute('data-url', url);
      }
      box.hidden = false;
    } else box.hidden = true;
    for (var i = 0; i < 2; i++) {
      var row = $('slot' + i), on = !!(slots[i] && slots[i].connected);
      row.classList.toggle('on', on);
      row.querySelector('b').textContent = on || G.tokens[i] ? G.names[i] : 'Joueur ' + (i + 1);
      row.querySelector('.st').textContent = on ? (G.ready[i] ? 'Flotte prête' : 'Place sa flotte…') : (G.tokens[i] ? 'Déconnecté' : 'En attente');
    }
    $('thMsg').textContent = G.hostErr || (telBothConnected() ? 'La partie commence dès que les deux flottes sont prêtes.' : 'Si le scan ne marche pas, vérifie que les deux appareils sont sur le même Wi-Fi.');
  }

  /* ================= Mode téléphone : côté téléphone ================= */
  function phoneInit(hostId) {
    var saved = loadPhone();
    if (saved && saved.hostId === hostId && saved.token) Ph = saved;
    else Ph = { hostId: hostId, token: Net.randomId() + Net.randomId(), slot: -1, name: prefs.pname || '', phase: 'join', ships: [], inc: E.emptyMatrix(),
                sunk: [], names: ['Joueur 1', 'Joueur 2'], turn: -1, winner: -1, last: null, ready: false, log: [] };
    PL = {
      get: function () { return Ph.ships; }, set: function (a) { Ph.ships = a; },
      title: function () { return 'Place ta flotte'; }, sub: function () { return 'Personne d\'autre ne voit ton téléphone'; },
      rot: function () { return false; }, persist: savePhone,
      onOk: function () { Ph.ready = true; Ph.phase = 'wait'; savePhone(); if (phNet) phNet.send({ t: 'ready' }); phoneRender(); }
    };
    $('phName').value = Ph.name;
    if (Ph.slot >= 0) phoneConnect(); else phoneRender();
  }
  function phoneConnect() {
    if (phNet) phNet.close();
    phoneStatus('Connexion à l\'iPad…');
    phNet = Net.joinHost(Ph.hostId, {
      onStatus: function (s) { if (s === 'retry') phoneStatus('Connexion perdue. Nouvelle tentative…'); else if (s === 'connecting') phoneStatus('Connexion à l\'iPad…'); },
      onOpen: function () { phNet.send({ t: 'hello', token: Ph.token, name: Ph.name }); },
      onMessage: phoneOnMessage,
      onError: function (err) { phoneStatus(err && err.type === 'network' ? 'Pas de connexion au service de mise en relation. Vérifie le Wi-Fi.' : 'Liaison impossible, nouvelle tentative…'); }
    });
  }
  var phStatusText = '';
  function phoneStatus(t) { phStatusText = t; phoneRender(); }
  function phoneLog(t) { Ph.log.unshift(t); Ph.log = Ph.log.slice(0, 4); }
  function phoneOnMessage(m) {
    if (!m) return;
    if (m.t === 'full') { Ph.phase = 'full'; phoneRender(); return; }
    if (m.t === 'newgame') { Ph.ships = []; Ph.inc = E.emptyMatrix(); Ph.sunk = []; Ph.ready = false; Ph.phase = 'place'; Ph.last = null; Ph.log = []; Ph.winner = -1; ui.ship = null; savePhone(); phoneRender(); return; }
    if (m.t === 'state') {
      Ph.slot = m.slot; Ph.names = m.names; Ph.turn = m.turn; Ph.winner = m.winner;
      if (m.phase === 'place') { if (Ph.phase !== 'wait') Ph.phase = Ph.ready ? 'wait' : 'place'; }
      else Ph.phase = m.phase === 'over' ? 'over' : 'battle';
      if (m.phase === 'battle' && m.turn === m.slot && (!Ph.lastTurn || Ph.lastTurn !== m.slot)) { try { navigator.vibrate && navigator.vibrate(150); } catch (e) {} }
      Ph.lastTurn = m.turn;
      savePhone(); phStatusText = ''; phoneRender(); return;
    }
    if (m.t === 'shot') {
      var res = E.fire(Ph.ships, Ph.inc, Ph.sunk, m.r, m.c);
      if (!res) return;
      var adv = Ph.names[1 - Ph.slot];
      phoneLog(adv + ' a tiré en ' + E.coord(m.r, m.c) + ' : ' + resText({ res: res.res, name: res.ship && res.ship.name }));
      Ph.last = { r: m.r, c: m.c };
      try { navigator.vibrate && navigator.vibrate(res.res === 'miss' ? 40 : [120, 60, 120]); } catch (e) {}
      phNet.send({ t: 'res', seq: m.seq, res: res });
      savePhone(); phoneRender();
    }
  }
  function phoneRender() {
    if (!Ph) return;
    var ph = Ph.phase;
    if (ph === 'place') { show('place'); renderPlace(); return; }
    show('phone');
    $('phTitle').textContent = Ph.slot >= 0 ? Ph.names[Ph.slot] : 'Bataille navale';
    $('phSub').textContent = Ph.slot >= 0 ? 'Ta flotte est secrète' : 'Mode téléphone';
    $('phJoin').hidden = ph !== 'join';
    var showGrid = ph === 'wait' || ph === 'battle' || ph === 'over';
    $('phBoards').hidden = !showGrid; $('phFleet').hidden = !showGrid;
    var line = phStatusText;
    if (!line) {
      if (ph === 'full') line = 'Cette partie a déjà deux joueurs.';
      else if (ph === 'wait') line = 'Flotte prête. En attente de l\'autre joueur…';
      else if (ph === 'battle') line = Ph.turn === Ph.slot ? 'À toi : tire sur la grille de l\'iPad.' : 'Au tour de ' + Ph.names[Ph.turn] + '…';
      else if (ph === 'over') line = Ph.winner === Ph.slot ? 'Victoire ! Tu as coulé toute la flotte adverse.' : 'Défaite. Ta flotte est coulée.';
    }
    $('phStatus').innerHTML = esc(line); $('phStatus').className = 'msg' + (ph === 'battle' && Ph.turn === Ph.slot && !phStatusText ? ' alert' : '');
    if (showGrid) {
      $('phCap').innerHTML = '<b>Ta flotte</b><span>' + shipsLeft(Ph.sunk) + ' navires à flot</span>';
      $('phGrid').innerHTML = gridHTML({ id: 'ph', inc: Ph.inc, sunk: Ph.sunk, ships: Ph.ships, last: Ph.last });
      $('phFleet').innerHTML = fleetChips(Ph.sunk);
    }
    $('phLog').innerHTML = (Ph.log || []).map(esc).join('<br>');
  }

  /* ================= Événements ================= */
  function bind() {
    qa('#segMode button').forEach(function (b) { b.onclick = function () { prefs.mode = b.getAttribute('data-m'); savePrefs(); renderHome(); }; });
    qa('#segLevel button').forEach(function (b) { b.onclick = function () { prefs.level = +b.getAttribute('data-l'); savePrefs(); renderHome(); }; });
    $('swRejoue').onclick = function () { prefs.rejoue = !prefs.rejoue; savePrefs(); renderHome(); };
    $('n1').oninput = function () { prefs.n1 = this.value; savePrefs(); };
    $('n2').oninput = function () { prefs.n2 = this.value; savePrefs(); };
    $('phName').oninput = function () { prefs.pname = this.value; savePrefs(); };
    $('btnNew').onclick = function () { newGame(); };
    $('btnResume').onclick = resume;
    $('btnRules').onclick = function () { $('dlgRules').showModal(); };
    $('btnMenuRules').onclick = function () { $('dlgMenu').close(); $('dlgRules').showModal(); };
    qa('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });
    ['btnMenuPl', 'btnMenuB', 'btnMenuD', 'btnMenuT', 'btnMenuP'].forEach(function (id) { $(id).onclick = function () { $('dlgMenu').showModal(); }; });
    $('btnQuit').onclick = function () {
      $('dlgMenu').close();
      if (Ph) { if (phNet) phNet.close(); clearPhone(); location.href = baseUrl(); return; }
      goHome();
    };
    $('btnVeil').onclick = dismissVeil;

    // placement
    $('plGrid').onclick = function (ev) { var c = cellOf(ev); if (c) placeTap(c.r, c.c); };
    $('plFleet').onclick = function (ev) {
      var b = ev.target.closest('button.shipchip'); if (!b) return;
      var id = b.getAttribute('data-id'), ships = PL.get();
      var s = E.removeShip(ships, id);
      if (s) { ui.horiz = s.cells.length > 1 ? s.cells[0][0] === s.cells[1][0] : ui.horiz; PL.persist(); }
      ui.ship = id; renderPlace();
    };
    $('plRot').onclick = function () { ui.horiz = !ui.horiz; renderPlace(); };
    $('plRand').onclick = function () { PL.set(E.randomFleet()); ui.ship = null; PL.persist(); renderPlace(); };
    $('plClear').onclick = function () { PL.set([]); ui.ship = null; PL.persist(); renderPlace(); };
    $('plOk').onclick = function () { if (E.isComplete(PL.get())) PL.onOk(); };

    // bataille : un joueur
    $('bTarget').onclick = function (ev) { var c = cellOf(ev); if (c && G) aim(viewer(), 1 - viewer(), c.r, c.c); };
    $('bAction').onclick = function () {
      if (!G) return;
      if (G.phase === 'over') { overOpen = false; showOver(); return; }
      if (G.await) { G.veil = { kind: 'turn', who: G.turn }; G.await = false; save(); renderAll(); return; }
      fireSelected();
    };

    // bataille : face à face et plateau du mode téléphone
    $('duo').onclick = function (ev) {
      var c = cellOf(ev); if (!c || !G) return;
      var target = c.g === 'd0' ? 0 : c.g === 'd1' ? 1 : -1;
      if (target >= 0) aim(1 - target, target, c.r, c.c);
    };
    [0, 1].forEach(function (p) { $('seat' + p).querySelector('.fire').onclick = function () { if (G && G.turn === p) fireSelected(); }; });

    // téléphone
    $('phGo').onclick = function () {
      Ph.name = $('phName').value.trim() || 'Joueur'; prefs.pname = Ph.name; savePrefs();
      Ph.phase = 'place'; savePhone();
      phoneConnect(); phoneRender();
    };
  }

  /* ================= Démarrage ================= */
  function init() {
    loadPrefs(); bind();
    var m = /[#&]j=([A-Za-z0-9]+)/.exec(location.hash || '');
    if (m && Net && Net.available()) { phoneInit(m[1]); }
    else { show('home'); renderHome(); }
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  init();
})();
