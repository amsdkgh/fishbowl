# Fishbowl Technical Spec

## Scope

This spec defines gameplay state behavior and current UI/interaction behavior for the local no-dependency Fishbowl web app.

## Runtime model

- Backend: Node.js HTTP server (`server.js`), in-memory game state.
- Frontend: vanilla HTML/CSS/JS (`public/`), polling server state.
- Transport: REST endpoints (`/api/state`, `/api/join`, `/api/action`).

## Core game state

- Phases: `LOBBY`, `CARD_ENTRY`, `ROUND_1`, `ROUND_2`, `ROUND_3`, `ROUND_SUMMARY`, `FINAL_RESULTS`
- Teams: `RED`, `BLUE`
- Timed turn model:
  - `IDLE` -> `COUNTDOWN` -> `RUNNING` -> end/next presenter
- Round progression:
  - Round deck built from master deck; reshuffled each round
  - 3 rounds total, then final results

## Lobby and join behavior

- Nickname uniqueness enforced case/whitespace-insensitively.
- Rejoin supported by player id + nickname match.
- Late join disabled after lobby.
- Auto-team assignment for new players:
  - First joined player defaults to `RED`
  - Each subsequent join defaults to the opposite of the most recent assigned team

## Action semantics

- `SCORED`: awards point to presenter team.
- `OPPONENT_POINT`: awards point to opposing team.
- `PASS`: moves top card to back of active round deck.
- `UNDO`: reverts most recent scoring action within same turn/round.

## UI behavior spec (current)

### Global theming

- Page background is presenter-team tinted during round phases:
  - RED presenter -> dark red tint
  - BLUE presenter -> dark blue tint

### Presenter control visibility

- `IDLE`: show only `Ready / Start`
- `COUNTDOWN`: hide scoring controls
- `RUNNING`: show score/pass/opponent/undo controls + prompt card

### Round layout hierarchy

Primary presenter action layout:
1. Score button (primary)
2. Prompt card
3. Pass button (primary)
4. Secondary row: Opponent Point, Undo

### Card interaction animations

- Score and Opponent Point: upward swipe animation
- Pass: right then back-left swipe animation
- Score feedback: floating `+1` with awarded-team color

### Button color states

- Team-sensitive buttons are team-colored.
- Pressed/temporarily disabled team buttons stay in darker team shades (not neutral gray).

### Team selection controls

- Team dropdown is color-coded:
  - Selected state: neutral / red / blue
  - Option backgrounds: neutral / red / blue

### Card Entry controls

- Card Entry header includes top-right CTA: `Start game`.

## Error handling expectations

- Server action failures surface API message in UI alert.
- Client render exceptions should not be reported as action failure; network/action and render paths are handled separately.
