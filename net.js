/* Bataille navale — liaison directe entre appareils (mode téléphone), par WebRTC via PeerJS.
   Un service public de PeerJS ne sert qu'à mettre les appareils en relation ; ensuite, les messages
   de jeu passent directement d'un appareil à l'autre. Aucune donnée de jeu n'est stockée ailleurs.

   - Net.createHost(opts) : l'iPad (plateau) attend les téléphones.
   - Net.joinHost(hostId, opts) : un téléphone se connecte à l'iPad, et se reconnecte tout seul s'il décroche. */
(function (root) {
  'use strict';

  function ctor() { return root.Peer || (root.peerjs && root.peerjs.Peer) || null; }
  function available() { return typeof ctor() === 'function'; }

  // Options de PeerJS (serveur de mise en relation). Par défaut : le service public. Les tests peuvent définir window.BN_PEER_OPTIONS.
  function mk(id) {
    var Peer = ctor(), o = root.BN_PEER_OPTIONS;
    if (id) return o ? new Peer(id, o) : new Peer(id);
    return o ? new Peer(o) : new Peer();
  }

  function randomId() {
    var a = 'abcdefghjkmnpqrstuvwxyz23456789', s = 'bn', i;
    for (i = 0; i < 8; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  }

  /* ----- iPad : reçoit les connexions des téléphones ----- */
  // opts : id (identifiant à réutiliser), onOpen(id), onConn(conn), onMessage(conn, msg), onClose(conn), onError(err)
  function createHost(opts) {
    var self = { dead: false, id: null, peer: null, conns: [] }, tries = 0;
    function open(id) {
      var peer = mk(id);
      self.peer = peer;
      peer.on('open', function (pid) { self.id = pid; if (opts.onOpen) opts.onOpen(pid); });
      peer.on('connection', function (conn) {
        conn.on('open', function () { self.conns.push(conn); if (opts.onConn) opts.onConn(conn); });
        conn.on('data', function (d) { if (opts.onMessage) opts.onMessage(conn, d); });
        conn.on('close', function () {
          var i = self.conns.indexOf(conn); if (i >= 0) self.conns.splice(i, 1);
          if (opts.onClose) opts.onClose(conn);
        });
        conn.on('error', function () { /* la fermeture est signalée par 'close' */ });
      });
      peer.on('disconnected', function () { if (!self.dead) { try { peer.reconnect(); } catch (e) {} } });
      peer.on('error', function (err) {
        // identifiant encore occupé (rechargement rapide de la page) : on réessaie quelques fois
        if (err && err.type === 'unavailable-id' && id && tries < 6 && !self.dead) {
          tries++; try { peer.destroy(); } catch (e) {}
          setTimeout(function () { if (!self.dead) open(id); }, 2500);
          return;
        }
        if (opts.onError) opts.onError(err);
      });
    }
    self.close = function () { self.dead = true; try { if (self.peer) self.peer.destroy(); } catch (e) {} };
    open(opts.id || randomId());
    return self;
  }

  /* ----- Téléphone : se connecte à l'iPad, avec reconnexion automatique ----- */
  // opts : onStatus('connecting'|'open'|'retry'), onOpen(), onMessage(msg), onClose(), onError(err)
  function joinHost(hostId, opts) {
    var self = { dead: false, open: false, conn: null }, peer = null, timer = null;
    function retry() {
      if (self.dead || timer) return;
      self.open = false;
      try { if (peer) peer.destroy(); } catch (e) {}
      if (opts.onStatus) opts.onStatus('retry');
      timer = setTimeout(function () { timer = null; start(); }, 2500);
    }
    function start() {
      if (self.dead) return;
      if (opts.onStatus) opts.onStatus('connecting');
      peer = mk();
      peer.on('open', function () {
        var conn = peer.connect(hostId, { reliable: true, serialization: 'json' });
        self.conn = conn;
        conn.on('open', function () { self.open = true; if (opts.onStatus) opts.onStatus('open'); if (opts.onOpen) opts.onOpen(); });
        conn.on('data', function (d) { if (opts.onMessage) opts.onMessage(d); });
        conn.on('close', function () { var was = self.open; self.open = false; if (was && opts.onClose) opts.onClose(); retry(); });
        conn.on('error', function () { retry(); });
      });
      peer.on('error', function (err) { if (opts.onError) opts.onError(err); retry(); });
      peer.on('disconnected', function () { /* le serveur de mise en relation n'est plus nécessaire une fois connecté */ });
    }
    self.send = function (msg) {
      if (!self.open || !self.conn) return false;
      try { self.conn.send(msg); return true; } catch (e) { return false; }
    };
    self.close = function () { self.dead = true; clearTimeout(timer); try { if (peer) peer.destroy(); } catch (e) {} };
    start();
    return self;
  }

  root.Net = { available: available, randomId: randomId, createHost: createHost, joinHost: joinHost };
})(typeof window !== 'undefined' ? window : this);
