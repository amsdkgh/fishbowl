const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const { exec } = require("child_process");

const PORT = process.env.PORT || 3000;
const HELPER_PORT = process.env.FISHBOWL_HELPER_PORT || 3001;
const PUBLIC_DIR = path.join(__dirname, "public");

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

const DEFAULT_SETTINGS = {
  cardsPerPlayer: 5,
  turnSeconds: 60,
  preTurnCountdownSeconds: 3,
  randomizePresenterOrderEachCycle: false
};

const state = createInitialState();
let countdownTimeout = null;
let turnTimeout = null;

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsed.pathname;

    if (pathname === "/api/state" && req.method === "GET") {
      const playerId = parsed.searchParams.get("playerId") || "";
      return sendJson(res, 200, { ok: true, state: buildClientState(playerId) });
    }

    if (pathname === "/api/join" && req.method === "POST") {
      const body = await readJson(req);
      const result = joinOrReconnectPlayer(body.playerId, body.nicknameRaw);
      if (!result.ok) {
        return sendJson(res, 400, result);
      }
      return sendJson(res, 200, {
        ok: true,
        playerId: result.playerId,
        state: buildClientState(result.playerId)
      });
    }

    if (pathname === "/api/action" && req.method === "POST") {
      const body = await readJson(req);
      const result = handleAction(body || {});
      const playerId = String(body.playerId || "");
      if (!result.ok) {
        return sendJson(res, 400, result);
      }
      return sendJson(res, 200, { ok: true, state: buildClientState(playerId) });
    }

    if (pathname === "/" && req.method === "GET") {
      return sendFile(res, path.join(PUBLIC_DIR, "index.html"), "text/html; charset=utf-8");
    }

    if (req.method === "GET") {
      return serveStatic(pathname, res);
    }

    return sendJson(res, 404, { ok: false, code: "NOT_FOUND", message: "Not found." });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      code: "SERVER_ERROR",
      message: error?.message || "Server error."
    });
  }
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload too large."));
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const text = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, code: "FILE_NOT_FOUND", message: "File not found." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${safePath}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { ok: false, code: "FORBIDDEN", message: "Forbidden." });
  }
  const ext = path.extname(resolved).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };
  return sendFile(res, resolved, types[ext] || "application/octet-stream");
}

function handleAction(body) {
  const action = String(body.type || "");
  const playerId = String(body.playerId || "");
  const player = getPlayerById(playerId);
  if (!player && action !== "START_JOIN_FLOW") {
    return fail("UNKNOWN_PLAYER", "Player not found. Rejoin game.");
  }

  if (action === "SET_TEAM") {
    if (state.phase !== PHASE.LOBBY) {
      return fail("INVALID_PHASE", "Teams can only be changed in lobby.");
    }
    if (!isValidTeam(body.team)) {
      return fail("INVALID_TEAM", "Invalid team.");
    }
    player.team = body.team;
    return ok();
  }

  if (action === "REORDER_PLAYERS") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can reorder players.");
    }
    if (state.phase !== PHASE.LOBBY) {
      return fail("INVALID_PHASE", "Players can only be reordered in lobby.");
    }
    const orderedPlayerIds = Array.isArray(body.orderedPlayerIds) ? body.orderedPlayerIds : [];
    if (orderedPlayerIds.length !== state.players.length) {
      return fail("INVALID_ORDER", "Invalid player order.");
    }
    const existing = new Set(state.players.map((p) => p.id));
    const incoming = new Set(orderedPlayerIds);
    if (incoming.size !== state.players.length) {
      return fail("INVALID_ORDER", "Duplicate player IDs.");
    }
    for (const id of orderedPlayerIds) {
      if (!existing.has(id)) {
        return fail("INVALID_ORDER", "Unknown player ID.");
      }
    }
    const pos = new Map(orderedPlayerIds.map((id, idx) => [id, idx]));
    for (const p of state.players) {
      p.order = pos.get(p.id);
    }
    return ok();
  }

  if (action === "UPDATE_SETTINGS") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can update settings.");
    }
    if (state.phase !== PHASE.LOBBY) {
      return fail("INVALID_PHASE", "Settings can only be changed in lobby.");
    }
    const cardsPerPlayer = Number(body.cardsPerPlayer);
    const turnSeconds = Number(body.turnSeconds);
    const randomizePresenterOrderEachCycle = Boolean(body.randomizePresenterOrderEachCycle);
    if (!Number.isInteger(cardsPerPlayer) || cardsPerPlayer < 1 || cardsPerPlayer > 20) {
      return fail("INVALID_SETTING", "Cards per player must be 1-20.");
    }
    if (!Number.isInteger(turnSeconds) || turnSeconds < 15 || turnSeconds > 180) {
      return fail("INVALID_SETTING", "Turn seconds must be 15-180.");
    }
    state.settings.cardsPerPlayer = cardsPerPlayer;
    state.settings.turnSeconds = turnSeconds;
    state.settings.randomizePresenterOrderEachCycle = randomizePresenterOrderEachCycle;
    return ok();
  }

  if (action === "START_CARD_ENTRY") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can start card entry.");
    }
    if (state.phase !== PHASE.LOBBY) {
      return fail("INVALID_PHASE", "Card entry can only start from lobby.");
    }
    const valid = validateLobbyReadiness();
    if (!valid.ok) {
      return valid;
    }
    state.phase = PHASE.CARD_ENTRY;
    state.submissionsByPlayerId = {};
    state.masterDeck = [];
    return ok();
  }

  if (action === "SUBMIT_CARD") {
    if (state.phase !== PHASE.CARD_ENTRY) {
      return fail("INVALID_PHASE", "Cards can only be submitted in card entry.");
    }
    const header = String(body.header || "").trim();
    const cardBody = String(body.cardBody || "").trim();
    if (!header) {
      return fail("INVALID_CARD", "Card header is required.");
    }
    if (cardBody && sharesAnyWord(header, cardBody)) {
      return fail(
        "INVALID_CARD",
        "Card description cannot contain words from the header (case-insensitive)."
      );
    }
    if (!state.submissionsByPlayerId[player.id]) {
      state.submissionsByPlayerId[player.id] = [];
    }
    if (state.submissionsByPlayerId[player.id].length >= state.settings.cardsPerPlayer) {
      return fail("CARD_LIMIT", "Card quota reached.");
    }
    state.submissionsByPlayerId[player.id].push({
      id: crypto.randomUUID(),
      header,
      body: cardBody,
      authorPlayerId: player.id
    });
    return ok();
  }

  if (action === "REMOVE_CARD") {
    if (state.phase !== PHASE.CARD_ENTRY) {
      return fail("INVALID_PHASE", "Cards can only be edited in card entry.");
    }
    const cardId = String(body.cardId || "");
    const cards = state.submissionsByPlayerId[player.id] || [];
    state.submissionsByPlayerId[player.id] = cards.filter((card) => card.id !== cardId);
    return ok();
  }

  if (action === "START_GAMEPLAY") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can start gameplay.");
    }
    if (state.phase !== PHASE.CARD_ENTRY) {
      return fail("INVALID_PHASE", "Gameplay starts from card entry.");
    }
    const valid = validateCardSubmissionReadiness();
    if (!valid.ok) {
      return valid;
    }
    startRound(1, 0);
    return ok();
  }

  if (action === "START_TURN") {
    if (!isRoundPhase(state.phase)) {
      return fail("INVALID_PHASE", "Turns can only start during rounds.");
    }
    if (!state.turn || state.turn.status !== "IDLE") {
      return fail("TURN_ACTIVE", "Turn is already active.");
    }
    if (state.turn.presenterPlayerId !== player.id) {
      return fail("NOT_PRESENTER", "Only presenter can start turn.");
    }
    startCountdownAndTurn();
    return ok();
  }

  if (action === "TURN_ACTION") {
    if (!isRoundPhase(state.phase)) {
      return fail("INVALID_PHASE", "Actions can only happen during rounds.");
    }
    if (!state.turn || state.turn.status !== "RUNNING") {
      return fail("TURN_NOT_RUNNING", "Turn is not running.");
    }
    if (state.turn.presenterPlayerId !== player.id) {
      return fail("NOT_PRESENTER", "Only presenter can act.");
    }
    const actionType = String(body.actionType || "");
    const validAction = applyTurnAction(player, actionType);
    if (!validAction.ok) {
      return validAction;
    }
    return ok();
  }

  if (action === "CONTINUE_AFTER_ROUND") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can continue.");
    }
    if (state.phase !== PHASE.ROUND_SUMMARY) {
      return fail("INVALID_PHASE", "Not waiting between rounds.");
    }
    if (state.currentRound === 3) {
      state.phase = PHASE.FINAL_RESULTS;
      return ok();
    }
    startRound(state.currentRound + 1, state.presenterIndex);
    return ok();
  }

  if (action === "END_GAME") {
    if (!player.isHost) {
      return fail("HOST_ONLY", "Only host can end game.");
    }
    resetState();
    return ok();
  }

  return fail("UNKNOWN_ACTION", "Unknown action.");
}

function joinOrReconnectPlayer(providedPlayerId, nicknameRaw) {
  const raw = String(nicknameRaw || "").trim();
  if (!raw) {
    return fail("INVALID_NICKNAME", "Nickname is required.");
  }
  const nicknameNorm = normalizeNickname(raw);
  const playerId = String(providedPlayerId || "").trim() || crypto.randomUUID();

  const existingById = state.players.find((p) => p.id === playerId);
  const existingByNorm = state.players.find((p) => p.nicknameNorm === nicknameNorm);

  if (existingById) {
    if (existingById.nicknameNorm !== nicknameNorm) {
      return fail("NICKNAME_MISMATCH", "Nickname does not match your player.");
    }
    existingById.nicknameRaw = raw;
    ensureHost();
    return { ok: true, playerId };
  }

  if (existingByNorm) {
    return fail("DUPLICATE_NICKNAME", "Nickname already taken.");
  }

  if (state.phase !== PHASE.LOBBY) {
    return fail("LATE_JOIN_DISABLED", "Joining is disabled after lobby.");
  }

  state.players.push({
    id: playerId,
    nicknameRaw: raw,
    nicknameNorm,
    team: getDefaultTeamForNewPlayer(),
    order: state.players.length,
    isHost: false
  });
  ensureHost();
  return { ok: true, playerId };
}

function applyTurnAction(player, actionType) {
  const turn = state.turn;
  const deck = state.activeRoundDeck;
  const round = state.currentRound;

  if (actionType === "PASS") {
    if (deck.length <= 1) {
      return ok();
    }
    const top = deck.shift();
    deck.push(top);
    turn.lastScoringAction = null;
    return ok();
  }

  if (actionType === "SCORED" || actionType === "OPPONENT_POINT") {
    if (!deck.length) {
      return fail("DECK_EMPTY", "No cards remaining.");
    }
    const card = deck.shift();
    const awardedTeam =
      actionType === "SCORED" ? player.team : player.team === TEAM.RED ? TEAM.BLUE : TEAM.RED;
    state.roundScores[round][awardedTeam] += 1;
    state.totalScores[awardedTeam] += 1;
    turn.lastScoringAction = {
      turnId: turn.turnId,
      roundNumber: round,
      actionType,
      card,
      awardedTeam
    };
    if (deck.length === 0) {
      endTurn("DECK_EMPTY");
    }
    return ok();
  }

  if (actionType === "UNDO") {
    if (!turn.lastScoringAction) {
      return fail("UNDO_NOT_AVAILABLE", "No undo available.");
    }
    const last = turn.lastScoringAction;
    if (last.turnId !== turn.turnId || last.roundNumber !== round) {
      return fail("UNDO_NOT_AVAILABLE", "No undo available.");
    }
    state.roundScores[round][last.awardedTeam] -= 1;
    state.totalScores[last.awardedTeam] -= 1;
    deck.unshift(last.card);
    turn.lastScoringAction = null;
    return ok();
  }

  return fail("INVALID_ACTION", "Invalid turn action.");
}

function startRound(roundNumber, presenterIndex) {
  clearTimers();
  state.currentRound = roundNumber;
  state.phase = `ROUND_${roundNumber}`;
  if (!state.masterDeck.length) {
    const all = [];
    for (const playerId of Object.keys(state.submissionsByPlayerId)) {
      all.push(...state.submissionsByPlayerId[playerId]);
    }
    state.masterDeck = all;
  }
  state.activeRoundDeck = shuffle([...state.masterDeck]);
  const ordered = getOrderedPlayers();
  state.presenterIndex = ordered.length ? presenterIndex % ordered.length : 0;
  const presenter = ordered[state.presenterIndex];
  state.turn = {
    turnId: crypto.randomUUID(),
    presenterPlayerId: presenter.id,
    status: "IDLE",
    countdownEndsAtMs: null,
    timerEndsAtMs: null,
    lastScoringAction: null
  };
}

function startCountdownAndTurn() {
  clearTimers();
  const turn = state.turn;
  turn.status = "COUNTDOWN";
  turn.countdownEndsAtMs = Date.now() + state.settings.preTurnCountdownSeconds * 1000;
  turn.timerEndsAtMs = null;

  countdownTimeout = setTimeout(() => {
    turn.status = "RUNNING";
    turn.countdownEndsAtMs = null;
    turn.timerEndsAtMs = Date.now() + state.settings.turnSeconds * 1000;
    turnTimeout = setTimeout(() => {
      endTurn("TIME");
    }, state.settings.turnSeconds * 1000);
  }, state.settings.preTurnCountdownSeconds * 1000);
}

function endTurn(reason) {
  clearTimers();
  let ordered = getOrderedPlayers();
  if (!ordered.length || !state.turn) {
    return;
  }
  const previousPresenter = ordered[state.presenterIndex];
  state.presenterIndex = (state.presenterIndex + 1) % ordered.length;
  if (!state.activeRoundDeck.length) {
    state.phase = PHASE.ROUND_SUMMARY;
    state.turn.status = "ENDED";
    state.turn.endReason = reason;
    return;
  }
  if (state.settings.randomizePresenterOrderEachCycle && state.presenterIndex === 0) {
    randomizePresenterOrderForNextCycle(ordered[0]?.team || TEAM.RED);
    ordered = getOrderedPlayers();
  }
  const nextPresenter = ordered[state.presenterIndex];
  if (
    previousPresenter &&
    nextPresenter &&
    previousPresenter.team &&
    nextPresenter.team &&
    previousPresenter.team !== nextPresenter.team
  ) {
    passTopCardToBack(state.activeRoundDeck);
  }
  state.turn = {
    turnId: crypto.randomUUID(),
    presenterPlayerId: nextPresenter.id,
    status: "IDLE",
    countdownEndsAtMs: null,
    timerEndsAtMs: null,
    lastScoringAction: null
  };
}

function validateLobbyReadiness() {
  const ordered = getOrderedPlayers();
  if (ordered.length < 4) {
    return fail("NOT_ENOUGH_PLAYERS", "Need at least 4 players.");
  }
  if (ordered.some((p) => !p.team)) {
    return fail("TEAM_REQUIRED", "Every player must choose a team.");
  }
  const redCount = ordered.filter((p) => p.team === TEAM.RED).length;
  const blueCount = ordered.filter((p) => p.team === TEAM.BLUE).length;
  if (redCount === 0 || blueCount === 0) {
    return fail("BOTH_TEAMS_REQUIRED", "Need players on both teams.");
  }
  for (let i = 0; i < ordered.length; i += 1) {
    const next = ordered[(i + 1) % ordered.length];
    if (ordered[i].team === next.team) {
      return fail("ORDER_NOT_ALTERNATING", "Player order must alternate teams.");
    }
  }
  return ok();
}

function validateCardSubmissionReadiness() {
  const ordered = getOrderedPlayers();
  for (const player of ordered) {
    const cards = state.submissionsByPlayerId[player.id] || [];
    if (cards.length !== state.settings.cardsPerPlayer) {
      return fail(
        "MISSING_CARDS",
        `${player.nicknameRaw} must submit ${state.settings.cardsPerPlayer} cards.`
      );
    }
  }
  return ok();
}

function buildClientState(viewerPlayerId) {
  const ordered = getOrderedPlayers();
  const presenterId = state.turn?.presenterPlayerId || null;
  const presenter = presenterId ? getPlayerById(presenterId) : null;
  const canSeeCard =
    Boolean(viewerPlayerId) &&
    viewerPlayerId === presenterId &&
    isRoundPhase(state.phase) &&
    state.turn &&
    state.turn.status === "RUNNING";
  return {
    phase: state.phase,
    settings: state.settings,
    players: ordered.map((p) => ({
      id: p.id,
      nicknameRaw: p.nicknameRaw,
      nicknameNorm: p.nicknameNorm,
      team: p.team,
      order: p.order,
      isHost: p.isHost
    })),
    submissionsByPlayerId: state.submissionsByPlayerId,
    cardsPerPlayer: state.settings.cardsPerPlayer,
    currentRound: state.currentRound,
    activeDeckCount: state.activeRoundDeck.length,
    topCard: canSeeCard ? state.activeRoundDeck[0] || null : null,
    roundScores: state.roundScores,
    totalScores: state.totalScores,
    presenterId,
    presenterTeam: presenter ? presenter.team : null,
    turn: state.turn
  };
}

function createInitialState() {
  return {
    phase: PHASE.LOBBY,
    settings: { ...DEFAULT_SETTINGS },
    players: [],
    submissionsByPlayerId: {},
    masterDeck: [],
    currentRound: 0,
    activeRoundDeck: [],
    roundScores: {
      1: { RED: 0, BLUE: 0 },
      2: { RED: 0, BLUE: 0 },
      3: { RED: 0, BLUE: 0 }
    },
    totalScores: { RED: 0, BLUE: 0 },
    presenterIndex: 0,
    turn: null
  };
}

function resetState() {
  clearTimers();
  const next = createInitialState();
  for (const key of Object.keys(state)) {
    state[key] = next[key];
  }
}

function clearTimers() {
  if (countdownTimeout) {
    clearTimeout(countdownTimeout);
    countdownTimeout = null;
  }
  if (turnTimeout) {
    clearTimeout(turnTimeout);
    turnTimeout = null;
  }
}

function getOrderedPlayers() {
  return [...state.players].sort((a, b) => a.order - b.order);
}

function getPlayerById(playerId) {
  return state.players.find((p) => p.id === playerId);
}

function ensureHost() {
  if (state.players.some((p) => p.isHost)) {
    return;
  }
  const ordered = getOrderedPlayers();
  if (ordered.length) {
    ordered[0].isHost = true;
  }
}

function normalizeNickname(value) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function isRoundPhase(phase) {
  return phase === PHASE.ROUND_1 || phase === PHASE.ROUND_2 || phase === PHASE.ROUND_3;
}

function isValidTeam(team) {
  return team === TEAM.RED || team === TEAM.BLUE;
}

function getDefaultTeamForNewPlayer() {
  const ordered = getOrderedPlayers();
  if (!ordered.length) {
    return TEAM.RED;
  }

  function randomizePresenterOrderForNextCycle(startTeam) {
    const ordered = getOrderedPlayers();
    const reds = shuffle([...ordered.filter((p) => p.team === TEAM.RED)]);
    const blues = shuffle([...ordered.filter((p) => p.team === TEAM.BLUE)]);
    if (!reds.length || reds.length !== blues.length) {
      return;
    }
    const nextOrdered = [];
    for (let i = 0; i < ordered.length; i += 1) {
      const wantsRed = i % 2 === 0 ? startTeam === TEAM.RED : startTeam !== TEAM.RED;
      const next = wantsRed ? reds.shift() : blues.shift();
      if (!next) {
        return;
      }
      nextOrdered.push(next);
    }
    for (let i = 0; i < nextOrdered.length; i += 1) {
      nextOrdered[i].order = i;
    }
  }

  function passTopCardToBack(deck) {
    if (!Array.isArray(deck) || deck.length <= 1) {
      return;
    }
    const top = deck.shift();
    deck.push(top);
  }

  function sharesAnyWord(header, cardBody) {
    const headerWords = tokenizeWords(header);
    if (!headerWords.size) {
      return false;
    }
    const bodyWords = tokenizeWords(cardBody);
    for (const word of bodyWords) {
      if (headerWords.has(word)) {
        return true;
      }
    }
    return false;
  }

  function tokenizeWords(value) {
    const text = String(value || "").toLowerCase();
    const matches = text.match(/[a-z0-9]+/g) || [];
    return new Set(matches);
  }
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const priorTeam = ordered[i].team;
    if (priorTeam === TEAM.RED) {
      return TEAM.BLUE;
    }
    if (priorTeam === TEAM.BLUE) {
      return TEAM.RED;
    }
  }
  return TEAM.RED;
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function ok() {
  return { ok: true };
}

function fail(code, message) {
  return { ok: false, code, message };
}

server.listen(PORT, () => {
  const hostIp = getPreferredLocalIpv4();
  const hostJoinUrl = `http://${hostIp}:${PORT}`;
  console.log(`Fishbowl running on http://localhost:${PORT}`);
  console.log(`Join from same Wi-Fi: ${hostJoinUrl}`);
  startHelperServer(hostJoinUrl);
});

function getPreferredLocalIpv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const addr of addresses || []) {
      if (addr.family !== "IPv4" || addr.internal) {
        continue;
      }
      if (addr.address.startsWith("169.254.")) {
        continue;
      }
      const nameScore = /wi-?fi|wlan|wireless/i.test(name) ? 0 : 1;
      candidates.push({ nameScore, address: addr.address });
    }
  }
  candidates.sort((a, b) => a.nameScore - b.nameScore || a.address.localeCompare(b.address));
  return candidates[0]?.address || "127.0.0.1";
}

function startHelperServer(joinUrl) {
  const helper = http.createServer((req, res) => {
    const parsed = new URL(req.url, `http://${req.headers.host}`);
    if (parsed.pathname === "/state-theme" && req.method === "GET") {
      const now = Date.now();
      const presenterId = state.turn?.presenterPlayerId || null;
      const presenter = presenterId ? getPlayerById(presenterId) : null;
      const turnStatus = state.turn?.status || null;
      const countdownSecondsRemaining =
        turnStatus === "COUNTDOWN" && state.turn?.countdownEndsAtMs
          ? Math.max(0, Math.ceil((state.turn.countdownEndsAtMs - now) / 1000))
          : null;
      const timerSecondsRemaining =
        turnStatus === "RUNNING" && state.turn?.timerEndsAtMs
          ? Math.max(0, Math.ceil((state.turn.timerEndsAtMs - now) / 1000))
          : null;
      const payload = {
        ok: true,
        phase: state.phase,
        currentRound: state.currentRound,
        presenterTeam: presenter ? presenter.team : null,
        presenterName: presenter ? presenter.nicknameRaw : null,
        totalScores: state.totalScores,
        turnStatus,
        countdownSecondsRemaining,
        timerSecondsRemaining
      };
      const text = JSON.stringify(payload);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": Buffer.byteLength(text)
      });
      res.end(text);
      return;
    }
    if (parsed.pathname !== "/" || req.method !== "GET") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const html = buildHelperHtml(joinUrl);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(html)
    });
    res.end(html);
  });

  helper.listen(HELPER_PORT, () => {
    const helperUrl = `http://localhost:${HELPER_PORT}`;
    console.log(`Share helper opened at ${helperUrl}`);
    openUrl(helperUrl);
  });

  helper.on("error", (error) => {
    console.error(`Failed to start helper server on port ${HELPER_PORT}: ${error.message}`);
  });
}

function buildHelperHtml(joinUrl) {
  const escapedJoinUrl = joinUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(joinUrl)}`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Fishbowl Join QR</title>
    <style>
      :root { font-family: Inter, Segoe UI, Arial, sans-serif; }
      body { margin: 0; background: #121922; color: #f2f7ff; display: grid; place-items: center; min-height: 100vh; transition: background-color 180ms ease-in-out; }
      body.presenting-red { background: #2a0f12; }
      body.presenting-blue { background: #0f1d34; }
      main { width: min(560px, 92vw); background: #1e2734; border: 1px solid #344055; border-radius: 16px; padding: 24px; text-align: center; }
      h1 { margin: 0 0 8px; font-size: clamp(1.5rem, 4vw, 2rem); }
      p { margin: 0 0 18px; color: #d5deee; }
      .status { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 0 14px; }
      .score { border-radius: 10px; padding: 8px 10px; font-size: 1.2rem; font-weight: 800; }
      .score.red { background: #682121; }
      .score.blue { background: #1f386a; }
      .meta { margin: 0 0 12px; color: #cdd7ec; font-weight: 600; }
      img { width: min(360px, 78vw); background: #fff; border-radius: 12px; padding: 12px; }
      code { display: block; margin-top: 16px; padding: 10px; border-radius: 8px; background: #111722; color: #9dc3ff; word-break: break-all; }
    </style>
  </head>
  <body>
    <main>
      <h1>Scan to join Fishbowl</h1>
      <p id="metaText" class="meta">Phones on the same Wi-Fi can scan this QR code.</p>
      <div class="status">
        <div class="score red">Red: <span id="scoreRed">0</span></div>
        <div class="score blue">Blue: <span id="scoreBlue">0</span></div>
      </div>
      <img src="${qrSrc}" alt="Fishbowl join QR code" />
      <code>${escapedJoinUrl}</code>
    </main>
    <script>
      async function pollTheme() {
        try {
          const response = await fetch('/state-theme', { cache: 'no-store' });
          if (!response.ok) return;
          const data = await response.json();
          const inRound = data.phase === 'ROUND_1' || data.phase === 'ROUND_2' || data.phase === 'ROUND_3';
          const team = inRound ? data.presenterTeam : null;
          const scoreRed = document.getElementById('scoreRed');
          const scoreBlue = document.getElementById('scoreBlue');
          const metaText = document.getElementById('metaText');
          scoreRed.textContent = String(data.totalScores?.RED ?? 0);
          scoreBlue.textContent = String(data.totalScores?.BLUE ?? 0);
          if (data.turnStatus === 'COUNTDOWN') {
            metaText.textContent = 'Round ' + (data.currentRound || '-') + ' · ' + (data.presenterName || 'Presenter') + ' starts in ' + data.countdownSecondsRemaining + 's';
          } else if (data.turnStatus === 'RUNNING') {
            metaText.textContent = 'Round ' + (data.currentRound || '-') + ' · ' + (data.presenterName || 'Presenter') + ' time left: ' + data.timerSecondsRemaining + 's';
          } else if (inRound) {
            metaText.textContent = 'Round ' + (data.currentRound || '-') + ' · Presenter: ' + (data.presenterName || 'TBD');
          } else {
            metaText.textContent = 'Phones on the same Wi-Fi can scan this QR code.';
          }
          document.body.classList.toggle('presenting-red', team === 'RED');
          document.body.classList.toggle('presenting-blue', team === 'BLUE');
        } catch {}
      }
      pollTheme();
      setInterval(pollTheme, 600);
    </script>
  </body>
</html>`;
}

function openUrl(url) {
  const escapedUrl = `"${url}"`;
  let command;
  if (process.platform === "win32") {
    command = `start "" ${escapedUrl}`;
    exec(command, { shell: "cmd.exe" }, () => {});
    return;
  }
  if (process.platform === "darwin") {
    command = `open ${escapedUrl}`;
    exec(command, () => {});
    return;
  }
  command = `xdg-open ${escapedUrl}`;
  exec(command, () => {});
}
