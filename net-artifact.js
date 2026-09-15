/* ============================================================
   Suspect — transport: Claude artifact database
   Implements the Store interface on top of the artifact `db`
   capability. Every player writes their own seat; the host alone
   writes the room. Available only inside the artifact host.
   ============================================================ */
(function (root) {
  "use strict";
  var Rules = root.SUSPECT_RULES;

  function seatsOf(q) {
    return q.docs.map(function (d) {
      var o = d.data() || {};
      o.id = o.id || d.id;
      return o;
    }).sort(function (a, b) { return (a.joinedAt || 0) - (b.joinedAt || 0); });
  }

  var Net = {
    kind: "artifact",
    /* the database outlives any one player, so the host role can move */
    takeover: true,
    code: null,

    db: null,
    _subs: [],
    _room: null,
    _seats: [],
    _cb: null,
    _fatal: null,

    connect: function () {
      var self = this;
      if (!(root.claude && root.claude.use)) return Promise.resolve(false);
      return root.claude.use("db").then(
        function (d) { self.db = d; return !!d; },
        function () { return false; }
      );
    },

    /* Deliver what we already hold the moment someone subscribes: a snapshot
       that arrived before the game was listening must not be lost. */
    onChange: function (fn) {
      this._cb = fn;
      if (fn && (this._room || this._seats.length)) this._emit();
    },
    onFatal: function (fn) { this._fatal = fn; },

    _doc: function (code) { return this.db.doc("rooms/" + (code || this.code)); },
    _col: function (code) { return this.db.collection("rooms/" + (code || this.code) + "/players"); },

    _emit: function () { if (this._cb) this._cb(this._room, this._seats); },

    _watch: function (code) {
      var self = this;
      this._unwatch();
      this.code = code;
      this._subs.push(this._doc(code).onSnapshot(function (s) {
        self._room = s.exists ? s.data() : null;
        self._emit();
      }));
      this._subs.push(this._col(code).onSnapshot(function (q) {
        self._seats = seatsOf(q);
        self._emit();
      }));
    },

    _unwatch: function () {
      this._subs.forEach(function (u) { try { u(); } catch (e) {} });
      this._subs = [];
    },

    open: function (roomData, seat) {
      var self = this, code = Rules.code();
      roomData.code = code;
      return this._doc(code).set(roomData)
        .then(function () { return self._col(code).doc(seat.id).set(seat); })
        .then(function () { self._watch(code); return code; });
    },

    join: function (code, seat) {
      var self = this;
      return this._doc(code).get().then(function (snap) {
        if (!snap.exists) throw new Error("noroom");
        return self._col(code).doc(seat.id).get();
      }).then(function (mine) {
        return self._col(code).doc(seat.id).set(Rules.rejoin(mine.exists ? mine.data() : null, seat));
      }).then(function () {
        self._watch(code);
      });
    },

    leave: function (id) {
      if (this.db && this.code && id) this._col().doc(id)["delete"]()["catch"](function () {});
      this._unwatch();
      this.code = null;
      this._room = null;
      this._seats = [];
    },

    updateRoom: function (patch) { return this._doc().update(patch)["catch"](function () {}); },
    updateSeat: function (id, patch) { return this._col().doc(id).update(patch)["catch"](function () {}); },
    removeSeat: function (id) { return this._col().doc(id)["delete"]()["catch"](function () {}); }
  };

  root.SUSPECT_NET_ARTIFACT = Net;
})(typeof window !== "undefined" ? window : globalThis);
