(function initSchogge(root) {
  "use strict";

  const STORAGE_KEY = "schogge.state.v1";
  const HISTORY_KEY = "schogge.history.v1";
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

  function deriveStarterRegularLimit(turn) {
    const regularRollCount = getRegularRollCount(turn);
    if (regularRollCount < 1) {
      throw new Error("Der Startspieler muss mindestens einmal regulär würfeln.");
    }
    return Math.min(3, regularRollCount);
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
    return getRegularRollCount(turn) < getTurnRegularLimit(round, turn);
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
    panel: null,
    currentRound: null,
    currentTurn: null,
    lastResult: null,
    lastRound: null,
    history: loadHistory(),
  });

  let state = loadState();
  let activeRollIntervalId = null;
  let activeRollTimeoutId = null;

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      return root.crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        <p class="muted">Der Startspieler würfelt zuerst. Seine genutzten regulären Würfe legen anschließend das Limit für alle anderen fest.</p>
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
    const guidance = turnGuidance(round, turn);
    const confirmHint = canTake && score ? `Erkannte Kombination: ${score.label}. Bitte Ergebnis bestätigen.` : "";

    return `
      <section class="board">
        <div class="board-inner">
          <p class="eyebrow">Spielerzug</p>
          <h2>${escapeHtml(player?.name || "Spieler")}</h2>
          <div class="stat-grid">
            <div class="stat"><span>Regulär</span><strong>${getRegularRollCount(turn)}/${regularLimit}</strong></div>
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
            ${turn.forceReroll ? "Pflichtwurf" : "Würfeln"}
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
            <div class="stat"><span>Regulär</span><strong>${result.regularRollCount || result.rollCount}</strong></div>
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
                    <span class="result-meta">${escapeHtml(resultLabel)} · ${result.regularRollCount || result.rollCount} reguläre${(result.regularRollCount || result.rollCount) === 1 ? "r" : ""} Wurf${(result.regularRollCount || result.rollCount) === 1 ? "" : "e"}${loserText}</span>
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

  function turnGuidance(round, turn) {
    if (isStartPlayerSettingLimit(round, turn)) {
      return "Du bestimmst das Wurflimit für diese Runde. Nach deinem Zug gilt deine genutzte Anzahl an regulären Würfen für alle Spieler.";
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
      rollCount: 0,
      regularRollCount: 0,
      forceReroll: false,
      isRolling: false,
      rollingDice: null,
      rollingIndices: [],
      rollAnimationToken: null,
      confirmationLocked: false,
      message: "Bereit für den ersten Wurf.",
    };
    state.screen = "turn";
    state.panel = null;
    render();
  }

  function performRoll() {
    const turn = state.currentTurn;
    if (!turn || turn.isRolling) {
      return;
    }
    const wasForced = turn.forceReroll;
    const rollingIndices = getRollingIndices(turn, wasForced);
    if (!rollingIndices.length) {
      return;
    }
    const finalDice = createFinalRollDice(turn, wasForced, rollingIndices);

    startRollAnimation(turn, {
      finalDice,
      rollingIndices,
      wasForced,
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

  function startRollAnimation(turn, { finalDice, rollingIndices, wasForced }) {
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
    turn.message = wasForced ? "Pflichtwurf läuft. Die Pflichtwürfel rollen." : "Würfel rollen.";
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
    turn.rollCount += 1;
    if (!wasForced) {
      turn.regularRollCount = getRegularRollCount(turn) + 1;
    }

    // Erst nach der sichtbaren Animation greifen die Regelentscheidungen.
    const doubleSix = applyDoubleSixRule(turn.dice);
    if (doubleSix.triggered) {
      turn.dice = doubleSix.dice;
      turn.held = doubleSix.held;
      turn.forceReroll = true;
      turn.message = `Doppel-Sechs: ${doubleSix.display}. Alle Nicht-Einsen müssen erneut gewürfelt werden.`;
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
      const limitReached = getRegularRollCount(turn) >= getTurnRegularLimit(state.currentRound, turn);
      turn.message = limitReached
        ? "Wurflimit erreicht. Bitte Ergebnis bestätigen."
        : "Wurf abgeschlossen. Du kannst bestätigen oder weiterwürfeln.";
    }

    const score = scoreCombination(turn.dice);
    if (score.category === "schogge_aus" && turn.rollCount === 1) {
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

    if (score.category === "schogge_aus" && turn.rollCount === 1) {
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
      rollCount: turn.rollCount,
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

  document.addEventListener("DOMContentLoaded", render);
})(typeof globalThis !== "undefined" ? globalThis : this);
