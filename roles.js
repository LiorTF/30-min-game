/* ============================================================
   Suspect — roles
   Pure functions: who is dealt what, and what a round is worth.

   The base game has one asymmetry — impostor or not — and that is why a
   fifth round feels like the first. These roles add more ways to be at the
   table without adding rules to remember: every one of them is a single
   sentence on your own card, and none of them adds a decision to the round.

     impostor    you do not have the word
     confused    you have the WRONG word, and you do not know it
     witness     you know that one named player is not an impostor
     accomplice  you know who the impostors are; you win when they do
     jester      you win by being voted out
     innocent    you have the word

   Roles unlock with table size, so a small table stays simple.
   ============================================================ */
(function (root) {
  "use strict";
  var Rules = root.SUSPECT_RULES;

  /* Which side a role scores with. "self" wins alone. */
  var SIDE = {
    impostor: "impostor",
    accomplice: "impostor",
    confused: "town",
    witness: "town",
    innocent: "town",
    jester: "self"
  };

  /* The table size at which each extra role starts appearing. Below these,
     the round is plain — a game of four should not need a glossary. */
  var UNLOCK = { confused: 5, jester: 7, witness: 8, accomplice: 9 };

  /* Role sets by the host's setting. */
  var MODES = {
    off: [],
    light: ["confused"],
    full: ["confused", "jester", "witness", "accomplice"]
  };

  var Roles = {
    SIDE: SIDE,
    UNLOCK: UNLOCK,
    MODES: MODES,

    side: function (role) { return SIDE[role] || "town"; },

    /* Which extras this table can actually field right now. */
    available: function (playerCount, mode) {
      var wanted = MODES[mode] || [];
      return wanted.filter(function (role) { return playerCount >= UNLOCK[role]; });
    },

    /* Deal the round. `shuffle` is injectable so tests can be deterministic. */
    assign: function (ids, opts, shuffle) {
      shuffle = shuffle || Rules.shuffle;
      opts = opts || {};
      var impostorCount = Math.max(1, Math.min(opts.impostors || 1, ids.length - 1));
      var order = shuffle(ids.slice());

      var out = {
        roleById: {},
        impostorIds: order.slice(0, impostorCount),
        confusedId: "",
        jesterId: "",
        witnessId: "",
        witnessClearedId: "",
        accompliceId: ""
      };
      order.forEach(function (id) { out.roleById[id] = "innocent"; });
      out.impostorIds.forEach(function (id) { out.roleById[id] = "impostor"; });

      var pool = order.slice(impostorCount);          /* everyone not an impostor */
      var extras = Roles.available(ids.length, opts.roleMode || "off");
      var next = 0;
      extras.forEach(function (role) {
        if (next >= pool.length) return;
        var id = pool[next++];
        out.roleById[id] = role;
        if (role === "confused") out.confusedId = id;
        if (role === "jester") out.jesterId = id;
        if (role === "witness") out.witnessId = id;
        if (role === "accomplice") out.accompliceId = id;
      });

      /* The witness is told one player who is genuinely on the town's side,
         so the tip is never quietly a lie. */
      if (out.witnessId) {
        var clean = order.filter(function (id) {
          return id !== out.witnessId && SIDE[out.roleById[id]] === "town";
        });
        out.witnessClearedId = clean.length ? clean[Math.floor(Math.random() * clean.length)] : "";
        if (!out.witnessClearedId) {                   /* nobody to vouch for */
          out.roleById[out.witnessId] = "innocent";
          out.witnessId = "";
        }
      }

      /* An accomplice with nobody to be complicit with is just an innocent. */
      if (out.accompliceId && !out.impostorIds.length) {
        out.roleById[out.accompliceId] = "innocent";
        out.accompliceId = "";
      }
      return out;
    },

    /* What the table did, in one word:
         jester   — the table voted out someone who wanted exactly that
         caught   — the accused is an impostor
         escaped  — nobody was accused, or the wrong person was      */
    outcome: function (accusedId, impostorIds, jesterId) {
      if (accusedId && jesterId && accusedId === jesterId) return "jester";
      if (accusedId && impostorIds.indexOf(accusedId) !== -1) return "caught";
      return "escaped";
    },

    /* Points for one round, as playerId -> delta.

         impostor escapes ............ 3
         impostor caught, guesses the word ... 2
         accomplice, impostors escape ....... 2
         voted for an impostor, table caught one ... 2
         voted for an impostor, table missed ...... 1
         confused, survived the vote ........ 2
         jester, voted out .................. 4  (and the impostors take 2)

       `double` doubles the whole round — used by the last trial. */
    score: function (ctx) {
      var roster = ctx.roster || [];
      var roleById = ctx.roleById || {};
      var impostorIds = ctx.impostorIds || [];
      var outcome = ctx.outcome;
      var caughtId = ctx.caughtId || "";
      var accusedId = ctx.accusedId || "";
      var deltas = {};

      var roleOf = function (id) { return roleById[id] || "innocent"; };
      var votedImpostor = function (p) { return p.vote && impostorIds.indexOf(p.vote) !== -1; };

      roster.forEach(function (p) {
        var role = roleOf(p.id);
        var d = 0;

        if (outcome === "jester") {
          /* the table fell for it: the jester takes the round, and the
             impostors are left standing because nobody looked at them */
          if (role === "jester") d = 4;
          else if (role === "impostor") d = 2;

        } else if (outcome === "caught") {
          if (role === "impostor") d = (p.id === caughtId) ? (ctx.guessRight ? 2 : 0) : 3;
          else if (role === "accomplice") d = 0;
          else {
            if (votedImpostor(p)) d = 2;
            if (role === "confused" && p.id !== accusedId) d += 2;
          }

        } else {   /* escaped */
          if (role === "impostor") d = 3;
          else if (role === "accomplice") d = 2;
          else {
            if (votedImpostor(p)) d = 1;
            if (role === "confused" && p.id !== accusedId) d += 2;
          }
        }

        deltas[p.id] = ctx.double ? d * 2 : d;
      });

      return deltas;
    }
  };

  root.SUSPECT_ROLES = Roles;
  if (typeof module === "object" && module.exports) module.exports = Roles;
})(typeof window !== "undefined" ? window : globalThis);
