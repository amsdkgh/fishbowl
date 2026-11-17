const PHASE = {
  LOBBY: "LOBBY",
  CARD_ENTRY: "CARD_ENTRY",
  ROUND_1: "ROUND_1",
  ROUND_2: "ROUND_2",
  ROUND_3: "ROUND_3",
  ROUND_SUMMARY: "ROUND_SUMMARY",
  FINAL_RESULTS: "FINAL_RESULTS"
};

const TEAM = {
  RED: "RED",
  BLUE: "BLUE"
};

const STORAGE_KEYS = {
  playerId: "fishbowl_player_id",
  nicknameRaw: "fishbowl_nickname_raw"
};

let gameState = null;
let selectedPlayerForOrder = null;
let pollTimer = null;
let tickTimer = null;
let lastStateSignature = "";
let turnActionLocked = false;

const els = {
  connectionStatus: byId("connectionStatus"),
  phaseLabel: byId("phaseLabel"),
  roundLabel: byId("roundLabel"),
  deckCountLabel: byId("deckCountLabel"),
  scoreRed: byId("scoreRed"),
  scoreBlue: byId("scoreBlue"),
  alerts: byId("alerts"),
  joinView: byId("joinView"),
  nicknameInput: byId("nicknameInput"),
  joinBtn: byId("joinBtn"),
  lobbyView: byId("lobbyView"),
  hostBadge: byId("hostBadge"),
  cardsPerPlayerInput: byId("cardsPerPlayerInput"),
  turnSecondsInput: byId("turnSecondsInput"),
  randomizePresenterOrderCheckbox: byId("randomizePresenterOrderCheckbox"),
  saveSettingsBtn: byId("saveSettingsBtn"),
  playersList: byId("playersList"),
  moveUpBtn: byId("moveUpBtn"),
  moveDownBtn: byId("moveDownBtn"),
  startCardEntryBtn: byId("startCardEntryBtn"),
  cardEntryView: byId("cardEntryView"),
  cardQuotaText: byId("cardQuotaText"),
  progressList: byId("progressList"),
  cardHeaderInput: byId("cardHeaderInput"),
  cardBodyInput: byId("cardBodyInput"),
  addCardBtn: byId("addCardBtn"),
  myCardsList: byId("myCardsList"),
  startGameplayBtn: byId("startGameplayBtn"),
  roundView: byId("roundView"),
  roundHeader: byId("roundHeader"),
  turnInfo: byId("turnInfo"),
  countdownBlock: byId("countdownBlock"),
  timerBlock: byId("timerBlock"),
  presenterReady: byId("presenterReady"),
  presenterCard: byId("presenterCard"),
  scoreFx: byId("scoreFx"),
  promptHeader: byId("promptHeader"),
  promptBody: byId("promptBody"),
  presenterActions: byId("presenterActions"),
  startTurnBtn: byId("startTurnBtn"),
  scoredBtn: byId("scoredBtn"),
  passBtn: byId("passBtn"),
  opponentPointBtn: byId("opponentPointBtn"),
  undoBtn: byId("undoBtn"),
  waitingBlock: byId("waitingBlock"),
  roundSummaryView: byId("roundSummaryView"),
  roundSummaryText: byId("roundSummaryText"),
  roundSummaryScores: byId("roundSummaryScores"),
  continueBtn: byId("continueBtn"),
  finalView: byId("finalView"),
  finalScores: byId("finalScores"),
  endGameBtn: byId("endGameBtn")
};

els.nicknameInput.value = localStorage.getItem(STORAGE_KEYS.nicknameRaw) || "";
startPolling();

els.joinBtn.addEventListener("click", async () => {
  const nicknameRaw = els.nicknameInput.value.trim();
  if (!nicknameRaw) {
    setAlert("Enter a nickname.");
    return;
  }
  let playerId = localStorage.getItem(STORAGE_KEYS.playerId);
  if (!playerId) {
    playerId = createId();
  }
  const result = await apiJoin({ playerId, nicknameRaw });
  if (!result.ok) {
    setAlert(result.message || "Failed to join.");
    return;
  }
  localStorage.setItem(STORAGE_KEYS.playerId, result.playerId);
  localStorage.setItem(STORAGE_KEYS.nicknameRaw, nicknameRaw);
  setStateAndRender(result.state);
});

els.saveSettingsBtn.addEventListener("click", () =>
  sendAction({
    type: "UPDATE_SETTINGS",
    cardsPerPlayer: Number(els.cardsPerPlayerInput.value),
    turnSeconds: Number(els.turnSecondsInput.value),
    randomizePresenterOrderEachCycle: Boolean(els.randomizePresenterOrderCheckbox.checked)
  })
);
els.startCardEntryBtn.addEventListener("click", () => sendAction({ type: "START_CARD_ENTRY" }));
els.moveUpBtn.addEventListener("click", () => reorderSelected(-1));
els.moveDownBtn.addEventListener("click", () => reorderSelected(1));

els.addCardBtn.addEventListener("click", () =>
  sendAction({
    type: "SUBMIT_CARD",
    header: els.cardHeaderInput.value,
    cardBody: els.cardBodyInput.value
  }).then((ok) => {
    if (ok) {
      els.cardHeaderInput.value = "";
      els.cardBodyInput.value = "";
    }
  })
);

els.startGameplayBtn.addEventListener("click", () => sendAction({ type: "START_GAMEPLAY" }));
els.startTurnBtn.addEventListener("click", () => sendAction({ type: "START_TURN" }));
els.scoredBtn.addEventListener("click", () => performTurnAction("SCORED"));
els.passBtn.addEventListener("click", () => performTurnAction("PASS"));
els.opponentPointBtn.addEventListener("click", () => performTurnAction("OPPONENT_POINT"));
els.undoBtn.addEventListener("click", () => performTurnAction("UNDO"));
els.continueBtn.addEventListener("click", () => sendAction({ type: "CONTINUE_AFTER_ROUND" }));
els.endGameBtn.addEventListener("click", () => sendAction({ type: "END_GAME" }));

async function startPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  await refreshState();
  pollTimer = setInterval(refreshState, 600);
}

async function refreshState() {
  const playerId = localStorage.getItem(STORAGE_KEYS.playerId) || "";
  let data;
  try {
    const result = await fetch(`/api/state?playerId=${encodeURIComponent(playerId)}`, {
      cache: "no-store"
    });
    if (!result.ok) {
      els.connectionStatus.textContent = "Offline";
      return;
    }
    data = await result.json();
    if (!data.ok) {
      return;
    }
  } catch {
    els.connectionStatus.textContent = "Offline";
    return;
  }
  els.connectionStatus.textContent = "Connected";
  try {
    const nextSignature = JSON.stringify(data.state);
    if (nextSignature === lastStateSignature) {
      return;
    }
    lastStateSignature = nextSignature;
    gameState = data.state;
    render();
  } catch (error) {
    console.error("Render update failed:", error);
  }
}

async function apiJoin(payload) {
  try {
    const result = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await result.json();
  } catch {
    return { ok: false, message: "Join failed." };
  }
}

async function sendAction(payload) {
  const playerId = localStorage.getItem(STORAGE_KEYS.playerId) || "";
  let data;
  try {
    const result = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, playerId })
    });
    data = await result.json();
  } catch {
    setAlert("Network error. Try again.");
    return false;
  }
  if (!data.ok) {
    if (data.code === "UNKNOWN_PLAYER") {
      const rejoined = await tryRejoinFromSavedNickname();
      if (rejoined) {
        return sendAction(payload);
      }
    }
    setAlert(data.message || "Action failed.");
    return false;
  }
  try {
    setStateAndRender(data.state);
  } catch (error) {
    console.error("Render after action failed:", error);
    setAlert("Action worked, but the screen had trouble updating.");
  }
  return true;

  async function tryRejoinFromSavedNickname() {
    const nicknameRaw = (localStorage.getItem(STORAGE_KEYS.nicknameRaw) || "").trim();
    if (!nicknameRaw) {
      return false;
    }
    const existingPlayerId = localStorage.getItem(STORAGE_KEYS.playerId) || createId();
    const result = await apiJoin({ playerId: existingPlayerId, nicknameRaw });
    if (!result.ok) {
      return false;
    }
    localStorage.setItem(STORAGE_KEYS.playerId, result.playerId);
    localStorage.setItem(STORAGE_KEYS.nicknameRaw, nicknameRaw);
    setStateAndRender(result.state);
    return true;
  }
}

async function performTurnAction(actionType) {
  if (turnActionLocked) {
    return;
  }
  turnActionLocked = true;
  try {
    if (actionType === "SCORED") {
      await animatePresenterCard("score", gameState.presenterTeam);
    } else if (actionType === "OPPONENT_POINT") {
      await animatePresenterCard("score", getOpposingTeam(gameState.presenterTeam));
    } else if (actionType === "PASS") {
      await animatePresenterCard("pass");
    }
    await sendAction({ type: "TURN_ACTION", actionType });
  } finally {
    turnActionLocked = false;
    if (gameState) {
      render();
    }
  }
}

async function animatePresenterCard(mode, awardedTeam) {
  if (!els.presenterCard || els.presenterCard.classList.contains("hidden")) {
    return;
  }
  const scoringTeam = awardedTeam || gameState.presenterTeam;
  const className =
    mode === "score"
      ? scoringTeam === TEAM.RED
        ? "card-swipe-score-red"
        : "card-swipe-score-blue"
      : "card-swipe-pass";
  if (mode === "score") {
    showScoreFx(scoringTeam);
  }
  els.presenterCard.classList.remove("card-swipe-score-red", "card-swipe-score-blue", "card-swipe-pass");
  void els.presenterCard.offsetWidth;
  els.presenterCard.classList.add(className);
  await wait(220);
  els.presenterCard.classList.remove(className);
}

function showScoreFx(scoringTeam) {
  if (!els.scoreFx) {
    return;
  }
  const isRed = scoringTeam === TEAM.RED;
  els.scoreFx.textContent = "+1";
  els.scoreFx.classList.remove("hidden", "score-fx-red", "score-fx-blue");
  els.scoreFx.classList.add(isRed ? "score-fx-red" : "score-fx-blue");
  setTimeout(() => {
    els.scoreFx.classList.add("hidden");
    els.scoreFx.classList.remove("score-fx-red", "score-fx-blue");
  }, 460);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render() {
  if (!gameState) {
    return;
  }
  applyPresenterTheme();
  const me = getMe();
  const isJoined = Boolean(me);
  const isHost = Boolean(me?.isHost);

  els.scoreRed.textContent = String(gameState.totalScores.RED);
  els.scoreBlue.textContent = String(gameState.totalScores.BLUE);
  els.phaseLabel.textContent = gameState.phase.replace(/_/g, " ");
  els.roundLabel.textContent = gameState.currentRound ? `Round ${gameState.currentRound}` : "Round -";
  els.deckCountLabel.textContent = `Deck ${gameState.activeDeckCount}`;

  showOnlyPhaseView(isJoined);
  toggle(els.hostBadge, isHost);

  if (!isJoined) {
    return;
  }

  els.cardsPerPlayerInput.value = String(gameState.settings.cardsPerPlayer);
  els.turnSecondsInput.value = String(gameState.settings.turnSeconds);
  els.randomizePresenterOrderCheckbox.checked = Boolean(gameState.settings.randomizePresenterOrderEachCycle);

  renderPlayers(me, isHost);
  if (gameState.phase === PHASE.CARD_ENTRY) {
    renderCardEntry(me, isHost);
  }
  if (gameState.phase === PHASE.ROUND_1 || gameState.phase === PHASE.ROUND_2 || gameState.phase === PHASE.ROUND_3) {
    renderRound(me);
  }
  if (gameState.phase === PHASE.ROUND_SUMMARY) {
    renderRoundSummary(isHost);
  }
  if (gameState.phase === PHASE.FINAL_RESULTS) {
    renderFinalView(isHost);
  }
}

function applyPresenterTheme() {
  const isRoundPhase =
    gameState.phase === PHASE.ROUND_1 || gameState.phase === PHASE.ROUND_2 || gameState.phase === PHASE.ROUND_3;
  const presentingTeam = isRoundPhase ? gameState.presenterTeam : null;
  document.body.classList.toggle("presenting-red", presentingTeam === TEAM.RED);
  document.body.classList.toggle("presenting-blue", presentingTeam === TEAM.BLUE);
}

function renderPlayers(me, isHost) {
  els.playersList.innerHTML = "";
  for (const player of gameState.players) {
    const row = document.createElement("div");
    row.className = "player-row";
    row.dataset.playerId = player.id;
    row.addEventListener("click", () => {
      selectedPlayerForOrder = player.id;
      highlightSelection();
    });

    const orderCell = document.createElement("div");
    orderCell.textContent = `#${player.order + 1}`;
    const nameCell = document.createElement("div");
    nameCell.textContent = player.nicknameRaw;
    const hostCell = document.createElement("div");
    hostCell.textContent = player.isHost ? "Host" : "";
    const teamCell = document.createElement("div");

    if (player.id === me.id) {
      const select = document.createElement("select");
      select.className = "team-select";
      select.innerHTML =
        '<option value="">Select team</option><option value="RED">RED</option><option value="BLUE">BLUE</option>';
      select.value = player.team || "";
      applyTeamSelectTheme(select);
      select.addEventListener("change", () => {
        applyTeamSelectTheme(select);
        sendAction({ type: "SET_TEAM", team: select.value || null });
      });
      teamCell.appendChild(select);
    } else {
      const teamPill = document.createElement("div");
      teamPill.className = `team-pill ${player.team === TEAM.RED ? "team-red" : player.team === TEAM.BLUE ? "team-blue" : ""}`;
      teamPill.textContent = player.team || "NO TEAM";
      teamCell.appendChild(teamPill);
    }

    row.appendChild(orderCell);
    row.appendChild(nameCell);
    row.appendChild(hostCell);
    row.appendChild(teamCell);
    els.playersList.appendChild(row);
  }
  highlightSelection();
  toggle(els.moveUpBtn, isHost);
  toggle(els.moveDownBtn, isHost);
  toggle(els.startCardEntryBtn, isHost);
  toggle(els.saveSettingsBtn, isHost);
}

function renderCardEntry(me, isHost) {
  els.cardQuotaText.textContent = `Submit ${gameState.cardsPerPlayer} cards.`;
  const myCards = gameState.submissionsByPlayerId[me.id] || [];
  els.progressList.innerHTML = "";
  for (const player of gameState.players) {
    const cards = gameState.submissionsByPlayerId[player.id] || [];
    const row = document.createElement("div");
    row.className = "progress-row";
    row.innerHTML = `<span>${escapeHtml(player.nicknameRaw)}</span><strong>${cards.length}/${gameState.cardsPerPlayer}</strong>`;
    els.progressList.appendChild(row);
  }
  els.myCardsList.innerHTML = "";
  for (const card of myCards) {
    const row = document.createElement("div");
    row.className = "my-card-row";
    const text = document.createElement("div");
    text.innerHTML = `<strong>${escapeHtml(card.header)}</strong><br/><span>${escapeHtml(card.body || "")}</span>`;
    const remove = document.createElement("button");
    remove.textContent = "Remove";
    remove.addEventListener("click", () => sendAction({ type: "REMOVE_CARD", cardId: card.id }));
    row.appendChild(text);
    row.appendChild(remove);
    els.myCardsList.appendChild(row);
  }
  els.addCardBtn.disabled = myCards.length >= gameState.cardsPerPlayer;
  toggle(els.startGameplayBtn, isHost);
}

function renderRound(me) {
  const turn = gameState.turn;
  const isPresenter = turn && me.id === gameState.presenterId;

  els.roundHeader.textContent = `Round ${gameState.currentRound}`;
  els.turnInfo.textContent = turn ? `Presenter: ${getPlayerName(gameState.presenterId)}` : "Waiting...";

  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (turn && (turn.status === "COUNTDOWN" || turn.status === "RUNNING")) {
    tickTimer = setInterval(renderTimer, 200);
  }

  toggle(els.countdownBlock, Boolean(turn && turn.status === "COUNTDOWN"));
  toggle(els.timerBlock, Boolean(turn && turn.status === "RUNNING"));

  if (!turn) {
    toggle(els.presenterReady, false);
    toggle(els.presenterActions, false);
    toggle(els.presenterCard, false);
    toggle(els.waitingBlock, true);
    els.waitingBlock.textContent = "Waiting...";
    return;
  }

  if (isPresenter) {
    toggle(els.presenterReady, turn.status === "IDLE");
    toggle(els.presenterActions, turn.status === "RUNNING");
    toggle(els.presenterCard, turn.status === "RUNNING");
    toggle(els.waitingBlock, false);
    els.startTurnBtn.disabled = turn.status !== "IDLE";
    els.scoredBtn.disabled = turn.status !== "RUNNING" || gameState.activeDeckCount === 0 || turnActionLocked;
    els.passBtn.disabled = turn.status !== "RUNNING" || gameState.activeDeckCount <= 1 || turnActionLocked;
    els.opponentPointBtn.disabled = turn.status !== "RUNNING" || gameState.activeDeckCount === 0 || turnActionLocked;
    els.undoBtn.disabled = turn.status !== "RUNNING" || !turn.lastScoringAction || turnActionLocked;
    els.promptHeader.textContent = gameState.topCard?.header || "";
    els.promptBody.textContent = gameState.topCard?.body || "";
    els.scoredBtn.textContent = `✅ Score (${me.team || "TEAM"})`;
    els.opponentPointBtn.textContent = `⚑ Opponent (${me.team === TEAM.RED ? TEAM.BLUE : TEAM.RED})`;
    els.scoredBtn.classList.toggle("team-red-btn", me.team === TEAM.RED);
    els.scoredBtn.classList.toggle("team-blue-btn", me.team === TEAM.BLUE);
    els.opponentPointBtn.classList.toggle("team-red-btn", me.team === TEAM.BLUE);
    els.opponentPointBtn.classList.toggle("team-blue-btn", me.team === TEAM.RED);
  } else {
    toggle(els.presenterReady, false);
    toggle(els.presenterActions, false);
    toggle(els.presenterCard, false);
    toggle(els.waitingBlock, true);
    if (me.team && gameState.presenterTeam && me.team === gameState.presenterTeam) {
      els.waitingBlock.textContent = "Lock in, you're guessing!";
    } else {
      els.waitingBlock.textContent = "Sit back and shut up";
    }
  }
  renderTimer();
}

function renderTimer() {
  if (!gameState?.turn) {
    return;
  }
  const now = Date.now();
  if (gameState.turn.status === "COUNTDOWN" && gameState.turn.countdownEndsAtMs) {
    const sec = Math.max(0, Math.ceil((gameState.turn.countdownEndsAtMs - now) / 1000));
    els.countdownBlock.textContent = `Starting in ${sec}...`;
  }
  if (gameState.turn.status === "RUNNING" && gameState.turn.timerEndsAtMs) {
    const sec = Math.max(0, Math.ceil((gameState.turn.timerEndsAtMs - now) / 1000));
    els.timerBlock.textContent = `Time left: ${sec}s`;
  }
}

function renderRoundSummary(isHost) {
  const round = gameState.currentRound;
  const roundScores = gameState.roundScores[round];
  els.roundSummaryText.textContent = `Round ${round} finished.`;
  els.roundSummaryScores.innerHTML = `
    <p>Round ${round}: Red ${roundScores.RED} - Blue ${roundScores.BLUE}</p>
    <p>Total: Red ${gameState.totalScores.RED} - Blue ${gameState.totalScores.BLUE}</p>
  `;
  toggle(els.continueBtn, isHost);
}

function renderFinalView(isHost) {
  const r = gameState.roundScores;
  els.finalScores.innerHTML = `
    <p>Round 1: Red ${r[1].RED} - Blue ${r[1].BLUE}</p>
    <p>Round 2: Red ${r[2].RED} - Blue ${r[2].BLUE}</p>
    <p>Round 3: Red ${r[3].RED} - Blue ${r[3].BLUE}</p>
    <p><strong>Final: Red ${gameState.totalScores.RED} - Blue ${gameState.totalScores.BLUE}</strong></p>
  `;
  toggle(els.endGameBtn, isHost);
}

function reorderSelected(direction) {
  if (!gameState || !selectedPlayerForOrder) {
    return;
  }
  const players = [...gameState.players];
  const idx = players.findIndex((p) => p.id === selectedPlayerForOrder);
  if (idx < 0) {
    return;
  }
  const next = idx + direction;
  if (next < 0 || next >= players.length) {
    return;
  }
  [players[idx], players[next]] = [players[next], players[idx]];
  sendAction({ type: "REORDER_PLAYERS", orderedPlayerIds: players.map((p) => p.id) });
}

function highlightSelection() {
  for (const row of els.playersList.querySelectorAll(".player-row")) {
    row.style.outline = row.dataset.playerId === selectedPlayerForOrder ? "2px solid #aaa" : "";
  }
}

function showOnlyPhaseView(isJoined) {
  toggle(els.joinView, !isJoined);
  toggle(els.lobbyView, isJoined && gameState.phase === PHASE.LOBBY);
  toggle(els.cardEntryView, isJoined && gameState.phase === PHASE.CARD_ENTRY);
  toggle(
    els.roundView,
    isJoined &&
      (gameState.phase === PHASE.ROUND_1 || gameState.phase === PHASE.ROUND_2 || gameState.phase === PHASE.ROUND_3)
  );
  toggle(els.roundSummaryView, isJoined && gameState.phase === PHASE.ROUND_SUMMARY);
  toggle(els.finalView, isJoined && gameState.phase === PHASE.FINAL_RESULTS);
}

function getMe() {
  if (!gameState) {
    return null;
  }
  const playerId = localStorage.getItem(STORAGE_KEYS.playerId);
  if (!playerId) {
    return null;
  }
  return gameState.players.find((player) => player.id === playerId) || null;
}

function getPlayerName(playerId) {
  return gameState.players.find((player) => player.id === playerId)?.nicknameRaw || "Unknown";
}

function getOpposingTeam(team) {
  return team === TEAM.RED ? TEAM.BLUE : TEAM.RED;
}

function setAlert(message) {
  els.alerts.innerHTML = `<div class="alert">${escapeHtml(message)}</div>`;
  setTimeout(() => {
    if (els.alerts.textContent === message) {
      els.alerts.innerHTML = "";
    }
  }, 3500);
}

function toggle(el, show) {
  el.classList.toggle("hidden", !show);
}

function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function applyTeamSelectTheme(select) {
  select.classList.remove("team-select-red", "team-select-blue", "team-select-none");
  if (select.value === TEAM.RED) {
    select.classList.add("team-select-red");
    return;
  }
  if (select.value === TEAM.BLUE) {
    select.classList.add("team-select-blue");
    return;
  }
  select.classList.add("team-select-none");
}

function setStateAndRender(state) {
  lastStateSignature = JSON.stringify(state);
  gameState = state;
  render();
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex
      .slice(8, 10)
      .join("")}-${hex.slice(10, 16).join("")}`;
  }
  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
