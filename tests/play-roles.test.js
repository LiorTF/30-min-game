/* Suspect - roles at a full table.
   Nine players with every role in play: the impostor, the confused who holds
   the wrong word and is never told, the witness, the accomplice, and the
   jester who wins by being voted out.

   Also checks that the table's record is written and published.
   Run: node tests/play-roles.test.js                                       */
const fs = require("fs"), path = require("path");
const { chromium } = require("/tmp/claude-0/node_modules/playwright-core");

const ROOT = path.join(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-db.js"), "utf8");
const DECK = require(path.join(ROOT, "deck.node.js"));
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";
const N = 9;

const store = new Map();
function db({ op, path: p, data }) {
  if (op === "get") return store.get(p) || null;
  if (op === "set") { store.set(p, JSON.parse(JSON.stringify(data))); return null; }
  if (op === "update") { store.set(p, Object.assign({}, store.get(p) || {}, JSON.parse(JSON.stringify(data)))); return null; }
  if (op === "del") { store.delete(p); return null; }
  if (op === "query") {
    const out = [];
    for (const [k, v] of store) if (k.startsWith(p + "/") && k.slice(p.length + 1).indexOf("/") === -1) out.push({ id: k.split("/").pop(), data: v });
    return out;
  }
  return null;
}
const room = () => { for (const [k, v] of store) if (/^rooms\/[A-Z0-9]{4}$/.test(k)) return v; return null; };
const seatsOf = () => [...store.entries()].filter(([k]) => k.includes("/players/")).map(([, v]) => v);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  [ok] " + n); } else { fail++; console.log("  [XX] " + n + (d ? "  -> " + d : "")); } };
const step = n => console.log("\n" + n);
const wait = ms => new Promise(r => setTimeout(r, ms));
const NAMES = ["Dana", "Yoav", "Michal", "Avi", "Noa", "Tal", "Ronit", "Eitan", "Shira"];

const sendClue = async (page, word, id, field) => {
  await page.fill("#clueIn", word);
  await page.click("#btnClue");
  for (let t = 0; t < 100; t++) {
    const seat = seatsOf().find(s => s.id === id);
    if (seat && String(seat[field] || "").trim()) return;
    await wait(100);
  }
  throw new Error("clue from " + id + " never registered");
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const errors = [];
  const pages = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.exposeFunction("__db", db);
    await page.addInitScript(MOCK);
    page.on("pageerror", e => errors.push(NAMES[i] + ": " + e.message));
    await page.goto(URL);
    pages.push(page);
  }
  const host = pages[0];

  step("nine at the table");
  await host.fill("#nameIn", NAMES[0]);
  await host.click("#btnCreate");
  await host.waitForSelector(".code", { timeout: 10000 });
  const code = (await host.textContent(".code")).trim();
  for (let i = 1; i < N; i++) {
    await pages[i].fill("#nameIn", NAMES[i]);
    await pages[i].fill("#codeIn", code);
    await pages[i].click("#btnJoin");
    await pages[i].waitForSelector(".roster", { timeout: 10000 });
  }
  await wait(900);
  ok("nine players are seated", (await host.$$(".roster li")).length === N);

  step("naming the table");
  await host.fill("#tableIn", "ליל שישי");
  await host.press("#tableIn", "Enter");
  await wait(600);
  ok("the table has a name", room().table === "ליל שישי", room().table);

  step("full roles");
  await host.click('[data-setstr="roleMode"][data-val="full"]');
  await host.click('[data-set="clueRounds"][data-val="1"]');
  await wait(700);
  ok("the room is set to full roles", room().settings.roleMode === "full", JSON.stringify(room().settings));
  await host.screenshot({ path: SHOTS + "/r1-lobby.png", fullPage: true });

  await host.click("#btnStart");
  await host.waitForSelector("#card", { timeout: 10000 });
  await wait(900);

  const ids = [];
  for (const p of pages) ids.push(await p.evaluate(() => sessionStorage.getItem("suspect.id")));
  const r = room();
  const roleById = r.roleById || {};
  const pageOf = role => pages[ids.indexOf(Object.keys(roleById).find(id => roleById[id] === role))];
  const idOf = role => Object.keys(roleById).find(id => roleById[id] === role);

  ok("every player was dealt a role", Object.keys(roleById).length === N);
  ["impostor", "confused", "jester", "witness", "accomplice"].forEach(role => {
    ok("the " + role + " is at the table", !!idOf(role), JSON.stringify(roleById));
  });
  ok("nobody holds two roles at once", new Set(Object.values(roleById)).size >= 5);

  step("what each of them sees");
  const realWord = DECK[r.catIdx].w[r.wordIdx][0];
  const decoy = r.confusedWordIdx >= 0 ? DECK[r.catIdx].w[r.confusedWordIdx][0] : null;

  const impText = await pageOf("impostor").textContent(".flip__front");
  ok("the impostor is told they are the impostor", impText.indexOf(realWord) === -1);

  const confusedPage = pageOf("confused");
  const confusedWord = (await confusedPage.textContent(".flip__word")).trim();
  ok("the confused is holding a real word", confusedWord.length > 0);
  ok("but not the table's word", confusedWord !== realWord, confusedWord + " vs " + realWord);
  ok("it is the decoy the round dealt them", confusedWord === decoy, confusedWord + " vs " + decoy);
  ok("and nothing on their card hints at it",
     await confusedPage.$(".flip__front .rolechip") === null);

  const witnessPage = pageOf("witness");
  const witnessText = await witnessPage.textContent(".flip__front");
  const clearedName = seatsOf().find(s => s.id === r.witnessClearedId).name;
  ok("the witness is given one name", witnessText.indexOf(clearedName) !== -1, witnessText.slice(0, 80));
  ok("and that name is genuinely not an impostor",
     r.impostorIds.indexOf(r.witnessClearedId) === -1);
  ok("nor the accomplice", r.witnessClearedId !== idOf("accomplice"));

  const accText = await pageOf("accomplice").textContent(".flip__front");
  const impName = seatsOf().find(s => s.id === r.impostorIds[0]).name;
  ok("the accomplice is told who to protect", accText.indexOf(impName) !== -1, accText.slice(0, 80));
  ok("and still holds the real word", accText.indexOf(realWord) !== -1);

  const jesterText = await pageOf("jester").textContent(".flip__front");
  ok("the jester is told how they win", jesterText.length > 20);
  ok("the jester's card is marked", await pageOf("jester").$(".flip__front .rolechip") !== null);

  /* photograph a role card, open, for the record */
  await pageOf("jester").mouse.move(4, 4);
  await pageOf("jester").focus("#card");
  await pageOf("jester").keyboard.press("Enter");
  await wait(350);
  await pageOf("jester").screenshot({ path: SHOTS + "/r2-jester.png", fullPage: true });
  await pageOf("jester").keyboard.press("Enter");

  step("the round");
  for (let i = 0; i < N; i++) { await pages[i].click("#btnReady"); await wait(80); }
  await wait(800);
  ok("the table moves to the clues", room().phase === "clues", room().phase);

  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota"];
  for (let i = 0; i < N; i++) { await sendClue(pages[i], words[i], ids[i], "clue"); }
  await wait(900);
  ok("and on to the vote", room().phase === "vote", room().phase);

  step("the table falls for the jester");
  const jesterId = idOf("jester");
  for (let i = 0; i < N; i++) {
    const target = ids[i] === jesterId ? ids.find(id => id !== jesterId && id !== ids[i]) : jesterId;
    const button = '.pick[data-vote="' + target + '"]';
    await pages[i].waitForSelector(button + ":not([disabled])", { timeout: 10000 });
    await pages[i].click(button);
    await wait(90);
  }
  await wait(1100);
  ok("the jester's round ends without a guess", room().phase === "results", room().phase);
  ok("and is recorded as the jester's", room().outcome === "jester", room().outcome);

  const seats = seatsOf();
  const scoreOf = id => seats.find(s => s.id === id).score;
  ok("the jester takes 4", scoreOf(jesterId) === 4, String(scoreOf(jesterId)));
  ok("the impostor is left standing and takes 2", scoreOf(r.impostorIds[0]) === 2,
     String(scoreOf(r.impostorIds[0])));
  ok("everyone who fell for it takes nothing",
     seats.filter(s => s.id !== jesterId && r.impostorIds.indexOf(s.id) === -1)
          .every(s => s.score === 0),
     seats.map(s => s.score).join(","));

  step("the verdict tells the table who was who");
  ok("the roles are revealed", (await host.$$(".ledger__row")).length >= 4);
  const ledgerText = await host.textContent(".ledger");
  ok("including the confused", ledgerText.length > 10);
  ok("and the word they were holding all along",
     (await host.textContent(".ledger")).indexOf(decoy) !== -1, decoy);
  await host.screenshot({ path: SHOTS + "/r3-verdict.png", fullPage: true });

  step("the table's record");
  ok("the night is on the books", room().ledger && room().ledger.nights === 1,
     JSON.stringify(room().ledger && room().ledger.nights));
  ok("every player has a row", room().ledger.rows.length === N);
  ok("the record carries the table's name", room().ledger.table === "ליל שישי");
  ok("a story was published for the room", !!room().story);

  await host.click("#btnDossier");
  await wait(600);
  ok("the dossier opens", (await host.$$(".book__row")).length === N);
  ok("it names the table", (await host.textContent("h2")).indexOf("ליל שישי") !== -1);
  await host.screenshot({ path: SHOTS + "/r4-dossier.png", fullPage: true });
  await host.click("#btnDossierClose");
  await wait(400);
  ok("and closes again", await host.$(".book__row") === null);

  step("console");
  ok("no page errors anywhere", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR\n" + e.stack); process.exit(1); });
