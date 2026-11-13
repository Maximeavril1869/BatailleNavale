/* Bataille navale — interface. Deux modes : contre l'ordinateur ('solo', sauvegardé dans le navigateur)
   et en ligne ('online') : deux joueurs, chacun place sa flotte et tire depuis son appareil.
   En ligne, l'état complet de la partie (flottes comprises) vit dans une ligne Supabase ; chaque appareil
   n'affiche que ce qu'il doit montrer (sa flotte, les tirs). Un « plateau » (iPad en affichage seul) montre
   les deux grilles de tirs ; personne ne joue dessus. */
(function () {
  'use strict';
  var E = window.Engine, EL = window.EnLigne;
  var SAVE_KEY = 'bn_partie_v1', PREF_KEY = 'bn_prefs_v1', OKEY = 'bn_online_v1', APP_VERSION = '2';
  var LEVELS = ['', 'Débutant', 'Normal', 'Fort'];

  var G = null;               // état de la partie (sérialisable)
  var ONL = null;             // partie en ligne : { id, me, version, dirty, pushing, status, watch, retry, redo }
  var PT = null;              // plateau ouvert sur cet appareil : { id, version, watch }
  var MY = { gen: 0, ships: [] };   // en ligne : ma flotte en cours de placement (reste sur cet appareil jusqu'à validation)
  var sel = null;             // case visée, pas encore tirée : [r, c]
  var busy = false;           // l'ordinateur joue
  var flash = '';             // message passager
  var ui = { horiz: true, ship: null };   // placement : orientation et navire sélectionné
  var PL = null;              // contexte de placement
  var overOpen = false;
  var prefs = { mode: 'solo', level: 2, rejoue: false, n1: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function qa(sel2, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel2)); }
  function delay(ms) { return window.BOT_DELAY != null ? window.BOT_DELAY : ms; }
  function online() { return !!G && G.mode === 'online'; }
  function me() { return online() && ONL ? ONL.me : 0; }

  /* ---------- Sauvegarde (contre l'ordinateur seulement : une partie en ligne vit sur le serveur) ---------- */
  function save() {
    if (G && G.mode === 'online') { if (ONL) { ONL.dirty = true; pushState(); } return; }
    try { if (G) localStorage.setItem(SAVE_KEY, JSON.stringify(G)); } catch (e) {}
  }
  function loadSave() {
    try { var s = localStorage.getItem(SAVE_KEY), g = s ? JSON.parse(s) : null; return g && g.mode === 'solo' && g.fleets && g.phase ? g : null; } catch (e) { return null; }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {} }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY));
      if (!p) return;
      if (p.mode === 'online') prefs.mode = 'online';   // « on se passe l'appareil », « face à face » et « téléphone » n'existent plus
      prefs.level = Math.min(3, Math.max(1, p.level || 2));
      prefs.rejoue = !!p.rejoue;
      if (typeof p.n1 === 'string' && p.n1 !== 'Joueur 1') prefs.n1 = p.n1;
    } catch (e) {}
  }

  /* ---------- Écrans ---------- */
  var SCREENS = ['home', 'place', 'battle', 'fleetwait', 'plateau'];
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
  function makeGame(mode, names) {
    return {
      v: 2, mode: mode, gen: 1, level: prefs.level, rejoue: prefs.rejoue, names: names,
      phase: 'place', turn: 0,
      fleets: [[], []], inc: [E.emptyMatrix(), E.emptyMatrix()], sunk: [[], []],
      last: null, winner: -1, shots: [0, 0], ready: [false, false]
    };
  }
  function newGame() {
    G = makeGame('solo', ['Toi', 'Ordinateur']);
    sel = null; busy = false; flash = ''; ui.ship = null; ui.horiz = true; overOpen = false;
    save(); renderAll();
  }

  /* ================= Placement ================= */
  function setPlacement() {
    if (online()) {
      PL = {
        get: function () { return MY.ships; }, set: function (a) { MY.ships = a; },
        title: function () { return 'Place ta flotte'; }, sub: function () { return 'Ton adversaire ne la voit pas'; },
        persist: saveMy, onOk: commitReady
      };
    } else {
      PL = {
        get: function () { return G.fleets[0]; }, set: function (a) { G.fleets[0] = a; },
        title: function () { return 'Place ta flotte'; }, sub: function () { return 'L\'ordinateur place la sienne en secret'; },
        persist: save, onOk: commitFleet
      };
    }
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
  function commitFleet() {                                     // contre l'ordinateur
    if (!E.isComplete(G.fleets[0])) return;
    G.fleets[1] = E.randomFleet();
    G.phase = 'battle'; G.turn = Math.random() < 0.5 ? 0 : 1;
    sel = null; save(); renderAll(); maybeBot();
  }
  function commitReady() {                                     // en ligne : la flotte part sur le serveur, la partie démarre quand les deux sont prêts
    if (!ONL || !E.isComplete(MY.ships)) return;
    var who = ONL.me, ships = JSON.parse(JSON.stringify(MY.ships));
    function apply() {
      G.fleets[who] = ships; G.ready[who] = true;
      if (G.phase === 'place' && G.ready[0] && G.ready[1]) { G.phase = 'battle'; G.turn = Math.random() < 0.5 ? 0 : 1; G.last = null; }
    }
    apply();
    ONL.redo = apply;          // si l'autre joueur écrit au même moment, on rejoue notre validation sur son état
    save(); onlineShow();
  }

  /* ================= Tirs ================= */
  function canAim(p, target) {
    if (!G || G.phase !== 'battle' || busy) return false;
    if (G.turn !== p || target !== 1 - p) return false;
    return p === me();
  }
  function aim(p, target, r, c) {
    if (!canAim(p, target) || G.inc[target][r][c] !== 0) return;
    if (sel && sel[0] === r && sel[1] === c) { fireSelected(); return; }
    sel = [r, c]; renderAll();
  }
  function fireSelected() {
    if (!sel || !canAim(me(), 1 - me())) return;
    var p = me(), t = 1 - p, res = E.fire(G.fleets[t], G.inc[t], G.sunk[t], sel[0], sel[1]);
    if (res) afterShot(p, res);
  }
  function afterShot(p, res) {
    sel = null; G.shots[p]++;
    G.last = { by: p, r: res.r, c: res.c, res: res.res, name: res.ship ? res.ship.name : null };
    var again = !res.allSunk && G.rejoue && res.res !== 'miss';
    if (res.allSunk) { G.phase = 'over'; G.winner = p; }
    else if (!again) G.turn = 1 - p;
    save();
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
    }, delay(900 + Math.random() * 500));
  }

  /* ================= Affichage : un joueur devant son appareil ================= */
  function renderBattle() {
    var v = me(), o = 1 - v, over = G.phase === 'over', myTurn = canAim(v, o);
    $('bTitle').textContent = online() ? G.names[v] : 'Bataille navale';
    $('bSub').textContent = (online() ? '' : 'Ordinateur : ' + LEVELS[G.level] + ' · ') + 'tes tirs : ' + G.shots[v];
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
    else if (G.turn === v) line = sel ? 'Cible : <b>' + E.coord(sel[0], sel[1]) + '</b>. Touche encore la case ou « Feu ! ».' : 'À toi de tirer : touche une case des eaux de ' + esc(G.names[o]) + '.';
    else line = G.names[G.turn] + ' vise…';
    $('bMsg').innerHTML = '<span>' + line + '</span>' + (small && !over ? '<small>' + esc(small) + '</small>' : '');
    $('bMsg').className = 'msg' + (G.turn === v && !over ? ' alert' : '');
    var b = $('bAction'); b.disabled = true; b.className = 'btn fire';
    if (over) { b.textContent = 'Voir le résultat'; b.disabled = false; b.className = 'btn gold'; }
    else if (myTurn && sel) { b.textContent = 'Feu en ' + E.coord(sel[0], sel[1]) + ' !'; b.disabled = false; }
    else if (G.turn === v) b.textContent = 'Choisis une case à viser';
    else b.textContent = 'Au tour de ' + G.names[G.turn] + '…';
  }

  /* ================= Fin de partie ================= */
  function showOver() {
    if (overOpen || !G || G.phase !== 'over') return;
    overOpen = true;
    var w = G.winner, txt;
    if (!online()) txt = w === 0 ? 'Victoire ! Tu as coulé toute la flotte en ' + G.shots[0] + ' tirs.' : 'Défaite. L\'ordinateur a coulé ta flotte en ' + G.shots[1] + ' tirs.';
    else txt = (w === me() ? 'Victoire ! Tu gagnes' : esc(G.names[w]) + ' gagne') + ' en ' + G.shots[w] + ' tirs !';
    var h = '<h2 class="cond">' + (!online() ? (w === 0 ? 'Victoire' : 'Défaite') : 'Partie terminée') + '</h2><p>' + txt + '</p>' +
            '<p>Tirs : ' + esc(G.names[0]) + ' ' + G.shots[0] + ' · ' + esc(G.names[1]) + ' ' + G.shots[1] + '</p>' +
            '<button class="btn gold" id="ovAgain" style="max-width:none">Rejouer</button>' +
            '<button class="btn ghost" id="ovHome" style="max-width:none">Accueil</button>' +
            '<button class="btn ghost" id="ovClose" style="max-width:none">Revoir les grilles</button>';
    $('overBody').innerHTML = h;
    var d = $('dlgOver'); if (!d.open) d.showModal();
    $('ovAgain').onclick = function () { d.close(); overOpen = false; if (online()) restartOnline(); else { clearSave(); newGame(); } };
    $('ovHome').onclick = function () { d.close(); goHome(); };
    $('ovClose').onclick = function () { d.close(); };
  }
  function closeOver() { overOpen = false; var d = $('dlgOver'); if (d.open) d.close(); }

  /* ================= Dispatch d'affichage ================= */
  function renderAll() {
    if (!G || PT) return;
    if (online() && !G.online.joined) return;                       // salle d'attente (#wait)
    if (G.phase === 'place') {
      if (online() && G.ready[me()]) {
        show('fleetwait');
        $('fwText').textContent = 'En attente de la flotte de ' + G.names[1 - me()] + '…';
      } else { setPlacement(); show('place'); renderPlace(); }
    } else { show('battle'); renderBattle(); }
    if (G.phase === 'over') showOver();
  }

  /* ================= Accueil ================= */
  function goHome() {
    ptStop();
    if (ONL) onlineStop();
    closeOver();
    $('dlgMenu').open && $('dlgMenu').close();
    G = null; $('wait').hidden = true;
    show('home'); renderHome();
  }
  function renderHome() {
    var on = prefs.mode === 'online';
    qa('#segMode button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-m') === prefs.mode); });
    qa('#segLevel button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-l') === prefs.level); });
    $('optLevel').hidden = on;
    $('optNames').hidden = !on;
    $('onlinePanel').hidden = !on;
    $('swRejoue').classList.toggle('on', prefs.rejoue);
    if (document.activeElement !== $('n1')) $('n1').value = prefs.n1;
    var s = loadSave();
    $('btnResume').hidden = on || !s || s.phase === 'over';
    $('btnNew').disabled = on && !EL.connecte();
    $('ver').textContent = 'Version ' + APP_VERSION;
    if (on) olRender();
  }
  function resume() {
    var s = loadSave();
    if (!s) return;
    G = s; sel = null; busy = false; flash = ''; ui.ship = null; overOpen = false;
    renderAll(); maybeBot();
  }

  /* ================= En ligne ================= */
  var OFF_TXT = $('offbar').textContent;
  function olMsg(t) { var e = $('olErr'); e.hidden = !t; e.textContent = t || ''; }
  function olError(e) {
    if (e && e.kind === 'auth') { olMsg('Session expirée : reconnecte-toi.'); olRender(); }
    else if (e && e.kind === 'reseau') olMsg('Pas de réseau : impossible de joindre le service pour l\'instant.');
    else olMsg('Erreur : ' + (e && e.message ? e.message : 'inconnue'));
  }
  function olRender() {
    var inn = EL.connecte();
    $('olLogin').hidden = inn; $('olIn').hidden = !inn;
    $('btnNew').disabled = prefs.mode === 'online' && !inn;
    if (inn) { $('olWho').textContent = EL.email(); olList(); }
  }
  function olList() {
    EL.liste('bataillenavale').then(function (a) {
      var h = '';
      a.forEach(function (r) {
        h += '<div class="olitem"><div class="t"><b>' + esc(r.id) + '</b><small>' + esc(r.titre || '') + '</small></div>' +
          '<button data-ol="resume" data-id="' + esc(r.id) + '">Reprendre</button><button data-ol="del" data-id="' + esc(r.id) + '" aria-label="Supprimer la partie ' + esc(r.id) + '">✕</button></div>';
      });
      $('olList').innerHTML = h || '<p class="olwho" style="margin:0">Aucune pour l\'instant.</p>';
    }).catch(olError);
  }
  function getMap() { try { return JSON.parse(localStorage.getItem(OKEY)) || {}; } catch (e) { return {}; } }
  function putMap(m) { try { localStorage.setItem(OKEY, JSON.stringify(m)); } catch (e) { /* rien */ } }
  function setSeat(id, seat) { var m = getMap(), e = m[id] || {}; e.me = seat; m[id] = e; putMap(m); }
  function saveMy() { if (!ONL) return; var m = getMap(), e = m[ONL.id] || {}; e.gen = MY.gen; e.ships = MY.ships; m[ONL.id] = e; putMap(m); }
  function loadMy(id, gen) { var e = getMap()[id]; return e && e.gen === gen && e.ships ? e.ships : []; }
  function titre() {
    var n = G.names.filter(function (x) { return x !== '…'; }).join(' et ');
    if (!G.online.joined) return n + ' · en attente';
    return n + ' · ' + (G.phase === 'place' ? 'placement' : G.phase === 'over' ? 'terminée' : (G.shots[0] + G.shots[1]) + ' tirs');
  }
  function onlineStart(id, seat, version) {
    onlineStop();
    ONL = { id: id, me: seat, version: version, dirty: false, pushing: false, status: 'ok', watch: null, retry: null, redo: null };
    setSeat(id, seat);
    MY = { gen: G.gen, ships: loadMy(id, G.gen) };
    ui.ship = null;
    ONL.watch = EL.surveiller(id, function () { return ONL ? ONL.version : 0; }, onRemote, onStatus);
  }
  function onlineStop() {
    if (ONL) { if (ONL.watch) ONL.watch.stop(); clearTimeout(ONL.retry); }
    ONL = null;
    $('offbar').hidden = true; $('wait').hidden = true;
  }
  function onStatus(st) {
    if (!ONL) return;
    ONL.status = st;
    $('offbar').hidden = st !== 'hors-ligne';
    if (st === 'supprimee') { goHome(); olMsg('Cette partie a été supprimée.'); return; }
    if (st === 'auth') { goHome(); olError({ kind: 'auth' }); return; }
    if (st === 'ok' && ONL.dirty && !ONL.pushing) pushState();
  }
  function onlineShow() {          // affiche G selon son avancement : salle d'attente, placement, bataille
    if (!G.online.joined) { $('waitCode').textContent = ONL.id; $('wait').hidden = false; return; }
    $('wait').hidden = true;
    if (G.gen !== MY.gen) { MY = { gen: G.gen, ships: [] }; saveMy(); ui.ship = null; }   // nouvelle partie (« Rejouer »)
    if (G.phase !== 'over') closeOver();
    renderAll();
  }
  function takeRemote(row) {       // l'état du serveur remplace le nôtre
    G = row.etat; ONL.version = row.version; sel = null;
  }
  function onRemote() {
    var o = ONL;
    if (!o || o.pushing || o.dirty) return;
    return EL.lire(o.id).then(function (row) {
      if (ONL !== o || !row || row.version <= o.version || o.pushing || o.dirty) return;
      takeRemote(row);
      onlineShow();
    });
  }
  function pushState() {
    var o = ONL;
    if (!o || o.pushing || !o.dirty) return;
    o.pushing = true; o.dirty = false;
    EL.ecrire(o.id, o.version, G, titre()).then(function (nv) {
      if (ONL !== o) return;
      o.pushing = false;
      if (nv) { o.version = nv; o.redo = null; if (o.status === 'hors-ligne') onStatus('ok'); if (o.dirty) pushState(); return; }
      // conflit : l'autre appareil a écrit avant nous. Son état l'emporte ; seule la validation de flotte est rejouée dessus.
      return EL.lire(o.id).then(function (row) {
        if (ONL !== o || !row) return;
        o.dirty = false; takeRemote(row);
        if (G.online.uids.indexOf(EL.uid()) < 0) { goHome(); olMsg('Cette partie a déjà ses deux joueurs.'); return; }
        if (o.redo && G.phase === 'place' && !G.ready[o.me]) { o.redo(); o.dirty = true; onlineShow(); pushState(); return; }
        o.redo = null;
        if (G.phase === 'battle') flash = 'Ton action a été annulée : l\'autre appareil a joué en même temps.';
        onlineShow();
        if (flash) setTimeout(function () { flash = ''; if (G && ONL === o) renderAll(); }, 4500);
      });
    }).catch(function (e) {
      if (ONL !== o) return;
      o.pushing = false; o.dirty = true;
      onStatus(e && e.kind === 'reseau' ? 'hors-ligne' : 'erreur');
      if (e && e.kind === 'auth') return;
      clearTimeout(o.retry);
      o.retry = setTimeout(function () { if (ONL === o) pushState(); }, 2000);
    });
  }
  function onlineCreate() {
    var nm = (prefs.n1 || '').trim() || 'Joueur 1';
    savePrefs();
    var g = makeGame('online', [nm, '…']);
    g.online = { uids: [EL.uid(), null], joined: false };
    EL.creer('bataillenavale', g, nm + ' · en attente').then(function (r) {
      G = g; overOpen = false; onlineStart(r.id, 0, r.version); onlineShow();
    }).catch(olError);
  }
  function restartOnline() {       // « Rejouer » en ligne : même code, mêmes joueurs, nouveau placement
    var o = G.online, gen = G.gen + 1, ng = makeGame('online', G.names.slice());
    ng.rejoue = G.rejoue; ng.gen = gen; ng.online = o;
    G = ng; sel = null; MY = { gen: gen, ships: [] }; saveMy();
    save(); onlineShow();
  }
  function seatFor(id, g) {
    var e = getMap()[id], seat = e ? e.me : null;
    if (seat == null && g.online) { var k = g.online.uids.indexOf(EL.uid()); if (k >= 0) seat = k; }
    return seat;
  }
  function onlineJoin(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { olMsg('Le code a 4 lettres.'); return; }
    olMsg('');
    EL.lire(code).then(function (row) {
      if (!row || row.jeu !== 'bataillenavale') { olMsg('Code inconnu.'); return; }
      var g = row.etat, seat = seatFor(code, g);
      if (seat != null && (g.online.joined || seat === 0)) { G = g; overOpen = false; onlineStart(code, seat, row.version); onlineShow(); return; }
      if (g.online.joined) { olMsg('Cette partie a déjà ses deux joueurs.'); return; }
      var nm = (prefs.n1 || '').trim() || 'Joueur 2';
      if (nm === g.names[0]) nm += ' (2)';
      G = g; overOpen = false; onlineStart(code, 1, row.version);
      G.names[1] = nm; G.online.uids[1] = EL.uid(); G.online.joined = true;
      save(); onlineShow();
    }).catch(olError);
  }
  function onlineResume(id) {
    olMsg('');
    EL.lire(id).then(function (row) {
      if (!row) { olMsg('Partie introuvable.'); olList(); return; }
      var seat = seatFor(id, row.etat);
      G = row.etat; overOpen = false; onlineStart(row.id, seat != null ? seat : 0, row.version); onlineShow();
    }).catch(olError);
  }

  /* ================= Plateau : affichage seul (iPad commun) ================= */
  // Lit la partie, n'y écrit jamais. Montre les tirs et les navires coulés de chaque côté ; les flottes ne sont révélées qu'en fin de partie.
  function ptStop() {
    var o = PT; if (!o) return;
    if (o.watch) o.watch.stop();
    PT = null; $('plateau').hidden = true; $('offbar').hidden = true; $('offbar').textContent = OFF_TXT;
  }
  function ptRender() {
    if (!G) return;
    var p;
    if (!G.online || !G.online.joined) {
      $('pTitle').textContent = 'Plateau · ' + PT.id; $('pSub').textContent = 'Bataille navale en ligne';
      $('pCap0').innerHTML = ''; $('pCap1').innerHTML = ''; $('pG0').innerHTML = ''; $('pG1').innerHTML = '';
      $('pMsg').innerHTML = '<span>En attente des joueurs…</span>';
      return;
    }
    var over = G.phase === 'over', bat = G.phase === 'battle';
    $('pTitle').textContent = over ? 'Partie terminée' : bat ? 'Bataille en cours' : 'Placement des flottes';
    $('pSub').textContent = 'Plateau · ' + PT.id + ' · tirs : ' + G.names[0] + ' ' + G.shots[0] + ' · ' + G.names[1] + ' ' + G.shots[1];
    for (p = 0; p < 2; p++) {
      $('pCap' + p).innerHTML = '<b>Eaux de ' + esc(G.names[p]) + '</b><span>' + shipsLeft(G.sunk[p]) + ' navires à flot</span>';
      $('pG' + p).innerHTML = gridHTML({ id: 'pg' + p, inc: G.inc[p], sunk: G.sunk[p], ships: over ? G.fleets[p] : null,
        last: G.last && G.last.by === 1 - p ? G.last : null });
      $('pw' + p).classList.toggle('aimed', bat && G.turn === 1 - p);
    }
    var t;
    if (over) t = G.names[G.winner] + ' gagne en ' + G.shots[G.winner] + ' tirs !';
    else if (bat) t = (G.last ? lastText(null) + ' ' : '') + 'Au tour de ' + G.names[G.turn] + ' de tirer.';
    else t = G.names.map(function (n, i) { return esc(n) + ' : ' + (G.ready[i] ? 'flotte prête' : 'place sa flotte…'); }).join(' · ');
    $('pMsg').innerHTML = '<span>' + (over || bat ? esc(t) : t) + '</span>';
    $('pMsg').className = 'msg' + (bat ? ' alert' : '');
  }
  function ptRemote() {
    var o = PT; if (!o) return;
    return EL.lire(o.id).then(function (row) {
      if (PT !== o || !row || row.version <= o.version) return;
      G = row.etat; o.version = row.version; ptRender();
    });
  }
  function ptStatus(st) {
    if (!PT) return;
    if (st === 'supprimee') { goHome(); olMsg('Cette partie a été supprimée.'); return; }
    if (st === 'auth') { goHome(); olError({ kind: 'auth' }); return; }
    $('offbar').textContent = 'Hors ligne : le plateau se remettra à jour au retour du réseau';
    $('offbar').hidden = st !== 'hors-ligne';
  }
  function plateauStart(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length !== 4) { olMsg('Le code a 4 lettres.'); return; }
    olMsg('');
    EL.lire(code).then(function (row) {
      if (!row || row.jeu !== 'bataillenavale') { olMsg('Code inconnu.'); return; }
      onlineStop(); ptStop(); closeOver();
      G = row.etat; sel = null;
      var o = PT = { id: code, version: row.version, watch: null };
      show('plateau');
      ptRender();
      o.watch = EL.surveiller(code, function () { return PT ? PT.version : 0; }, ptRemote, ptStatus);
    }).catch(olError);
  }

  /* ================= Événements ================= */
  function bind() {
    qa('#segMode button').forEach(function (b) { b.onclick = function () { prefs.mode = b.getAttribute('data-m'); savePrefs(); olMsg(''); renderHome(); }; });
    qa('#segLevel button').forEach(function (b) { b.onclick = function () { prefs.level = +b.getAttribute('data-l'); savePrefs(); renderHome(); }; });
    $('swRejoue').onclick = function () { prefs.rejoue = !prefs.rejoue; savePrefs(); renderHome(); };
    $('n1').oninput = function () { prefs.n1 = this.value.slice(0, 14); savePrefs(); };
    $('btnNew').onclick = function () { if (prefs.mode === 'online') onlineCreate(); else newGame(); };
    $('btnResume').onclick = resume;
    $('btnRules').onclick = function () { $('dlgRules').showModal(); };
    $('btnMenuRules').onclick = function () { $('dlgMenu').close(); $('dlgRules').showModal(); };
    qa('[data-close]').forEach(function (b) { b.onclick = function () { b.closest('dialog').close(); }; });
    ['btnMenuPl', 'btnMenuB'].forEach(function (id) { $(id).onclick = function () { $('dlgMenu').showModal(); }; });
    $('btnQuit').onclick = function () { $('dlgMenu').close(); goHome(); };

    // placement
    $('plGrid').onclick = function (ev) { var c = cellOf(ev); if (c && PL) placeTap(c.r, c.c); };
    $('plFleet').onclick = function (ev) {
      var b = ev.target.closest('button.shipchip'); if (!b || !PL) return;
      var id = b.getAttribute('data-id'), ships = PL.get();
      var s = E.removeShip(ships, id);
      if (s) { ui.horiz = s.cells.length > 1 ? s.cells[0][0] === s.cells[1][0] : ui.horiz; PL.persist(); }
      ui.ship = id; renderPlace();
    };
    $('plRot').onclick = function () { ui.horiz = !ui.horiz; renderPlace(); };
    $('plRand').onclick = function () { PL.set(E.randomFleet()); ui.ship = null; PL.persist(); renderPlace(); };
    $('plClear').onclick = function () { PL.set([]); ui.ship = null; PL.persist(); renderPlace(); };
    $('plOk').onclick = function () { if (E.isComplete(PL.get())) PL.onOk(); };

    // bataille
    $('bTarget').onclick = function (ev) { var c = cellOf(ev); if (c && G) aim(me(), 1 - me(), c.r, c.c); };
    $('bAction').onclick = function () {
      if (!G) return;
      if (G.phase === 'over') { overOpen = false; showOver(); return; }
      fireSelected();
    };

    // en ligne
    window.addEventListener('offline', function () { if (ONL) onStatus('hors-ligne'); });
    window.addEventListener('online', function () { if (ONL && ONL.watch) ONL.watch.poke(); });
    $('btnOlLogin').onclick = function () {
      olMsg('');
      EL.login($('olEmail').value.trim(), $('olPwd').value).then(function () { $('olPwd').value = ''; renderHome(); }).catch(function (e) {
        olMsg(e.kind === 'bad' ? 'E-mail ou mot de passe refusé.' : e.kind === 'reseau' ? 'Pas de réseau.' : 'Erreur : ' + e.message);
      });
    };
    $('btnOlLogout').onclick = function () { EL.logout(); olMsg(''); renderHome(); };
    $('btnOlJoin').onclick = function () { onlineJoin($('olCode').value); };
    $('btnOlPlateau').onclick = function () { plateauStart($('olCode').value); };
    $('olList').onclick = function (ev) {
      var b = ev.target.closest('button[data-ol]'); if (!b) return;
      var id = b.getAttribute('data-id');
      if (b.getAttribute('data-ol') === 'resume') onlineResume(id);
      else if (confirm('Supprimer la partie ' + id + ' pour les deux joueurs ?')) EL.supprimer(id).then(olList).catch(olError);
    };
    $('btnWaitCancel').onclick = function () {
      var id = ONL && ONL.id;
      goHome();
      if (id && confirm('Supprimer la partie ' + id + ' ?')) EL.supprimer(id).catch(function () { /* déjà partie */ });
    };
    $('btnWaitHome').onclick = goHome;
    $('btnFwHome').onclick = goHome;
    $('btnPlQuit').onclick = goHome;
  }

  /* ================= Démarrage ================= */
  function init() {
    loadPrefs(); bind();
    show('home'); renderHome();
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  init();
})();
