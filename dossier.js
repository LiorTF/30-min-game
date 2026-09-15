/* ============================================================
   Suspect — the dossier
   What the table remembers about itself, from one night to the next.

   A party game is played once. A party game that keeps a record of who
   always suspects whom, who has never once been caught, and what the best
   lie of the year was, gets played for years — because every vote is now
   also a small entry in a family argument that has been running since
   March.

   Players are identified by NAME, because that is the only thing that
   survives a new phone, a new tab and a new night. Two people sharing a
   name share a record; at a family table that is a feature more often
   than a bug.

   Everything here is pure except load/save, which are a thin wrapper over
   the host device's local storage. The dossier travels with whoever opens
   the rooms.
   ============================================================ */
(function (root) {
  "use strict";

  var HISTORY_CAP = 60;
  var VERSION = 1;

  function blankPlayer(name) {
    return {
      name: name,
      nights: 0, rounds: 0, points: 0,
      impostorRounds: 0, caught: 0, escaped: 0,
      escapeStreak: 0, bestEscapeStreak: 0,
      votesCast: 0, votesCorrect: 0,
      accusedTimes: 0,
      votedFor: {},      /* name -> how often this player accused them */
      accusedBy: {},     /* name -> how often they accused this player */
      roles: {},
      bestBluff: null    /* { clue, word, fooled, night } */
    };
  }

  function ensure(dossier, name) {
    if (!dossier.players[name]) dossier.players[name] = blankPlayer(name);
    return dossier.players[name];
  }
  function bump(map, key) { if (key) map[key] = (map[key] || 0) + 1; }

  var Dossier = {
    VERSION: VERSION,

    blank: function (table) {
      return {
        v: VERSION,
        table: table || "",
        nights: 0,
        lastPlayed: 0,
        players: {},
        history: [],
        records: {}
      };
    },

    /* A night begins: everyone at the table gets a tally mark. */
    openNight: function (dossier, names) {
      var d = Dossier.clone(dossier);
      d.nights = (d.nights || 0) + 1;
      d.lastPlayed = Date.now();
      (names || []).forEach(function (n) { ensure(d, n).nights += 1; });
      return d;
    },

    clone: function (d) { return JSON.parse(JSON.stringify(d)); },

    /* Fold one finished round into the record. Pure: returns a new dossier. */
    record: function (dossier, round) {
      var d = Dossier.clone(dossier);
      var seats = round.seats || [];
      var roleById = round.roleById || {};
      var impostorIds = round.impostorIds || [];
      var nameById = {};
      seats.forEach(function (s) { nameById[s.id] = s.name; });

      var impostorNames = impostorIds.map(function (id) { return nameById[id]; }).filter(Boolean);
      var accusedName = nameById[round.accusedId] || "";

      seats.forEach(function (s) {
        var p = ensure(d, s.name);
        var role = roleById[s.id] || "innocent";
        var isImpostor = impostorIds.indexOf(s.id) !== -1;

        p.rounds += 1;
        p.points += (s.delta || 0);
        bump(p.roles, role);

        if (isImpostor) {
          p.impostorRounds += 1;
          if (round.outcome === "caught" && round.caughtId === s.id) {
            p.caught += 1;
            p.escapeStreak = 0;
          } else {
            p.escaped += 1;
            p.escapeStreak += 1;
            if (p.escapeStreak > p.bestEscapeStreak) p.bestEscapeStreak = p.escapeStreak;

            /* the lie that worked: how many of the innocents it steered away */
            var fooled = seats.filter(function (o) {
              return impostorIds.indexOf(o.id) === -1 && o.vote && o.vote !== s.id;
            }).length;
            var clue = [s.clue, s.clue2].filter(Boolean).join(" · ");
            if (clue && (!p.bestBluff || fooled > p.bestBluff.fooled)) {
              p.bestBluff = { clue: clue, word: round.word, fooled: fooled, night: d.nights };
            }
          }
        }

        if (s.vote && s.vote !== "skip") {
          p.votesCast += 1;
          if (impostorIds.indexOf(s.vote) !== -1) p.votesCorrect += 1;
          var target = nameById[s.vote];
          if (target && target !== s.name) {
            bump(p.votedFor, target);
            bump(ensure(d, target).accusedBy, s.name);
          }
        }
        if (accusedName === s.name) p.accusedTimes += 1;
      });

      d.history.push({
        night: d.nights,
        round: round.round,
        word: round.word,
        impostors: impostorNames,
        accused: accusedName,
        outcome: round.outcome
      });
      if (d.history.length > HISTORY_CAP) d.history = d.history.slice(-HISTORY_CAP);

      /* records worth bragging about */
      var votesOnAccused = seats.filter(function (s) { return s.vote === round.accusedId; }).length;
      if (round.outcome === "caught" &&
          (!d.records.mostUnanimous || votesOnAccused > d.records.mostUnanimous.votes)) {
        d.records.mostUnanimous = { name: accusedName, votes: votesOnAccused, of: seats.length };
      }
      var longest = null;
      Object.keys(d.players).forEach(function (n) {
        var p = d.players[n];
        if (!longest || p.bestEscapeStreak > longest.streak) longest = { name: n, streak: p.bestEscapeStreak };
      });
      if (longest && longest.streak > 0) d.records.longestEscape = longest;

      return d;
    },

    /* Standing titles. Each is earned, not given: the thresholds keep them
       meaningful on a table that has only played twice. */
    titles: function (dossier) {
      var players = Object.keys(dossier.players).map(function (n) { return dossier.players[n]; });
      var out = [];
      var best = function (list, score) {
        var top = null;
        list.forEach(function (p) {
          var v = score(p);
          if (v == null) return;
          if (!top || v > top.value) top = { player: p, value: v };
        });
        return top;
      };

      var snake = best(players, function (p) {
        return p.bestEscapeStreak >= 3 ? p.bestEscapeStreak : null;
      });
      if (snake) out.push({ key: "snake", name: snake.player.name, value: snake.value });

      var detective = best(players, function (p) {
        return p.votesCast >= 6 ? Math.round(p.votesCorrect / p.votesCast * 100) : null;
      });
      if (detective && detective.value >= 50) {
        out.push({ key: "detective", name: detective.player.name, value: detective.value });
      }

      var glass = best(players, function (p) {
        if (p.impostorRounds < 3) return null;
        var rate = p.caught / p.impostorRounds;
        return rate >= 0.75 ? Math.round(rate * 100) : null;
      });
      if (glass) out.push({ key: "glass", name: glass.player.name, value: glass.value });

      var ghost = best(players, function (p) {
        return p.rounds >= 6 ? Math.round((1 - p.accusedTimes / p.rounds) * 100) : null;
      });
      if (ghost && ghost.value >= 80) out.push({ key: "ghost", name: ghost.player.name, value: ghost.value });

      var fool = best(players, function (p) {
        return (p.roles && p.roles.jester) ? p.roles.jester : null;
      });
      if (fool && fool.value >= 2) out.push({ key: "jester", name: fool.player.name, value: fool.value });

      var rich = best(players, function (p) { return p.rounds >= 6 ? p.points : null; });
      if (rich) out.push({ key: "veteran", name: rich.player.name, value: rich.value });

      return out;
    },

    /* The most one-sided suspicion at the table: "she always votes for you". */
    nemesis: function (dossier) {
      var top = null;
      Object.keys(dossier.players).forEach(function (name) {
        var p = dossier.players[name];
        Object.keys(p.votedFor || {}).forEach(function (target) {
          var n = p.votedFor[target];
          if (n >= 3 && (!top || n > top.count)) top = { from: name, to: target, count: n };
        });
      });
      return top;
    },

    /* One line for the verdict screen, drawn from everything the table has
       ever done. Returned as a key plus values so it reads in either
       language. Ordered by how much it will make somebody shout. */
    note: function (dossier, round) {
      var seats = round.seats || [];
      var nameById = {};
      seats.forEach(function (s) { nameById[s.id] = s.name; });

      if (round.outcome === "jester") {
        return { key: "noteJester", name: nameById[round.accusedId] || "" };
      }

      /* a run of escapes is the best story in the game */
      var runner = null;
      (round.impostorIds || []).forEach(function (id) {
        var name = nameById[id];
        var p = name && dossier.players[name];
        if (p && p.escapeStreak >= 2 && (!runner || p.escapeStreak > runner.streak)) {
          runner = { name: name, streak: p.escapeStreak };
        }
      });
      if (runner) return { key: "noteStreak", name: runner.name, n: runner.streak };

      /* a first catch after a run of getting away with it */
      if (round.outcome === "caught") {
        var caughtName = nameById[round.caughtId];
        var cp = caughtName && dossier.players[caughtName];
        if (cp && cp.impostorRounds >= 3 && cp.caught === cp.impostorRounds) {
          return { key: "noteNeverWins", name: caughtName, n: cp.impostorRounds };
        }
      }

      /* the long-running grudge */
      var grudge = null;
      seats.forEach(function (s) {
        if (!s.vote || s.vote === "skip") return;
        var target = nameById[s.vote];
        var p = dossier.players[s.name];
        if (!p || !target) return;
        var n = (p.votedFor || {})[target] || 0;
        if (n >= 3 && (!grudge || n > grudge.n)) grudge = { from: s.name, to: target, n: n };
      });
      if (grudge) return { key: "noteGrudge", from: grudge.from, to: grudge.to, n: grudge.n };

      return null;
    },

    /* ---------- persistence (host device only) ---------- */

    key: function (table) {
      return "suspect.dossier." + String(table || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    },

    load: function (table) {
      try {
        var raw = root.localStorage.getItem(Dossier.key(table));
        if (!raw) return Dossier.blank(table);
        var parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== VERSION) return Dossier.blank(table);
        parsed.table = table;
        return parsed;
      } catch (e) { return Dossier.blank(table); }
    },

    save: function (dossier) {
      try {
        root.localStorage.setItem(Dossier.key(dossier.table), JSON.stringify(dossier));
        return true;
      } catch (e) { return false; }
    },

    /* Every table this device has hosted, most recent first. */
    tables: function () {
      var out = [];
      try {
        for (var i = 0; i < root.localStorage.length; i++) {
          var k = root.localStorage.key(i);
          if (k && k.indexOf("suspect.dossier.") === 0) {
            var d = JSON.parse(root.localStorage.getItem(k));
            if (d && d.v === VERSION) out.push({ table: d.table, nights: d.nights, lastPlayed: d.lastPlayed });
          }
        }
      } catch (e) {}
      return out.sort(function (a, b) { return (b.lastPlayed || 0) - (a.lastPlayed || 0); });
    }
  };

  root.SUSPECT_DOSSIER = Dossier;
  if (typeof module === "object" && module.exports) module.exports = Dossier;
})(typeof window !== "undefined" ? window : globalThis);
