# Fishbowl

Fishbowl is a local Wi-Fi party game (Monikers-style: Taboo + Password + Charades) for phones on the same network.

## Why use this app

- Fast setup in a browser (no install on player devices).
- Team-based rounds with a shared deck and timer.
- Designed for in-room play with one presenter at a time.

## Game flow

1. Players join lobby and are auto-assigned alternating teams (first join is RED).
2. Everyone submits cards in Card Entry.
3. Host starts game.
4. Presenters rotate through timed turns.
5. Same master deck is replayed across 3 rounds with reshuffle each round.
6. Optional host setting: randomize presenter order after each full cycle while keeping team alternation.

## What each button means

- **Score**: Press when your team correctly guessed the card header phrase.
- **Pass**: Press to skip a card and send it to the back of the current deck (for example, if you don’t want to clue it yet).
- **Opponent Point**: Press if you accidentally used forbidden wording (e.g., you said words from the header) and the point should go to the other team.
- **Undo**: Press immediately after a score/opponent-point if you applied it incorrectly.

Card writing rule:

- Card description cannot reuse words from the card header (case-insensitive), to keep clues fair.

## UI quick tour

- Round screen uses team-tinted backgrounds for the active presenter.
- Ready/Start appears before a turn; scoring controls appear during live turn.
- Card interactions animate to reinforce game actions:
  - Score / Opponent Point: upward swipe
  - Pass: right then back-left swipe (to back of deck)

## Screenshots

Add gameplay screenshots here (for example: lobby, card entry, active round, final results).

## Run locally

```bash
npm start
```

Open on host machine:

`http://localhost:3000`

Host helper (auto-opened):

`http://localhost:3001` (QR code page)

Open from phones on same Wi-Fi:

`http://<host-lan-ip>:3000`
