# חשד · Suspect

A bilingual (Hebrew / English) multiplayer party game of hidden roles, built to be
played around a table on everyone's phones.

## The game

Everyone in the room gets **the same secret word** — except one player, the impostor,
who only sees the category. Each player submits **one single word** as a clue. All clues
reveal at once, the table argues, everyone votes.

- Impostor escapes the vote → **3 points**
- Impostor is caught → everyone who voted for an impostor takes **2**, and the caught
  impostor gets one guess at the real word from six options in the same category,
  worth **2** if right
- Voted correctly while the table got it wrong → **1 point** anyway

Options the host sets per room: **one, two or three impostors** (a second unlocks at
seven players, a third at ten), one or two clue rounds, and a target score of 8, 12, 20
or no finish line. In a two-clue round everyone sees the first clues before writing their second, which
changes the game completely — the impostor now has something to work with, and the
rest of the table has to decide how much more to give away.

Works from 3 players up. It is at its best from 7 upward, where two or three impostors
can hide in the noise — at that size the interface adapts: the roster and the clue list
tighten, every vote button carries that player's own clues so nobody has to hold twelve
of them in their head, and the round names whoever is still holding it up instead of
leaving the table guessing. A round runs about four minutes.

## Two ways to play

The same game ships in two forms, and the page works out which one it is running in.

**Anywhere on the web, no account.** `index.html` is an ordinary page. Serve it from
any static host — GitHub Pages, or straight off this repository through a raw CDN —
and it runs peer to peer: the player who opens the room hosts it in their own browser
and everyone else connects to it over WebRTC. Nothing to sign into, no server, no
database. The only shared service is a signalling broker that introduces the phones to
each other; after that the game data goes directly between them. The trade is that the
room lives in the opener's browser, so that page has to stay open, and the host role
cannot move to anyone else.

**Inside Claude.** `artifact.html` is the same game published as a Claude Artifact. It
uses the artifact database, so the room outlives any one player and the host role can be
handed on — but every player needs to be able to open the artifact.

Nothing else differs: one set of rules, one set of views, one stylesheet.

## Running it locally

Open `index.html` in a browser and it will use the peer-to-peer transport. To point it
at your own signalling broker rather than the public one, add
`?peer=host:port` (append `:0` for plain `ws`), which is how the tests run.

## Structure

| file | what it holds |
| --- | --- |
| `index.html` | the standalone page — full document, used for ordinary web hosting |
| `artifact.html` | the same page as a fragment, for the Claude Artifact host |
| `net-p2p.js` | transport: peer to peer over WebRTC, host-authoritative |
| `net-artifact.js` | transport: the Claude artifact database |
| `vendor/peerjs.min.js` | PeerJS 1.5.5 (MIT), served with the game so the public page depends on no CDN |
| `styles.css` | the whole visual system, as tokens |
| `deck.js` | the word deck — 20 categories, 200 words, both languages |
| `i18n.js` | every string, written natively in each language |
| `rules.js` | pure game logic: word selection, vote counting, scoring, clue validation |
| `app.js` | networking, the host state machine, views, and event binding |

`rules.js` deliberately holds no DOM, no network and no clock, so every decision the
game makes can be tested directly. `app.js` never talks to a network directly either:
it goes through whichever transport answered at startup, and both present the same
handful of calls (`open`, `join`, `updateRoom`, `updateSeat`, `removeSeat`, `onChange`).

### Data model (artifact transport)

- `rooms/{CODE}` — phase, round, category, word, impostors, guess options, verdict,
  settings, round log
- `rooms/{CODE}/players/{playerId}` — name, score, ready, clues, vote, last delta,
  presence

Each player writes only their own player document. The host alone advances phases and
applies scoring, so every transition has exactly one writer and concurrent writes never
collide. If the host's device goes quiet for 30 seconds, any other player can take over.

## Tests

```
node tests/rules.test.js      # 63 assertions — scoring, voting, clue validation, the deck
node tests/play.test.js       # 46 assertions — a full four-player round, end to end
node tests/play-big.test.js   # 24 assertions — seven players, two impostors, a tied vote
node tests/play-huge.test.js  # 26 assertions — twelve players, three impostors
node tests/play-p2p.test.js   # 24 assertions — a full round over real WebRTC
```

`play-p2p` starts a signalling broker and a static server of its own, then plays a
four-player round over real data channels: joining by code, a wrong code being refused,
a guest trying to forge another player's seat (the host refuses it), and the guests
being told the room has closed when the host shuts their page.

The three `play` suites run real browsers: one context per player, all of them sharing a
single in-memory stand-in for the `db` capability (`tests/mock-db.js`), so a round is
actually played through every phase — cards revealed, clues written and refused, votes
cast, the impostor's last guess, points awarded, the host walking away and someone else
taking over. `tests/play.test.js` also writes screenshots of each phase to
`/tmp/claude-0/shots`.

`deck.node.js` is generated from `deck.js` for the node-side tests:

```
node -e "const fs=require('fs');fs.writeFileSync('deck.node.js',fs.readFileSync('deck.js','utf8').replace('window.SUSPECT_DECK =','module.exports ='))"
```

## Design

A single committed dark world rather than a light and dark pair: lacquer black
`#0A0709`, crimson `#CE1229`, ember `#EF4136`, bone `#EFE8E4`, with greys biased
towards the accent. Frank Ruhl Libre — a classic Hebrew serif — carries the display
type, set against Cormorant Garamond for Latin, with Assistant for the interface.

Layout uses CSS logical properties throughout, so Hebrew and English render from the
same rules and each player can switch language on their own phone mid-round without
affecting anyone else.
