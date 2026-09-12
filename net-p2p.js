/* ============================================================
   Suspect — transport: peer to peer
   Implements the Store interface over WebRTC, so the game runs on any
   plain web address with no server, no database and no accounts.

   The player who opens the room IS the server: their browser holds the
   only copy of the room and broadcasts it after every change. Everyone
   else sends their moves to that browser. Only a signalling broker is
   needed to introduce the peers, and after the introduction the data
   goes directly between the phones.

   The room code doubles as the host's peer id, so joining needs nothing
   but the four characters.

   Pass ?peer=host:port:0 to point at your own broker (the trailing 0
   means plain ws rather than wss); used by the tests.
   ============================================================ */
(function (root) {
  "use strict";
  var Rules = root.SUSPECT_RULES;

  var NAMESPACE = "suspect-v1-";   /* keeps our ids clear of other apps on the public broker */
  var JOIN_TIMEOUT = 15000;
  var OPEN_TIMEOUT = 12000;
  var PING_EVERY = 7000;           /* the host says it is still there */
  var SILENCE_LIMIT = 21000;       /* after this much quiet, the guest gives up */

  function brokerOptions() {
    var m = (root.location && root.location.search || "").match(/[?&]peer=([^&]+)/);
    if (!m) return undefined;                       /* undefined = the public broker */
    var parts = decodeURIComponent(m[1]).split(":");
    return {
      host: parts[0],
      port: parseInt(parts[1] || "443", 10),
      path: "/",
      secure: parts[2] !== "0"
    };
  }

  function assign(target, patch) {
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) target[k] = patch[k];
    return target;
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  var Net = {
    kind: "p2p",
    /* the room lives in the host's browser, so it cannot be handed on */
    takeover: false,
    code: null,

    peer: null,
    hosting: false,
    conns: [],          /* host: one per guest */
    hostConn: null,     /* guest: the line to the host */
    state: { room: null, seats: {} },

    _cb: null,
    _fatal: null,
    _me: null,

    connect: function () { return Promise.resolve(!!root.Peer); },
    onChange: function (fn) { this._cb = fn; },
    onFatal: function (fn) { this._fatal = fn; },

    _seatList: function () {
      var seats = this.state.seats, out = [], k;
      for (k in seats) if (Object.prototype.hasOwnProperty.call(seats, k)) out.push(seats[k]);
      return out.sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); });
    },

    /* Hand the new state to the game on a fresh turn of the loop. Applying a
       change and telling the game about it in the same breath would re-enter
       the caller from inside its own write. */
    _emit: function () {
      var self = this;
      if (!this._cb || this._pending) return;
      this._pending = true;
      Promise.resolve().then(function () {
        self._pending = false;
        if (self._cb) self._cb(self.state.room, self._seatList());
      });
    },

    _broadcast: function () {
      var msg = { t: "state", room: this.state.room, seats: this.state.seats };
      this.conns.forEach(function (c) {
        if (c.open) { try { c.send(msg); } catch (e) {} }
      });
      this._emit();
    },

    /* ---------- host ---------- */

    /* Ask the broker for the id that matches a room code. A code already in
       use means a live room elsewhere, so try another one. */
    _claimId: function (tries) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var code = Rules.code();
        var peer = new root.Peer(NAMESPACE + code, brokerOptions());
        var settled = false;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          try { peer.destroy(); } catch (e) {}
          reject(new Error("broker"));
        }, OPEN_TIMEOUT);

        peer.on("open", function () {
          if (settled) return;
          settled = true; clearTimeout(timer);
          resolve({ peer: peer, code: code });
        });
        peer.on("error", function (err) {
          if (settled) return;
          settled = true; clearTimeout(timer);
          try { peer.destroy(); } catch (e) {}
          if (err && err.type === "unavailable-id" && tries > 0) resolve(self._claimId(tries - 1));
          else reject(new Error(err && err.type === "unavailable-id" ? "taken" : "broker"));
        });
      });
    },

    open: function (roomData, seat) {
      var self = this;
      return this._claimId(5).then(function (got) {
        self.peer = got.peer;
        self.hosting = true;
        self.code = got.code;
        self._me = seat.id;
        roomData.code = got.code;
        self.state = { room: roomData, seats: {} };
        self.state.seats[seat.id] = seat;

        self.peer.on("connection", function (conn) { self._accept(conn); });
        self.peer.on("error", function () { /* a single failed guest must not end the room */ });

        /* A browser that is simply closed does not always drop its data
           channels in any useful time, so the room announces itself instead
           and a guest that stops hearing it knows the room has gone. */
        clearInterval(self._pulse);
        self._pulse = setInterval(function () {
          self.conns.forEach(function (c) {
            if (c.open) { try { c.send({ t: "ping" }); } catch (e) {} }
          });
        }, PING_EVERY);

        self._emit();
        return got.code;
      });
    },

    _accept: function (conn) {
      var self = this;
      conn.on("open", function () { self.conns.push(conn); });
      conn.on("data", function (msg) { self._fromGuest(conn, msg); });
      conn.on("close", function () {
        self.conns = self.conns.filter(function (c) { return c !== conn; });
        self._broadcast();
      });
      conn.on("error", function () {});
    },

    /* Everything a guest may ask for. A guest can only touch its own seat:
       the seat id is fixed at hello and checked on every later message. */
    _fromGuest: function (conn, msg) {
      if (!msg || !this.state.room) return;
      if (msg.t === "hello" && msg.seat && msg.seat.id) {
        conn.player = msg.seat.id;
        this.state.seats[msg.seat.id] = Rules.rejoin(this.state.seats[msg.seat.id] || null, msg.seat);
        this._broadcast();
        return;
      }
      if (!conn.player) return;
      if (msg.t === "room" && msg.patch) {
        assign(this.state.room, msg.patch);
        this._broadcast();
      } else if (msg.t === "seat" && msg.patch && msg.id === conn.player) {
        if (this.state.seats[msg.id]) {
          assign(this.state.seats[msg.id], msg.patch);
          this._broadcast();
        }
      } else if (msg.t === "bye" && this.state.seats[conn.player]) {
        delete this.state.seats[conn.player];
        this._broadcast();
      }
    },

    /* ---------- guest ---------- */

    join: function (code, seat) {
      var self = this;
      this._me = seat.id;
      return new Promise(function (resolve, reject) {
        var peer = new root.Peer(undefined, brokerOptions());
        var settled = false;
        var fail = function (why) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { peer.destroy(); } catch (e) {}
          reject(new Error(why));
        };
        var timer = setTimeout(function () { fail("timeout"); }, JOIN_TIMEOUT);

        peer.on("error", function (err) {
          fail(err && err.type === "peer-unavailable" ? "noroom" : "broker");
        });

        peer.on("open", function () {
          var conn = peer.connect(NAMESPACE + code, { reliable: true });
          conn.on("open", function () { conn.send({ t: "hello", seat: seat }); });
          conn.on("data", function (msg) {
            self._heard = Date.now();
            if (!msg || msg.t !== "state") return;
            self.state.room = msg.room;
            self.state.seats = msg.seats || {};
            self._emit();
            if (!settled && self.state.seats[seat.id]) {
              settled = true;
              clearTimeout(timer);
              self.peer = peer;
              self.hostConn = conn;
              self.code = code;
              self._heard = Date.now();
              clearInterval(self._watch);
              self._watch = setInterval(function () {
                if (Date.now() - self._heard < SILENCE_LIMIT) return;
                clearInterval(self._watch);
                self._watch = null;
                if (self._fatal) self._fatal("hostLeft");
              }, 3000);
              resolve();
            }
          });
          conn.on("close", function () {
            if (!settled) return fail("noroom");
            clearInterval(self._watch); self._watch = null;
            if (self._fatal) self._fatal("hostLeft");
          });
          conn.on("error", function () { fail("noroom"); });
        });
      });
    },

    /* ---------- shared ---------- */

    _send: function (msg) {
      if (this.hostConn && this.hostConn.open) {
        try { this.hostConn.send(msg); } catch (e) {}
      }
    },

    updateRoom: function (patch) {
      if (this.hosting) {
        if (this.state.room) { assign(this.state.room, clone(patch)); this._broadcast(); }
      } else {
        this._send({ t: "room", patch: patch });
      }
      return Promise.resolve();
    },

    updateSeat: function (id, patch) {
      if (this.hosting) {
        if (this.state.seats[id]) { assign(this.state.seats[id], clone(patch)); this._broadcast(); }
      } else if (id === this._me) {
        this._send({ t: "seat", id: id, patch: patch });
      }
      return Promise.resolve();
    },

    removeSeat: function (id) {
      if (this.hosting) {
        delete this.state.seats[id];
        this._broadcast();
      } else if (id === this._me) {
        this._send({ t: "bye" });
      }
      return Promise.resolve();
    },

    leave: function () {
      clearInterval(this._pulse); this._pulse = null;
      clearInterval(this._watch); this._watch = null;
      if (!this.hosting) this._send({ t: "bye" });
      try { if (this.peer) this.peer.destroy(); } catch (e) {}
      this.peer = null;
      this.hostConn = null;
      this.conns = [];
      this.hosting = false;
      this.code = null;
      this.state = { room: null, seats: {} };
    }
  };

  root.SUSPECT_NET_P2P = Net;
})(typeof window !== "undefined" ? window : globalThis);
