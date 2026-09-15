/* ============================================================
   Suspect — game rules
   Pure functions only: no DOM, no network, no clock. Everything the
   game decides — which word, who scores, whether a clue is legal —
   lives here so it can be reasoned about and tested on its own.
   Runs in the browser (attaches to window) and under node (exports).
   ============================================================ */
(function (root) {
  "use strict";
  var DECK = root.SUSPECT_DECK || (typeof require === "function" ? require("./deck.node.js") : []);

/* ---------------------------------------------------------
   Rules — pure functions, all independently testable
   --------------------------------------------------------- */
var Rules = {
  /* Pick a word the room has not used yet, avoiding the previous
     category so consecutive rounds don't feel repetitive. */
  pickWord: function (used, lastCat, allowed) {
    var pool = [];
    var ok = function (c) { return !allowed || !allowed.length || allowed.indexOf(c) !== -1; };
    for (var c = 0; c < DECK.length; c++) {
      if (!ok(c)) continue;
      if (DECK.length > 1 && c === lastCat && Rules.catCount(allowed) > 1) continue;
      for (var w = 0; w < DECK[c].w.length; w++) {
        if (used.indexOf(c + ":" + w) === -1) pool.push([c, w]);
      }
    }
    if (!pool.length) {
      /* every word in the chosen packs is used — start them over */
      var cats = [];
      for (var i = 0; i < DECK.length; i++) if (ok(i)) cats.push(i);
      if (!cats.length) for (i = 0; i < DECK.length; i++) cats.push(i);
      c = cats[Math.floor(Math.random() * cats.length)];
      return { cat: c, word: Math.floor(Math.random() * DECK[c].w.length), wrapped: true };
    }
    var hit = pool[Math.floor(Math.random() * pool.length)];
    return { cat: hit[0], word: hit[1], wrapped: false };
  },

  /* Six options for a caught impostor: the real word plus five decoys
     from the same category, so the guess is a real read, not a coin flip. */
  guessOptions: function (catIdx, wordIdx) {
    var pool = [], i;
    for (i = 0; i < DECK[catIdx].w.length; i++) if (i !== wordIdx) pool.push(i);
    Rules.shuffle(pool);
    return Rules.shuffle(pool.slice(0, 5).concat([wordIdx]));
  },

  shuffle: function (a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  },

  /* Plurality vote. A tie means nobody is accused and the impostor walks. */
  tally: function (roster) {
    var counts = {}, i, p;
    for (i = 0; i < roster.length; i++) {
      p = roster[i];
      if (p.vote && p.vote !== "skip") counts[p.vote] = (counts[p.vote] || 0) + 1;
    }
    var top = 0, leaders = [];
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > top) { top = counts[k]; leaders = [k]; }
      else if (counts[k] === top) leaders.push(k);
    });
    return {
      counts: counts,
      top: top,
      accused: leaders.length === 1 ? leaders[0] : "",
      tie: leaders.length > 1
    };
  },

  /* Points for one round, as a map of playerId -> delta.
       impostor escapes .......... 3
       voted correctly, caught ... 2
       voted correctly, missed ... 1   (right read, wrong table)
       caught impostor guesses ... 2 if the guess is right       */
  score: function (roster, impostorIds, caughtId, guessRight) {
    var caught = !!caughtId, out = {};
    roster.forEach(function (p) {
      var isImp = impostorIds.indexOf(p.id) !== -1;
      var d = 0;
      if (isImp) {
        if (!caught || p.id !== caughtId) d = 3;
        else if (guessRight) d = 2;
      } else if (p.vote && impostorIds.indexOf(p.vote) !== -1) {
        d = caught ? 2 : 1;
      }
      out[p.id] = d;
    });
    return out;
  },

  /* Hebrew and English both normalise to a bare comparable form:
     niqqud, geresh, maqaf and case all stripped. */
  normalise: function (s) {
    return String(s || "")
      .replace(/[֑-ׇ]/g, "")
      .replace(/[׳״'"`’־–—-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  },

  /* Hebrew glues single-letter prefixes onto words — ה, ו, ב, ל, כ, מ, ש —
     so "סדר" and "הסדר" are the same word for our purposes. Compare both
     the written form and the form with that prefix removed. */
  forms: function (w) {
    var out = [w];
    if (w.length >= 4 && "הובלכמש".indexOf(w.charAt(0)) !== -1) out.push(w.slice(1));
    return out;
  },

  /* Same word, or an inflection of it. A different word that merely starts
     the same way (קול / קולנוע, cat / catalogue) is fair play. */
  tooClose: function (a, b) {
    var fa = Rules.forms(a), fb = Rules.forms(b), i, j, x, y;
    for (i = 0; i < fa.length; i++) for (j = 0; j < fb.length; j++) {
      x = fa[i]; y = fb[j];
      if (x === y) return true;
      if (x.length >= 3 && Math.abs(x.length - y.length) <= 2 &&
          (x.indexOf(y) === 0 || y.indexOf(x) === 0)) return true;
    }
    return false;
  },

  /* A clue must be one word, and for anyone holding the secret word it must
     not be that word or a piece of it. The impostor is never checked — they
     have nothing to give away. */
  checkClue: function (raw, secret, isImpostor) {
    var v = String(raw || "").trim();
    if (!v) return { ok: false, quiet: true };
    if (/\s/.test(v)) return { ok: false, key: "errOneWord" };
    if (v.replace(/[\u0591-\u05C7]/g, "").length < 2) return { ok: false, key: "errTooShort" };
    if (!isImpostor) {
      var n = Rules.normalise(v);
      var parts = Rules.normalise(secret).split(" ");
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && Rules.tooClose(parts[i], n)) return { ok: false, key: "errIsWord" };
      }
    }
    return { ok: true, value: v.slice(0, 22) };
  },

  /* Impostors need a crowd to hide in. One is right for a small table;
     a second becomes possible once there are seven, and a third at ten —
     beyond that the clues get too noisy to read. */
  maxImpostors: function (n) {
    if (n >= 10) return 3;
    if (n >= 7) return 2;
    return 1;
  },

  /* The table size at which each impostor count unlocks, for the lobby note. */
  impostorsUnlockAt: function (count) { return count >= 3 ? 10 : (count >= 2 ? 7 : 0); },

  /* Coming back to a room you were already in — a refresh, a dropped phone,
     a second tab — keeps your standing. Only the name can change. */
  rejoin: function (prev, fresh) {
    if (!prev) return fresh;
    var out = {}, k;
    for (k in fresh) if (Object.prototype.hasOwnProperty.call(fresh, k)) out[k] = fresh[k];
    out.score = prev.score || 0;
    out.joinedAt = prev.joinedAt || fresh.joinedAt;
    out.inRound = !!prev.inRound;
    out.ready = !!prev.ready;
    out.clue = prev.clue || "";
    out.clue2 = prev.clue2 || "";
    out.vote = prev.vote || "";
    out.delta = prev.delta == null ? null : prev.delta;
    out.seatRound = prev.seatRound || 0;
    return out;
  },

  /* How many categories the chosen packs actually cover. */
  catCount: function (allowed) {
    if (!allowed || !allowed.length) return DECK.length;
    return allowed.length;
  },

  /* Category indices covered by a list of pack ids. An empty choice means
     the whole deck, so a table that turns everything off still plays. */
  catsForPacks: function (packIds, packs) {
    packs = packs || (typeof window !== "undefined" ? window.SUSPECT_PACKS : null) || [];
    if (!packIds || !packIds.length) return [];
    var wanted = {};
    packs.forEach(function (p) {
      if (packIds.indexOf(p.id) === -1) return;
      p.cats.forEach(function (c) { wanted[c] = true; });
    });
    var out = [];
    for (var i = 0; i < DECK.length; i++) if (wanted[DECK[i].id]) out.push(i);
    return out;
  },

  /* How many words a pack choice puts in play — shown in the lobby. */
  wordsAvailable: function (allowed) {
    var n = 0;
    for (var i = 0; i < DECK.length; i++) {
      if (!allowed || !allowed.length || allowed.indexOf(i) !== -1) n += DECK[i].w.length;
    }
    return n;
  },

  code: function () {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  }
};

  root.SUSPECT_RULES = Rules;
  if (typeof module === "object" && module.exports) module.exports = Rules;
})(typeof window !== "undefined" ? window : globalThis);
