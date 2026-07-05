(function initSchogge(root) {
  "use strict";

  const STORAGE_KEY = "schogge.state.v1";
  const HISTORY_KEY = "schogge.history.v1";
  const ONLINE_SESSION_KEY = "schogge.online.session.v1";
  const MAX_HISTORY = 40;
  const ROLL_ANIMATION_MS = 880;
  const ROLL_FRAME_MS = 90;
  const REDUCED_ROLL_ANIMATION_MS = 120;
  const REDUCED_ROLL_FRAME_MS = 120;

  function sortDiceDesc(dice) {
    return [...dice].sort((a, b) => b - a);
  }

  function countValue(dice, value) {
    return dice.filter((die) => die === value).length;
  }

  function validateDice(dice) {
    if (!Array.isArray(dice) || dice.length !== 3) {
      throw new Error("Es werden genau drei Würfel erwartet.");
    }
    dice.forEach((die) => {
      if (!Number.isInteger(die) || die < 1 || die > 6) {
        throw new Error("Würfelwerte müssen zwischen 1 und 6 liegen.");
      }
    });
  }

  function getCombinationDisplayName(score) {
    const key = score.displayDice || score.sortedDice?.join("") || "";

    if (score.category === "schogge_aus") {
      return "Schogge aus";
    }
    if (score.category === "schogge") {
      return `Schogge ${score.schluecke}`;
    }
    if (score.category === "drasch") {
      const draschNames = {
        6: "Sechser Drasch",
        5: "Fünfer Drasch",
        4: "Vierer Drasch",
        3: "Dreier Drasch",
        2: "Zweier Drasch",
      };
      return draschNames[key[0]] || key;
    }
    if (score.category === "strasse") {
      const streetNames = {
        654: "Große Straße",
        543: "Mittelgroße Straße",
        432: "Mittelkleine Straße",
        321: "Kleine Straße",
      };
      return streetNames[key] || key;
    }
    if (score.category === "einfach") {
      return key === "531" ? "Kurve" : key;
    }
    return key;
  }

  function withCombinationDisplayName(score) {
    return {
      ...score,
      label: getCombinationDisplayName(score),
    };
  }

  function scoreCombination(dice) {
    validateDice(dice);
    const sorted = sortDiceDesc(dice);
    const key = sorted.join("");
    const counts = new Map();
    sorted.forEach((die) => counts.set(die, (counts.get(die) || 0) + 1));

    if (key === "111") {
      return withCombinationDisplayName({
        category: "schogge_aus",
        displayDice: "111",
        sortedDice: [1, 1, 1],
        rank: 6000,
        schluecke: 0,
      });
    }

    if (countValue(sorted, 1) === 2) {
      const third = sorted.find((die) => die !== 1);
      return withCombinationDisplayName({
        category: "schogge",
        displayDice: `11${third}`,
        sortedDice: [1, 1, third],
        rank: 5000 + third,
        schluecke: third,
      });
    }

    if (counts.size === 1) {
      const face = sorted[0];
      return withCombinationDisplayName({
        category: "drasch",
        displayDice: key,
        sortedDice: sorted,
        rank: 4000 + face,
        schluecke: 3,
      });
    }

    const streetRanks = {
      321: 1,
      432: 2,
      543: 3,
      654: 4,
    };
    if (Object.prototype.hasOwnProperty.call(streetRanks, key)) {
      return withCombinationDisplayName({
        category: "strasse",
        displayDice: key,
        sortedDice: sorted,
        rank: 3000 + streetRanks[key],
        schluecke: 2,
      });
    }

    const simpleRank = key === "531" ? 1999 : 1000 + Number(key);
    return withCombinationDisplayName({
      category: "einfach",
      displayDice: key,
      sortedDice: sorted,
      rank: simpleRank,
      schluecke: 0,
    });
  }

  function formatDoubleSixDisplay(dice) {
    const ones = countValue(dice, 1);
    const sixes = countValue(dice, 6);
    const other = dice.find((die) => die !== 1 && die !== 6);

    if (ones === 2) {
      return `11${other || 6}`;
    }
    if (ones === 1 && sixes === 2) {
      return "166";
    }
    if (ones === 1 && sixes === 1 && other) {
      return `61${other}`;
    }
    return dice.join("");
  }

  function applyDoubleSixRule(dice) {
    validateDice(dice);
    if (countValue(dice, 6) < 2) {
      return {
        triggered: false,
        dice: [...dice],
        held: dice.map(() => false),
        mustRerollIndices: [],
        display: dice.join(""),
      };
    }

    const nextDice = [...dice];
    const firstSixIndex = nextDice.indexOf(6);
    nextDice[firstSixIndex] = 1;
    const held = nextDice.map((die) => die === 1);
    const mustRerollIndices = nextDice
      .map((die, index) => (die === 1 ? null : index))
      .filter((index) => index !== null);

    return {
      triggered: true,
      dice: nextDice,
      held,
      mustRerollIndices,
      display: formatDoubleSixDisplay(nextDice),
    };
  }

  function sortWorstFirst(results) {
    return [...results].sort((left, right) => {
      if (left.score.rank !== right.score.rank) {
        return left.score.rank - right.score.rank;
      }
      // Bei gleichem schlechtestem Wurf ist der später abgeschlossene Zug schlechter.
      return right.completedOrder - left.completedOrder;
    });
  }

  function getLowestRoundScoreState(results) {
    if (!Array.isArray(results) || results.length === 0) {
      return {
        hasResult: false,
        label: "Noch kein Ergebnis",
        lowestRank: null,
        doubleDeep: false,
        resultIds: [],
      };
    }

    const lowestRank = Math.min(...results.map((result) => result.score.rank));
    const lowestResults = results.filter((result) => result.score.rank === lowestRank);
    const doubleDeep = lowestResults.length > 1;
    const baseLabel = getCombinationDisplayName(lowestResults[0].score);

    return {
      hasResult: true,
      label: `${baseLabel}${doubleDeep ? " – doppelt tief" : ""}`,
      lowestRank,
      doubleDeep,
      resultIds: lowestResults.map((result) => result.playerId),
    };
  }

  function isDoubleDeepResult(result, results) {
    const lowest = getLowestRoundScoreState(results);
    return Boolean(lowest.doubleDeep && result.score.rank === lowest.lowestRank);
  }

  function getResultDisplayName(result, results = null) {
    const baseLabel = getCombinationDisplayName(result.score || result);
    if (!results || !isDoubleDeepResult(result, results)) {
      return baseLabel;
    }
    return `${baseLabel} – doppelt tief`;
  }

  function resolveRound({ results, pot, schoggeAusCount = 0, immediateAus = null }) {
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error("Eine Rundenauswertung braucht mindestens ein Ergebnis.");
    }

    if (immediateAus) {
      const result = results.find((entry) => entry.playerId === immediateAus.playerId) || results[0];
      return {
        type: "immediate_aus",
        title: "Schogge aus im ersten Wurf",
        losers: [result],
        drinks: immediateAus.potBefore || pot,
        multiplier: 1,
        nextStarterId: result.playerId,
        potAfter: 0,
      };
    }

    const worstFirst = sortWorstFirst(results);

    if (schoggeAusCount > 0) {
      const glassCount = Math.min(schoggeAusCount, results.length);
      const losers = worstFirst.slice(0, glassCount);
      return {
        type: "glass",
        title: `${glassCount} Glas${glassCount === 1 ? "" : "er"}`,
        losers,
        glassCount,
        nextStarterId: losers[0].playerId,
        potAfter: 0,
      };
    }

    const loser = worstFirst[0];
    const tiedWorst = results.filter((entry) => entry.score.rank === loser.score.rank);
    const multiplier = tiedWorst.length > 1 ? 2 : 1;

    return {
      type: "sips",
      title: "Schlückerunde",
      losers: [loser],
      drinks: pot * multiplier,
      multiplier,
      nextStarterId: loser.playerId,
      potAfter: 0,
    };
  }

  function getRegularRollCount(turn) {
    if (!turn) {
      return 0;
    }
    return Number.isInteger(turn.regularRollCount) ? turn.regularRollCount : turn.rollCount || 0;
  }

  function getActualThrowCount(turn) {
    if (!turn) {
      return 0;
    }
    if (Number.isInteger(turn.actualThrowCount)) {
      return turn.actualThrowCount;
    }
    return Number.isInteger(turn.rollCount) ? turn.rollCount : 0;
  }

  function getNextThrowNumber(turn) {
    return getActualThrowCount(turn) + 1;
  }

  function registerThrowStart(turn, wasForced) {
    const throwNumber = getNextThrowNumber(turn);
    turn.actualThrowCount = throwNumber;
    turn.rollCount = throwNumber;
    if (!wasForced) {
      turn.regularRollCount = getRegularRollCount(turn) + 1;
    }
    return throwNumber;
  }

  function deriveStarterRegularLimit(turn) {
    const actualThrowCount = getActualThrowCount(turn);
    if (actualThrowCount < 1) {
      throw new Error("Der Startspieler muss mindestens einmal würfeln.");
    }
    return Math.min(3, actualThrowCount);
  }

  function isStartPlayerTurn(round, turn) {
    return Boolean(round && turn && round.startPlayerId === turn.playerId);
  }

  function isStartPlayerSettingLimit(round, turn) {
    return isStartPlayerTurn(round, turn) && round.regularLimit == null;
  }

  function getTurnRegularLimit(round, turn) {
    if (isStartPlayerSettingLimit(round, turn)) {
      return 3;
    }
    return round?.regularLimit || 3;
  }

  function canRollTurn(round, turn) {
    if (!round || !turn || turn.isRolling || turn.confirmationLocked) {
      return false;
    }
    if (turn.forceReroll) {
      return turn.dice.some((die) => die !== 1);
    }
    if (!turn.held.some((held) => !held)) {
      return false;
    }
    return getActualThrowCount(turn) < getTurnRegularLimit(round, turn);
  }

  function canTakeTurnResult(round, turn) {
    if (!round || !turn || turn.forceReroll || turn.isRolling || turn.confirmationLocked || !turn.dice.every(Boolean)) {
      return false;
    }
    if (getRegularRollCount(turn) < 1) {
      return false;
    }
    if (isStartPlayerSettingLimit(round, turn)) {
      return true;
    }
    return round.regularLimit != null;
  }

  function shouldAutoAcceptTurn(round, turn) {
    return false;
  }

  const SchoggeRules = {
    scoreCombination,
    applyDoubleSixRule,
    resolveRound,
    sortWorstFirst,
    sortDiceDesc,
    getRegularRollCount,
    getActualThrowCount,
    getNextThrowNumber,
    deriveStarterRegularLimit,
    isStartPlayerTurn,
    isStartPlayerSettingLimit,
    getTurnRegularLimit,
    canRollTurn,
    canTakeTurnResult,
    shouldAutoAcceptTurn,
    getCombinationDisplayName,
    getLowestRoundScoreState,
    getResultDisplayName,
    isDoubleDeepResult,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SchoggeRules;
  }
  root.SchoggeRules = SchoggeRules;

  if (typeof document === "undefined") {
    return;
  }

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const defaultPlayers = () => [
    { id: createId(), name: "Spieler 1" },
    { id: createId(), name: "Spieler 2" },
  ];

  const defaultState = () => ({
    players: defaultPlayers(),
    gameStarted: false,
    roundNumber: 1,
    pot: 0,
    nextStarterId: null,
    screen: "setup",
    setupMode: "menu",
    panel: null,
    currentRound: null,
    currentTurn: null,
    lastResult: null,
    lastRound: null,
    history: loadHistory(),
  });

  let state = loadState();
  let onlineState = {
    view: "menu",
    room: null,
    players: [],
    session: loadOnlineSession(),
    error: "",
    notice: "",
    loading: false,
    channel: null,
    client: null,
  };
  let activeRollIntervalId = null;
  let activeRollTimeoutId = null;

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadOnlineSession() {
    try {
      return JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY)) || null;
    } catch {
      return null;
    }
  }

  function saveOnlineSession(session) {
    onlineState.session = session;
    if (session) {
      localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(ONLINE_SESSION_KEY);
    }
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    } catch {
      return [];
    }
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.players)) {
        const restored = { ...defaultState(), ...saved, history: loadHistory() };
        if (restored.currentTurn) {
          restored.currentTurn = clearTurnAnimation(restored.currentTurn);
        }
        return restored;
      }
    } catch {
      return defaultState();
    }
    return defaultState();
  }

  function saveState() {
    if (state.currentTurn?.isRolling) {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, history: undefined }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  }

  function clearTurnAnimation(turn) {
    return {
      ...turn,
      actualThrowCount: getActualThrowCount(turn),
      regularRollCount: Number.isInteger(turn.regularRollCount) ? turn.regularRollCount : turn.rollCount || 0,
      isRolling: false,
      rollingDice: null,
      rollingIndices: [],
      rollAnimationToken: null,
      confirmationLocked: false,
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function playerName(id) {
    const player = state.players.find((entry) => entry.id === id);
    return player ? player.name : "Unbekannt";
  }

  function getTurnOrder(startPlayerId) {
    const startIndex = Math.max(0, state.players.findIndex((player) => player.id === startPlayerId));
    return [...state.players.slice(startIndex), ...state.players.slice(0, startIndex)].map((player) => player.id);
  }

  function randomDie() {
    return Math.floor(Math.random() * 6) + 1;
  }

  function getSupabaseConfig() {
    return root.SCHOGGE_SUPABASE_CONFIG || {};
  }

  function isSupabaseConfigured() {
    const config = getSupabaseConfig();
    return Boolean(config.url && config.anonKey && root.supabase?.createClient);
  }

  function getSupabaseClient() {
    if (!isSupabaseConfigured()) {
      throw new Error("Supabase ist noch nicht konfiguriert.");
    }
    if (!onlineState.client) {
      const config = getSupabaseConfig();
      onlineState.client = root.supabase.createClient(config.url, config.anonKey);
    }
    return onlineState.client;
  }

  function setOnlineError(message) {
    onlineState.error = message || "";
    onlineState.notice = "";
  }

  function setOnlineNotice(message) {
    onlineState.notice = message || "";
    onlineState.error = "";
  }

  function setOnlineLoading(loading) {
    onlineState.loading = Boolean(loading);
  }

  function normalizeRoomCode(code) {
    return String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function currentOnlinePlayer() {
    return onlineState.players.find((player) => player.id === onlineState.session?.playerId) || null;
  }

  function isOnlineHost() {
    return Boolean(onlineState.room?.host_player_id && onlineState.room.host_player_id === onlineState.session?.playerId);
  }

  function getOnlineGameState() {
    return onlineState.room?.game_state || null;
  }

  function onlinePlayerName(playerId) {
    const player = onlineState.players.find((entry) => entry.id === playerId);
    return player ? player.name : "Unbekannt";
  }

  async function callOnlineRpc(name, payload) {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc(name, payload);
    if (error) {
      throw new Error(error.message || "Die Online-Aktion ist fehlgeschlagen.");
    }
    return data;
  }

  function currentPlayer() {
    if (!state.currentTurn) {
      return null;
    }
    return state.players.find((player) => player.id === state.currentTurn.playerId) || null;
  }

  function render() {
    saveState();
    const app = $("#app");
    const activePanel = state.panel || state.screen;
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">111</div>
          <div>
            <h1 class="brand-title">Schogge</h1>
            <p class="brand-subtitle">${state.gameStarted ? `Runde ${state.roundNumber}` : "Privates Würfelspiel"}</p>
          </div>
        </div>
        ${
          state.gameStarted
            ? `<button class="icon-button" id="prepare-new-game" aria-label="Spiel neu einrichten">↺</button>`
            : ""
        }
      </header>
      <main class="view">
        ${renderActiveView(activePanel)}
      </main>
      <nav class="bottom-nav" aria-label="Hauptnavigation">
        <button class="nav-button ${!state.panel ? "is-active" : ""}" data-panel="game">Spiel</button>
        <button class="nav-button ${state.panel === "rules" ? "is-active" : ""}" data-panel="rules">Regeln</button>
        <button class="nav-button ${state.panel === "history" ? "is-active" : ""}" data-panel="history">Verlauf</button>
      </nav>
    `;
    bindGlobalActions(app);
    bindViewActions(app, activePanel);
  }

  function renderActiveView(activePanel) {
    if (activePanel === "rules") {
      return renderRulesView();
    }
    if (activePanel === "history") {
      return renderHistoryView();
    }
    if (state.screen === "online") {
      return renderOnlineView();
    }
    if (state.screen === "roundStart") {
      return renderRoundStartView();
    }
    if (state.screen === "turn") {
      return renderTurnView();
    }
    if (state.screen === "result") {
      return renderResultView();
    }
    if (state.screen === "summary") {
      return renderSummaryView();
    }
    return renderSetupView();
  }

  function renderSetupView() {
    if (!state.gameStarted && state.setupMode === "menu") {
      return renderModeSelectionView();
    }
    const canAdd = state.players.length < 6;
    const canRemove = state.players.length > 2;
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Spiel einrichten</p>
          <h2>Zwei bis sechs Namen, dann wird ausgelost.</h2>
          <div class="stat-grid">
            <div class="stat"><span>Spieler</span><strong>${state.players.length}/6</strong></div>
            <div class="stat"><span>Runde</span><strong>${state.roundNumber}</strong></div>
            <div class="stat"><span>Pott</span><strong>${state.pot}</strong></div>
          </div>
        </div>
      </section>

      <section class="surface">
        <h2>Spieler</h2>
        <ul class="player-list">
          ${state.players
            .map(
              (player, index) => `
                <li class="player-row">
                  <input data-player-name="${player.id}" value="${escapeHtml(player.name)}" aria-label="Name Spieler ${index + 1}">
                  <button class="icon-button danger" data-remove-player="${player.id}" ${canRemove ? "" : "disabled"} aria-label="${escapeHtml(player.name)} entfernen">×</button>
                </li>
              `,
            )
            .join("")}
        </ul>
        <div class="actions">
          <button class="button secondary" id="add-player" ${canAdd ? "" : "disabled"}>+ Spieler</button>
          <button class="button" id="start-game">Spiel starten</button>
        </div>
        ${
          state.gameStarted
            ? `<button class="button warn" id="reset-game">Neues Spiel vorbereiten</button>`
            : ""
        }
      </section>
    `;
  }

  function renderModeSelectionView() {
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Spielmodus</p>
          <h2>Wie wollt ihr Schogge spielen?</h2>
          <div class="stat-grid mode-grid">
            <div class="stat mode-stat"><span>Lokal</span><strong>1 Gerät</strong></div>
            <div class="stat mode-stat"><span>Online</span><strong>Raumcode</strong></div>
            <div class="stat mode-stat"><span>Konten</span><strong>Keine</strong></div>
          </div>
        </div>
      </section>

      <section class="surface">
        <div class="actions vertical">
          <button class="button" id="choose-local">Lokales Spiel</button>
          <button class="button secondary" id="choose-online-create">Online-Spiel erstellen</button>
          <button class="button secondary" id="choose-online-join">Online-Spiel beitreten</button>
        </div>
        ${
          onlineState.session
            ? `<button class="button gold" id="resume-online">Online-Raum ${escapeHtml(onlineState.session.roomCode)} wieder öffnen</button>`
            : ""
        }
      </section>
    `;
  }

  function renderOnlineView() {
    if (onlineState.view === "create") {
      return renderOnlineCreateView();
    }
    if (onlineState.view === "join") {
      return renderOnlineJoinView();
    }
    if (onlineState.view === "lobby") {
      return renderOnlineLobbyView();
    }
    if (onlineState.view === "game") {
      return renderOnlineGameView();
    }
    return renderModeSelectionView();
  }

  function renderOnlineMessages() {
    return `
      ${onlineState.error ? `<div class="status-line aus">${escapeHtml(onlineState.error)}</div>` : ""}
      ${onlineState.notice ? `<div class="status-line confirm">${escapeHtml(onlineState.notice)}</div>` : ""}
      ${
        !isSupabaseConfigured()
          ? `<div class="status-line force">Supabase ist noch nicht eingerichtet. Trage URL und Anon Key in supabase-config.js ein und spiele das SQL-Schema in Supabase ein.</div>`
          : ""
      }
    `;
  }

  function renderOnlineCreateView() {
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Online-Spiel erstellen</p>
          <h2>Private Lobby mit Raumcode.</h2>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        <label class="field">
          <span>Dein Name</span>
          <input id="online-create-name" maxlength="32" autocomplete="name" placeholder="Name">
        </label>
        <div class="actions">
          <button class="button" id="create-online-room" ${onlineState.loading || !isSupabaseConfigured() ? "disabled" : ""}>Raum erstellen</button>
          <button class="button secondary" id="back-to-modes">Zurück</button>
        </div>
      </section>
    `;
  }

  function renderOnlineJoinView() {
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Online-Spiel beitreten</p>
          <h2>Raumcode und Name eingeben.</h2>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        <label class="field">
          <span>Dein Name</span>
          <input id="online-join-name" maxlength="32" autocomplete="name" placeholder="Name">
        </label>
        <label class="field">
          <span>Raumcode</span>
          <input id="online-room-code" maxlength="16" autocapitalize="characters" autocomplete="off" placeholder="SCHOGGE42">
        </label>
        <div class="actions">
          <button class="button" id="join-online-room" ${onlineState.loading || !isSupabaseConfigured() ? "disabled" : ""}>Beitreten</button>
          <button class="button secondary" id="back-to-modes">Zurück</button>
        </div>
      </section>
    `;
  }

  function renderOnlineLobbyView() {
    const room = onlineState.room;
    const canStart = isOnlineHost() && onlineState.players.length >= 2 && room?.status === "lobby";
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Online-Lobby</p>
          <h2>${room ? `Raum ${escapeHtml(room.code)}` : "Lobby wird geladen"}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Spieler</span><strong>${onlineState.players.length}/6</strong></div>
            <div class="stat"><span>Status</span><strong>${escapeHtml(room?.status || "-")}</strong></div>
            <div class="stat"><span>Du</span><strong>${escapeHtml(currentOnlinePlayer()?.name || "-")}</strong></div>
          </div>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        <div class="room-code">
          <span>Raumcode</span>
          <strong>${escapeHtml(room?.code || onlineState.session?.roomCode || "-")}</strong>
        </div>
        <div class="actions">
          <button class="button secondary" id="copy-room-code" ${room?.code ? "" : "disabled"}>Code kopieren</button>
          <button class="button" id="start-online-game" ${canStart ? "" : "disabled"}>Spiel starten</button>
          <button class="button warn" id="leave-online-room">Raum verlassen</button>
        </div>
      </section>
      <section class="surface">
        <h2>Spielerliste</h2>
        ${renderOnlinePlayerList()}
      </section>
    `;
  }

  function renderOnlinePlayerList() {
    if (!onlineState.players.length) {
      return `<p class="muted">Noch keine Spieler geladen.</p>`;
    }
    return `
      <ul class="player-list">
        ${onlineState.players
          .map((player) => {
            const isHost = onlineState.room?.host_player_id === player.id;
            const isMe = onlineState.session?.playerId === player.id;
            const isOnline = player.presence_state !== "offline";
            return `
              <li class="player-row online-player-row">
                <div>
                  <strong>${escapeHtml(player.name)}</strong>
                  <span class="result-meta">${isHost ? "Host" : "Mitspieler"}${isMe ? " · Du" : ""} · ${isOnline ? "online" : "offline"}</span>
                </div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function renderOnlineGameView() {
    const game = getOnlineGameState();
    if (!onlineState.room || !game) {
      return renderOnlineLobbyView();
    }
    const currentTurn = game.currentTurn || null;
    const round = game.currentRound || null;
    const currentPlayerId = currentTurn?.playerId || null;
    const myTurn = currentPlayerId === onlineState.session?.playerId;
    const activeName = currentPlayerId ? onlinePlayerName(currentPlayerId) : "-";

    if (game.screen === "result") {
      return renderOnlineResultView(game);
    }
    if (game.screen === "summary") {
      return renderOnlineSummaryView(game);
    }
    if (game.screen === "roundStart") {
      return renderOnlineRoundStartView(game);
    }

    const score = currentTurn?.dice?.every(Boolean) ? scoreCombination(currentTurn.dice) : null;
    const regularLimit = round && currentTurn ? getTurnRegularLimit(round, currentTurn) : 3;
    const canRoll = myTurn && round && currentTurn && canRollTurn(round, currentTurn);
    const canTake = myTurn && round && currentTurn && canTakeTurnResult(round, currentTurn);
    const guidance = myTurn ? "Du bist dran." : `${activeName} ist dran.`;
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Online-Spiel ${onlineState.room.code ? `· ${escapeHtml(onlineState.room.code)}` : ""}</p>
          <h2>${myTurn ? "Du bist dran" : `${escapeHtml(activeName)} würfelt`}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Würfe</span><strong>${getActualThrowCount(currentTurn)}/${regularLimit}</strong></div>
            <div class="stat"><span>Pott</span><strong>${game.pot || 0}</strong></div>
            <div class="stat"><span>Runde</span><strong>${game.roundNumber || 1}</strong></div>
          </div>
        </div>
      </section>
      <section class="surface dice-zone">
        ${renderOnlineMessages()}
        <div class="status-line ${currentTurn?.forceReroll ? "force" : ""}">${escapeHtml(currentTurn?.message || guidance)}</div>
        ${renderLowestScoreField(round?.results || [])}
        <div class="dice-row" aria-label="Würfel">
          ${(currentTurn?.dice || [null, null, null])
            .map((die, index) =>
              renderOnlineDie({
                value: die,
                index,
                held: currentTurn?.held?.[index],
                locked: currentTurn?.forceReroll,
                disabled: !myTurn || currentTurn?.forceReroll,
              }),
            )
            .join("")}
        </div>
        <div class="pill-row">
          ${score ? `<span class="pill ${score.category === "schogge_aus" ? "warn" : "info"}">${escapeHtml(score.label)}</span>` : ""}
          ${currentTurn?.forceReroll ? `<span class="pill gold">Pflichtwurf</span>` : ""}
          ${myTurn ? `<span class="pill good">Du bist dran</span>` : `<span class="pill info">${escapeHtml(activeName)} ist dran</span>`}
        </div>
        <div class="actions">
          <button class="button ${currentTurn?.forceReroll ? "gold" : ""}" id="online-roll" ${canRoll ? "" : "disabled"}>
            ${currentTurn?.forceReroll ? `Pflichtwurf (Wurf ${getNextThrowNumber(currentTurn)})` : `Würfeln (Wurf ${getNextThrowNumber(currentTurn)})`}
          </button>
          <button class="button gold" id="online-take-result" ${canTake ? "" : "disabled"}>Ergebnis bestätigen</button>
          <button class="button warn" id="leave-online-room">Raum verlassen</button>
        </div>
      </section>
      <section class="surface">
        <h2>Aktuelle Ergebnisse</h2>
        ${renderOnlineResults(round?.results || [])}
      </section>
    `;
  }

  function renderOnlineDie({ value, index, held, locked, disabled }) {
    const pips = value
      ? `<span class="die-pips pips-${value}">${Array.from({ length: value }, () => "<span></span>").join("")}</span>`
      : `<span class="die-empty">?</span>`;
    return `
      <button
        class="die ${held ? "is-held" : ""} ${locked ? "is-locked" : ""}"
        data-online-toggle-die="${index}"
        aria-label="Würfel ${index + 1}${held ? ", gehalten" : ""}"
        aria-pressed="${held ? "true" : "false"}"
        ${!value || locked || disabled ? "disabled" : ""}
      >
        ${pips}
      </button>
    `;
  }

  function renderOnlineResults(results) {
    if (!results.length) {
      return `<p class="muted">Noch keine Ergebnisse.</p>`;
    }
    return `
      <ul class="result-list">
        ${results
          .map((result) => {
            const resultLabel = getResultDisplayName(result, results);
            return `
              <li class="result-row">
                <div class="result-main">
                  <strong>${escapeHtml(result.playerName)}</strong>
                  <span class="result-meta">${escapeHtml(resultLabel)} · ${formatResultThrowMeta(result)}</span>
                </div>
                <div class="score-badge">${escapeHtml(resultLabel)}</div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function renderOnlineRoundStartView(game) {
    const canBegin = isOnlineHost() || game.nextStarterId === onlineState.session?.playerId;
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Online-Runde</p>
          <h2>${escapeHtml(onlinePlayerName(game.nextStarterId))} beginnt.</h2>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        <p class="muted">Der Startspieler bestimmt das Limit durch tatsächlich ausgeführte Würfe, höchstens drei.</p>
        <div class="actions">
          <button class="button" id="online-begin-round" ${canBegin ? "" : "disabled"}>Runde starten</button>
          <button class="button warn" id="leave-online-room">Raum verlassen</button>
        </div>
      </section>
    `;
  }

  function renderOnlineResultView(game) {
    const result = game.lastResult;
    const results = game.currentRound?.results || [result];
    const resultLabel = getResultDisplayName(result, results);
    const canContinue = isOnlineHost() || onlineState.session?.playerId === result?.playerId;
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Zugergebnis</p>
          <h2>${escapeHtml(result?.playerName || "-")}: ${escapeHtml(resultLabel)}</h2>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        <div class="status-line">${escapeHtml(result?.message || "Ergebnis übernommen.")}</div>
        <div class="actions">
          <button class="button" id="online-continue" ${canContinue ? "" : "disabled"}>${game.currentRoundDone ? "Zur Auswertung" : "Nächster Spieler"}</button>
          <button class="button warn" id="leave-online-room">Raum verlassen</button>
        </div>
      </section>
    `;
  }

  function renderOnlineSummaryView(game) {
    const outcome = game.lastRound?.outcome;
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Rundenauswertung</p>
          <h2>${escapeHtml(outcome ? outcomeText(outcome) : "Runde beendet.")}</h2>
        </div>
      </section>
      <section class="surface">
        ${renderOnlineMessages()}
        ${renderOnlineResults(game.lastRound?.results || [])}
        <div class="actions">
          <button class="button" id="online-next-round" ${isOnlineHost() ? "" : "disabled"}>Nächste Runde</button>
          <button class="button warn" id="leave-online-room">Raum verlassen</button>
        </div>
      </section>
    `;
  }

  function renderRoundStartView() {
    const starter = playerName(state.nextStarterId);
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Rundenstart</p>
          <h2>${escapeHtml(starter)} beginnt und bestimmt das Wurflimit im Zug.</h2>
          <div class="stat-grid">
            <div class="stat"><span>Runde</span><strong>${state.roundNumber}</strong></div>
            <div class="stat"><span>Start</span><strong>${escapeHtml(starter)}</strong></div>
            <div class="stat"><span>Pott</span><strong>${state.pot}</strong></div>
          </div>
        </div>
      </section>

      <section class="surface">
        <h2>Runde starten</h2>
        <p class="muted">Der Startspieler würfelt zuerst. Seine tatsächlich ausgeführten Würfe legen anschließend das Limit für alle anderen fest, höchstens jedoch drei.</p>
        <button class="button" id="begin-round">Runde starten</button>
      </section>
    `;
  }

  function renderTurnView() {
    const turn = state.currentTurn;
    const round = state.currentRound;
    if (!turn || !round) {
      return renderSetupView();
    }
    const player = currentPlayer();
    const visibleDice = turn.isRolling && turn.rollingDice ? turn.rollingDice : turn.dice;
    const rollingIndices = turn.rollingIndices || [];
    const score = !turn.isRolling && turn.dice.every(Boolean) ? scoreCombination(turn.dice) : null;
    const statusClass = turn.isRolling ? "rolling" : turn.forceReroll ? "force" : score?.category === "schogge_aus" ? "aus" : "";
    const canTake = canTakeTurnResult(round, turn);
    const canRoll = canRollTurn(round, turn);
    const regularLimit = getTurnRegularLimit(round, turn);
    const actualThrowCount = getActualThrowCount(turn);
    const nextThrowNumber = getNextThrowNumber(turn);
    const guidance = turnGuidance(round, turn);
    const confirmHint = canTake && score ? `Erkannte Kombination: ${score.label}. Bitte Ergebnis bestätigen.` : "";

    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Spielerzug</p>
          <h2>${escapeHtml(player?.name || "Spieler")}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Würfe</span><strong>${actualThrowCount}/${regularLimit}</strong></div>
            <div class="stat"><span>Regulär</span><strong>${getRegularRollCount(turn)}</strong></div>
            <div class="stat"><span>Pott</span><strong>${state.pot}</strong></div>
            <div class="stat"><span>Aus</span><strong>${round.schoggeAusCount}</strong></div>
          </div>
        </div>
      </section>

      <section class="surface dice-zone">
        <div class="status-line">
          ${escapeHtml(guidance)}
        </div>
        ${renderLowestScoreField(round.results)}
        <div class="status-line ${statusClass}">
          ${escapeHtml(turn.message)}
        </div>
        ${
          confirmHint
            ? `<div class="status-line confirm">${escapeHtml(confirmHint)}</div>`
            : ""
        }
        <div class="dice-row" aria-label="Würfel">
          ${visibleDice
            .map((die, index) =>
              renderDie({
                value: die,
                index,
                held: turn.held[index],
                locked: turn.forceReroll,
                disabled: turn.isRolling,
                rolling: turn.isRolling && rollingIndices.includes(index),
              }),
            )
            .join("")}
        </div>
        <div class="pill-row">
          ${score ? `<span class="pill ${score.category === "schogge_aus" ? "warn" : "info"}">${escapeHtml(score.label)}</span>` : ""}
          ${turn.forceReroll ? `<span class="pill gold">Pflichtwurf</span>` : ""}
          ${turn.isRolling ? `<span class="pill gold">Würfel rollen</span>` : ""}
          ${round.potFrozen ? `<span class="pill warn">Pott geschlossen</span>` : ""}
        </div>
        <div class="actions">
          <button class="button ${turn.forceReroll ? "gold" : ""}" id="roll-dice" ${canRoll ? "" : "disabled"}>
            ${turn.forceReroll ? `Pflichtwurf (Wurf ${nextThrowNumber})` : `Würfeln (Wurf ${nextThrowNumber})`}
          </button>
          <button class="button gold" id="take-result" ${canTake ? "" : "disabled"}>Ergebnis bestätigen</button>
        </div>
      </section>
    `;
  }

  function renderDie({ value, index, held, locked, disabled, rolling }) {
    const pips = value
      ? `<span class="die-pips pips-${value}">${Array.from({ length: value }, () => "<span></span>").join("")}</span>`
      : `<span class="die-empty">?</span>`;

    return `
      <button
        class="die ${held ? "is-held" : ""} ${locked ? "is-locked" : ""} ${rolling ? "is-rolling" : ""}"
        data-toggle-die="${index}"
        aria-label="Würfel ${index + 1}${held ? ", gehalten" : ""}"
        aria-pressed="${held ? "true" : "false"}"
        data-rolling="${rolling ? "true" : "false"}"
        ${!value || locked || disabled ? "disabled" : ""}
      >
        ${pips}
      </button>
    `;
  }

  function renderResultView() {
    const result = state.lastResult;
    if (!result) {
      return renderSetupView();
    }
    const roundResults = state.currentRound?.results || [result];
    const resultLabel = getResultDisplayName(result, roundResults);
    const isRoundDone = state.currentRound?.immediateAus || state.currentRound?.results.length === state.players.length;
    const message = resultMessage(result);

    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Zugergebnis</p>
          <h2>${escapeHtml(result.playerName)}: ${escapeHtml(resultLabel)}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Anzeige</span><strong>${escapeHtml(resultLabel)}</strong></div>
            <div class="stat"><span>Würfe</span><strong>${result.actualThrowCount || result.rollCount}</strong></div>
            <div class="stat"><span>Pott</span><strong>${result.potAfter}</strong></div>
          </div>
        </div>
      </section>

      <section class="surface">
        ${renderLowestScoreField(roundResults)}
        <div class="status-line ${result.special === "immediate_aus" || result.special === "regular_aus" ? "aus" : ""}">
          ${escapeHtml(message)}
        </div>
        <div class="result-row">
          <div class="result-main">
            <strong>${escapeHtml(resultLabel)}</strong>
            <span class="result-meta">Pott vorher ${result.potBefore}, nachher ${result.potAfter}</span>
          </div>
          <div class="score-badge">${escapeHtml(resultLabel)}</div>
        </div>
        <button class="button" id="continue-after-result">${isRoundDone ? "Zur Auswertung" : "Nächster Spieler"}</button>
      </section>
    `;
  }

  function renderSummaryView() {
    const round = state.lastRound;
    if (!round || !round.outcome) {
      return renderRoundStartView();
    }
    const outcome = round.outcome;
    const loserIds = new Set(outcome.losers.map((entry) => entry.playerId));
    const text = outcomeText(outcome);

    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Rundenauswertung</p>
          <h2>${escapeHtml(text)}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Runde</span><strong>${round.number}</strong></div>
            <div class="stat"><span>Limit</span><strong>${round.regularLimit || "-"}</strong></div>
            <div class="stat"><span>Nächster Start</span><strong>${escapeHtml(playerName(outcome.nextStarterId))}</strong></div>
          </div>
        </div>
      </section>

      <section class="surface">
        ${renderLowestScoreField(round.results)}
        <h2>Ergebnisse</h2>
        <ul class="result-list">
          ${round.results
            .map((result) => {
              const resultLabel = getResultDisplayName(result, round.results);
              const loserText = loserIds.has(result.playerId) ? " · Verlierer" : "";
              return `
                <li class="result-row ${loserIds.has(result.playerId) ? (outcome.type === "glass" ? "is-glass" : "is-loser") : ""}">
                  <div class="result-main">
                    <strong>${escapeHtml(result.playerName)}</strong>
                    <span class="result-meta">${escapeHtml(resultLabel)} · ${formatResultThrowMeta(result)}${loserText}</span>
                  </div>
                  <div class="score-badge">${escapeHtml(resultLabel)}</div>
                </li>
              `;
            })
            .join("")}
        </ul>
        <button class="button" id="next-round">Nächste Runde</button>
      </section>
    `;
  }

  function renderRulesView() {
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Regeln</p>
          <h2>Rang, Pott und Schogge aus.</h2>
        </div>
      </section>
      <section class="surface">
        <ul class="rules-list">
          <li><strong>Rangfolge:</strong> 111, dann 116 bis 112, Drasch, Straßen, einfache Zahlen. 531 ist die höchste einfache Zahl.</li>
          <li><strong>Pott:</strong> Schogge zählt 2 bis 6 Schlücke, Drasch 3, Straße 2, einfache Zahlen 0.</li>
          <li><strong>Doppel-Sechs:</strong> Eine 6 wird zur 1. Alle Nicht-Einsen müssen erneut geworfen werden; dieser Pflichtwurf zählt mit.</li>
          <li><strong>111 im ersten Wurf:</strong> Die Runde endet sofort. Der Spieler verliert und trinkt den bisherigen Pott.</li>
          <li><strong>111 ab dem zweiten Wurf:</strong> Der Pott verfällt, weitere Schlücke werden nicht gezählt. Am Ende exen die schlechtesten Spieler je nach Anzahl der Schogge aus.</li>
          <li><strong>Gleichstand:</strong> Bei gleichem schlechtestem Wurf verliert der Spieler, der später fertig war.</li>
        </ul>
      </section>
    `;
  }

  function renderHistoryView() {
    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Verlauf</p>
          <h2>${state.history.length ? "Gespeicherte Runden" : "Noch keine Runde gespeichert"}</h2>
        </div>
      </section>
      <section class="surface">
        ${
          state.history.length
            ? `<ul class="history-list">
                ${state.history
                  .map(
                    (entry) => `
                      <li class="history-row">
                        <strong>Runde ${entry.roundNumber}: ${escapeHtml(entry.summary)}</strong>
                        <span class="history-meta">${escapeHtml(entry.date)} · Start: ${escapeHtml(entry.startPlayer)} · Limit ${entry.limit}</span>
                      </li>
                    `,
                  )
                  .join("")}
              </ul>`
            : `<p class="muted">Der Verlauf wird nach abgeschlossenen Runden lokal auf diesem Gerät gespeichert.</p>`
        }
        <button class="button secondary" id="clear-history" ${state.history.length ? "" : "disabled"}>Verlauf löschen</button>
      </section>
    `;
  }

  function renderLowestScoreField(results) {
    const lowest = getLowestRoundScoreState(results);
    return `
      <div class="lowest-field">
        <span>Aktuell tiefstes Ergebnis</span>
        <strong>${escapeHtml(lowest.label)}</strong>
      </div>
    `;
  }

  function formatResultThrowMeta(result) {
    const actual = getActualThrowCount(result);
    const regular = getRegularRollCount(result);
    const actualText = `${actual} Wurf${actual === 1 ? "" : "e"} gesamt`;
    if (actual === regular) {
      return actualText;
    }
    return `${actualText} · ${regular} reguläre${regular === 1 ? "r" : ""} Wurf${regular === 1 ? "" : "e"}`;
  }

  function turnGuidance(round, turn) {
    if (isStartPlayerSettingLimit(round, turn)) {
      return "Du bestimmst das Wurflimit für diese Runde. Nach deinem Zug gilt deine Anzahl tatsächlich ausgeführter Würfe für alle Spieler, höchstens jedoch drei.";
    }
    return `Maximal ${round.regularLimit} Würfe, festgelegt durch ${round.startPlayerName}.`;
  }

  function bindGlobalActions(app) {
    $$("[data-panel]", app).forEach((button) => {
      button.addEventListener("click", () => {
        const panel = button.dataset.panel;
        state.panel = panel === "game" ? null : panel;
        render();
      });
    });
    $("#prepare-new-game", app)?.addEventListener("click", prepareNewGame);
  }

  function bindViewActions(app, activePanel) {
    if (activePanel === "rules") {
      return;
    }
    if (activePanel === "history") {
      $("#clear-history", app)?.addEventListener("click", () => {
        state.history = [];
        saveState();
        render();
      });
      return;
    }

    if (state.screen === "setup") {
      bindSetupActions(app);
    } else if (state.screen === "online") {
      bindOnlineActions(app);
    } else if (state.screen === "roundStart") {
      bindRoundStartActions(app);
    } else if (state.screen === "turn") {
      bindTurnActions(app);
    } else if (state.screen === "result") {
      $("#continue-after-result", app)?.addEventListener("click", continueAfterResult);
    } else if (state.screen === "summary") {
      $("#next-round", app)?.addEventListener("click", () => {
        state.screen = "roundStart";
        state.panel = null;
        render();
      });
    }
  }

  function bindSetupActions(app) {
    $("#choose-local", app)?.addEventListener("click", () => {
      state.setupMode = "local";
      state.screen = "setup";
      render();
    });
    $("#choose-online-create", app)?.addEventListener("click", () => {
      openOnlineView("create");
    });
    $("#choose-online-join", app)?.addEventListener("click", () => {
      openOnlineView("join");
    });
    $("#resume-online", app)?.addEventListener("click", () => {
      resumeOnlineSession();
    });

    $$("[data-player-name]", app).forEach((input) => {
      input.addEventListener("input", () => {
        const player = state.players.find((entry) => entry.id === input.dataset.playerName);
        if (player) {
          player.name = input.value.trim() || "Spieler";
          saveState();
        }
      });
    });

    $$("[data-remove-player]", app).forEach((button) => {
      button.addEventListener("click", () => {
        if (state.players.length <= 2) {
          return;
        }
        state.players = state.players.filter((player) => player.id !== button.dataset.removePlayer);
        render();
      });
    });

    $("#add-player", app)?.addEventListener("click", () => {
      if (state.players.length >= 6) {
        return;
      }
      state.players.push({ id: createId(), name: `Spieler ${state.players.length + 1}` });
      render();
    });

    $("#start-game", app)?.addEventListener("click", startGame);
    $("#reset-game", app)?.addEventListener("click", prepareNewGame);
  }

  function prepareNewGame() {
    clearActiveRollTimers();
    const names = state.players.map((player) => ({ id: createId(), name: player.name }));
    state = { ...defaultState(), players: names, history: state.history };
    render();
  }

  function bindRoundStartActions(app) {
    $("#begin-round", app)?.addEventListener("click", beginRound);
  }

  function bindOnlineActions(app) {
    $("#back-to-modes", app)?.addEventListener("click", () => {
      openModeMenu();
    });
    $("#create-online-room", app)?.addEventListener("click", createOnlineRoom);
    $("#join-online-room", app)?.addEventListener("click", joinOnlineRoom);
    $("#copy-room-code", app)?.addEventListener("click", copyOnlineRoomCode);
    $("#start-online-game", app)?.addEventListener("click", () => performOnlineAction("schogge_start_game", {}));
    $("#online-begin-round", app)?.addEventListener("click", () => performOnlineAction("schogge_begin_round", {}));
    $("#online-roll", app)?.addEventListener("click", () => performOnlineAction("schogge_roll", {}));
    $("#online-take-result", app)?.addEventListener("click", () => performOnlineAction("schogge_accept_turn", {}));
    $("#online-continue", app)?.addEventListener("click", () => performOnlineAction("schogge_continue_after_result", {}));
    $("#online-next-round", app)?.addEventListener("click", () => performOnlineAction("schogge_next_round", {}));
    $("#leave-online-room", app)?.addEventListener("click", leaveOnlineRoom);

    $$("[data-online-toggle-die]", app).forEach((button) => {
      button.addEventListener("click", () => {
        performOnlineAction("schogge_toggle_die", { die_index: Number(button.dataset.onlineToggleDie) });
      });
    });
  }

  function openModeMenu() {
    clearOnlineRealtime();
    setOnlineError("");
    onlineState.view = "menu";
    state.screen = "setup";
    state.setupMode = "menu";
    render();
  }

  function openOnlineView(view) {
    state.screen = "online";
    state.panel = null;
    onlineState.view = view;
    setOnlineError("");
    render();
  }

  async function createOnlineRoom() {
    const name = $("#online-create-name")?.value.trim();
    if (!name) {
      setOnlineError("Bitte gib deinen Namen ein.");
      render();
      return;
    }
    await runOnline(async () => {
      const data = await callOnlineRpc("schogge_create_room", { player_name: name });
      adoptOnlineSession(data);
      setOnlineNotice("Online-Raum erstellt.");
      await loadOnlineRoom();
    });
  }

  async function joinOnlineRoom() {
    const name = $("#online-join-name")?.value.trim();
    const code = normalizeRoomCode($("#online-room-code")?.value);
    if (!name || !code) {
      setOnlineError("Bitte gib Name und Raumcode ein.");
      render();
      return;
    }
    await runOnline(async () => {
      const data = await callOnlineRpc("schogge_join_room", { room_code: code, player_name: name });
      adoptOnlineSession(data);
      setOnlineNotice("Du bist der Lobby beigetreten.");
      await loadOnlineRoom();
    });
  }

  function adoptOnlineSession(data) {
    const session = {
      roomId: data.room_id,
      roomCode: data.room_code,
      playerId: data.player_id,
      playerToken: data.player_token,
    };
    saveOnlineSession(session);
    onlineState.view = data.room_status === "playing" ? "game" : "lobby";
    state.screen = "online";
    state.panel = null;
  }

  async function resumeOnlineSession() {
    if (!onlineState.session) {
      openOnlineView("join");
      return;
    }
    openOnlineView("lobby");
    await runOnline(loadOnlineRoom);
  }

  async function runOnline(work) {
    try {
      setOnlineLoading(true);
      setOnlineError("");
      render();
      await work();
    } catch (error) {
      setOnlineError(error.message || "Online-Aktion fehlgeschlagen.");
    } finally {
      setOnlineLoading(false);
      render();
    }
  }

  async function loadOnlineRoom() {
    const session = onlineState.session;
    if (!session) {
      throw new Error("Keine Online-Sitzung gefunden.");
    }
    const client = getSupabaseClient();
    const { data: room, error: roomError } = await client
      .from("schogge_rooms")
      .select("*")
      .eq("id", session.roomId)
      .single();
    if (roomError || !room) {
      throw new Error("Der Online-Raum wurde nicht gefunden oder ist abgelaufen.");
    }
    const { data: players, error: playersError } = await client
      .from("schogge_players")
      .select("*")
      .eq("room_id", session.roomId)
      .order("seat_index", { ascending: true });
    if (playersError) {
      throw new Error("Die Spielerliste konnte nicht geladen werden.");
    }
    onlineState.room = room;
    onlineState.players = players || [];
    onlineState.view = room.status === "lobby" ? "lobby" : "game";
    subscribeOnlineRoom();
  }

  function subscribeOnlineRoom() {
    const session = onlineState.session;
    if (!session || onlineState.channel) {
      return;
    }
    const client = getSupabaseClient();
    onlineState.channel = client
      .channel(`schogge-room-${session.roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schogge_rooms", filter: `id=eq.${session.roomId}` }, () => {
        loadOnlineRoom().catch((error) => {
          setOnlineError(error.message);
          render();
        });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schogge_players", filter: `room_id=eq.${session.roomId}` }, () => {
        loadOnlineRoom().catch((error) => {
          setOnlineError(error.message);
          render();
        });
      })
      .subscribe();
    touchOnlinePresence();
  }

  function clearOnlineRealtime() {
    if (onlineState.channel && onlineState.client) {
      onlineState.client.removeChannel(onlineState.channel);
    }
    onlineState.channel = null;
  }

  async function touchOnlinePresence() {
    if (!onlineState.session || !isSupabaseConfigured()) {
      return;
    }
    try {
      await callOnlineRpc("schogge_touch_presence", {
        player_id: onlineState.session.playerId,
        player_token: onlineState.session.playerToken,
      });
    } catch {
      // Eine fehlgeschlagene Anwesenheitsmeldung darf das Spiel nicht blockieren.
    }
  }

  async function performOnlineAction(actionName, payload) {
    const session = onlineState.session;
    if (!session) {
      setOnlineError("Du bist keinem Online-Raum beigetreten.");
      render();
      return;
    }
    await runOnline(async () => {
      await callOnlineRpc(actionName, {
        ...payload,
        room_id: session.roomId,
        player_id: session.playerId,
        player_token: session.playerToken,
      });
      await loadOnlineRoom();
    });
  }

  async function copyOnlineRoomCode() {
    const code = onlineState.room?.code || onlineState.session?.roomCode;
    if (!code) {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setOnlineNotice("Raumcode kopiert.");
    } catch {
      setOnlineNotice(`Raumcode: ${code}`);
    }
    render();
  }

  async function leaveOnlineRoom() {
    const session = onlineState.session;
    if (session && isSupabaseConfigured()) {
      try {
        await callOnlineRpc("schogge_leave_room", {
          room_id: session.roomId,
          player_id: session.playerId,
          player_token: session.playerToken,
        });
      } catch {
        // Lokales Verlassen soll auch funktionieren, wenn die Verbindung weg ist.
      }
    }
    clearOnlineRealtime();
    saveOnlineSession(null);
    onlineState.room = null;
    onlineState.players = [];
    openModeMenu();
  }

  function bindTurnActions(app) {
    $$("[data-toggle-die]", app).forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.toggleDie);
        const turn = state.currentTurn;
        if (!turn || turn.forceReroll || turn.isRolling || !turn.dice[index]) {
          return;
        }
        turn.held[index] = !turn.held[index];
        turn.message = turn.held[index] ? "Würfel gehalten." : "Würfel freigegeben.";
        render();
      });
    });

    $("#roll-dice", app)?.addEventListener("click", performRoll);
    $("#take-result", app)?.addEventListener("click", () => acceptTurn("confirmed"));
  }

  function startGame() {
    clearActiveRollTimers();
    state.players = state.players
      .map((player, index) => ({
        ...player,
        name: player.name.trim() || `Spieler ${index + 1}`,
      }))
      .slice(0, 6);

    if (state.players.length < 2) {
      return;
    }

    const starter = state.players[Math.floor(Math.random() * state.players.length)];
    state.gameStarted = true;
    state.roundNumber = 1;
    state.pot = 0;
    state.nextStarterId = starter.id;
    state.currentRound = null;
    state.currentTurn = null;
    state.lastResult = null;
    state.lastRound = null;
    state.screen = "roundStart";
    state.panel = null;
    render();
  }

  function beginRound() {
    if (!state.gameStarted) {
      startGame();
      return;
    }
    const startPlayerId = state.nextStarterId || state.players[0].id;
    state.currentRound = {
      id: createId(),
      number: state.roundNumber,
      startPlayerId,
      startPlayerName: playerName(startPlayerId),
      regularLimit: null,
      turnOrder: getTurnOrder(startPlayerId),
      currentTurnIndex: 0,
      results: [],
      schoggeAusCount: 0,
      potFrozen: false,
      immediateAus: null,
      outcome: null,
    };
    startTurnForCurrentIndex();
  }

  function startTurnForCurrentIndex() {
    const round = state.currentRound;
    const playerId = round.turnOrder[round.currentTurnIndex];
    state.currentTurn = {
      playerId,
      dice: [null, null, null],
      held: [false, false, false],
      actualThrowCount: 0,
      rollCount: 0,
      regularRollCount: 0,
      forceReroll: false,
      isRolling: false,
      rollingDice: null,
      rollingIndices: [],
      rollAnimationToken: null,
      confirmationLocked: false,
      message: "Bereit für Wurf 1.",
    };
    state.screen = "turn";
    state.panel = null;
    render();
  }

  function performRoll() {
    const round = state.currentRound;
    const turn = state.currentTurn;
    if (!round || !turn || turn.isRolling || !canRollTurn(round, turn)) {
      return;
    }
    const wasForced = turn.forceReroll;
    const rollingIndices = getRollingIndices(turn, wasForced);
    if (!rollingIndices.length) {
      return;
    }
    const finalDice = createFinalRollDice(turn, wasForced, rollingIndices);
    const throwNumber = registerThrowStart(turn, wasForced);

    startRollAnimation(turn, {
      finalDice,
      rollingIndices,
      wasForced,
      throwNumber,
    });
  }

  function getRollingIndices(turn, wasForced) {
    if (wasForced) {
      return turn.dice.map((die, index) => (die === 1 ? null : index)).filter((index) => index !== null);
    }
    return turn.dice
      .map((die, index) => (die === null || !turn.held[index] ? index : null))
      .filter((index) => index !== null);
  }

  function createFinalRollDice(turn, wasForced, rollingIndices) {
    return turn.dice.map((die, index) => {
      if (!rollingIndices.includes(index)) {
        return die;
      }
      if (wasForced && die === 1) {
        return die;
      }
      return randomDie();
    });
  }

  function createRollingDisplayDice(turn, rollingIndices) {
    return turn.dice.map((die, index) => (rollingIndices.includes(index) ? randomDie() : die));
  }

  function prefersReducedMotion() {
    return Boolean(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function clearActiveRollTimers() {
    if (activeRollIntervalId) {
      clearInterval(activeRollIntervalId);
      activeRollIntervalId = null;
    }
    if (activeRollTimeoutId) {
      clearTimeout(activeRollTimeoutId);
      activeRollTimeoutId = null;
    }
  }

  function startRollAnimation(turn, { finalDice, rollingIndices, wasForced, throwNumber }) {
    clearActiveRollTimers();
    const token = createId();
    const reduceMotion = prefersReducedMotion();
    const duration = reduceMotion ? REDUCED_ROLL_ANIMATION_MS : ROLL_ANIMATION_MS;
    const frameMs = reduceMotion ? REDUCED_ROLL_FRAME_MS : ROLL_FRAME_MS;

    turn.isRolling = true;
    turn.rollingIndices = rollingIndices;
    turn.rollingDice = createRollingDisplayDice(turn, rollingIndices);
    turn.rollAnimationToken = token;
    turn.confirmationLocked = false;
    turn.message = wasForced ? `Pflichtwurf läuft. Wurf ${throwNumber}.` : `Würfel rollen. Wurf ${throwNumber}.`;
    render();

    activeRollIntervalId = setInterval(() => {
      if (state.currentTurn !== turn || turn.rollAnimationToken !== token) {
        clearActiveRollTimers();
        return;
      }
      turn.rollingDice = createRollingDisplayDice(turn, rollingIndices);
      render();
    }, frameMs);

    activeRollTimeoutId = setTimeout(() => {
      clearActiveRollTimers();
      if (state.currentTurn !== turn || turn.rollAnimationToken !== token) {
        return;
      }
      finishRollAfterAnimation(turn, { finalDice, wasForced });
    }, duration);
  }

  function finishRollAfterAnimation(turn, { finalDice, wasForced }) {
    turn.isRolling = false;
    turn.rollingDice = null;
    turn.rollingIndices = [];
    turn.rollAnimationToken = null;
    turn.dice = finalDice;
    turn.confirmationLocked = false;

    // Erst nach der sichtbaren Animation greifen die Regelentscheidungen.
    const doubleSix = applyDoubleSixRule(turn.dice);
    if (doubleSix.triggered) {
      turn.dice = doubleSix.dice;
      turn.held = doubleSix.held;
      turn.forceReroll = true;
      turn.message = `Doppel-Sechs: ${doubleSix.display}. Alle Nicht-Einsen müssen erneut gewürfelt werden. Der Pflichtwurf ist Wurf ${getNextThrowNumber(turn)}.`;
      render();
      return;
    }

    turn.forceReroll = false;

    if (wasForced) {
      turn.held = turn.dice.map((die) => die === 1);
      turn.message = canRollTurn(state.currentRound, turn)
        ? "Pflichtwurf erledigt. Du kannst bestätigen oder weiterwürfeln."
        : "Pflichtwurf erledigt. Bitte Ergebnis bestätigen.";
    } else {
      const limitReached = getActualThrowCount(turn) >= getTurnRegularLimit(state.currentRound, turn);
      turn.message = limitReached
        ? "Wurflimit erreicht. Bitte Ergebnis bestätigen."
        : "Wurf abgeschlossen. Du kannst bestätigen oder weiterwürfeln.";
    }

    const score = scoreCombination(turn.dice);
    if (score.category === "schogge_aus" && getActualThrowCount(turn) === 1) {
      acceptTurn("first_aus");
      return;
    }

    render();
  }

  function acceptTurn(reason) {
    const round = state.currentRound;
    const turn = state.currentTurn;
    if (!round || !turn || turn.forceReroll || turn.isRolling || turn.confirmationLocked || !turn.dice.every(Boolean)) {
      return;
    }
    if (reason !== "first_aus" && !canTakeTurnResult(round, turn)) {
      return;
    }
    turn.confirmationLocked = true;

    const score = scoreCombination(turn.dice);
    const player = currentPlayer();
    const completedOrder = round.results.length + 1;
    const potBefore = state.pot;
    let potChange = 0;
    let special = null;
    let setRoundLimit = null;

    if (score.category === "schogge_aus" && getActualThrowCount(turn) === 1) {
      special = "immediate_aus";
      round.immediateAus = {
        playerId: turn.playerId,
        potBefore,
      };
      state.pot = 0;
    } else if (score.category === "schogge_aus") {
      special = "regular_aus";
      round.schoggeAusCount += 1;
      round.potFrozen = true;
      state.pot = 0;
    } else if (!round.potFrozen) {
      potChange = score.schluecke;
      state.pot += potChange;
    }

    if (!round.immediateAus && isStartPlayerSettingLimit(round, turn)) {
      setRoundLimit = deriveStarterRegularLimit(turn);
      round.regularLimit = setRoundLimit;
    }

    const result = {
      playerId: turn.playerId,
      playerName: player?.name || "Spieler",
      dice: [...turn.dice],
      held: [...turn.held],
      rollCount: getActualThrowCount(turn),
      actualThrowCount: getActualThrowCount(turn),
      regularRollCount: getRegularRollCount(turn),
      completedOrder,
      score,
      potBefore,
      potAfter: state.pot,
      potChange,
      reason,
      special,
      setRoundLimit,
    };

    round.results.push(result);
    state.lastResult = result;
    state.screen = "result";
    render();
  }

  function continueAfterResult() {
    const round = state.currentRound;
    if (!round) {
      state.screen = "roundStart";
      render();
      return;
    }

    const roundDone = round.immediateAus || round.results.length >= state.players.length;
    if (roundDone) {
      finishRound();
      return;
    }

    round.currentTurnIndex += 1;
    startTurnForCurrentIndex();
  }

  function finishRound() {
    const round = state.currentRound;
    if (!round) {
      return;
    }
    round.outcome = resolveRound({
      results: round.results,
      pot: state.pot,
      schoggeAusCount: round.schoggeAusCount,
      immediateAus: round.immediateAus,
    });

    const historyEntry = {
      id: round.id,
      date: new Date().toLocaleString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
      roundNumber: round.number,
      startPlayer: round.startPlayerName,
      limit: round.regularLimit,
      summary: outcomeText(round.outcome),
      results: round.results.map((result) => ({
        playerName: result.playerName,
        displayDice: result.score.displayDice,
        label: getResultDisplayName(result, round.results),
        rollCount: result.rollCount,
        actualThrowCount: result.actualThrowCount || result.rollCount,
        regularRollCount: result.regularRollCount || result.rollCount,
      })),
    };

    state.history = [historyEntry, ...state.history].slice(0, MAX_HISTORY);
    state.nextStarterId = round.outcome.nextStarterId;
    state.pot = 0;
    state.roundNumber += 1;
    state.lastRound = round;
    state.currentRound = null;
    state.currentTurn = null;
    state.screen = "summary";
    state.panel = null;
    render();
  }

  function resultMessage(result) {
    const limitText = result.setRoundLimit
      ? ` Für diese Runde gelten maximal ${result.setRoundLimit} Würfe.`
      : "";
    if (result.special === "immediate_aus") {
      return `${result.playerName} verliert sofort und trinkt den bisherigen Pott.`;
    }
    if (result.special === "regular_aus") {
      return `Regulärer Schogge aus: Der Pott verfällt, ab jetzt zählen keine weiteren Schlücke.${limitText}`;
    }
    if (result.potChange > 0) {
      return `${result.potChange} Schlücke gehen in den Pott.${limitText}`;
    }
    if (state.currentRound?.potFrozen) {
      return `Der Pott ist geschlossen; dieses Ergebnis zählt nur für die Rangfolge.${limitText}`;
    }
    return `Keine Schlücke für den Pott.${limitText}`;
  }

  function outcomeText(outcome) {
    const names = outcome.losers.map((entry) => entry.playerName).join(", ");
    if (outcome.type === "immediate_aus") {
      return `${names} verliert sofort und trinkt ${outcome.drinks} Schlücke.`;
    }
    if (outcome.type === "glass") {
      return `${names} ${outcome.losers.length === 1 ? "ext ein Glas" : "exen ein Glas"}.`;
    }
    return `${names} trinkt ${outcome.drinks} Schlücke${outcome.multiplier > 1 ? " wegen Gleichstand" : ""}.`;
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }

  async function initializeOnlineFromSession() {
    if (!onlineState.session || !isSupabaseConfigured()) {
      render();
      return;
    }
    state.screen = "online";
    state.panel = null;
    onlineState.view = "lobby";
    try {
      await loadOnlineRoom();
      setOnlineNotice("Online-Raum wieder verbunden.");
    } catch (error) {
      setOnlineError(error.message);
    }
    render();
  }

  document.addEventListener("DOMContentLoaded", initializeOnlineFromSession);
})(typeof globalThis !== "undefined" ? globalThis : this);
