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

### Roles

One asymmetry makes a good round. Five make a game worth playing for years. Roles unlock
with table size, so a small table stays simple, and each is a single sentence on your own
card — none of them adds a decision to the round.

| role | from | what you hold |
| --- | --- | --- |
| **Impostor** | always | no word, only the category |
| **Confused** | 5 players | a real word from the category — the *wrong* one, and nobody tells you |
| **Jester** | 7 players | you win by being voted out (4 points, and the impostor walks) |
| **Witness** | 8 players | one named player who is definitely not an impostor |
| **Accomplice** | 9 players | you know who the impostors are, and you win when they do |

The confused is the one that changes the table: their card is indistinguishable from an
innocent's, so they argue their wrong word with total conviction, and everyone else has
to work out whether that is a liar or a fool.

The host chooses **none / light / full**. Light adds only the confused.

### The night

Rounds run to a target score. When somebody crosses it the night does not simply end —
it goes to **the Last Trial**: one final round at double points, where anyone still
within reach can take it. Then the champion screen.

### The dossier

The table's record, kept on the host's device and published to the room. Players are
matched by name across nights, so it survives new phones and new sessions.

It tracks who was the impostor and how often they got away with it, every vote in both
directions, and the clue that fooled the most people. Out of that it awards standing
titles — **The Snake** (escapes in a row), **The Detective** (best read of the table),
**The Glass** (caught every time), **The Ghost** (never accused) — and finds the
running grudge: who votes for whom more than anyone else.

Each verdict also carries one line drawn from all of it: *"Dana walks away for the
fourth round running"*, *"Yoav voted for Michal — for the eighth time"*. That line is
the point of the whole feature.

### Word packs

The 200 words are grouped into four packs (Everyday, Head & heart, Culture, Home) so a
table can choose its own flavour, or retire the ones it knows by heart. Words never
repeat inside a room until the pack runs out.

Works from 3 players up. It is at its best from 7 upward. A round runs about four
minutes.

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
| `styles.css` | the whole visual system, as tokens |
| `deck.js` | the word deck — 20 categories, 200 words, both languages, grouped into packs |
| `i18n.js` | every string, written natively in each language |
| `rules.js` | pure: word selection, vote counting, clue validation, rejoining |
| `roles.js` | pure: who is dealt what, and what a round is worth |
| `dossier.js` | the table's long memory — records, titles, the line under each verdict |
| `net-p2p.js` | transport: peer to peer over WebRTC, host-authoritative |
| `net-artifact.js` | transport: the Claude artifact database |
| `app.js` | the host state machine, the views, and event binding |
| `vendor/peerjs.min.js` | PeerJS 1.5.5 (MIT), served with the game so the public page depends on no CDN |
| `deck.node.js` | evaluates `deck.js` for the node tests, so they cannot drift from it |

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
node tests/rules.test.js      # 70  words, voting, clue validation, rejoining
node tests/roles.test.js      # 44  role dealing and what each round is worth
node tests/dossier.test.js    # 35  the table's memory, titles and story lines
node tests/i18n.test.js       #  8  the copy holds together in both languages
node tests/play.test.js       # 52  a four-player round, end to end
node tests/play-big.test.js   # 30  seven players, a tied vote, the last trial
node tests/play-huge.test.js  # 26  twelve players, three impostors
node tests/play-roles.test.js # 40  nine players with every role in play
node tests/play-p2p.test.js   # 26  a full round over real WebRTC
```

323 assertions. The five `play` suites run real browsers — one context per player, all
sharing a single stand-in for the transport — so rounds are genuinely played through
every phase rather than simulated.

`play-p2p` goes further and starts a signalling broker and a static server of its own,
then plays a round over real data channels, including a guest trying to forge another
player's seat, which the host refuses.

The `i18n` suite is there because a missing string renders as a blank button and throws
nothing: it checks both languages carry the same keys and the same placeholders, that
every string the views reference exists, and that none is dead weight.

## Continuous integration

`.github/workflows/pages.yml` runs the four browser-free suites on every push, then
publishes the game to GitHub Pages. The publish step enables Pages for the repository
itself, so the site does not need anyone to visit the settings page first.

## Design

A single committed dark world rather than a light and dark pair: lacquer black
`#0A0709`, crimson `#CE1229`, ember `#EF4136`, bone `#EFE8E4`, with greys biased
towards the accent. Frank Ruhl Libre — a classic Hebrew serif — carries the display
type, set against Cormorant Garamond for Latin, with Assistant for the interface.

Layout uses CSS logical properties throughout, so Hebrew and English render from the
same rules and each player can switch language on their own phone mid-round without
affecting anyone else.
