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

Options the host sets per room: one or two impostors (two unlock at seven players),
one or two clue rounds, and a target score of 8, 12, 20 or no finish line. In a
two-clue round everyone sees the first clues before writing their second, which
changes the game completely — the impostor now has something to work with, and the
rest of the table has to decide how much more to give away.

Best with 4–10 players. A round runs about four minutes.

## Running it

The game is published as a Claude Artifact and needs no build step. To work on it
locally, open `index.html` in a browser — without the `db` capability it will report
that it can't reach the server, which is the correct behaviour outside the artifact
host.

## Structure

| file | what it holds |
| --- | --- |
| `index.html` | page shell and script order |
| `styles.css` | the whole visual system, as tokens |
| `deck.js` | the word deck — 20 categories, 200 words, both languages |
| `i18n.js` | every string, written natively in each language |
| `rules.js` | pure game logic: word selection, vote counting, scoring, clue validation |
| `app.js` | networking, the host state machine, views, and event binding |

`rules.js` deliberately holds no DOM, no network and no clock, so every decision the
game makes can be tested directly.

### Data model

- `rooms/{CODE}` — phase, round, category, word, impostors, guess options, verdict,
  settings, round log
- `rooms/{CODE}/players/{playerId}` — name, score, ready, clues, vote, last delta,
  presence

Each player writes only their own player document. The host alone advances phases and
applies scoring, so every transition has exactly one writer and concurrent writes never
collide. If the host's device goes quiet for 30 seconds, any other player can take over.

## Tests

```
node tests/rules.test.js      # 51 assertions — scoring, voting, clue validation, the deck
node tests/play.test.js       # 46 assertions — a full four-player round, end to end
node tests/play-big.test.js   # 24 assertions — seven players, two impostors, a tied vote
```

The two `play` suites run real browsers: one context per player, all of them sharing a
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
