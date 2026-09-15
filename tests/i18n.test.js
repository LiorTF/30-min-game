/* Suspect — the copy holds together.
   Catches the class of bug where a string is added to one language, or is
   referenced from the views and never written at all: the interface then
   renders a blank button and nothing errors.
   Run: node tests/i18n.test.js                                            */
const fs = require("fs"), path = require("path"), vm = require("vm");

const root = path.join(__dirname, "..");
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "i18n.js"), "utf8"), ctx);
const T = ctx.window.SUSPECT_I18N;
const sources = ["app.js", "net-p2p.js", "net-artifact.js"]
  .map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
const app = sources;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  FAIL  " + n + (d ? "  -> " + d : "")); } };
const group = n => console.log("\n" + n);

const he = Object.keys(T.he), en = Object.keys(T.en);

group("both languages");
ok("Hebrew and English carry the same keys",
   he.length === en.length && he.every(k => en.indexOf(k) !== -1),
   he.filter(k => en.indexOf(k) === -1).concat(en.filter(k => he.indexOf(k) === -1)).join(", "));
ok("no string is left empty",
   he.every(k => T.he[k] !== "" && T.en[k] !== ""),
   he.filter(k => T.he[k] === "" || T.en[k] === "").join(", "));
ok("the two languages agree on which keys are lists",
   he.every(k => Array.isArray(T.he[k]) === Array.isArray(T.en[k])),
   he.filter(k => Array.isArray(T.he[k]) !== Array.isArray(T.en[k])).join(", "));
ok("lists are the same length in both",
   he.filter(k => Array.isArray(T.he[k])).every(k => T.he[k].length === T.en[k].length));

group("placeholders");
const holders = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join(",");
const flat = (v) => Array.isArray(v) ? v.join(" ") : v;
ok("a placeholder in one language exists in the other too",
   he.every(k => holders(flat(T.he[k])) === holders(flat(T.en[k]))),
   he.filter(k => holders(flat(T.he[k])) !== holders(flat(T.en[k])))
     .map(k => k + " (" + holders(flat(T.he[k])) + " vs " + holders(flat(T.en[k])) + ")").join(", "));

group("everything the views ask for");
/* Strict: written in the views as L.something. */
const referenced = new Set();
(app.match(/\bL\.([A-Za-z_][A-Za-z0-9_]*)/g) || []).forEach(m => referenced.add(m.slice(2)));

/* keys the views build at run time, from a role or title name */
const computed = ["roleImpostor", "roleConfused", "roleWitness", "roleAccomplice", "roleJester", "roleInnocent"];
["Snake", "Detective", "Glass", "Ghost", "Jester", "Veteran"].forEach(t => {
  computed.push("title" + t); computed.push("title" + t + "Note");
});
["noteStreak", "noteGrudge", "noteJester", "noteNeverWins"].forEach(k => computed.push(k));
/* chosen at run time: the clue check's reason, and the live region's phase name */
["errOneWord", "errTooShort", "errIsWord", "lobby"].forEach(k => computed.push(k));

const missing = [...referenced].filter(k => he.indexOf(k) === -1);
ok("every string the views reference exists", missing.length === 0, missing.join(", "));
const missingComputed = computed.filter(k => he.indexOf(k) === -1);
ok("every string built at run time exists too", missingComputed.length === 0, missingComputed.join(", "));

group("unused");
/* Lenient, for the other direction only: a key reached through App.fail("errCode")
   or _fatal("hostLeft") still appears as a quoted string somewhere in the source. */
const quoted = new Set((app.match(/"([A-Za-z_][A-Za-z0-9_]*)"/g) || []).map(m => m.slice(1, -1)));
const unused = he.filter(k =>
  !referenced.has(k) && !quoted.has(k) && computed.indexOf(k) === -1 && k !== "dir" && k !== "name");
ok("no string is dead weight", unused.length === 0, unused.join(", "));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
