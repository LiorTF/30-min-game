/* The deck, for the node-side tests.
   Not a copy: it evaluates deck.js exactly as a browser would, so the tests
   can never drift from the deck the game actually ships. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = {};
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "deck.js"), "utf8"), ctx);

module.exports = ctx.window.SUSPECT_DECK;
module.exports.PACKS = ctx.window.SUSPECT_PACKS;
