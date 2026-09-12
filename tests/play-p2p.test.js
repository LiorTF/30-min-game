/* Suspect - peer to peer.
   The same game with no database behind it: the player who opens the room
   hosts it in their own browser and everyone else connects to them.

   Runs a local signalling broker and a local static server, then plays a
   four-player round over real WebRTC data channels — including a forged
   message from a guest, which the host must refuse.

   Run: node tests/play-p2p.test.js                                        */
const fs = require("fs"), path = require("path"), http = require("http");
const { chromium } = require("/tmp/claude-0/node_modules/playwright-core");
const { PeerServer } = require("/tmp/claude-0/node_modules/peer");

const ROOT = path.join(__dirname, "..");
const SHOTS = process.env.SHOTS || "/tmp/claude-0/shots";
const WEB_PORT = 8321, BROKER_PORT = 9321;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  [ok] " + n); } else { fail++; console.log("  [XX] " + n + (d ? "  -> " + d : "")); } };
const step = n => console.log("\n" + n);
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  /* a signalling broker of our own, standing in for the public one */
  const broker = PeerServer({ host: "127.0.0.1", port: BROKER_PORT, path: "/", allow_discovery: false });

  /* plain static hosting, exactly like a public web address would be */
  const web = http.createServer((req, res) => {
    const name = (req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]).replace(/^\//, "");
    const file = path.join(ROOT, name);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end("no"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => web.listen(WEB_PORT, "127.0.0.1", r));

  const URL = "http://127.0.0.1:" + WEB_PORT + "/index.html?peer=127.0.0.1:" + BROKER_PORT + ":0";
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const errors = [];
  const pages = [];
  const names = ["Dana", "Yoav", "Michal", "Avi"];

  for (let i = 0; i < 4; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    /* the sandbox cannot reach cdnjs; the peer library is served with the game */
    await page.route("**/qrcode*.js", r => r.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route("**/fonts.googleapis.com/**", r => r.fulfill({ contentType: "text/css", body: "" }));
    page.on("pageerror", e => errors.push(names[i] + ": " + e.message));
    await page.goto(URL);
    pages.push(page);
  }
  const [host, p1, p2, p3] = pages;
  const state = () => host.evaluate(() => JSON.parse(JSON.stringify(window.SUSPECT_NET_P2P.state)));
  const room = async () => (await state()).room;
  const seats = async () => Object.values((await state()).seats);

  step("no database, no account");
  ok("the page falls back to the peer-to-peer transport",
     await host.evaluate(() => !window.claude));

  step("opening a room");
  await host.fill("#nameIn", names[0]);
  await host.click("#btnCreate");
  await host.waitForSelector(".code", { timeout: 20000 });
  const code = (await host.textContent(".code")).trim();
  ok("the host claimed a room code from the broker", /^[A-Z0-9]{4}$/.test(code), code);
  ok("the opener is warned to keep the page open", await host.$(".note--warn") !== null);
  ok("the host role cannot be handed on in a peer room", await host.$("#btnClaim") === null);

  step("three phones join over webrtc");
  for (let i = 0; i < 3; i++) {
    await pages[i + 1].fill("#nameIn", names[i + 1]);
    await pages[i + 1].fill("#codeIn", code);
    await pages[i + 1].click("#btnJoin");
    await pages[i + 1].waitForSelector(".roster", { timeout: 20000 });
  }
  await wait(900);
  ok("all four are seated on the host's screen", (await host.$$(".roster li")).length === 4);
  ok("and on a guest's screen", (await p2.$$(".roster li")).length === 4);
  ok("the guest sees the same room code", (await p2.textContent(".foot")).indexOf(code) !== -1);
  await host.screenshot({ path: SHOTS + "/p1-lobby.png", fullPage: true });

  step("a wrong code is refused");
  const stray = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const strayPage = await stray.newPage();
  await strayPage.route("**/qrcode*.js", r => r.fulfill({ contentType: "text/javascript", body: "" }));
  await strayPage.route("**/fonts.googleapis.com/**", r => r.fulfill({ contentType: "text/css", body: "" }));
  await strayPage.goto(URL);
  await strayPage.fill("#nameIn", "Nobody");
  await strayPage.fill("#codeIn", code === "ZZZZ" ? "YYYY" : "ZZZZ");
  await strayPage.click("#btnJoin");
  await strayPage.waitForSelector(".err", { timeout: 20000 });
  ok("joining a room that does not exist fails with a message",
     (await strayPage.textContent(".err")).trim().length > 0);
  await stray.close();

  step("a full round over the data channels");
  await host.click("#btnStart");
  await host.waitForSelector("#card", { timeout: 15000 });
  await wait(700);
  const r0 = await room();
  ok("the round reached every guest", await p3.$("#card") !== null);
  ok("one impostor was chosen", r0.impostorIds.length === 1);

  const ids = [];
  for (const pg of pages) ids.push(await pg.evaluate(() => sessionStorage.getItem("suspect.id")));
  const impIdx = ids.indexOf(r0.impostorIds[0]);

  for (const pg of pages) { await pg.click("#btnReady"); await wait(150); }
  await wait(900);
  ok("ready moves the whole table on", (await room()).phase === "clues", (await room()).phase);

  const w1 = ["alpha", "beta", "gamma", "delta"];
  for (let i = 0; i < 4; i++) { await pages[i].fill("#clueIn", w1[i]); await pages[i].click("#btnClue"); await wait(200); }
  await wait(900);
  ok("a second clue round opens for everyone", (await room()).clueRound === 2);
  const w2 = ["zeta", "eta", "iota", "kappa"];
  for (let i = 0; i < 4; i++) { await pages[i].fill("#clueIn", w2[i]); await pages[i].click("#btnClue"); await wait(200); }
  await wait(900);
  ok("the table reaches the vote", (await room()).phase === "vote", (await room()).phase);
  ok("a guest sees everyone's clues", (await p1.$$(".clues li")).length === 4);

  step("a guest cannot forge someone else's seat");
  /* aim at anyone but the sender: patching your own seat is allowed, so p1
     must target somebody else for this to prove anything */
  const victim = ids.find((id, i) => i !== 1);
  await p1.evaluate(v => {
    window.SUSPECT_NET_P2P.hostConn.send({ t: "seat", id: v, patch: { score: 999, vote: "rigged" } });
  }, victim);
  await wait(800);
  const victimSeat = (await seats()).find(s => s.id === victim);
  ok("the host refuses a patch aimed at another player", victimSeat.score !== 999,
     "score " + victimSeat.score);
  ok("and the forged vote never landed", victimSeat.vote !== "rigged");

  step("catching the impostor");
  const impId = ids[impIdx];
  for (let i = 0; i < 4; i++) {
    const t = i === impIdx ? ids[(impIdx + 1) % 4] : impId;
    const button = '.pick[data-vote="' + t + '"]';
    /* state arrives over the data channel, so a phone may still be painting
       the vote screen; wait for the button rather than racing it */
    await pages[i].waitForSelector(button + ":not([disabled])", { timeout: 10000 });
    await pages[i].click(button);
    await wait(180);
  }
  await wait(1000);
  ok("the caught impostor is asked to guess", (await room()).phase === "guess", (await room()).phase);
  await pages[impIdx].waitForSelector(".pick--word", { timeout: 10000 });
  await pages[impIdx].click('.pick--word[data-guess="' + (await room()).wordIdx + '"]');
  await wait(1200);

  ok("the round ends in a verdict for everyone", (await room()).phase === "results");
  const final = await seats();
  ok("the caught impostor who guessed right took 2",
     final.find(s => s.id === impId).score === 2,
     String(final.find(s => s.id === impId).score));
  ok("the other three took 2 each",
     final.filter(s => s.id !== impId).every(s => s.score === 2),
     final.filter(s => s.id !== impId).map(s => s.score).join(","));
  ok("a guest sees the same verdict", (await p2.textContent(".verdict__word")).trim().length > 0);
  await p2.screenshot({ path: SHOTS + "/p2-verdict-guest.png", fullPage: true });

  step("when the host closes the page");
  await host.close();
  /* WebRTC will not report a vanished peer promptly, so the guests fall back
     on the room's heartbeat going quiet — give that watchdog its window */
  await wait(26000);
  const guestText = await p1.textContent("body");
  ok("the guests are told the room has closed and sent home",
     await p1.$("#btnCreate") !== null, guestText.slice(0, 60));
  ok("with an explanation rather than a silent failure", await p1.$(".err") !== null);
  await p1.screenshot({ path: SHOTS + "/p3-host-left.png", fullPage: true });

  step("console");
  ok("no page errors anywhere", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  web.close();
  broker.close ? broker.close() : null;
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log("HARNESS ERROR\n" + e.stack); process.exit(1); });
