"use strict";

const assert = require("node:assert/strict");
const {
  scoreCombination,
  applyDoubleSixRule,
  resolveRound,
  sortWorstFirst,
  deriveStarterRegularLimit,
  getTurnRegularLimit,
  getActualThrowCount,
  getNextThrowNumber,
  canRollTurn,
  canTakeTurnResult,
  shouldAutoAcceptTurn,
  getCombinationDisplayName,
  getLowestRoundScoreState,
  getResultDisplayName,
  GAME_MODES,
  defaultSpecialRules,
  getTableEdgeRisk,
  getRescueWindowMs,
} = require("./app.js");

function result(playerId, dice, completedOrder, rollCount = 1) {
  return {
    playerId,
    playerName: `Spieler ${playerId}`,
    score: scoreCombination(dice),
    completedOrder,
    rollCount,
  };
}

function roundState(regularLimit = null) {
  return {
    startPlayerId: "A",
    startPlayerName: "Spieler A",
    regularLimit,
  };
}

function turnState({
  playerId = "A",
  regularRollCount = 0,
  rollCount = regularRollCount,
  actualThrowCount = rollCount,
  forceReroll = false,
  confirmationLocked = false,
  dice = [2, 3, 4],
}) {
  return {
    playerId,
    actualThrowCount,
    regularRollCount,
    rollCount,
    forceReroll,
    confirmationLocked,
    isRolling: false,
    dice,
    held: [false, false, false],
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("Kategorien und Rangfolge", () => {
  const aus = scoreCombination([1, 1, 1]);
  const schogge116 = scoreCombination([1, 1, 6]);
  const schogge115 = scoreCombination([5, 1, 1]);
  const drasch666 = scoreCombination([6, 6, 6]);
  const drasch555 = scoreCombination([5, 5, 5]);
  const strasse654 = scoreCombination([6, 5, 4]);
  const strasse543 = scoreCombination([3, 5, 4]);
  const einfach665 = scoreCombination([6, 6, 5]);

  assert.equal(aus.category, "schogge_aus");
  assert.equal(schogge116.category, "schogge");
  assert.equal(drasch666.category, "drasch");
  assert.equal(strasse654.category, "strasse");
  assert.equal(einfach665.category, "einfach");

  assert.ok(aus.rank > schogge116.rank);
  assert.ok(schogge116.rank > schogge115.rank);
  assert.ok(schogge115.rank > drasch666.rank);
  assert.ok(drasch666.rank > drasch555.rank);
  assert.ok(drasch555.rank > strasse654.rank);
  assert.ok(strasse654.rank > strasse543.rank);
  assert.ok(strasse543.rank > einfach665.rank);
});

test("Neue Schogge-Bezeichnungen", () => {
  assert.equal(scoreCombination([1, 1, 1]).label, "Schogge aus");
  assert.equal(scoreCombination([1, 1, 6]).label, "Schogge 6");
  assert.equal(scoreCombination([1, 1, 5]).label, "Schogge 5");
  assert.equal(scoreCombination([1, 1, 4]).label, "Schogge 4");
  assert.equal(scoreCombination([1, 1, 3]).label, "Schogge 3");
  assert.equal(scoreCombination([1, 1, 2]).label, "Schogge 2");
});

test("Neue Drasch-Bezeichnungen", () => {
  assert.equal(scoreCombination([6, 6, 6]).label, "Sechser Drasch");
  assert.equal(scoreCombination([5, 5, 5]).label, "Fünfer Drasch");
  assert.equal(scoreCombination([4, 4, 4]).label, "Vierer Drasch");
  assert.equal(scoreCombination([3, 3, 3]).label, "Dreier Drasch");
  assert.equal(scoreCombination([2, 2, 2]).label, "Zweier Drasch");
});

test("Neue Straßen-Bezeichnungen", () => {
  assert.equal(scoreCombination([6, 5, 4]).label, "Große Straße");
  assert.equal(scoreCombination([5, 4, 3]).label, "Mittelgroße Straße");
  assert.equal(scoreCombination([4, 3, 2]).label, "Mittelkleine Straße");
  assert.equal(scoreCombination([3, 2, 1]).label, "Kleine Straße");
});

test("Einfache Zahlen und Kurve", () => {
  assert.equal(scoreCombination([5, 3, 1]).label, "Kurve");
  assert.equal(scoreCombination([6, 5, 5]).label, "655");
  assert.equal(scoreCombination([2, 2, 1]).label, "221");
  assert.equal(getCombinationDisplayName(scoreCombination([5, 5, 4])), "554");
});

test("Doppelt tief nur beim aktuell niedrigsten Gleichstand", () => {
  const results = [
    result("1", [1, 1, 6], 1),
    result("2", [5, 5, 4], 2),
    result("3", [5, 5, 4], 3),
    result("4", [6, 6, 5], 4),
    result("5", [6, 6, 5], 5),
  ];
  const lowest = getLowestRoundScoreState(results);

  assert.equal(lowest.label, "554 – doppelt tief");
  assert.equal(getResultDisplayName(results[1], results), "554 – doppelt tief");
  assert.equal(getResultDisplayName(results[2], results), "554 – doppelt tief");
  assert.equal(getResultDisplayName(results[3], results), "665");
  assert.equal(getResultDisplayName(results[4], results), "665");
});

test("Ergebnisuebersicht nutzt zentrale Ergebnisbezeichnungen", () => {
  const cases = [
    [[1, 1, 6], "Schogge 6"],
    [[1, 1, 1], "Schogge aus"],
    [[6, 6, 6], "Sechser Drasch"],
    [[6, 5, 4], "Große Straße"],
    [[5, 4, 3], "Mittelgroße Straße"],
    [[4, 3, 2], "Mittelkleine Straße"],
    [[3, 2, 1], "Kleine Straße"],
    [[5, 3, 1], "Kurve"],
    [[5, 5, 4], "554"],
  ];

  cases.forEach(([dice, label], index) => {
    assert.equal(getResultDisplayName(result(String(index), dice, index + 1)), label);
  });

  const doubleDeepResults = [
    result("A", [5, 5, 4], 1),
    result("B", [5, 5, 4], 2),
    result("C", [6, 6, 6], 3),
  ];

  assert.equal(getResultDisplayName(doubleDeepResults[0], doubleDeepResults), "554 – doppelt tief");
  assert.equal(getResultDisplayName(doubleDeepResults[1], doubleDeepResults), "554 – doppelt tief");
});

test("Sonderfall 531 ist höchste einfache Zahl", () => {
  const topSimple = scoreCombination([5, 3, 1]);
  const highNormal = scoreCombination([6, 6, 5]);
  const lowSimple = scoreCombination([2, 2, 1]);

  assert.equal(topSimple.category, "einfach");
  assert.ok(topSimple.rank > highNormal.rank);
  assert.ok(highNormal.rank > lowSimple.rank);
});

test("Schlückewerte", () => {
  assert.equal(scoreCombination([1, 1, 6]).schluecke, 6);
  assert.equal(scoreCombination([2, 2, 2]).schluecke, 3);
  assert.equal(scoreCombination([6, 5, 4]).schluecke, 2);
  assert.equal(scoreCombination([6, 6, 5]).schluecke, 0);
});

test("Doppel-Sechs bei 661, 662 und 666", () => {
  const sixSixOne = applyDoubleSixRule([6, 6, 1]);
  assert.equal(sixSixOne.triggered, true);
  assert.equal(sixSixOne.display, "116");
  assert.deepEqual(sixSixOne.mustRerollIndices.map((index) => sixSixOne.dice[index]), [6]);

  const sixSixTwo = applyDoubleSixRule([6, 6, 2]);
  assert.equal(sixSixTwo.display, "612");
  assert.deepEqual(sixSixTwo.mustRerollIndices.map((index) => sixSixTwo.dice[index]).sort(), [2, 6]);

  const sixSixSix = applyDoubleSixRule([6, 6, 6]);
  assert.equal(sixSixSix.display, "166");
  assert.deepEqual(sixSixSix.mustRerollIndices.map((index) => sixSixSix.dice[index]), [6, 6]);
});

test("Pflichtwurf nach Doppel-Sechs im ersten Wurf ist Wurf 2 und erzeugt keinen vierten Normalwurf", () => {
  const round = roundState(3);
  const pendingForced = turnState({
    regularRollCount: 1,
    actualThrowCount: 1,
    rollCount: 1,
    forceReroll: true,
    dice: [1, 6, 2],
  });
  const afterForced = turnState({
    regularRollCount: 1,
    actualThrowCount: 2,
    rollCount: 2,
    dice: [1, 5, 2],
  });
  const afterThirdActualThrow = turnState({
    regularRollCount: 2,
    actualThrowCount: 3,
    rollCount: 3,
    dice: [5, 4, 2],
  });

  assert.equal(getNextThrowNumber(pendingForced), 2);
  assert.equal(canRollTurn(round, pendingForced), true);
  assert.equal(canRollTurn(round, afterForced), true);
  assert.equal(canRollTurn(round, afterThirdActualThrow), false);
});

test("Pflichtwurf nach Doppel-Sechs im zweiten Wurf ist Wurf 3 und erzeugt keinen vierten Normalwurf", () => {
  const round = roundState(3);
  const pendingForced = turnState({
    regularRollCount: 2,
    actualThrowCount: 2,
    rollCount: 2,
    forceReroll: true,
    dice: [1, 6, 2],
  });
  const afterForced = turnState({
    regularRollCount: 2,
    actualThrowCount: 3,
    rollCount: 3,
    dice: [1, 5, 2],
  });

  assert.equal(getNextThrowNumber(pendingForced), 3);
  assert.equal(canRollTurn(round, pendingForced), true);
  assert.equal(canRollTurn(round, afterForced), false);
});

test("Doppel-Sechs im dritten Wurf erlaubt Pflichtwurf als Wurf 4", () => {
  const round = roundState(3);
  const pendingForced = turnState({
    regularRollCount: 3,
    actualThrowCount: 3,
    rollCount: 3,
    forceReroll: true,
    dice: [1, 6, 2],
  });
  const afterForced = turnState({
    regularRollCount: 3,
    actualThrowCount: 4,
    rollCount: 4,
    dice: [1, 5, 2],
  });

  assert.equal(getNextThrowNumber(pendingForced), 4);
  assert.equal(canRollTurn(round, pendingForced), true);
  assert.equal(canRollTurn(round, afterForced), false);
});

test("Doppel-Sechs im vierten Pflichtwurf erlaubt weiteren Pflichtwurf als Wurf 5", () => {
  const round = roundState(3);
  const pendingForced = turnState({
    regularRollCount: 3,
    actualThrowCount: 4,
    rollCount: 4,
    forceReroll: true,
    dice: [1, 6, 2],
  });

  assert.equal(getActualThrowCount(pendingForced), 4);
  assert.equal(getNextThrowNumber(pendingForced), 5);
  assert.equal(canRollTurn(round, pendingForced), true);
});

test("Letzter regulärer Wurf wartet auf Bestätigung statt Auto-Übernahme", () => {
  const round = roundState(2);
  const turn = turnState({ playerId: "B", regularRollCount: 2, rollCount: 2 });

  assert.equal(shouldAutoAcceptTurn(round, turn), false);
  assert.equal(canTakeTurnResult(round, turn), true);
});

test("Freiwillig früher beendeter Zug kann bestätigt werden", () => {
  const round = roundState(3);
  const turn = turnState({ playerId: "B", regularRollCount: 1, rollCount: 1 });

  assert.equal(canTakeTurnResult(round, turn), true);
  assert.equal(getTurnRegularLimit(round, turn), 3);
});

test("Bestätigungssperre verhindert doppelte Übernahme", () => {
  const round = roundState(1);
  const turn = turnState({ playerId: "B", regularRollCount: 1, rollCount: 1, confirmationLocked: true });

  assert.equal(canTakeTurnResult(round, turn), false);
});

test("Reguläres Schogge aus ab dem zweiten Wurf wartet auf Bestätigung", () => {
  const round = roundState(2);
  const turn = turnState({ playerId: "B", regularRollCount: 2, rollCount: 2, dice: [1, 1, 1] });

  assert.equal(scoreCombination(turn.dice).category, "schogge_aus");
  assert.equal(canTakeTurnResult(round, turn), true);
  assert.equal(shouldAutoAcceptTurn(round, turn), false);
});

test("Startspieler beendet nach einem Wurf: andere haben maximal einen regulären Wurf", () => {
  const starterTurn = turnState({ regularRollCount: 1, rollCount: 1 });
  const limit = deriveStarterRegularLimit(starterTurn);
  const round = roundState(limit);
  const nextPlayerTurn = turnState({ playerId: "B", regularRollCount: 1, rollCount: 1 });

  assert.equal(limit, 1);
  assert.equal(getTurnRegularLimit(round, nextPlayerTurn), 1);
  assert.equal(shouldAutoAcceptTurn(round, nextPlayerTurn), false);
  assert.equal(canTakeTurnResult(round, nextPlayerTurn), true);
});

test("Startspieler beendet nach zwei Würfen: andere haben maximal zwei reguläre Würfe", () => {
  const starterTurn = turnState({ regularRollCount: 2, rollCount: 2 });
  const limit = deriveStarterRegularLimit(starterTurn);
  const round = roundState(limit);

  assert.equal(limit, 2);
  assert.equal(canTakeTurnResult(roundState(null), starterTurn), true);
  assert.equal(shouldAutoAcceptTurn(round, turnState({ playerId: "B", regularRollCount: 1, rollCount: 1 })), false);
  assert.equal(shouldAutoAcceptTurn(round, turnState({ playerId: "B", regularRollCount: 2, rollCount: 2 })), false);
  assert.equal(canTakeTurnResult(round, turnState({ playerId: "B", regularRollCount: 2, rollCount: 2 })), true);
});

test("Startspieler nutzt drei Würfe: Ergebnis wartet auf Bestätigung", () => {
  const starterTurn = turnState({ regularRollCount: 3, rollCount: 3 });

  assert.equal(deriveStarterRegularLimit(starterTurn), 3);
  assert.equal(canTakeTurnResult(roundState(null), starterTurn), true);
  assert.equal(shouldAutoAcceptTurn(roundState(null), starterTurn), false);
});

test("Pflichtwürfe erhöhen das reguläre Limit nicht und blockieren Übernehmen", () => {
  const openForcedTurn = turnState({
    regularRollCount: 2,
    rollCount: 2,
    forceReroll: true,
    dice: [6, 1, 2],
  });
  const completedForcedTurn = turnState({
    regularRollCount: 2,
    rollCount: 4,
    forceReroll: false,
    dice: [5, 1, 2],
  });
  const limit = deriveStarterRegularLimit(completedForcedTurn);
  const round = roundState(limit);

  assert.equal(canTakeTurnResult(roundState(null), openForcedTurn), false);
  assert.equal(canRollTurn(roundState(null), openForcedTurn), true);
  assert.equal(canTakeTurnResult(roundState(null), completedForcedTurn), true);
  assert.equal(limit, 3);
  assert.equal(shouldAutoAcceptTurn(round, turnState({ playerId: "B", regularRollCount: 2, rollCount: 4 })), false);
  assert.equal(canTakeTurnResult(round, turnState({ playerId: "B", regularRollCount: 2, rollCount: 4 })), true);
});

test("Schogge aus im ersten Wurf endet sofort", () => {
  const results = [result("A", [1, 1, 1], 1, 1)];
  const outcome = resolveRound({
    results,
    pot: 7,
    immediateAus: { playerId: "A", potBefore: 7 },
  });

  assert.equal(outcome.type, "immediate_aus");
  assert.equal(outcome.nextStarterId, "A");
  assert.equal(outcome.drinks, 7);
  assert.equal(outcome.potAfter, 0);
});

test("Schogge aus ab dem zweiten Wurf löst Glasrunde aus", () => {
  const results = [
    result("A", [1, 1, 1], 1, 2),
    result("B", [6, 6, 5], 2, 1),
    result("C", [2, 2, 1], 3, 1),
  ];
  const outcome = resolveRound({ results, pot: 0, schoggeAusCount: 1 });

  assert.equal(outcome.type, "glass");
  assert.equal(outcome.losers[0].playerId, "C");
  assert.equal(outcome.nextStarterId, "C");
});

test("Gleichstand: spätester Abschluss verliert und trinkt doppelt", () => {
  const results = [
    result("1", [1, 1, 6], 1),
    result("2", [1, 1, 3], 2),
    result("3", [5, 5, 4], 3),
    result("4", [5, 5, 4], 4),
  ];
  const outcome = resolveRound({ results, pot: 9 });

  assert.equal(outcome.type, "sips");
  assert.equal(outcome.losers[0].playerId, "4");
  assert.equal(outcome.drinks, 18);
  assert.equal(outcome.nextStarterId, "4");
});

test("Glasrunde mit zwei Schogge aus wählt die zwei schlechtesten Spieler", () => {
  const results = [
    result("A", [1, 1, 1], 1, 2),
    result("B", [1, 1, 1], 2, 3),
    result("C", [6, 6, 5], 3),
    result("D", [5, 5, 4], 4),
    result("E", [5, 5, 4], 5),
  ];
  const outcome = resolveRound({ results, pot: 0, schoggeAusCount: 2 });

  assert.equal(outcome.type, "glass");
  assert.deepEqual(outcome.losers.map((entry) => entry.playerId), ["E", "D"]);
  assert.equal(outcome.nextStarterId, "E");
});

test("Worst-first Sortierung nutzt Zeit-Tie-Break", () => {
  const sorted = sortWorstFirst([
    result("früh", [5, 5, 4], 1),
    result("spät", [5, 5, 4], 2),
    result("besser", [1, 1, 2], 3),
  ]);

  assert.equal(sorted[0].playerId, "spät");
});

test("Startspieler-Limit zaehlt Pflichtwurf als zweiten Wurf", () => {
  const starterTurn = turnState({ regularRollCount: 1, actualThrowCount: 2, rollCount: 2 });
  const limit = deriveStarterRegularLimit(starterTurn);
  const round = roundState(limit);

  assert.equal(limit, 2);
  assert.equal(getTurnRegularLimit(round, turnState({ playerId: "B" })), 2);
  assert.equal(canRollTurn(round, turnState({ playerId: "B", regularRollCount: 1, actualThrowCount: 1, rollCount: 1 })), true);
  assert.equal(canRollTurn(round, turnState({ playerId: "B", regularRollCount: 2, actualThrowCount: 2, rollCount: 2 })), false);
});

test("Startspieler-Limit zaehlt Pflichtwurf als dritten Wurf", () => {
  const starterTurn = turnState({ regularRollCount: 2, actualThrowCount: 3, rollCount: 3 });
  const limit = deriveStarterRegularLimit(starterTurn);
  const round = roundState(limit);

  assert.equal(limit, 3);
  assert.equal(getTurnRegularLimit(round, turnState({ playerId: "B" })), 3);
  assert.equal(canRollTurn(round, turnState({ playerId: "B", regularRollCount: 2, actualThrowCount: 2, rollCount: 2 })), true);
  assert.equal(canRollTurn(round, turnState({ playerId: "B", regularRollCount: 3, actualThrowCount: 3, rollCount: 3 })), false);
});

test("Startspieler-Limit bleibt nach Pflichtwurf als viertem Wurf bei drei", () => {
  const starterTurn = turnState({ regularRollCount: 3, actualThrowCount: 4, rollCount: 4 });
  const limit = deriveStarterRegularLimit(starterTurn);
  const round = roundState(limit);

  assert.equal(limit, 3);
  assert.equal(getTurnRegularLimit(round, turnState({ playerId: "B" })), 3);
  assert.equal(canRollTurn(round, turnState({ playerId: "B", regularRollCount: 3, actualThrowCount: 3, rollCount: 3 })), false);
});

test("Schogge Spezial: klassischer Modus erzeugt kein Tischkanten-Risiko", () => {
  const game = { gameMode: GAME_MODES.CLASSIC, specialRules: defaultSpecialRules() };
  const turn = turnState({ regularRollCount: 2, actualThrowCount: 2, rollCount: 2 });

  assert.equal(getTableEdgeRisk(game, turn, false), 0);
});

test("Schogge Spezial: freiwilliges Weiterwürfeln erhöht Risiko", () => {
  const game = { gameMode: GAME_MODES.SPECIAL, specialRules: defaultSpecialRules() };

  assert.equal(getTableEdgeRisk(game, turnState({ regularRollCount: 1, actualThrowCount: 1, rollCount: 1 }), false), 0);
  assert.equal(getTableEdgeRisk(game, turnState({ regularRollCount: 2, actualThrowCount: 2, rollCount: 2 }), false), 0.02);
  assert.equal(getTableEdgeRisk(game, turnState({ regularRollCount: 3, actualThrowCount: 3, rollCount: 3 }), false), 0.05);
});

test("Schogge Spezial: Pflichtwurf bleibt risikofrei", () => {
  const game = { gameMode: GAME_MODES.SPECIAL, specialRules: defaultSpecialRules() };
  const forcedTurn = turnState({ regularRollCount: 3, actualThrowCount: 4, rollCount: 4, forceReroll: true });

  assert.equal(getTableEdgeRisk(game, forcedTurn, true), 0);
});

test("Schogge Spezial: Intensität steuert Risiko und Rettungsfenster", () => {
  const relaxed = { ...defaultSpecialRules(), intensity: "relaxed" };
  const normal = { ...defaultSpecialRules(), intensity: "normal" };
  const escalating = { ...defaultSpecialRules(), intensity: "escalating" };
  const turn = turnState({ regularRollCount: 2, actualThrowCount: 2, rollCount: 2 });

  assert.equal(getTableEdgeRisk({ gameMode: GAME_MODES.SPECIAL, specialRules: relaxed }, turn, false), 0.01);
  assert.equal(getTableEdgeRisk({ gameMode: GAME_MODES.SPECIAL, specialRules: normal }, turn, false), 0.02);
  assert.equal(getTableEdgeRisk({ gameMode: GAME_MODES.SPECIAL, specialRules: escalating }, turn, false), 0.035);
  assert.equal(getRescueWindowMs(relaxed), 1800);
  assert.equal(getRescueWindowMs(normal), 1200);
  assert.equal(getRescueWindowMs(escalating), 800);
});

console.log("Alle Regeltests bestanden.");
