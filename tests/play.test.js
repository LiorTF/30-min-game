/* Suspect - end-to-end round.
   Four browser contexts, one shared in-memory database, one full round
   played through every phase. Run: node tests/play.test.js            */
const fs = require("fs"), path = require("path");
const { chromium } = require("/tmp/claude-0/node_modules/playwright-core");

const ROOT = path.join(__dirname, "..");
const URL = "file://" + path.join(ROOT, "index.html");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-db.js"), "utf8");
const DECK = require(path.join(ROOT, "deck.node.js"));
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";

/* ---- the shared store ---- */
const store = new Map();
function db({ op, path: p, data }) {
  if (op === "get") return store.get(p) || null;
  if (op === "set") { store.set(p, JSON.parse(JSON.stringify(data))); return null; }
  if (op === "update") { store.set(p, Object.assign({}, store.get(p) || {}, JSON.parse(JSON.stringify(data)))); return null; }
  if (op === "del") { store.delete(p); return null; }
  if (op === "query") {
    const out = [];
    for (const [k, v] of store) {
      if (k.startsWith(p + "/") && k.slice(p.length + 1).indexOf("/") === -1) out.push({ id: k.split("/").pop(), data: v });
    }
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


(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const errors = [];
  const players = [];
  const names = ["Dana", "Yoav", "Michal", "Avi"];

  for (let i = 0; i < 4; i++) {
    /* a context each; identity is per tab, so each page is its own player */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.exposeFunction("__db", db);
    await page.addInitScript(MOCK);
    /* the sandbox has no route to the font/QR CDNs; those are not app errors */
    page.on("console", m => {
      const text = m.text();
      if (m.type() === "error" && !/Failed to load resource|ERR_(TUNNEL|CONNECTION|NAME)/.test(text)) {
        errors.push(names[i] + ": " + text);
      }
    });
    page.on("pageerror", e => errors.push(names[i] + ": " + e.message));
    await page.goto(URL);
    players.push(page);
  }
  const [host, p1, p2, p3] = players;
  const guests = [p1, p2, p3];

  /* ---------- open and fill the room ---------- */
  step("lobby");
  await host.fill("#nameIn", names[0]);
  const openedAt = Date.now();
  await host.click("#btnCreate");
  await host.waitForSelector(".code", { timeout: 8000 });
  const openMs = Date.now() - openedAt;
  const code = (await host.textContent(".code")).trim();
  ok("host opened a room with a 4-character code", /^[A-Z0-9]{4}$/.test(code), code);
  /* the lobby used to wait for the next presence heartbeat before it drew */
  ok("the lobby appears at once, not on the next heartbeat", openMs < 4000, openMs + "ms");

  for (let i = 0; i < guests.length; i++) {
    await guests[i].fill("#nameIn", names[i + 1]);
    await guests[i].fill("#codeIn", code);
    await guests[i].click("#btnJoin");
    await guests[i].waitForSelector(".roster", { timeout: 8000 });
  }
  await wait(600);
  ok("all four players are seated", (await host.$$(".roster li")).length === 4);
  ok("only the host can change the settings", await p1.$eval('[data-set="impostors"]', el => el.disabled));
  ok("two impostors stay locked below seven players",
     await host.$eval('[data-set="impostors"][data-val="2"]', el => el.disabled));
  await host.screenshot({ path: SHOTS + "/1-lobby.png", fullPage: true });

  /* ---------- start ---------- */
  step("reveal");
  await host.click("#btnStart");
  await host.waitForSelector("#card", { timeout: 8000 });
  await wait(500);
  const r0 = room();
  ok("one impostor was chosen", r0.impostorIds.length === 1, JSON.stringify(r0.impostorIds));
  ok("six guess options are prepared", r0.options.length === 6);
  ok("the guess options include the real word", r0.options.indexOf(r0.wordIdx) !== -1);
  ok("every player is dealt into the round", seatsOf().every(s => s.inRound));

  await host.locator("#card").scrollIntoViewIfNeeded();
  const box = await host.locator("#card").boundingBox();
  await host.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await host.mouse.down();
  await wait(600);
  ok("holding the card opens it", await host.$eval("#card", el => el.classList.contains("is-open")));
  await host.mouse.up();
  await wait(300);
  ok("releasing shuts it again", await host.$eval("#card", el => !el.classList.contains("is-open")));

  /* The keyboard path toggles instead of holding, so the card is reachable
     without a pointer. Move the mouse off the card first: leaving the card
     ends a hold, and a full-page screenshot scrolls, so a pointer still
     resting there would close the card mid-sequence. */
  await host.mouse.move(4, 4);
  await host.focus("#card");
  await host.keyboard.press("Enter");
  await wait(300);
  ok("the card opens from the keyboard too", await host.$eval("#card", el => el.classList.contains("is-open")));
  await host.keyboard.press("Enter");
  await wait(250);
  ok("a second press closes it", await host.$eval("#card", el => !el.classList.contains("is-open")));

  /* open once more purely for the photograph */
  await host.keyboard.press("Enter");
  await wait(300);
  await host.screenshot({ path: SHOTS + "/2-reveal.png", fullPage: true });
  await host.keyboard.press("Enter");
  await wait(200);

  for (const pg of players) { await pg.click("#btnReady"); await wait(120); }
  await wait(700);
  ok("the table moves on once everyone is ready", room().phase === "clues", room().phase);

  /* ---------- clues, both rounds ---------- */
  step("clues");
  const seatIds = [];
  for (const pg of players) seatIds.push(await pg.evaluate(() => sessionStorage.getItem("suspect.id")));
  const impIdx = seatIds.indexOf(room().impostorIds[0]);
  ok("the impostor is hidden from their own word screen",
     (await players[impIdx].textContent(".strip__word")).indexOf("·") !== -1);
  ok("everyone else is shown the real word",
     (await players[(impIdx + 1) % 4].textContent(".strip__word")).trim().length > 1);

  const innocent = players[(impIdx + 1) % 4];
  const secretHe = DECK[room().catIdx].w[room().wordIdx][0];
  await innocent.fill("#clueIn", secretHe);
  await innocent.click("#btnClue");
  await wait(350);
  ok("writing the secret word as your clue is refused", await innocent.$(".err") !== null);
  await innocent.fill("#clueIn", "");

  const words1 = ["alpha", "beta", "gamma", "delta"];
  for (let i = 0; i < 4; i++) { await sendClue(players[i], words1[i], seatIds[i], "clue"); }
  await wait(800);
  ok("a second clue round opens", room().clueRound === 2 && room().phase === "clues",
     room().phase + "/" + room().clueRound);
  ok("round one clues are on the table before round two is written",
     (await host.$$(".clues li")).length === 4);
  await host.screenshot({ path: SHOTS + "/3-clues.png", fullPage: true });

  const words2 = ["zeta", "eta", "iota", "kappa"];
  for (let i = 0; i < 4; i++) { await sendClue(players[i], words2[i], seatIds[i], "clue2"); }
  await wait(800);
  ok("the table moves to the vote", room().phase === "vote", room().phase);

  /* ---------- vote ---------- */
  step("vote");
  await host.waitForSelector(".pick", { timeout: 6000 });
  ok("both clues per player are shown before voting",
     (await host.$$(".clues__w--second")).length === 4);
  ok("you cannot vote for yourself",
     await host.$eval(`.pick[data-vote="${seatIds[0]}"]`, el => el.disabled));
  await host.screenshot({ path: SHOTS + "/4-vote.png", fullPage: true });

  const impId = room().impostorIds[0];
  for (let i = 0; i < 4; i++) {
    const target = i === impIdx ? seatIds[(impIdx + 1) % 4] : impId;
    await players[i].click('.pick[data-vote="' + target + '"]');
    await wait(160);
  }
  await wait(900);
  ok("catching the impostor opens their last guess", room().phase === "guess", room().phase);

  /* ---------- the impostor's guess ---------- */
  step("guess");
  const impPage = players[impIdx];
  await impPage.waitForSelector(".pick--word", { timeout: 6000 });
  ok("the caught impostor gets six words to choose from", (await impPage.$$(".pick--word")).length === 6);
  const bystander = players[(impIdx + 1) % 4];
  ok("nobody else is offered the guess", (await bystander.$$(".pick--word")).length === 0);
  await impPage.screenshot({ path: SHOTS + "/5-guess.png", fullPage: true });
  ok("the bystanders are told what is happening",
     (await bystander.textContent("h2")).trim().length > 0);
  await impPage.click('.pick--word[data-guess="' + room().wordIdx + '"]');
  await wait(1000);

  /* ---------- verdict ---------- */
  step("verdict");
  ok("the round ends in a verdict", room().phase === "results", room().phase);
  const seats = seatsOf();
  const imp = seats.find(s => s.id === impId);
  const others = seats.filter(s => s.id !== impId);
  ok("a caught impostor who guesses right takes 2", imp.score === 2, "got " + imp.score);
  ok("the three who caught them take 2 each", others.every(s => s.score === 2), others.map(s => s.score).join(","));
  ok("the round is written to the log", (room().log || []).length === 1);
  ok("the impostor's clues are marked in the verdict", (await host.$$(".clues li.is-imp")).length === 1);
  ok("vote bars are drawn for every player", (await host.$$(".bar")).length === 4);
  ok("point changes are shown on the table", (await host.$$(".delta")).length === 4);
  await host.screenshot({ path: SHOTS + "/6-verdict.png", fullPage: true });

  /* ---------- language ---------- */
  step("language");
  await p1.click("#langEn");
  await wait(500);
  ok("switching to English flips that phone to ltr", await p1.evaluate(() => document.documentElement.dir === "ltr"));
  ok("the other players stay in Hebrew", await host.evaluate(() => document.documentElement.dir === "rtl"));
  const englishText = await p1.textContent("body");
  ok("the verdict reads in English", englishText.indexOf("The word") !== -1 || englishText.indexOf("Standings") !== -1);
  await p1.screenshot({ path: SHOTS + "/7-english.png", fullPage: true });
  await p1.click("#langHe");
  await wait(300);

  /* ---------- second round ---------- */
  step("next round");
  const firstKey = room().catIdx + ":" + room().wordIdx;
  const firstCat = room().catIdx;
  await host.click("#btnStart");
  await wait(900);
  ok("round two starts", room().round === 2, "round " + room().round);
  ok("it does not reuse the first word", room().catIdx + ":" + room().wordIdx !== firstKey);
  ok("it moves to a different category", room().catIdx !== firstCat);
  ok("clues and votes are cleared", seatsOf().every(v => !v.clue && !v.clue2 && !v.vote));
  ok("scores carry across rounds", seatsOf().every(v => v.score === 2));

  /* ---------- the host walks away, and comes back ---------- */
  step("host takeover");
  const hostSeatKey = [...store.keys()].find(k => k.endsWith("/players/" + seatIds[0]));
  const quiet = ms => store.set(hostSeatKey, Object.assign({}, store.get(hostSeatKey), { lastSeen: Date.now() - ms }));

  quiet(45000);
  await wait(1200);
  ok("a briefly quiet host is not up for grabs", await p1.$("#btnClaim") === null);

  /* the host's own phone reports in every few seconds, so keep the clock
     pushed back until the other players notice the silence */
  let offered = null;
  for (let t = 0; t < 25 && !offered; t++) {
    quiet(150000);
    await wait(400);
    offered = await p1.$("#btnClaim");
  }
  ok("a host who has really gone can be replaced", offered !== null);
  await p1.click("#btnClaim");
  await wait(700);
  ok("the new host takes over", room().hostId === seatIds[1], room().hostId);

  /* the player who opened the room can always take the controls back */
  await wait(400);
  ok("the opener is offered their controls back", await host.$("#btnClaim") !== null);
  ok("and the button says so rather than offering a takeover",
     (await host.textContent("#btnClaim")).trim().length > 0);
  await host.click("#btnClaim");
  await wait(700);
  ok("the opener has the room back", room().hostId === seatIds[0], room().hostId);
  /* once the opener's phone reports in again, nobody is offered the room */
  store.set(hostSeatKey, Object.assign({}, store.get(hostSeatKey), { lastSeen: Date.now() }));
  await wait(1200);
  ok("nobody else is offered it while the opener is answering", await p2.$("#btnClaim") === null);

  /* ---------- layout ---------- */
  step("layout");
  await p2.setViewportSize({ width: 1280, height: 900 });
  await wait(400);
  await p2.screenshot({ path: SHOTS + "/8-desktop.png", fullPage: true });
  ok("no sideways scrolling on desktop",
     !(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  await p2.setViewportSize({ width: 360, height: 780 });
  await wait(400);
  ok("no sideways scrolling on a small phone",
     !(await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  ok("text never renders on a transparent ground",
     await p2.evaluate(() => getComputedStyle(document.body).backgroundColor !== "rgba(0, 0, 0, 0)"));

  step("console");
  ok("no page errors anywhere", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  console.log("screenshots -> " + SHOTS);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR\n" + e.stack); process.exit(1); });
