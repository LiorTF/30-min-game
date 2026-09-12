/* Suspect - a full table.
   Twelve players, three impostors. Checks the things that only go wrong once
   the room is big: the impostor count, naming who is holding the round up,
   carrying each player's clues onto the vote buttons, and scoring a round
   where two impostors walk away while one is caught.
   Run: node tests/play-huge.test.js                                        */
const fs = require("fs"), path = require("path");
const { chromium } = require("/tmp/claude-0/node_modules/playwright-core");

const ROOT = path.join(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-db.js"), "utf8");
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";
const N = 12;

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
/* Send a clue and wait for the room to have actually recorded it. Watching the
   input disappear is not enough: for the last player of a round it is replaced
   by the next round's input rather than removed. */
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


const NAMES = ["Dana", "Yoav", "Michal", "Avi", "Noa", "Tal", "Ronit", "Eitan",
               "Shira", "Omer", "Gali", "Itai"];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const errors = [];
  const pages = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.exposeFunction("__db", db);
    await page.addInitScript(MOCK);
    page.on("pageerror", e => errors.push(NAMES[i] + ": " + e.message));
    await page.goto(URL);
    pages.push(page);
  }
  const host = pages[0];

  step("twelve at the table");
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
  await wait(1200);
  ok("twelve players are seated", (await host.$$(".roster li")).length === N,
     String((await host.$$(".roster li")).length));
  ok("a long roster switches to tighter rows", await host.$(".roster--dense") !== null);
  ok("three impostors unlock at ten",
     !(await host.$eval('[data-set="impostors"][data-val="3"]', el => el.disabled)));

  step("three impostors");
  await host.click('[data-set="impostors"][data-val="3"]');
  await wait(400);
  await host.click('[data-set="clueRounds"][data-val="1"]');
  await wait(700);
  ok("the room is set to three impostors and one clue round",
     room().settings.impostors === 3 && room().settings.clueRounds === 1,
     JSON.stringify(room().settings));
  await host.screenshot({ path: SHOTS + "/h1-lobby12.png", fullPage: true });

  await host.click("#btnStart");
  await host.waitForSelector("#card", { timeout: 10000 });
  await wait(900);
  ok("three impostors are dealt", room().impostorIds.length === 3, JSON.stringify(room().impostorIds));
  ok("they are three different people", new Set(room().impostorIds).size === 3);

  const ids = [];
  for (const p of pages) ids.push(await p.evaluate(() => sessionStorage.getItem("suspect.id")));
  const impIdx = room().impostorIds.map(id => ids.indexOf(id));
  const innocentIdx = ids.map((_, i) => i).filter(i => impIdx.indexOf(i) === -1);
  ok("nine innocents and three impostors", innocentIdx.length === 9);

  const impCard = await pages[impIdx[0]].textContent(".flip__front");
  ok("an impostor is told how many others are out there", impCard.indexOf("2") !== -1, impCard.slice(0, 90));
  const cleanCard = await pages[innocentIdx[0]].textContent(".flip__front");
  ok("an innocent is told nothing about impostors", cleanCard.indexOf("2") === -1);

  step("naming who we are waiting for");
  for (let i = 0; i < N - 2; i++) { await pages[i].click("#btnReady"); await wait(70); }
  await wait(900);
  const waitText = await host.textContent(".waitlist");
  ok("the two stragglers are named on everyone's phone",
     waitText.indexOf(NAMES[N - 1]) !== -1 && waitText.indexOf(NAMES[N - 2]) !== -1, waitText);
  await host.screenshot({ path: SHOTS + "/h2-waiting.png", fullPage: true });
  for (let i = N - 2; i < N; i++) { await pages[i].click("#btnReady"); await wait(70); }
  await wait(900);
  ok("the round moves on once the last two arrive", room().phase === "clues", room().phase);

  step("twelve clues");
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta",
                 "eta", "theta", "iota", "kappa", "lambda", "sigma"];
  for (let i = 0; i < N; i++) { await sendClue(pages[i], words[i], ids[i], "clue"); }
  await wait(1200);
  ok("the table reaches the vote", room().phase === "vote", room().phase);
  ok("all twelve clues are on the table", (await host.$$(".clues li")).length === N);

  step("clues travel onto the vote buttons");
  const clueOnButton = await host.$eval('.pick[data-vote="' + ids[1] + '"] .pick__clue', el => el.textContent.trim());
  ok("each vote button carries that player's own clue", clueOnButton === words[1], clueOnButton);
  await host.screenshot({ path: SHOTS + "/h3-vote12.png", fullPage: true });

  step("nine innocents converge on one impostor");
  const target = ids[impIdx[0]];
  for (const i of innocentIdx) { await pages[i].click('.pick[data-vote="' + target + '"]'); await wait(70); }
  /* the impostors spread their votes over innocents */
  for (let j = 0; j < impIdx.length; j++) {
    await pages[impIdx[j]].click('.pick[data-vote="' + ids[innocentIdx[j]] + '"]');
    await wait(70);
  }
  await wait(1200);
  ok("one caught impostor goes to the guess", room().phase === "guess", room().phase);
  ok("the caught one is the impostor the table named", room().caughtId === target);

  await pages[impIdx[0]].waitForSelector(".pick--word", { timeout: 8000 });
  await pages[impIdx[0]].click('.pick--word[data-guess="' + room().wordIdx + '"]');
  await wait(1200);

  step("verdict for a big table");
  ok("the round ends in a verdict", room().phase === "results", room().phase);
  const seats = seatsOf();
  const byId = id => seats.find(s => s.id === id);
  ok("the caught impostor takes 2 for a right guess", byId(target).score === 2, String(byId(target).score));
  ok("the two who slipped through take 3 each",
     impIdx.slice(1).every(i => byId(ids[i]).score === 3),
     impIdx.slice(1).map(i => byId(ids[i]).score).join(","));
  ok("all nine who caught them take 2",
     innocentIdx.every(i => byId(ids[i]).score === 2),
     innocentIdx.map(i => byId(ids[i]).score).join(","));
  ok("the verdict names all three impostors",
     (await host.textContent(".verdict__name")).split("·").length === 3);
  ok("three clue rows are marked as impostors", (await host.$$(".clues li.is-imp")).length === 3);
  ok("a vote bar is drawn for every player", (await host.$$(".bar")).length === N);
  await host.screenshot({ path: SHOTS + "/h4-verdict12.png", fullPage: true });

  step("layout at twelve");
  ok("no sideways scrolling on a phone",
     !(await host.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await host.setViewportSize({ width: 900, height: 1000 });
  await wait(400);
  ok("no sideways scrolling on a wide screen",
     !(await host.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await host.screenshot({ path: SHOTS + "/h5-wide12.png", fullPage: true });

  step("console");
  ok("no page errors anywhere", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR\n" + e.stack); process.exit(1); });
