/* Suspect — rules tests. Run: node tests/rules.test.js */
const fs = require("fs"), path = require("path"), vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, Math, Date, JSON, Object, String, Number, Array };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "deck.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "rules.js"), "utf8"), ctx);
const R = ctx.window.SUSPECT_RULES, DECK = ctx.window.SUSPECT_DECK;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  → " + detail : "")); }
}
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " ≠ " + JSON.stringify(b)); }
function group(n) { console.log("\n" + n); }

/* ---------- deck integrity ---------- */
group("deck");
ok("twenty categories", DECK.length === 20, DECK.length + " found");
ok("every category has at least 6 words (guess needs 6 options)",
   DECK.every(c => c.w.length >= 6));
ok("every entry has both languages",
   DECK.every(c => c.c.he && c.c.en && c.w.every(w => w[0] && w[1])));
ok("no duplicate word inside a category",
   DECK.every(c => new Set(c.w.map(w => w[0])).size === c.w.length));
ok("no duplicate hebrew word across the whole deck", (() => {
  const all = DECK.flatMap(c => c.w.map(w => w[0]));
  return new Set(all).size === all.length;
})());
ok("category ids unique", new Set(DECK.map(c => c.id)).size === DECK.length);
console.log("  " + DECK.reduce((n, c) => n + c.w.length, 0) + " words in play");

/* ---------- pickWord ---------- */
group("pickWord");
ok("never repeats a used word", (() => {
  const used = [];
  for (let i = 0; i < 150; i++) {
    const p = R.pickWord(used, -1);
    if (p.wrapped) break;
    const key = p.cat + ":" + p.word;
    if (used.includes(key)) return false;
    used.push(key);
  }
  return true;
})());
ok("skips the previous category", (() => {
  for (let i = 0; i < 200; i++) if (R.pickWord([], 3).cat === 3) return false;
  return true;
})());
ok("wraps when the deck is exhausted", (() => {
  const used = [];
  DECK.forEach((c, ci) => c.w.forEach((w, wi) => used.push(ci + ":" + wi)));
  return R.pickWord(used, -1).wrapped === true;
})());

/* ---------- guessOptions ---------- */
group("guessOptions");
ok("six unique options", (() => {
  for (let i = 0; i < 100; i++) {
    const o = R.guessOptions(i % DECK.length, 0);
    if (o.length !== 6 || new Set(o).size !== 6) return false;
  }
  return true;
})());
ok("always contains the real word", (() => {
  for (let i = 0; i < 100; i++) {
    const w = i % 6;
    if (!R.guessOptions(0, w).includes(w)) return false;
  }
  return true;
})());

/* ---------- tally ---------- */
group("tally");
const seats = (...votes) => votes.map((v, i) => ({ id: "p" + i, vote: v }));
eq("clear plurality", R.tally(seats("p2", "p2", "p1")).accused, "p2");
eq("tie leaves nobody accused", R.tally(seats("p1", "p0", "p2", "p2", "p1")).accused, "");
ok("tie is flagged", R.tally(seats("p1", "p0")).tie === true);
eq("skipped votes are ignored", R.tally(seats("skip", "skip", "p1")).accused, "p1");
eq("no votes at all", R.tally(seats("", "")).accused, "");

/* ---------- score ---------- */
group("score");
const board = (...rows) => rows.map(([id, vote]) => ({ id, vote }));
{
  /* impostor p0 escapes: p2 read it right anyway */
  const s = R.score(board(["p0", "p1"], ["p1", "p2"], ["p2", "p0"]), ["p0"], "", false);
  eq("escaped impostor takes 3", s.p0, 3);
  eq("wrong voter takes nothing", s.p1, 0);
  eq("right voter, wrong table, takes 1", s.p2, 1);
}
{
  /* impostor p0 caught, guesses wrong */
  const s = R.score(board(["p0", "p1"], ["p1", "p0"], ["p2", "p1"]), ["p0"], "p0", false);
  eq("caught impostor with a wrong guess takes nothing", s.p0, 0);
  eq("correct voter takes 2", s.p1, 2);
  eq("incorrect voter takes nothing", s.p2, 0);
}
{
  const s = R.score(board(["p0", "p1"], ["p1", "p0"]), ["p0"], "p0", true);
  eq("caught impostor who guesses right takes 2", s.p0, 2);
}
{
  /* two impostors, only p0 caught */
  const s = R.score(board(["p0", "p3"], ["p1", "p0"], ["p2", "p1"], ["p3", "p0"]), ["p0", "p1"], "p0", false);
  eq("caught impostor takes nothing", s.p0, 0);
  eq("the impostor who slipped through still takes 3", s.p1, 3);
  eq("voting for either impostor counts", s.p2, 2);
  eq("voting for the caught impostor counts", s.p3, 2);
}
{
  const s = R.score(board(["p0", ""], ["p1", "p0"]), ["p0"], "", false);
  eq("both impostors score when nobody is caught", s.p0, 3);
}
{
  /* a big table: three impostors, p0 is caught and guesses right */
  const s = R.score(
    board(["p0", "p4"], ["p1", "p5"], ["p2", "p0"], ["p3", "p0"], ["p4", "p1"], ["p5", "p0"]),
    ["p0", "p1", "p2"], "p0", true);
  eq("the caught impostor still takes 2 for a right guess", s.p0, 2);
  eq("the second impostor escapes with 3", s.p1, 3);
  eq("the third impostor escapes with 3 even after voting for a fellow impostor", s.p2, 3);
  eq("an innocent who named the caught impostor takes 2", s.p3, 2);
  eq("an innocent who named an uncaught impostor also takes 2", s.p4, 2);
  eq("an innocent who named the caught impostor takes 2 as well", s.p5, 2);
}

/* ---------- checkClue ---------- */
group("checkClue");
const clue = (v, secret, imp) => R.checkClue(v, secret, !!imp);
ok("plain clue passes", clue("טחינה", "פלאפל").ok);
eq("two words rejected", clue("פיתה חמה", "פלאפל").key, "errOneWord");
eq("single letter rejected", clue("פ", "פלאפל").key, "errTooShort");
eq("the word itself rejected", clue("פלאפל", "פלאפל").key, "errIsWord");
eq("an inflection rejected", clue("פלאפלים", "פלאפל").key, "errIsWord");
eq("english plural rejected", clue("cats", "Cat").key, "errIsWord");
eq("case and quotes ignored", clue("CAT", "Cat").key, "errIsWord");
ok("a different word that starts the same is allowed", clue("קולנוע", "קול").ok);
ok("catalogue is not cat", clue("catalogue", "Cat").ok);
ok("either half of a two-word secret is rejected", !clue("הסדר", "ליל הסדר").ok);
ok("a hebrew prefix does not smuggle the word through", !clue("סדר", "ליל הסדר").ok);
ok("the root behind a prefixed secret is caught", !clue("ראה", "מראה").ok);
ok("an unrelated short word still passes", clue("חושך", "מראה").ok);
ok("the impostor is never checked", clue("פלאפל", "פלאפל", true).ok);
/* one table can run both languages at once, so the word is barred in both */
eq("the hebrew word is barred when both forms are given", clue("פלאפל", "פלאפל Falafel").key, "errIsWord");
eq("the english word is barred too", clue("falafel", "פלאפל Falafel").key, "errIsWord");
ok("an unrelated clue passes against both forms", clue("טחינה", "פלאפל Falafel").ok);
ok("empty input fails quietly", clue("  ", "פלאפל").quiet === true);
eq("long clues are trimmed to 22", clue("א".repeat(40), "פלאפל").value.length, 22);

/* ---------- misc ---------- */
group("table size");
eq("three players allow one impostor", R.maxImpostors(3), 1);
eq("six players allow one impostor", R.maxImpostors(6), 1);
eq("seven players unlock two", R.maxImpostors(7), 2);
eq("nine players still cap at two", R.maxImpostors(9), 2);
eq("ten players unlock three", R.maxImpostors(10), 3);
eq("a very big table still caps at three", R.maxImpostors(20), 3);
eq("the lobby note knows where two unlocks", R.impostorsUnlockAt(2), 7);
eq("the lobby note knows where three unlocks", R.impostorsUnlockAt(3), 10);
ok("room codes are four unambiguous characters", (() => {
  for (let i = 0; i < 500; i++) if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/.test(R.code())) return false;
  return true;
})());
ok("shuffle keeps every element", (() => {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const b = R.shuffle(a.slice());
  return b.length === 8 && a.every(x => b.includes(x));
})());

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
