/* ============================================================
   Suspect — game client
   Layers, top to bottom:
     Prefs   local device preferences (name, language, identity)
     Rules   pure game logic; no network, no DOM
     Net     the realtime store and this client's subscriptions
     Host    the phase machine — only the host runs it
     View    markup per phase
     App     state, painting, event binding
   ============================================================ */
(function () {
  "use strict";

  var root = window;
  var DECK = window.SUSPECT_DECK;
  var I18N = window.SUSPECT_I18N;

  /* ---------------------------------------------------------
     Prefs
     --------------------------------------------------------- */
  var Prefs = (function () {
    function safe(kind) {
      try {
        var s = window[kind];
        s.setItem("__s", "1"); s.removeItem("__s");
        return s;
      } catch (e) { return null; }
    }
    var local = safe("localStorage"), tab = safe("sessionStorage");
    function get(k, d) { try { var v = local && local.getItem("suspect." + k); return v == null ? d : v; } catch (e) { return d; } }
    function set(k, v) { try { local && local.setItem("suspect." + k, v); } catch (e) {} }

    /* Identity is per TAB, not per browser. Two windows of the same game are
       two players — which is how one person tries the game out before the
       table arrives — and a refresh still returns to the same seat. */
    var id = null;
    try { id = tab && tab.getItem("suspect.id"); } catch (e) {}
    if (!id) {
      id = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { tab && tab.setItem("suspect.id", id); } catch (e) {}
    }
    return { get: get, set: set, id: id };
  })();
  var Rules = window.SUSPECT_RULES;

  /* ---------------------------------------------------------
     Store — the transport in use.
     Two are available and they present the same small interface:
       net-artifact.js  the Claude artifact database, when the page is
                        running inside the artifact host
       net-p2p.js       peer to peer, for the same game served from any
                        ordinary web address with no account and no server
     The page picks whichever one this environment can actually run.
     --------------------------------------------------------- */
  var AWAY_MS = 90000;      /* how long a phone can be quiet before it reads as away */
  var Store = null;

  function pickTransport() {
    var artifact = root.SUSPECT_NET_ARTIFACT, p2p = root.SUSPECT_NET_P2P;
    var tryOne = function (net) {
      if (!net) return Promise.resolve(null);
      return net.connect().then(function (ok) { return ok ? net : null; }, function () { return null; });
    };
    return tryOne(artifact).then(function (won) { return won || tryOne(p2p); });
  }

  /* ---------------------------------------------------------
     App state
     --------------------------------------------------------- */
  var S = {
    lang: Prefs.get("lang", "he") === "en" ? "en" : "he",
    name: Prefs.get("name", ""),
    view: "home",          /* home | room */
    room: null,
    seats: [],
    seatedOnce: false,
    joinCode: "",
    error: "",
    clueError: "",
    clueDraft: "",
    clueFor: 0,            /* which clue round the draft belongs to */
    busy: false,
    copied: false,
    held: false,           /* card is being held open */
    pendingPaint: false,
    lastSig: ""
  };

  function T() { return I18N[S.lang]; }
  function t(k) { return I18N[S.lang][k]; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function fill(s, n) { return String(s).replace("{n}", n); }

  /* roster helpers */
  function me() { for (var i = 0; i < S.seats.length; i++) if (S.seats[i].id === Prefs.id) return S.seats[i]; return null; }
  function seatOf(id) { for (var i = 0; i < S.seats.length; i++) if (S.seats[i].id === id) return S.seats[i]; return null; }
  function nameOf(id) { var p = seatOf(id); return p ? p.name : "—"; }
  function roster() { return S.seats.filter(function (p) { return p.inRound; }); }
  function isHost() { return !!S.room && S.room.hostId === Prefs.id; }
  function imps() { return (S.room && S.room.impostorIds) || []; }
  function amImpostor() { return imps().indexOf(Prefs.id) !== -1; }
  function away(p) { return Date.now() - (p.lastSeen || 0) > AWAY_MS; }
  function hostAway() {
    if (!S.room) return false;
    var h = seatOf(S.room.hostId);
    return !h || away(h);
  }
  /* The person who opened the room owns it: they can always take the controls
     back in one tap, and until they are plainly gone nobody else is offered
     them. Peer-to-peer rooms live inside the opener's browser, so there the
     role cannot move at all. */
  function amOwner() { return !!S.room && S.room.ownerId === Prefs.id; }
  function canClaim() {
    if (!S.room || isHost() || !Store || !Store.takeover) return false;
    if (amOwner()) return true;
    return hostAway();
  }
  /* Everyone still holding the round up. At four players you can see who it
     is across the table; at twelve you cannot, so name them. */
  function outstanding() {
    if (!S.room) return [];
    var r = S.room, list = roster();
    if (r.phase === "reveal") return list.filter(function (p) { return !p.ready; });
    if (r.phase === "clues") {
      var f = r.clueRound === 2 ? "clue2" : "clue";
      return list.filter(function (p) { return !(p[f] || "").trim(); });
    }
    if (r.phase === "vote") return list.filter(function (p) { return !p.vote; });
    return [];
  }
  function waitingLine() {
    var left = outstanding(), L = T();
    if (!left.length) return "";
    var shown = left.slice(0, 3).map(function (p) { return p.name; }).join(", ");
    if (left.length > 3) shown += " " + fill(L.andMore, left.length - 3);
    /* the label carries its own separator: Hebrew joins with a maqaf, English with a space */
    return '<p class="waitlist">' + esc(L.waitingOn) + esc(shown) + "</p>";
  }

  function settings() {
    var s = (S.room && S.room.settings) || {};
    return { impostors: s.impostors || 1, clueRounds: s.clueRounds || 2, target: s.target == null ? 12 : s.target };
  }
  function secret() {
    if (!S.room) return { cat: "", word: "" };
    var c = DECK[S.room.catIdx] || DECK[0];
    var w = c.w[S.room.wordIdx] || c.w[0];
    return { cat: c.c[S.lang], word: w[S.lang === "he" ? 0 : 1], raw: w };
  }
  function wordAt(i) {
    var c = DECK[S.room.catIdx] || DECK[0], w = c.w[i];
    return w ? w[S.lang === "he" ? 0 : 1] : "—";
  }
  function leader() {
    var top = 0;
    S.seats.forEach(function (p) { top = Math.max(top, p.score || 0); });
    return top;
  }
  /* Only crown a clear leader — marking everyone when the table is level
     says nothing. */
  function soleLeader() {
    var top = leader();
    if (!top) return null;
    var holders = S.seats.filter(function (p) { return (p.score || 0) === top; });
    return holders.length === 1 ? holders[0].id : null;
  }
  function matchOver() {
    var tgt = settings().target;
    return tgt > 0 && leader() >= tgt;
  }

  /* ---------------------------------------------------------
     Host — the phase machine. Only the host advances state, which
     keeps every transition single-writer and conflict-free.
     --------------------------------------------------------- */
  var Host = {
    lock: false,

    /* The seed state for a new room. The transport picks the code, claims it,
       and fills it in — a peer-to-peer room needs a code nobody else is on. */
    seed: function () {
      return {
        code: "", hostId: Prefs.id, ownerId: Prefs.id, createdAt: Date.now(),
        phase: "lobby", round: 0, clueRound: 1, match: 1,
        catIdx: 0, wordIdx: 0, impostorIds: [], options: [], order: [],
        guess: -1, caught: false, caughtId: "", accusedId: "", tie: false,
        settings: { impostors: 1, clueRounds: 2, target: 12 },
        used: [], lastCat: -1, log: [], scoredRound: -1
      };
    },

    startRound: function () {
      if (!isHost() || S.seats.length < 3) return;
      var r = S.room, cfg = settings();
      var pick = Rules.pickWord(r.used || [], r.lastCat);
      var used = pick.wrapped ? [] : (r.used || []).slice(-120);
      used.push(pick.cat + ":" + pick.word);

      var ids = Rules.shuffle(S.seats.map(function (p) { return p.id; }));
      var count = Math.min(cfg.impostors, Rules.maxImpostors(S.seats.length));
      var chosen = ids.slice(0, count);

      Promise.all(S.seats.map(function (p) {
        return Store.updateSeat(p.id, { ready: false, clue: "", clue2: "", vote: "", delta: null, inRound: true });
      })).then(function () {
        return Store.updateRoom({
          phase: "reveal", round: (r.round || 0) + 1, clueRound: 1,
          catIdx: pick.cat, wordIdx: pick.word, lastCat: pick.cat, used: used,
          impostorIds: chosen,
          options: Rules.guessOptions(pick.cat, pick.word),
          order: Rules.shuffle(S.seats.map(function (p) { return p.id; })),
          guess: -1, caught: false, caughtId: "", accusedId: "", tie: false
        });
      })["catch"](function () {});
    },

    /* Called on every snapshot. Advances the round when the table is ready.

       Every branch runs through go(), which takes the work as a function so
       the lock is set BEFORE anything is written. A transport that applies a
       write synchronously — the peer-to-peer one does — otherwise re-enters
       this machine from inside its own transition and settles the round twice. */
    tick: function () {
      if (!S.room || !isHost() || !Store || Host.lock) return;
      var r = S.room, list = roster(), cfg = settings();
      if (!list.length) return;
      var all = function (fn) { return list.every(fn); };
      var release = function () { Host.lock = false; };
      var go = function (work) {
        Host.lock = true;
        var p;
        try { p = work(); } catch (e) { release(); return; }
        if (p && p.then) p.then(release, release); else release();
      };

      if (r.phase === "reveal") {
        if (all(function (p) { return p.ready; })) {
          go(function () { return Store.updateRoom({ phase: "clues", clueRound: 1 }); });
        }

      } else if (r.phase === "clues") {
        var field = r.clueRound === 2 ? "clue2" : "clue";
        if (all(function (p) { return (p[field] || "").trim(); })) {
          if (cfg.clueRounds === 2 && r.clueRound === 1) {
            go(function () { return Store.updateRoom({ clueRound: 2 }); });
          } else {
            go(function () { return Store.updateRoom({ phase: "vote" }); });
          }
        }

      } else if (r.phase === "vote") {
        if (all(function (p) { return p.vote; })) {
          var v = Rules.tally(list);
          var caughtId = v.accused && imps().indexOf(v.accused) !== -1 ? v.accused : "";
          if (caughtId) {
            go(function () {
              return Store.updateRoom({
                phase: "guess", caught: true, caughtId: caughtId,
                accusedId: v.accused, tie: v.tie
              });
            });
          } else {
            if (r.scoredRound === r.round) return;
            go(function () { return Host.settle(list, "", false, { accusedId: v.accused, tie: v.tie }); });
          }
        }

      } else if (r.phase === "guess") {
        if (r.guess !== -1) {
          if (r.scoredRound === r.round) return;
          go(function () { return Host.settle(list, r.caughtId, r.guess === r.wordIdx, {}); });
        }
      }
    },

    /* Write the round's points, the log entry, and move to the verdict. */
    settle: function (list, caughtId, guessRight, extra) {
      var r = S.room;
      if (r.scoredRound === r.round) return Promise.resolve();
      r.scoredRound = r.round;          /* claim the round before writing a point */
      var deltas = Rules.score(list, imps(), caughtId, guessRight);
      var jobs = list.map(function (p) {
        return Store.updateSeat(p.id, { score: (p.score || 0) + (deltas[p.id] || 0), delta: deltas[p.id] || 0 });
      });
      var entry = {
        r: r.round,
        word: DECK[r.catIdx].w[r.wordIdx],
        imps: imps().map(nameOf),
        caught: !!caughtId
      };
      var log = ((r.log || []).concat([entry])).slice(-12);
      return Promise.all(jobs).then(function () {
        var patch = {
          phase: "results", caught: !!caughtId, caughtId: caughtId,
          scoredRound: r.round, log: log
        };
        if (extra.accusedId !== undefined) patch.accusedId = extra.accusedId;
        if (extra.tie !== undefined) patch.tie = extra.tie;
        return Store.updateRoom(patch);
      });
    },

    /* The host can move past anyone who has walked away from their phone. */
    skipWaiting: function () {
      if (!isHost() || !S.room) return;
      var r = S.room, list = roster(), jobs = [];
      if (r.phase === "reveal") {
        list.forEach(function (p) { if (!p.ready) jobs.push(Store.updateSeat(p.id, { ready: true })); });
      } else if (r.phase === "clues") {
        var f = r.clueRound === 2 ? "clue2" : "clue";
        list.forEach(function (p) {
          if (!(p[f] || "").trim()) { var u = {}; u[f] = "—"; jobs.push(Store.updateSeat(p.id, u)); }
        });
      } else if (r.phase === "vote") {
        list.forEach(function (p) { if (!p.vote) jobs.push(Store.updateSeat(p.id, { vote: "skip" })); });
      } else if (r.phase === "guess") {
        jobs.push(Store.updateRoom({ guess: -2 }));
      }
      Promise.all(jobs)["catch"](function () {});
    },

    setSetting: function (key, value) {
      if (!isHost()) return;
      var s = settings();
      s[key] = value;
      /* Apply locally first. Settings are a read-modify-write on one object,
         and a second tap can land before the first write comes back as a
         snapshot — without this the newer tap would overwrite the older. */
      if (S.room) S.room.settings = s;
      App.paint();
      Store.updateRoom({ settings: s })["catch"](function () {});
    },

    toChampion: function () { Store.updateRoom({ phase: "champion" })["catch"](function () {}); },

    newMatch: function () {
      if (!isHost()) return;
      Promise.all(S.seats.map(function (p) {
        return Store.updateSeat(p.id, { score: 0, delta: null, ready: false, clue: "", clue2: "", vote: "", inRound: false });
      })).then(function () {
        return Store.updateRoom({
          phase: "lobby", round: 0, log: [], used: [], lastCat: -1,
          scoredRound: -1, match: (S.room.match || 1) + 1
        });
      })["catch"](function () {});
    },

    backToLobby: function () { Store.updateRoom({ phase: "lobby" })["catch"](function () {}); },

    claim: function () { Store.updateRoom({ hostId: Prefs.id })["catch"](function () {}); },

    remove: function (id) { if (isHost() && id !== Prefs.id) Store.removeSeat(id)["catch"](function () {}); }
  };

  /* ---------------------------------------------------------
     Player actions
     --------------------------------------------------------- */
  var Play = {
    seatData: function (previous) {
      var d = {
        id: Prefs.id, name: S.name.trim().slice(0, 18), score: 0,
        joinedAt: Date.now(), lastSeen: Date.now(),
        inRound: false, ready: false, clue: "", clue2: "", vote: "", delta: null
      };
      if (previous) {
        d.score = previous.score || 0;
        d.joinedAt = previous.joinedAt || d.joinedAt;
        d.inRound = !!previous.inRound;
        d.ready = !!previous.ready;
        d.clue = previous.clue || "";
        d.clue2 = previous.clue2 || "";
        d.vote = previous.vote || "";
        d.delta = previous.delta == null ? null : previous.delta;
      }
      return d;
    },

    create: function () {
      if (!Store) return App.fail("errNet");
      if (!S.name.trim()) return App.fail("errName");
      S.busy = true; S.error = ""; App.paint(true);
      Store.open(Host.seed(), Play.seatData(null)).then(function (code) {
        App.entered(code);
      })["catch"](function (e) {
        S.busy = false;
        App.fail(e && e.message === "broker" ? "errBroker" : "errCode");
      });
    },

    join: function (code) {
      if (!Store) return App.fail("errNet");
      code = String(code || "").trim().toUpperCase();
      if (!S.name.trim()) return App.fail("errName");
      if (code.length !== 4) return App.fail("errCode");
      S.busy = true; S.error = ""; App.paint(true);
      Store.join(code, Play.seatData(null)).then(function () {
        App.entered(code);
      })["catch"](function (e) {
        S.busy = false;
        var why = e && e.message;
        App.fail(why === "broker" ? "errBroker" : (why === "timeout" ? "errSlow" : "errCode"));
      });
    },

    leave: function () {
      if (Store) Store.leave(Prefs.id);
      App.exit();
    },

    ready: function () { Store.updateSeat(Prefs.id, { ready: true })["catch"](function () {}); },

    sendClue: function () {
      /* Both languages are live at one table, so the word is off-limits in
         either of them. checkClue splits the secret on spaces and tests each
         piece, so handing it both forms covers the cross-language giveaway. */
      var raw = secret().raw;
      var check = Rules.checkClue(S.clueDraft, raw[0] + " " + raw[1], amImpostor());
      if (!check.ok) {
        S.clueError = check.quiet ? "" : t(check.key);
        App.paint();
        return;
      }
      var patch = {};
      patch[S.room.clueRound === 2 ? "clue2" : "clue"] = check.value;
      S.clueDraft = ""; S.clueError = "";
      Store.updateSeat(Prefs.id, patch)["catch"](function () {});
    },

    vote: function (id) {
      var m = me();
      if (!m || m.vote || id === Prefs.id) return;
      Store.updateSeat(Prefs.id, { vote: id })["catch"](function () {});
    },

    guess: function (i) { Store.updateRoom({ guess: i })["catch"](function () {}); }
  };

  /* ---------------------------------------------------------
     View
     --------------------------------------------------------- */
  var View = {
    home: function () {
      var L = T();
      return [
        '<section class="block enter">',
        '<p class="kicker">', esc(L.heroKicker), '</p>',
        '<h1>', esc(L.hero), '</h1>',
        '<p class="lede">', esc(L.heroSub), '</p>',
        '</section>',

        '<section class="panel panel--lift panel--pad enter">',
        '<label class="field" for="nameIn"><span class="field__label">', esc(L.nameLabel), '</span>',
        '<input class="input" type="text" id="nameIn" maxlength="18" autocomplete="nickname" ',
        'placeholder="', esc(L.namePh), '" value="', esc(S.name), '"></label>',
        S.error ? '<p class="err">' + esc(S.error) + '</p>' : '',
        '<button class="btn" type="button" id="btnCreate"', S.busy ? ' disabled' : '', '>',
        esc(S.busy ? L.connecting : L.create), '</button>',
        '<div class="between"><hr class="rule" style="flex:1"><span class="status">', esc(L.or), '</span><hr class="rule" style="flex:1"></div>',
        '<label class="field" for="codeIn"><span class="field__label">', esc(L.codeLabel), '</span>',
        '<input class="input input--code" type="text" id="codeIn" maxlength="4" autocomplete="off" ',
        'autocapitalize="characters" spellcheck="false" placeholder="····" value="', esc(S.joinCode), '"></label>',
        '<button class="btn btn--ghost" type="button" id="btnJoin"', S.busy ? ' disabled' : '', '>',
        esc(S.busy ? L.connecting : L.join), '</button>',
        '</section>',

        View.rules()
      ].join("");
    },

    rules: function () {
      var L = T();
      return [
        '<details class="rules panel panel--quiet enter"><summary>', esc(L.rulesTitle), '</summary>',
        '<ol>', L.rules.map(function (r) { return "<li>" + r + "</li>"; }).join(""), '</ol>',
        '<p class="rules__tip">', esc(L.scoreNote), ' · ', esc(L.tip), '</p>',
        '</details>'
      ].join("");
    },

    steps: function () {
      var L = T(), p = S.room.phase;
      var at = { reveal: 0, clues: 1, vote: 2, guess: 3, results: 3, champion: 3 }[p];
      if (at === undefined) return "";
      var labels = [L.stepReveal, L.stepClue, L.stepVote, L.stepVerdict];
      return '<ul class="steps">' + labels.map(function (label, i) {
        var cls = i < at ? "done" : (i === at ? "now" : "");
        return '<li class="' + cls + '">' + esc(label) + '</li>';
      }).join("") + '</ul>';
    },

    roster: function (opts) {
      opts = opts || {};
      var L = T(), crown = soleLeader(), r = S.room;
      /* A standings table ranks; a lobby list keeps the order people arrived. */
      var list = opts.rank
        ? S.seats.slice().sort(function (a, b) {
            return (b.score || 0) - (a.score || 0) || (a.joinedAt || 0) - (b.joinedAt || 0);
          })
        : S.seats;
      return '<ul class="roster' + (S.seats.length > 8 ? ' roster--dense' : '') + '">' + list.map(function (p, i) {
        var tags = "";
        if (r && r.hostId === p.id) tags += '<span class="tag tag--host">' + esc(L.host) + '</span>';
        if (away(p)) tags += '<span class="tag tag--away">' + esc(L.away) + '</span>';
        if (r && p.inRound) {
          if (r.phase === "reveal" && p.ready) tags += '<span class="tag tag--on">' + esc(L.readyState) + '</span>';
          if (r.phase === "clues") {
            var f = r.clueRound === 2 ? "clue2" : "clue";
            if ((p[f] || "").trim()) tags += '<span class="tag tag--on">' + esc(L.sent) + '</span>';
          }
          if (r.phase === "vote" && p.vote) tags += '<span class="tag tag--on">' + esc(L.voted) + '</span>';
        }
        if (r && r.phase !== "lobby" && r.phase !== "champion" && !p.inRound) {
          tags += '<span class="tag">' + esc(L.nextRoundTag) + '</span>';
        }
        if (opts.kick && isHost() && p.id !== Prefs.id) {
          tags += '<button class="remove" type="button" data-kick="' + esc(p.id) +
                  '" aria-label="' + esc(L.kick) + ' ' + esc(p.name) + '" title="' + esc(L.kick) + '">&times;</button>';
        }
        var delta = opts.delta && p.delta != null
          ? '<span class="delta' + (p.delta ? '' : ' delta--zero') + '">' + (p.delta > 0 ? "+" : "") + p.delta + '</span>'
          : '';
        return [
          '<li class="', p.id === Prefs.id ? "is-me " : "", (opts.score && crown === p.id) ? "lead" : "", '">',
          '<span class="seat">', i + 1, '</span>',
          '<span class="roster__name">', esc(p.name), p.id === Prefs.id ? ' <span class="muted" style="font-weight:400">· ' + esc(L.you) + '</span>' : '', '</span>',
          tags, delta,
          opts.score ? '<span class="score tnum">' + (p.score || 0) + '</span>' : '',
          '</li>'
        ].join("");
      }).join("") + '</ul>';
    },

    hostTools: function () {
      var L = T(), out = [];
      if (canClaim()) {
        out.push('<button class="btn btn--ghost btn--sm" type="button" id="btnClaim">' +
                 esc(amOwner() ? L.reclaim : L.takeover) + '</button>');
      }
      if (isHost() && ["reveal", "clues", "vote", "guess"].indexOf(S.room.phase) !== -1) {
        out.push('<button class="btn btn--quiet btn--sm" type="button" id="btnSkip">' + esc(L.skipWaiting) + '</button>');
      }
      return out.length ? '<div class="row row--tight" style="justify-content:center">' + out.join("") + '</div>' : "";
    },

    lobby: function () {
      var L = T(), cfg = settings(), canStart = isHost() && S.seats.length >= 3;
      var maxImp = Rules.maxImpostors(S.seats.length);
      var seg = function (name, value, current, label, disabled) {
        return '<button type="button" data-set="' + name + '" data-val="' + value + '" aria-pressed="' +
          (current === value) + '"' + (disabled || !isHost() ? ' disabled' : '') + '>' + esc(label) + '</button>';
      };
      return [
        '<section class="panel panel--lift panel--pad enter">',
        '<p class="kicker">', esc(L.roomCode), '</p>',
        '<div class="codewrap">',
        '<div class="code">', esc(S.room.code), '</div>',
        '<div class="qr"><canvas id="qr" aria-label="QR"></canvas></div>',
        '</div>',
        '<p class="note">', esc(L.shareHint), '</p>',
        '<button class="btn btn--ghost btn--sm" type="button" id="btnCopy">', esc(S.copied ? L.copied : L.copyLink), '</button>',
        (Store && Store.kind === "p2p" && amOwner())
          ? '<p class="note note--warn">' + esc(L.hostMustStay) + '</p>' : '',
        '</section>',

        '<section class="panel enter">',
        '<p class="kicker kicker--quiet">', esc(L.playersN), ' · ', S.seats.length, '</p>',
        View.roster({ score: true, kick: true }),
        '</section>',

        '<section class="panel enter">',
        '<p class="kicker kicker--quiet">', esc(L.settings), '</p>',
        '<div class="setting"><span class="field__label">', esc(L.setImp), '</span>',
        '<div class="seg">',
        seg("impostors", 1, cfg.impostors, L.setImp1),
        seg("impostors", 2, cfg.impostors, L.setImp2, maxImp < 2),
        seg("impostors", 3, cfg.impostors, L.setImp3, maxImp < 3),
        '</div>',
        maxImp < 3 ? '<p class="note">' + esc(L.setImpNote) + '</p>' : '',
        '</div>',
        '<div class="setting"><span class="field__label">', esc(L.setRounds), '</span>',
        '<div class="seg">', seg("clueRounds", 1, cfg.clueRounds, L.setRounds1), seg("clueRounds", 2, cfg.clueRounds, L.setRounds2), '</div>',
        '<p class="note">', esc(L.setRoundsNote), '</p>',
        '</div>',
        '<div class="setting"><span class="field__label">', esc(L.setTarget), '</span>',
        '<div class="seg">', seg("target", 8, cfg.target, "8"), seg("target", 12, cfg.target, "12"),
        seg("target", 20, cfg.target, "20"), seg("target", 0, cfg.target, L.noTarget), '</div>',
        '</div>',
        '</section>',

        canStart
          ? '<button class="btn enter" type="button" id="btnStart">' + esc(L.start) + '</button>'
          : '<p class="status">' + esc(S.seats.length < 3 ? L.needMore : L.waitHost) + '</p>',
        View.hostTools(),
        View.rules(),
        '<button class="btn btn--quiet btn--sm" type="button" id="btnLeave">', esc(L.leave), '</button>'
      ].join("");
    },

    waitingRoom: function () {
      var L = T();
      return [
        '<section class="panel panel--pad enter block">',
        '<p class="kicker kicker--quiet">', esc(L.round), ' ', S.room.round, '</p>',
        '<h2>', esc(L.nextRoundTag), '</h2>',
        '<p class="lede">', esc(L.waitHost), '</p>',
        '</section>',
        '<section class="panel enter">', View.roster({ score: true }), '</section>'
      ].join("");
    },

    reveal: function () {
      var L = T(), m = me();
      if (!m || !m.inRound) return View.waitingRoom();
      var sec = secret(), imp = amImpostor(), list = roster();
      var readyN = list.filter(function (p) { return p.ready; }).length;
      var others = imps().length - 1;
      var company = others === 1 ? " " + L.impHint2 : (others > 1 ? " " + fill(L.impHint3, others) : "");
      return [
        View.steps(),
        '<section class="block enter">',
        '<p class="kicker">', esc(L.round), ' ', S.room.round, ' · ', esc(L.category), ' — ', esc(sec.cat), '</p>',
        '<h2>', esc(L.revealTitle), '</h2>',
        '<p class="note">', esc(L.revealSub), '</p>',
        '</section>',

        '<div class="holder enter">',
        '<div class="flip', S.held ? ' is-open' : '', '" id="card" tabindex="0" role="button" aria-label="', esc(L.holdToSee), '">',
        '<div class="flip__face flip__back"><div class="seal">?</div><p class="hint">', esc(L.holdToSee), '</p></div>',
        '<div class="flip__face flip__front', imp ? ' is-imp' : '', '">',
        '<p class="hint">', esc(sec.cat), '</p>',
        '<div class="flip__word">', esc(imp ? L.youAreImp : sec.word), '</div>',
        imp ? '<p class="hint hint--wide">' + esc(L.impHint + company) + '</p>' : '',
        '</div></div></div>',

        m.ready
          ? '<p class="status"><b>' + readyN + '</b>/' + list.length + ' ' + esc(L.readyState) + '</p>' + waitingLine()
          : '<button class="btn enter" type="button" id="btnReady">' + esc(L.ready) + '</button>',
        View.hostTools()
      ].join("");
    },

    clues: function () {
      var L = T(), m = me();
      if (!m || !m.inRound) return View.waitingRoom();
      var sec = secret(), imp = amImpostor(), r = S.room;
      var second = r.clueRound === 2;
      var field = second ? "clue2" : "clue";
      var list = roster();
      var sentN = list.filter(function (p) { return (p[field] || "").trim(); }).length;
      var mine = (m[field] || "").trim();
      return [
        View.steps(),
        '<section class="block enter">',
        '<p class="kicker">', esc(second ? L.cluesSecond : L.cluesFirst), ' · ', esc(L.category), ' — ', esc(sec.cat), '</p>',
        '<h2>', esc(second ? L.clueTitle2 : L.clueTitle), '</h2>',
        '<p class="note">', esc(second ? L.clueSub2 : L.clueSub), '</p>',
        '</section>',

        '<div class="strip', imp ? ' strip--imp' : '', ' enter">',
        '<span class="hint">', esc(imp ? L.youAreImp : L.yourWord), '</span>',
        '<span class="strip__word">', esc(imp ? "···" : sec.word), '</span>',
        '</div>',

        second ? '<section class="block--tight block enter"><p class="kicker kicker--quiet">' + esc(L.cluesFirst) + '</p>' + View.clueList(1) + '</section>' : '',

        mine
          ? '<section class="panel enter"><p class="kicker kicker--quiet">' + esc(L.sent) + '</p>' +
            '<p class="serif" style="font-size:26px">' + esc(mine) + '</p></section>' +
            '<p class="status"><b>' + sentN + '</b>/' + list.length + ' · ' + esc(L.waitingClues) + '</p>' + waitingLine()
          : '<div class="block enter">' +
            '<input class="input' + (S.clueError ? ' input--bad' : '') + '" type="text" id="clueIn" maxlength="22" ' +
            'autocomplete="off" spellcheck="false" aria-label="' + esc(second ? L.clueTitle2 : L.clueTitle) + '" ' +
            (S.clueError ? 'aria-invalid="true" ' : '') +
            'placeholder="' + esc(L.cluePh) + '" value="' + esc(S.clueDraft) + '">' +
            (S.clueError ? '<p class="err">' + esc(S.clueError) + '</p>' : '') +
            '<button class="btn" type="button" id="btnClue">' + esc(L.send) + '</button></div>',

        '<section class="panel enter">', View.roster({}), '</section>',
        View.hostTools()
      ].join("");
    },

    clueList: function (only) {
      var order = (S.room.order || []).filter(function (id) { return !!seatOf(id); });
      /* A dozen clues is a lot of screen. Past eight players the rows tighten
         so the whole table still reads as one block. */
      var dense = order.length > 8 ? " clues--dense" : "";
      var showImp = ["results", "champion"].indexOf(S.room.phase) !== -1;
      return '<ul class="clues' + dense + '">' + order.map(function (id) {
        var p = seatOf(id);
        var isImp = showImp && imps().indexOf(id) !== -1;
        var first = p.clue || "—";
        var second = only === 1 ? "" : (p.clue2 || "");
        return [
          '<li class="', isImp ? "is-imp" : "", '">',
          '<span class="clues__who">', esc(p.name), '</span>',
          '<span class="clues__words">',
          '<span class="clues__w">', esc(first), '</span>',
          second ? '<span class="clues__w clues__w--second">' + esc(second) + '</span>' : '',
          '</span></li>'
        ].join("");
      }).join("") + '</ul>';
    },

    vote: function () {
      var L = T(), m = me(), list = roster();
      var votedN = list.filter(function (p) { return p.vote; }).length;
      var mine = m && m.vote;
      var many = imps().length > 1;
      return [
        View.steps(),
        '<section class="block enter">',
        '<p class="kicker">', esc(L.clues), '</p>',
        View.clueList(),
        '</section>',
        '<section class="block enter">',
        '<h2>', esc(L.voteTitle), '</h2>',
        '<p class="note">', esc(L.voteSub), many ? ' ' + esc(fill(L.voteSub2, imps().length)) : '', '</p>',
        '</section>',
        m && m.inRound
          ? '<div class="grid enter">' + list.map(function (p) {
              /* Each button carries that player's own clues. At a big table
                 nobody can hold twelve clues in their head while scrolling. */
              var said = [p.clue, p.clue2].filter(function (w) { return (w || "").trim(); }).join(" · ");
              return [
                '<button class="pick', p.vote ? ' is-voted' : '', '" type="button" data-vote="', esc(p.id),
                '" aria-pressed="', mine === p.id, '"',
                (mine || p.id === Prefs.id) ? ' disabled' : '', '>',
                '<span class="pick__name">', esc(p.name), p.id === Prefs.id ? ' <span class="muted">· ' + esc(L.you) + '</span>' : '', '</span>',
                '<span class="pick__clue">', esc(said || "—"), '</span>',
                '</button>'
              ].join("");
            }).join("") + '</div>'
          : '',
        '<p class="status"><b>', votedN, '</b>/', list.length, ' · ', esc(mine ? L.locked : L.waitingVotes), '</p>',
        mine ? waitingLine() : '',
        View.hostTools()
      ].join("");
    },

    guess: function () {
      var L = T(), r = S.room;
      if (r.caughtId !== Prefs.id) {
        return [
          View.steps(),
          '<section class="block enter">',
          '<p class="kicker">', esc(L.verdict), '</p>',
          '<h2>', esc(L.guessWait), '</h2>',
          '</section>',
          '<section class="panel enter">', View.clueList(), '</section>',
          View.hostTools()
        ].join("");
      }
      return [
        View.steps(),
        '<section class="block enter">',
        '<p class="kicker">', esc(L.caughtTitle), '</p>',
        '<h2>', esc(L.caughtSub), '</h2>',
        '</section>',
        '<div class="grid enter">', (r.options || []).map(function (i) {
          return '<button class="pick pick--word" type="button" data-guess="' + i + '">' + esc(wordAt(i)) + '</button>';
        }).join(""), '</div>'
      ].join("");
    },

    results: function () {
      var L = T(), r = S.room, sec = secret(), list = roster();
      var caught = !!r.caught, two = imps().length > 1;
      var v = Rules.tally(list);
      var maxVotes = Math.max(1, v.top);
      var guessed = r.guess >= 0 && r.guess !== -2;
      var right = r.guess === r.wordIdx;
      var over = matchOver();

      var bars = list.map(function (p) {
        var n = v.counts[p.id] || 0;
        var isImp = imps().indexOf(p.id) !== -1;
        return [
          '<div class="bar', isImp ? ' is-imp' : '', '">',
          '<span class="bar__name">', esc(p.name), isImp ? ' <span class="tag tag--host">' + esc(L.theImp) + '</span>' : '', '</span>',
          '<span class="bar__n tnum">', n, '</span>',
          '<span class="bar__track"><span class="bar__fill" style="inline-size:', Math.round(n / maxVotes * 100), '%"></span></span>',
          '</div>'
        ].join("");
      }).join("");

      return [
        View.steps(),
        '<section class="panel panel--lift panel--pad verdict enter">',
        '<span class="badge ', caught ? 'badge--good' : 'badge--bad', '">',
        esc(caught ? (two ? L.impsCaught : L.impCaught) : L.impEscaped), '</span>',
        '<p class="kicker kicker--quiet" style="justify-content:center">', esc(two ? L.theImps : L.theImp), '</p>',
        '<div class="verdict__name">', esc(imps().map(nameOf).join(" · ")), '</div>',
        '<p class="kicker kicker--quiet" style="justify-content:center">', esc(L.theWord), '</p>',
        '<div class="verdict__word">', esc(sec.word), '</div>',
        caught
          ? (guessed
              ? '<p class="note">' + (right
                  ? esc(L.stole)
                  : esc(L.guessWas) + ' \u201C' + esc(wordAt(r.guess)) + '\u201D \u2014 ' + esc(L.wrongGuess)) + '</p>'
              : '')
          : (r.tie ? '<p class="note">' + esc(L.noMajority) + '</p>' : ''),
        '</section>',

        '<section class="block enter"><p class="kicker kicker--quiet">', esc(L.clues), '</p>', View.clueList(), '</section>',
        '<section class="panel enter"><p class="kicker kicker--quiet">', esc(L.votesFor), '</p><div class="bars">', bars, '</div></section>',
        '<section class="panel enter"><p class="kicker kicker--quiet">', esc(L.standings), '</p>', View.roster({ score: true, delta: true, rank: true }), '</section>',
        (r.log && r.log.length > 1) ? View.history() : '',

        isHost()
          ? (over
              ? '<button class="btn enter" type="button" id="btnChampion">' + esc(L.finalTable) + '</button>'
              : (S.seats.length >= 3
                  ? '<button class="btn enter" type="button" id="btnStart">' + esc(L.nextRound) + '</button>'
                  : '<p class="status">' + esc(L.needMore) + '</p>'))
          : '<p class="status">' + esc(L.waitNext) + '</p>',
        View.hostTools()
      ].join("");
    },

    history: function () {
      var L = T();
      return [
        '<section class="block--tight block enter"><p class="kicker kicker--quiet">', esc(L.history), '</p>',
        '<ul class="log">', (S.room.log || []).slice().reverse().map(function (e) {
          return [
            '<li><span class="log__n">', e.r, '</span>',
            '<span class="log__word">', esc(e.word[S.lang === "he" ? 0 : 1]), '</span>',
            '<span class="log__imp">', esc((e.imps || []).join(", ")), '</span>',
            '<span class="log__out ', e.caught ? 'caught' : 'escaped', '">', esc(e.caught ? L.outCaught : L.outEscaped), '</span>',
            '</li>'
          ].join("");
        }).join(""), '</ul></section>'
      ].join("");
    },

    champion: function () {
      var L = T(), top = leader();
      var winners = S.seats.filter(function (p) { return (p.score || 0) === top; });
      return [
        '<section class="panel panel--lift panel--pad enter">',
        '<div class="crown">',
        '<div class="crown__ring">★</div>',
        '<p class="kicker kicker--quiet" style="justify-content:center">', esc(L.champion), '</p>',
        '<div class="crown__name">', esc(winners.map(function (p) { return p.name; }).join(" · ")), '</div>',
        '<p class="crown__score tnum">', top, '</p>',
        '</div></section>',
        '<section class="panel enter"><p class="kicker kicker--quiet">', esc(L.finalTable), '</p>',
        View.roster({ score: true, rank: true }), '</section>',
        View.history(),
        isHost()
          ? '<div class="row"><button class="btn" type="button" id="btnNewMatch">' + esc(L.newMatch) + '</button>' +
            '<button class="btn btn--ghost" type="button" id="btnPlayOn">' + esc(L.playOn) + '</button></div>'
          : '<p class="status">' + esc(L.waitHost) + '</p>'
      ].join("");
    },

    room: function () {
      var p = S.room.phase;
      if (p === "lobby") return View.lobby();
      if (p === "reveal") return View.reveal();
      if (p === "clues") return View.clues();
      if (p === "vote") return View.vote();
      if (p === "guess") return View.guess();
      if (p === "champion") return View.champion();
      return View.results();
    }
  };

  /* ---------------------------------------------------------
     App
     --------------------------------------------------------- */
  var App = {
    fail: function (key) { S.error = t(key); S.busy = false; App.paint(true); },

    entered: function (code) {
      S.view = "room"; S.error = ""; S.busy = false; S.seatedOnce = false;
      try { history.replaceState(null, "", "#" + code); } catch (e) { location.hash = code; }

      Store.onChange(function (room, seats) {
        S.room = room;
        S.seats = seats || [];
        if (seatOf(Prefs.id)) S.seatedOnce = true;
        else if (S.seatedOnce) { App.exit(); return; }   /* removed by the host */
        App.paint();
        Host.tick();
      });
      Store.onFatal(function (key) {
        App.exit();
        S.error = t(key);
        App.paint(true);
      });

      /* presence: tell the room this phone is still awake */
      if (App.beat) clearInterval(App.beat);
      App.beat = setInterval(function () {
        if (Store && Store.code) Store.updateSeat(Prefs.id, { lastSeen: Date.now() });
      }, 9000);

      App.paint(true);
    },

    exit: function () {
      if (App.beat) { clearInterval(App.beat); App.beat = null; }
      if (Store) { Store.onChange(null); Store.onFatal(null); }
      S.view = "home"; S.room = null; S.seats = []; S.seatedOnce = false;
      S.clueDraft = ""; S.clueError = "";
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      App.paint(true);
    },

    /* A signature of everything the markup depends on. Painting only when
       it changes keeps typing, focus and the held card from being clobbered
       by unrelated snapshots. */
    signature: function () {
      var r = S.room;
      return JSON.stringify([
        S.view, S.lang, S.error, S.clueError, S.clueDraft.length > 0, S.busy, S.copied, S.joinCode,
        r && [r.phase, r.round, r.clueRound, r.catIdx, r.wordIdx, r.guess, r.caught, r.caughtId,
              r.hostId, r.impostorIds, r.settings, (r.log || []).length, r.order],
        S.seats.map(function (p) {
          return [p.id, p.name, p.score, p.delta, p.ready, p.clue, p.clue2, p.vote, p.inRound,
                  Date.now() - (p.lastSeen || 0) > AWAY_MS];
        })
      ]);
    },

    paint: function (force) {
      if (S.held) { S.pendingPaint = true; return; }     /* never redraw a held card */
      var sig = App.signature();
      if (!force && sig === S.lastSig) return;
      S.lastSig = sig;

      var L = T();
      document.documentElement.lang = S.lang;
      document.documentElement.dir = L.dir;
      $("brand").textContent = L.brand;
      $("brandAlt").textContent = L.brandAlt;
      $("langHe").setAttribute("aria-pressed", String(S.lang === "he"));
      $("langEn").setAttribute("aria-pressed", String(S.lang === "en"));

      /* keep the caret where the player left it */
      var act = document.activeElement;
      var keep = act && act.tagName === "INPUT" && act.id
        ? { id: act.id, value: act.value, start: act.selectionStart, end: act.selectionEnd } : null;

      $("app").innerHTML = S.view === "home" ? View.home() : (S.room ? View.room() : '<p class="status pulse">···</p>');
      App.bind();

      if (keep) {
        var back = $(keep.id);
        if (back) {
          back.value = keep.value;
          try { back.setSelectionRange(keep.start, keep.end); } catch (e) {}
          back.focus({ preventScroll: true });
        }
      }

      $("footL").textContent = S.room && S.room.round ? L.round + " " + S.room.round : L.brand + " · " + L.brandAlt;
      $("footR").innerHTML = Store && Store.code ? '<b>' + esc(Store.code) + '</b>' : "";
      $("live").textContent = S.room ? (L[{ lobby: "lobby", reveal: "stepReveal", clues: "stepClue", vote: "stepVote", guess: "verdict", results: "verdict", champion: "champion" }[S.room.phase]] || "") : "";
    },

    on: function (id, ev, fn) { var el = $(id); if (el) el.addEventListener(ev, fn); },
    each: function (sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); },

    bind: function () {
      App.on("nameIn", "input", function (e) { S.name = e.target.value; Prefs.set("name", S.name); });
      App.on("codeIn", "input", function (e) {
        S.joinCode = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
        e.target.value = S.joinCode;
      });
      App.on("codeIn", "keydown", function (e) { if (e.key === "Enter") Play.join(S.joinCode); });
      App.on("nameIn", "keydown", function (e) { if (e.key === "Enter") $("codeIn") && $("codeIn").focus(); });
      App.on("btnCreate", "click", Play.create);
      App.on("btnJoin", "click", function () { Play.join(S.joinCode); });
      App.on("btnLeave", "click", Play.leave);
      App.on("btnStart", "click", Host.startRound);
      App.on("btnReady", "click", Play.ready);
      App.on("btnSkip", "click", Host.skipWaiting);
      App.on("btnClaim", "click", Host.claim);
      App.on("btnChampion", "click", Host.toChampion);
      App.on("btnNewMatch", "click", Host.newMatch);
      App.on("btnPlayOn", "click", Host.backToLobby);

      App.on("btnCopy", "click", function () {
        var url = location.href.split("#")[0] + "#" + S.room.code;
        var settle = function () {
          S.copied = true; App.paint(true);
          setTimeout(function () { S.copied = false; App.paint(true); }, 1800);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(settle, settle);
        else settle();
      });

      App.on("clueIn", "input", function (e) { S.clueDraft = e.target.value; S.clueError = ""; });
      App.on("clueIn", "keydown", function (e) { if (e.key === "Enter") Play.sendClue(); });
      App.on("btnClue", "click", Play.sendClue);

      App.each("[data-set]", function (b) {
        b.addEventListener("click", function () {
          Host.setSetting(b.getAttribute("data-set"), parseInt(b.getAttribute("data-val"), 10));
        });
      });
      App.each("[data-vote]", function (b) { b.addEventListener("click", function () { Play.vote(b.getAttribute("data-vote")); }); });
      App.each("[data-guess]", function (b) { b.addEventListener("click", function () { Play.guess(parseInt(b.getAttribute("data-guess"), 10)); }); });
      App.each("[data-kick]", function (b) { b.addEventListener("click", function () { Host.remove(b.getAttribute("data-kick")); }); });

      App.card();
      App.qr();
    },

    /* Hold to reveal. Pointer for touch and mouse; keyboard toggles, so the
       card is reachable without a pointer at all. */
    card: function () {
      var card = $("card");
      if (!card) return;
      var open = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        S.held = true; card.classList.add("is-open");
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) {} }
      };
      var shut = function () {
        if (!S.held) return;
        S.held = false; card.classList.remove("is-open");
        if (S.pendingPaint) { S.pendingPaint = false; App.paint(true); }
      };
      card.addEventListener("pointerdown", open);
      ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { card.addEventListener(ev, shut); });
      card.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      card.addEventListener("keydown", function (e) {
        if (e.key === " " || e.key === "Enter") { e.preventDefault(); S.held ? shut() : open(); }
      });
      card.addEventListener("blur", shut);
    },

    /* The lobby QR encodes the join link, so nobody types anything. */
    qr: function () {
      var cv = $("qr");
      if (!cv || !S.room) return;
      if (!window.qrcode) { cv.parentNode.style.display = "none"; return; }
      try {
        var q = window.qrcode(0, "M");
        q.addData(location.href.split("#")[0] + "#" + S.room.code);
        q.make();
        var n = q.getModuleCount(), px = 4, size = n * px, g = cv.getContext("2d");
        cv.width = size; cv.height = size;
        g.fillStyle = "#EFE8E4"; g.fillRect(0, 0, size, size);
        g.fillStyle = "#0A0709";
        for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) g.fillRect(c * px, r * px, px, px);
      } catch (e) {
        cv.parentNode.style.display = "none";
      }
    },

    setLang: function (l) {
      S.lang = l; Prefs.set("lang", l);
      S.error = ""; S.clueError = "";
      App.paint(true);
    },

    boot: function () {
      $("langHe").addEventListener("click", function () { App.setLang("he"); });
      $("langEn").addEventListener("click", function () { App.setLang("en"); });

      S.joinCode = (location.hash || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4);
      App.paint(true);

      pickTransport().then(function (net) {
        Store = net;
        if (!Store) { S.error = t("errNet"); }
        App.paint(true);
      });

      /* presence ages even when nothing else changes */
      setInterval(function () { if (S.view === "room") App.paint(); }, 6000);
    }
  };

  App.boot();
})();
