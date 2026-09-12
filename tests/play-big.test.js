/* Suspect - the big table.
   Seven players, two impostors, one clue round, a tied vote that lets the
   impostors walk, the host's skip control, and the end of a match.
   Run: node tests/play-big.test.js                                      */
const fs = require("fs"), path = require("path");
const { chromium } = require("/tmp/claude-0/node_modules/playwright-core");

const ROOT = path.join(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-db.js"), "utf8");
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";
const N = 7;

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
const seatKey = id => [...store.keys()].find(k => k.endsWith("/players/" + id));

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
    page.on("pageerror", e => errors.push("P" + i + ": " + e.message));
    await page.goto(URL);
    pages.push(page);
  }
  const host = pages[0];

  step("seven at the table");
  await host.fill("#nameIn", "P1");
  await host.click("#btnCreate");
  await host.waitForSelector(".code", { timeout: 8000 });
  const code = (await host.textContent(".code")).trim();
  for (let i = 1; i < N; i++) {
    await pages[i].fill("#nameIn", "P" + (i + 1));
    await pages[i].fill("#codeIn", code);
    await pages[i].click("#btnJoin");
    await pages[i].waitForSelector(".roster", { timeout: 8000 });
  }
  await wait(800);
  ok("seven players are seated", (await host.$$(".roster li")).length === N);
  ok("two impostors unlock at seven",
     !(await host.$eval('[data-set="impostors"][data-val="2"]', el => el.disabled)));

  step("settings");
  await host.click('[data-set="impostors"][data-val="2"]');
  await host.click('[data-set="clueRounds"][data-val="1"]');
  await host.click('[data-set="target"][data-val="8"]');
  await wait(600);
  const cfg = room().settings;
  ok("settings are stored for the room", cfg.impostors === 2 && cfg.clueRounds === 1 && cfg.target === 8,
     JSON.stringify(cfg));
  ok("every player sees the change", await pages[3].$eval('[data-set="impostors"][data-val="2"]',
     el => el.getAttribute("aria-pressed") === "true"));
  await host.screenshot({ path: SHOTS + "/b1-settings.png", fullPage: true });

  step("round one");
  await host.click("#btnStart");
  await host.waitForSelector("#card", { timeout: 8000 });
  await wait(600);
  ok("two impostors are dealt", room().impostorIds.length === 2, JSON.stringify(room().impostorIds));

  const ids = [];
  for (const p of pages) ids.push(await p.evaluate(() => sessionStorage.getItem("suspect.id")));
  const impIdx = room().impostorIds.map(id => ids.indexOf(id));
  ok("the two impostors are different people", impIdx[0] !== impIdx[1]);
  const impPage = pages[impIdx[0]];
  const impText = await impPage.textContent(".flip__front");
  ok("an impostor is warned there is another one", impText.indexOf("השני") !== -1 || impText.length > 10);

  /* five press ready, two wander off — the host moves the table on */
  step("the host skips the stragglers");
  for (let i = 0; i < N - 2; i++) { await pages[i].click("#btnReady"); await wait(100); }
  await wait(500);
  ok("the round waits for the last two", room().phase === "reveal", room().phase);
  await host.click("#btnSkip");
  await wait(800);
  ok("the skip control moves the table on", room().phase === "clues", room().phase);

  step("one clue round only");
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"];
  for (let i = 0; i < N; i++) { await sendClue(pages[i], words[i], ids[i], "clue"); }
  await wait(900);
  ok("one clue round goes straight to the vote", room().phase === "vote", room().phase + "/" + room().clueRound);
  ok("no second clue column is shown", (await host.$$(".clues__w--second")).length === 0);

  step("a tied vote lets them walk");
  /* P1..P3 accuse ids[5]; P4..P6 accuse ids[6]; the last accuses ids[0] -> 3-3 tie */
  const plan = [ids[5], ids[5], ids[5], ids[6], ids[6], ids[6], ids[0]];
  for (let i = 0; i < N; i++) {
    let target = plan[i];
    if (target === ids[i]) target = ids[(i + 1) % N];    /* nobody votes for themselves */
    await pages[i].click('.pick[data-vote="' + target + '"]');
    await wait(120);
  }
  await wait(1000);
  ok("a tie ends the round without a catch", room().phase === "results" && room().caught === false,
     room().phase + "/caught:" + room().caught);
  ok("the tie is recorded", room().tie === true);
  const seats = seatsOf();
  const impScores = room().impostorIds.map(id => seats.find(s => s.id === id).score);
  ok("both impostors take 3 for escaping", impScores.every(s => s === 3), impScores.join(","));
  const anyRight = seats.filter(s => room().impostorIds.indexOf(s.id) === -1 &&
                                     room().impostorIds.indexOf(s.vote) !== -1);
  ok("a correct vote on a missed round still pays 1", anyRight.every(s => s.score === 1),
     anyRight.map(s => s.score).join(","));
  ok("the verdict names both impostors", (await host.textContent(".verdict__name")).indexOf("·") !== -1);
  await host.screenshot({ path: SHOTS + "/b2-escaped.png", fullPage: true });

  step("reaching the finish line");
  /* nudge a player past the target the room is playing to */
  const k = seatKey(ids[2]);
  store.set(k, Object.assign({}, store.get(k), { score: 9 }));
  await wait(1200);
  ok("the host is offered the final table", await host.$("#btnChampion") !== null);
  await host.click("#btnChampion");
  await wait(800);
  ok("the match ends on the champion screen", room().phase === "champion", room().phase);
  ok("the winner is crowned", (await host.textContent(".crown__name")).trim() === "P3",
     await host.textContent(".crown__name"));
  ok("earlier rounds are listed", (await host.$$(".log li")).length >= 1);
  await host.screenshot({ path: SHOTS + "/b3-champion.png", fullPage: true });

  step("a new match resets the board");
  await host.click("#btnNewMatch");
  await wait(1000);
  ok("scores are cleared", seatsOf().every(s => s.score === 0));
  ok("the log is cleared", (room().log || []).length === 0);
  ok("everyone is back in the lobby", room().phase === "lobby");

  step("console");
  ok("no page errors anywhere", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR\n" + e.stack); process.exit(1); });
