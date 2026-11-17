# fishbowl

Local Wi-Fi Fishbowl game (Monikers-style: Taboo + Password + Charades) with:

- Red/Blue team setup
- Custom card entry
- 3 rounds with reshuffled master deck each round
- Presenter-only prompts
- Timed turns, scoring, pass, opponent point, and undo
- Auto team assignment on join (first player RED, then alternating by last assigned team)

## UI spec (current)

### Round/presenter experience

- Full-page background is team-coded by active presenter team:
  - RED presenter: dark red page tint
  - BLUE presenter: dark blue page tint
- Presenter controls are phase-gated:
  - **IDLE**: only `Ready / Start` visible
  - **COUNTDOWN**: scoring controls hidden
  - **RUNNING**: card + action controls visible
- Main gameplay section is centered with larger, high-contrast text for turn status, timer, and prompt content.

### Flash-card interactions

- Prompt card is styled as a physical upright flash card.
- `Score` and `Opponent Point` trigger an upward swipe animation.
- `Pass` triggers a right-then-back-left swipe animation to suggest moving card to back of deck.
- Score actions show a temporary `+1` popup in awarded team color.

### Button hierarchy and color system

- Presenter action order:
  1. `Score` (primary, above card)
  2. Card prompt
  3. `Pass` (primary, below card)
  4. Secondary row: `Opponent Point`, `Undo`
- Team-sensitive actions are color-coded:
  - `Score` uses presenter team color
  - `Opponent Point` uses opposing team color
- Pressed/temporarily disabled team buttons keep an in-family darker team shade (not neutral gray).

### Card Entry layout

- Card Entry header includes top-right CTA button labeled `Start game` (replacing `Start round 1`).

### Lobby/player team selection

- Team dropdown is color-coded:
  - Selected value colors: neutral / RED / BLUE
  - Option backgrounds are also color-coded (neutral / RED / BLUE)

## Run locally

```bash
npm start
```

Open on host machine:

`http://localhost:3000`

Open from phones on same Wi-Fi:

`http://<host-lan-ip>:3000`
