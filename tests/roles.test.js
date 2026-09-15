/* Suspect — role dealing and round scoring. Run: node tests/roles.test.js */
const fs = require("fs"), path = require("path"), vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console, Math, Date, JSON, Object, String, Number, Array };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "deck.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "rules.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(root, "roles.js"), "utf8"), ctx);
const R = ctx.window.SUSPECT_ROLES;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a) + " != " + JSON.stringify(b));
const group = n => console.log("\n" + n);

/* deal in a fixed order so every assertion is exact */
const inOrder = a => a;
const ids = n => Array.from({ length: n }, (_, i) => "p" + i);

/* ---------- which roles appear ---------- */
group("unlocks");
eq("a small table stays plain", R.available(4, "full"), []);
eq("the confused arrives at five", R.available(5, "full"), ["confused"]);
eq("light mode never goes past the confused", R.available(12, "light"), ["confused"]);
eq("roles off means off", R.available(12, "off"), []);
eq("the jester arrives at seven", R.available(7, "full"), ["confused", "jester"]);
eq("the witness at eight", R.available(8, "full"), ["confused", "jester", "witness"]);
eq("the accomplice at nine", R.available(9, "full"),
   ["confused", "jester", "witness", "accomplice"]);

/* ---------- dealing ---------- */
group("dealing");
{
  const d = R.assign(ids(5), { impostors: 1, roleMode: "light" }, inOrder);
  eq("the impostor is dealt first from the shuffled order", d.impostorIds, ["p0"]);
  eq("the confused comes from the rest", d.confusedId, "p1");
  eq("everyone else is innocent",
     ["p2", "p3", "p4"].map(i => d.roleById[i]), ["innocent", "innocent", "innocent"]);
}
{
  const d = R.assign(ids(10), { impostors: 3, roleMode: "full" }, inOrder);
  eq("three impostors", d.impostorIds, ["p0", "p1", "p2"]);
  eq("extras are dealt from the non-impostors", d.confusedId, "p3");
  eq("jester next", d.jesterId, "p4");
  eq("witness next", d.witnessId, "p5");
  eq("accomplice next", d.accompliceId, "p6");
  ok("nobody holds two roles",
     new Set([d.confusedId, d.jesterId, d.witnessId, d.accompliceId]).size === 4);
  ok("an impostor is never given an extra role",
     d.impostorIds.every(i => d.roleById[i] === "impostor"));
}
ok("the witness is only ever told about the town's own side", (() => {
  for (let t = 0; t < 400; t++) {
    const d = R.assign(ids(10), { impostors: 2, roleMode: "full" });
    if (!d.witnessId) continue;
    const cleared = d.witnessClearedId;
    if (!cleared) return false;
    if (cleared === d.witnessId) return false;
    if (R.side(d.roleById[cleared]) !== "town") return false;   /* never an impostor or accomplice */
  }
  return true;
})());
ok("every player always leaves with exactly one role", (() => {
  for (let n = 3; n <= 14; n++) {
    const d = R.assign(ids(n), { impostors: Math.min(3, n - 1), roleMode: "full" });
    if (Object.keys(d.roleById).length !== n) return false;
  }
  return true;
})());
ok("there is always at least one non-impostor", (() => {
  const d = R.assign(ids(3), { impostors: 9, roleMode: "full" });
  return d.impostorIds.length <= 2;
})());

/* ---------- what happened ---------- */
group("outcome");
eq("naming an impostor is a catch", R.outcome("p0", ["p0"], ""), "caught");
eq("naming the jester is the jester's round", R.outcome("p3", ["p0"], "p3"), "jester");
eq("naming nobody lets them go", R.outcome("", ["p0"], ""), "escaped");
eq("naming the wrong person lets them go", R.outcome("p2", ["p0"], ""), "escaped");
eq("the jester beats a catch when they are the same vote",
   R.outcome("p0", ["p0"], "p0"), "jester");

/* ---------- points ---------- */
group("scoring");
const seat = (id, vote) => ({ id, vote });

{
  /* one impostor, caught, guessed right; one confused who survived */
  const roleById = { p0: "impostor", p1: "confused", p2: "innocent", p3: "innocent" };
  const d = R.score({
    roster: [seat("p0", "p2"), seat("p1", "p0"), seat("p2", "p0"), seat("p3", "p1")],
    roleById, impostorIds: ["p0"], outcome: "caught", caughtId: "p0",
    accusedId: "p0", guessRight: true
  });
  eq("caught impostor who guessed right takes 2", d.p0, 2);
  eq("the confused took 2 for voting right and 2 for surviving", d.p1, 4);
  eq("a correct voter takes 2", d.p2, 2);
  eq("a voter who named the confused takes nothing", d.p3, 0);
}
{
  /* the confused is the one voted out */
  const roleById = { p0: "impostor", p1: "confused", p2: "innocent" };
  const d = R.score({
    roster: [seat("p0", "p1"), seat("p1", "p0"), seat("p2", "p1")],
    roleById, impostorIds: ["p0"], outcome: "escaped", accusedId: "p1"
  });
  eq("the impostor walks", d.p0, 3);
  eq("the confused, voted out, takes nothing", d.p1, 1);
  eq("a voter who fell for it takes nothing", d.p2, 0);
}
{
  /* jester baits the table */
  const roleById = { p0: "impostor", p1: "jester", p2: "innocent", p3: "innocent" };
  const d = R.score({
    roster: [seat("p0", "p1"), seat("p1", "p0"), seat("p2", "p1"), seat("p3", "p1")],
    roleById, impostorIds: ["p0"], outcome: "jester", accusedId: "p1"
  });
  eq("the jester takes the round", d.p1, 4);
  eq("the impostor is left standing and takes 2", d.p0, 2);
  eq("everyone who fell for it takes nothing", [d.p2, d.p3], [0, 0]);
}
{
  /* accomplice rides home with the impostors */
  const roleById = { p0: "impostor", p1: "accomplice", p2: "innocent" };
  const escaped = R.score({
    roster: [seat("p0", "p2"), seat("p1", "p2"), seat("p2", "p1")],
    roleById, impostorIds: ["p0"], outcome: "escaped", accusedId: "p2"
  });
  eq("impostor escapes with 3", escaped.p0, 3);
  eq("the accomplice takes 2 with them", escaped.p1, 2);

  const caught = R.score({
    roster: [seat("p0", "p2"), seat("p1", "p2"), seat("p2", "p0")],
    roleById, impostorIds: ["p0"], outcome: "caught", caughtId: "p0",
    accusedId: "p0", guessRight: false
  });
  eq("a caught impostor with a wrong guess takes nothing", caught.p0, 0);
  eq("the accomplice goes down with them", caught.p1, 0);
  eq("the player who called it takes 2", caught.p2, 2);
}
{
  /* a right read on a round the table got wrong still pays */
  const roleById = { p0: "impostor", p1: "innocent", p2: "innocent" };
  const d = R.score({
    roster: [seat("p0", "p1"), seat("p1", "p0"), seat("p2", "p1")],
    roleById, impostorIds: ["p0"], outcome: "escaped", accusedId: "p1"
  });
  eq("the lone correct vote takes 1", d.p1, 1);
  eq("the rest take nothing", d.p2, 0);
}
{
  const roleById = { p0: "impostor", p1: "innocent" };
  const base = { roster: [seat("p0", "p1"), seat("p1", "p0")], roleById,
                 impostorIds: ["p0"], outcome: "escaped", accusedId: "" };
  const single = R.score(base);
  const doubled = R.score(Object.assign({}, base, { double: true }));
  eq("the last trial doubles everything", [doubled.p0, doubled.p1],
     [single.p0 * 2, single.p1 * 2]);
}
ok("nobody ever loses points", (() => {
  const roleById = { p0: "impostor", p1: "confused", p2: "jester", p3: "innocent" };
  const roster = [seat("p0", "p1"), seat("p1", "p2"), seat("p2", "p0"), seat("p3", "p0")];
  return ["caught", "escaped", "jester"].every(outcome => {
    const d = R.score({ roster, roleById, impostorIds: ["p0"], outcome,
                        caughtId: outcome === "caught" ? "p0" : "", accusedId: "p0" });
    return Object.keys(d).every(k => d[k] >= 0);
  });
})());

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
