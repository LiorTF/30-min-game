/* Suspect — what the table remembers. Run: node tests/dossier.test.js */
const fs = require("fs"), path = require("path"), vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, Math, Date, JSON, Object, String, Number, Array };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "dossier.js"), "utf8"), ctx);
const D = ctx.window.SUSPECT_DOSSIER;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " != " + JSON.stringify(b));
const group = n => console.log("\n" + n);

/* A round where `imp` is the only impostor and `accused` is voted out.
   votes maps player name -> the name they accused. */
function round(n, { imp, accused, votes, outcome, guessRight = false, clue = "x" }) {
  const names = Object.keys(votes);
  const idOf = name => "id-" + name;
  const seats = names.map(name => ({
    id: idOf(name), name,
    vote: votes[name] ? idOf(votes[name]) : "",
    clue: name === imp ? clue : "c" + name,
    delta: 0
  }));
  const roleById = {};
  seats.forEach(s => { roleById[s.id] = s.name === imp ? "impostor" : "innocent"; });
  return {
    round: n, word: ["מילה", "word"],
    seats, roleById,
    impostorIds: [idOf(imp)],
    accusedId: accused ? idOf(accused) : "",
    caughtId: outcome === "caught" ? idOf(imp) : "",
    outcome, guessRight
  };
}

/* ---------- a night ---------- */
group("a night");
{
  let d = D.blank("שולחן");
  d = D.openNight(d, ["Dana", "Yoav", "Michal"]);
  eq("the night is counted", d.nights, 1);
  eq("everyone present is on the books", Object.keys(d.players).sort(), ["Dana", "Michal", "Yoav"]);
  eq("each of them has a night to their name", d.players.Dana.nights, 1);
}

/* ---------- escaping and being caught ---------- */
group("the impostor's record");
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  d = D.record(d, round(1, { imp: "Dana", accused: "Yoav",
    votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Yoav" }, outcome: "escaped" }));
  eq("an escape is recorded", d.players.Dana.escaped, 1);
  eq("and starts a streak", d.players.Dana.escapeStreak, 1);
  eq("the round is counted for everyone", d.players.Michal.rounds, 1);

  d = D.record(d, round(2, { imp: "Dana", accused: "Michal",
    votes: { Dana: "Michal", Yoav: "Michal", Michal: "Yoav" }, outcome: "escaped" }));
  eq("the streak grows", d.players.Dana.escapeStreak, 2);

  d = D.record(d, round(3, { imp: "Dana", accused: "Dana",
    votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Dana" }, outcome: "caught" }));
  eq("being caught ends the streak", d.players.Dana.escapeStreak, 0);
  eq("but the best run is kept", d.players.Dana.bestEscapeStreak, 2);
  eq("the catch is recorded", d.players.Dana.caught, 1);
  eq("three rounds as the impostor", d.players.Dana.impostorRounds, 3);
  eq("the table's longest escape is on the record", d.records.longestEscape,
     { name: "Dana", streak: 2 });
}

/* ---------- votes, both directions ---------- */
group("who suspects whom");
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  for (let i = 1; i <= 4; i++) {
    d = D.record(d, round(i, { imp: "Michal", accused: "Yoav",
      votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Dana" }, outcome: "escaped" }));
  }
  eq("Dana's suspicion of Yoav is counted", d.players.Dana.votedFor.Yoav, 4);
  eq("and recorded from Yoav's side too", d.players.Yoav.accusedBy.Dana, 4);
  eq("Yoav was the one voted out each time", d.players.Yoav.accusedTimes, 4);
  eq("Yoav read it right every time", d.players.Yoav.votesCorrect, 4);
  eq("Dana never did", d.players.Dana.votesCorrect, 0);
  eq("the running grudge is findable", D.nemesis(d), { from: "Dana", to: "Yoav", count: 4 });
}

/* ---------- the best lie ---------- */
group("the best bluff");
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal", "Avi"]);
  d = D.record(d, round(1, { imp: "Dana", accused: "Yoav", clue: "טחינה",
    votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Yoav", Avi: "Yoav" }, outcome: "escaped" }));
  eq("the clue that worked is kept", d.players.Dana.bestBluff.clue, "טחינה");
  eq("along with how many it steered away", d.players.Dana.bestBluff.fooled, 3);

  /* a worse bluff later must not overwrite the good one */
  d = D.record(d, round(2, { imp: "Dana", accused: "", clue: "משהו",
    votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Dana", Avi: "" }, outcome: "escaped" }));
  eq("a weaker lie does not replace it", d.players.Dana.bestBluff.clue, "טחינה");
}

/* ---------- titles ---------- */
group("titles");
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  for (let i = 1; i <= 3; i++) {
    d = D.record(d, round(i, { imp: "Dana", accused: "Yoav",
      votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Yoav" }, outcome: "escaped" }));
  }
  const titles = D.titles(d);
  const snake = titles.find(t => t.key === "snake");
  ok("three escapes in a row earns the snake", snake && snake.name === "Dana", JSON.stringify(titles));
  eq("and records the run", snake.value, 3);

  const early = D.titles(D.record(D.openNight(D.blank("t"), ["A", "B"]),
    round(1, { imp: "A", accused: "B", votes: { A: "B", B: "A" }, outcome: "escaped" })));
  ok("one round earns nobody anything", early.length === 0, JSON.stringify(early));
}
{
  /* a player caught every single time they were the impostor */
  /* six rounds, because a title should not be handed out on a small sample */
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  for (let i = 1; i <= 6; i++) {
    d = D.record(d, round(i, { imp: "Yoav", accused: "Yoav",
      votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Yoav" }, outcome: "caught" }));
  }
  const glass = D.titles(d).find(t => t.key === "glass");
  ok("never getting away with it earns the glass", glass && glass.name === "Yoav");
  eq("at a hundred per cent", glass.value, 100);
  const detective = D.titles(d).find(t => t.key === "detective");
  ok("the best reader of the table earns the detective", detective && detective.name === "Dana",
     JSON.stringify(detective));
  ok("four votes is not yet enough to earn it", (() => {
    let few = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
    for (let i = 1; i <= 4; i++) {
      few = D.record(few, round(i, { imp: "Yoav", accused: "Yoav",
        votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Yoav" }, outcome: "caught" }));
    }
    return !D.titles(few).find(t => t.key === "detective");
  })());
}

/* ---------- the line under the verdict ---------- */
group("the story line");
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  for (let i = 1; i <= 2; i++) {
    d = D.record(d, round(i, { imp: "Dana", accused: "Yoav",
      votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Yoav" }, outcome: "escaped" }));
  }
  const r = round(3, { imp: "Dana", accused: "Yoav",
    votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Yoav" }, outcome: "escaped" });
  const note = D.note(d, r);
  eq("a run of escapes is the headline", note.key, "noteStreak");
  eq("named", note.name, "Dana");
  eq("with the count", note.n, 2);
}
{
  let d = D.openNight(D.blank("t"), ["Dana", "Yoav", "Michal"]);
  for (let i = 1; i <= 3; i++) {
    d = D.record(d, round(i, { imp: "Michal", accused: "Michal",
      votes: { Dana: "Yoav", Yoav: "Michal", Michal: "Dana" }, outcome: "caught" }));
  }
  const r = round(4, { imp: "Yoav", accused: "Yoav",
    votes: { Dana: "Yoav", Yoav: "Dana", Michal: "Yoav" }, outcome: "caught" });
  const note = D.note(d, r);
  ok("an old grudge surfaces when there is no streak to report",
     note && note.key === "noteGrudge", JSON.stringify(note));
}
{
  const d = D.openNight(D.blank("t"), ["A", "B"]);
  const r = round(1, { imp: "A", accused: "B", votes: { A: "B", B: "A" }, outcome: "jester" });
  eq("the jester's round speaks for itself", D.note(d, r).key, "noteJester");
}
{
  const fresh = D.openNight(D.blank("t"), ["A", "B", "C"]);
  const r = round(1, { imp: "A", accused: "B", votes: { A: "B", B: "C", C: "B" }, outcome: "escaped" });
  eq("a table with no history says nothing", D.note(fresh, r), null);
}

/* ---------- the record is not corrupted by editing it ---------- */
group("purity");
{
  const before = D.openNight(D.blank("t"), ["A", "B"]);
  const snapshot = JSON.stringify(before);
  D.record(before, round(1, { imp: "A", accused: "B", votes: { A: "B", B: "A" }, outcome: "escaped" }));
  eq("recording a round leaves the old dossier untouched", JSON.stringify(before), snapshot);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
