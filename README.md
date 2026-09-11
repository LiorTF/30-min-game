# חשד · Suspect

A bilingual (Hebrew / English) multiplayer party game of hidden roles, built to be played
around a table on everyone's phones.

## The game

Everyone in the room gets **the same secret word** — except one player, the impostor,
who only sees the category. Each player submits **one single word** as a clue.
All clues reveal at once, everyone argues, everyone votes.

- Impostor escapes the vote → impostor scores **3**
- Impostor is caught → everyone who voted correctly scores **2**, and the impostor
  gets one guess at the real word from six options, worth **2** if correct

Best with 4–10 players. Rounds run 3–5 minutes.

## Structure

`index.html` is the whole game: layout, styling, word deck, and game logic in one file.
It is published as a Claude Artifact and uses the `db` runtime capability for realtime
multiplayer state.

Data model:

- `rooms/{CODE}` — phase, round, category, word, impostor, guess options, verdict
- `rooms/{CODE}/players/{playerId}` — name, score, ready, clue, vote, presence

Each player writes only their own player document; the host advances phases and applies
scoring, which keeps concurrent writes from colliding. If the host's device goes quiet
for 30 seconds any other player can take over as host.

## Design

Single committed dark theme — lacquer black `#0A0709`, crimson `#D01B2E`, ember `#F2564B`,
bone `#EDE6E2`. Frank Ruhl Libre for Hebrew display type, Cormorant Garamond for Latin,
Assistant for the interface. Full RTL/LTR switching per device, so two people at the same
table can play in different languages.
