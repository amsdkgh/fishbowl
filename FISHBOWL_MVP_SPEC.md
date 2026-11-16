# Fishbowl Local Web App - MVP Specification

## 1. Product Goal

Build a mobile-friendly web app that runs on one host machine and is accessible from phones on the same Wi-Fi network. The app supports a 3-round Fishbowl-style party game with community-authored cards, team scoring, timed turns, and session-only state.

MVP target: reliable local gameplay in one evening build session.

---

## 2. Scope

### In Scope (MVP)

- Local-network game hosting (single room, single host process)
- Player join by nickname (strict uniqueness with normalization)
- Manual team selection (Red/Blue)
- Player order management
- Card authoring with default quota per player (default 5)
- 3 rounds of play using the same master deck reshuffled each round
- Presenter-only card visibility and action controls
- Team scoring and per-round summaries
- End-game totals and full session reset
- Reconnect best-effort reclaim

### Out of Scope (MVP)

- User accounts/authentication
- Persistent database storage
- Spectator mode
- Multi-room support
- Semantic nickname similarity detection beyond normalization
- Hosting on internet/public URL

---

## 3. Platform and Architecture

- **Runtime:** Node.js
- **Realtime transport:** Socket.IO (or equivalent WebSocket layer)
- **Client:** Single-page app (mobile-first responsive web UI)
- **State:** In-memory on server only
- **Client persistence:** localStorage for reconnect token and nickname key
- **Network access:** `http://<host-lan-ip>:3000`

If the host process restarts, game state is intentionally lost.

---

## 4. Game Rules and Behavior

## 4.1 Players and Nicknames

- Players join with a nickname.
- Nickname uniqueness is enforced with normalization:
  - lowercase
  - remove all whitespace
- Examples considered identical:
  - `jacob`
  - `Jacob`
  - `jA CoB`
- First-come-first-serve lock on normalized nickname.

## 4.2 Teams

- Each player chooses **Red** or **Blue**.
- Minimum players: **4**.
- Teams must support alternating order for fair turn flow.

## 4.3 Card Authoring

- Host-configurable cards per player, default **5**.
- Each card contains:
  - `header` (prominent, bold)
  - `body` (normal text)
- No character limits in MVP; UI must wrap and remain usable.
- Round 1 cannot begin until all players submit required card count.

## 4.4 Deck Across Rounds

- Build one **master deck** from all submitted cards.
- At the start of each round (1, 2, 3), create the active round deck as a **reshuffled copy** of the full master deck.
- Therefore cards removed during a round reappear in later rounds.

## 4.5 Turn Controls

Presenter-only controls during active turn:

- **Scored**
  - +1 to presenter’s team
  - remove top card from current round deck
- **Pass**
  - move top card to bottom of current round deck
  - no score
- **Opponent Point**
  - +1 to opposing team
  - remove top card from current round deck
- **Undo**
  - one-level undo
  - only for last scoring action (`Scored` or `Opponent Point`)
  - restores removed card to top of deck
  - reverts awarded point
  - does not undo `Pass`

## 4.6 Timer and Turn Flow

- Default turn timer: **60 seconds** (host-configurable in lobby if desired).
- Presenter taps **Ready/Start** to begin turn.
- Show **3-second countdown** before timer starts.
- Turn ends when either:
  - timer reaches 0, or
  - current round deck becomes empty.

## 4.7 Round and Game End

- Round ends when round deck is empty.
- Immediately show round summary (no dramatic count-up animation):
  - round points (Red/Blue)
  - running totals (Red/Blue)
- Host clicks **Continue** to move forward.
- Round 2 and Round 3 start with the next presenter in player order.
- After Round 3 summary, show final totals and **End Game**.
- End Game fully wipes in-memory session; players rejoin for new game.

---

## 5. Visibility Rules

- Only current presenter sees:
  - live card content
  - action buttons
  - countdown/timer
- Non-presenters see waiting state only:
  - same team as presenter: **"Lock in, you're guessing!"**
  - opposite team: **"Sit back and shut up"**
- Scoreboard (team totals) is visible to everyone at all times.

---

## 6. Host and Permissions Model

MVP permissions:

- **Host-only**
  - reorder players
  - start gameplay
  - continue between rounds
  - end game/reset
- **Any player**
  - join/rejoin self
  - choose own team
  - submit own cards
  - take presenter actions only when they are active presenter

Server remains authoritative and rejects invalid/out-of-phase events.

---

## 7. State Machine

`LOBBY -> CARD_ENTRY -> ROUND_1 -> ROUND_2 -> ROUND_3 -> FINAL_RESULTS -> RESET`

### LOBBY
- Join, team selection, player ordering, settings
- Start blocked until minimum/valid conditions pass

### CARD_ENTRY
- Players submit required cards
- Host can proceed only after all quotas met

### ROUND_1 / ROUND_2 / ROUND_3
- Per-turn gameplay with timer and controls
- Round summary at deck exhaustion
- Host continue gate between rounds

### FINAL_RESULTS
- Show round-by-round and total points
- Host can trigger End Game

### RESET
- Clear all runtime state
- Return to LOBBY join flow

---

## 8. Validation Rules

Before starting card entry/game:

- At least 4 players connected
- Every player assigned a team
- Player order alternates teams (Red/Blue/Red/Blue...)

Before starting Round 1:

- Every player has submitted exactly required card quota

During gameplay:

- Reject actions from non-presenters
- Reject turn actions outside active round states
- Reject undo when no undoable scoring action exists

---

## 9. Reconnect Behavior

Store on client:

- `playerId` (generated UUID)
- `nicknameNorm`

On reconnect/join:

1. If `nicknameNorm` exists and `playerId` matches existing player: reclaim session.
2. If `nicknameNorm` exists but `playerId` differs: reject as duplicate.
3. Else create new player (only if phase allows joining).

Late joins during active rounds are disallowed in MVP.

---

## 10. Data Model (Reference)

```ts
type Team = "RED" | "BLUE";
type Phase =
  | "LOBBY"
  | "CARD_ENTRY"
  | "ROUND_1"
  | "ROUND_2"
  | "ROUND_3"
  | "FINAL_RESULTS";

interface Player {
  id: string;
  socketId?: string;
  nicknameRaw: string;
  nicknameNorm: string; // lowercased, all whitespace removed
  team: Team | null;
  order: number;
  connected: boolean;
  isHost: boolean;
}

interface Card {
  id: string;
  header: string;
  body: string;
  authorPlayerId: string;
}

interface RoundScore {
  RED: number;
  BLUE: number;
}

interface LastScoringAction {
  turnId: string;
  roundNumber: 1 | 2 | 3;
  actionType: "SCORED" | "OPPONENT_POINT";
  card: Card;
  awardedTeam: Team;
}

interface TurnState {
  turnId: string;
  presenterPlayerId: string;
  isRunning: boolean;
  countdownEndsAtMs: number | null;
  timerEndsAtMs: number | null;
  lastScoringAction: LastScoringAction | null;
}

interface GameState {
  phase: Phase;
  settings: {
    cardsPerPlayer: number; // default 5
    turnSeconds: number; // default 60
    preTurnCountdownSeconds: number; // fixed 3
  };
  players: Player[];
  masterDeck: Card[];
  submissionsByPlayerId: Record<string, Card[]>;
  currentRound: 1 | 2 | 3 | null;
  activeRoundDeck: Card[];
  roundScores: { 1: RoundScore; 2: RoundScore; 3: RoundScore };
  totalScores: RoundScore;
  turn: TurnState | null;
}
```

---

## 11. Required UI Screens

1. **Join Screen**
   - nickname input
   - duplicate nickname error (normalized)

2. **Lobby**
   - player list with team tags/colors
   - host controls: reorder + settings + start
   - readiness validation messaging

3. **Card Entry**
   - per-player quota progress
   - card create form (header/body)
   - submit status indicators

4. **Round Screen (Presenter)**
   - card header/body
   - countdown + timer
   - controls: Scored, Pass, Opponent Point, Undo

5. **Round Screen (Non-Presenter)**
   - waiting message by team relation
   - always-visible scoreboard

6. **Round Summary**
   - round points + running totals
   - host-only Continue button

7. **Final Results**
   - round breakdown + final totals
   - host-only End Game

---

## 12. Real-time Event Contract (Suggested)

Client -> Server:

- `join_game` `{ playerId, nicknameRaw }`
- `reconnect_player` `{ playerId, nicknameNorm }`
- `set_team` `{ playerId, team }`
- `reorder_players` `{ orderedPlayerIds[] }` (host only)
- `update_settings` `{ cardsPerPlayer?, turnSeconds? }` (host only)
- `submit_card` `{ playerId, header, body }`
- `start_card_entry` `{}` (host only)
- `start_round` `{}` (host only/system transition)
- `start_turn` `{ presenterPlayerId }` (presenter only)
- `turn_action` `{ type: "SCORED" | "PASS" | "OPPONENT_POINT" | "UNDO" }`
- `continue_after_round` `{}` (host only)
- `end_game` `{}` (host only)

Server -> Client:

- `state_snapshot` `{ gameState }`
- `state_patch` `{ changedFields }`
- `error_event` `{ code, message }`
- `turn_countdown` `{ secondsRemaining }`
- `turn_timer` `{ secondsRemaining }`
- `round_summary` `{ roundNumber, roundScores, totals }`
- `game_ended` `{}`

---

## 13. Acceptance Criteria

1. Players on same Wi-Fi can join host game URL from phones.
2. Nickname uniqueness works with case/whitespace normalization.
3. Team assignment + host reordering + start validations work.
4. Card quota enforcement blocks round start until complete.
5. Presenter-only card visibility is enforced.
6. Scored/Pass/Opponent Point/Undo behavior exactly matches rules.
7. Round transitions, summaries, and host continue gate work.
8. Round 3 final results render correctly.
9. End Game fully resets session state.

---

## 14. Build Plan (Tonight)

1. Bootstrap Node + Socket.IO + SPA shell
2. Implement core server game state + state machine
3. Add lobby/team/order/settings flows
4. Add card entry and quota tracking
5. Implement round deck generation + turn actions
6. Implement timer/countdown and end-turn transitions
7. Add summaries/final results/reset
8. Mobile UI polish and local Wi-Fi test on 2+ phones

This order is optimized for a working MVP before polish.
