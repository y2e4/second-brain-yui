"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

global.window = global;
delete global.QualificationOSCommon;
require("./hygiene-os-v2-learning-data-migration.js");

var ADAPTER = global.HygieneOSV2LearningDataMigration;
var STATE_KEY = "hygieneQualificationOSV2StateV1";
var BACKUP_KEY = "hygieneQualificationOSV2LearningDataMigrationBackupsV1";
var MIGRATED_AT = "2026-07-26T12:34:56.000Z";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeQuestionStats(index) {
  var isAggregate = index === 1;
  var isManualWeak = index <= 14;
  var outcome = index === 3
    ? "unsure"
    : index === 4
      ? "guess"
      : index === 5
        ? "ambiguous"
        : "understood";
  return {
    attempts: isAggregate ? 261 : 1,
    correct: isAggregate ? 229 : 1,
    wrong: isAggregate ? 32 : 0,
    unsure: index === 3 ? 1 : 0,
    guess: index === 4 ? 1 : 0,
    ambiguous: index === 5 ? 1 : 0,
    understood: outcome === "understood" ? (isAggregate ? 200 : 1) : 0,
    fluctuationCount: isAggregate ? 32 : outcome === "understood" ? 0 : 1,
    reviewCount: 0,
    understoodStreak: outcome === "understood" ? 1 : 0,
    lastUnderstandingDate: outcome === "understood" ? "2026-07-25" : "",
    lastOutcome: outcome,
    lastAnsweredDate: "2026-07-25",
    lastFluctuationAt: outcome === "understood" ? "" : "2026-07-25T08:00:00.000Z",
    lastFluctuationDate: outcome === "understood" ? "" : "2026-07-25",
    lastStableAt: outcome === "understood" ? "2026-07-25T08:00:00.000Z" : "",
    lastShownOrder: index,
    supplementAttempts: 0,
    supplementCorrect: 0,
    supplementUnderstood: 0,
    supplementWeak: 0,
    lastSupplementAt: "",
    lastSupplementOutcome: "",
    wrongActive: isAggregate,
    reviewActive: isAggregate || outcome !== "understood",
    manualWeak: isManualWeak
  };
}

function makeLegacyState() {
  var questionStats = {};
  var index;
  for (index = 1; index <= 15; index += 1) {
    questionStats["legacy-q" + String(index).padStart(2, "0")] =
      makeQuestionStats(index);
  }
  return {
    schemaVersion: 2,
    unlockedStages: [1, 2, 3, 4, 5],
    currentStage: 5,
    earnedKeys: {
      "2": true,
      "3": true,
      "4": true,
      "5": true
    },
    stage5Ready: true,
    totalAnswered: 275,
    lastStudyDate: "2026-07-25",
    lastStudyAt: "2026-07-25T08:00:00.000Z",
    lastSavedAt: "2026-07-25T08:00:00.000Z",
    lastManualSyncAt: "2026-07-23T08:00:00.000Z",
    shownSequence: 15,
    recentQuestionIds: ["legacy-q13", "legacy-q14", "legacy-q15"],
    dailyDate: "2026-07-25",
    dailyShownIds: ["legacy-q15"],
    dailyAnsweredCount: 3,
    lastQueueByStage: {
      "5": ["legacy-q13", "legacy-q14", "legacy-q15"]
    },
    firekeeper: {
      shownDates: [],
      lastShownDate: "",
      lastDecision: "",
      lastReason: "",
      lastActionAt: "",
      restRecords: []
    },
    questionStats: questionStats,
    currentSession: {
      stage: 5,
      mode: "final30",
      queue: ["legacy-q13", "legacy-q14", "legacy-q15"],
      index: 2,
      correct: 3,
      recorded: true,
      selectionLog: [{
        questionId: "legacy-q15",
        selectionReason: "legacy"
      }]
    }
  };
}

function makeGenericQuestionStats(attempts, correct, manualWeak) {
  var wrong = Math.max(0, attempts - correct);
  return {
    attempts: attempts,
    correct: correct,
    wrong: wrong,
    unsure: 0,
    guess: 0,
    understood: correct > 0 ? 1 : 0,
    understoodStreak: correct > 0 ? 1 : 0,
    lastUnderstandingDate: correct > 0 ? "2026-07-25" : "",
    lastOutcome: wrong > 0 ? "incorrect" : correct > 0 ? "understood" : "",
    lastAnsweredDate: attempts > 0 ? "2026-07-25" : "",
    lastShownOrder: attempts > 0 ? 1 : 0,
    wrongActive: wrong > 0,
    reviewActive: wrong > 0,
    manualWeak: manualWeak === true
  };
}

function makeGenericLegacyState(options) {
  var settings = Object.assign({
    totalAnswered: 11,
    totalCorrect: 9,
    currentStage: 1,
    unlockedStages: [1],
    manualWeakCount: 0,
    currentSession: null
  }, options || {});
  var questionStats = {
    "generic-q01": makeGenericQuestionStats(
      settings.totalAnswered,
      settings.totalCorrect,
      false
    )
  };
  var index;

  for (index = 1; index <= settings.manualWeakCount; index += 1) {
    questionStats["generic-weak-" + index] = makeGenericQuestionStats(0, 0, true);
  }

  return {
    schemaVersion: 2,
    unlockedStages: cloneJson(settings.unlockedStages),
    currentStage: settings.currentStage,
    totalAnswered: settings.totalAnswered,
    totalCorrect: settings.totalCorrect,
    lastStudyDate: settings.totalAnswered ? "2026-07-25" : "",
    lastStudyAt: settings.totalAnswered ? "2026-07-25T08:00:00.000Z" : "",
    lastSavedAt: "2026-07-25T08:00:00.000Z",
    shownSequence: settings.totalAnswered ? 1 : 0,
    recentQuestionIds: settings.totalAnswered ? ["generic-q01"] : [],
    questionStats: questionStats,
    currentSession: settings.currentSession === undefined
      ? null
      : cloneJson(settings.currentSession)
  };
}

function MemoryStorage(options) {
  this.values = new Map();
  this.failures = Object.assign({}, options && options.failures || {});
}

MemoryStorage.prototype.seed = function (key, value) {
  this.values.set(String(key), String(value));
};

MemoryStorage.prototype.getItem = function (key) {
  var normalized = String(key);
  return this.values.has(normalized) ? this.values.get(normalized) : null;
};

MemoryStorage.prototype.setItem = function (key, value) {
  var normalized = String(key);
  var remaining = Number(this.failures[normalized] || 0);
  if (remaining > 0) {
    this.failures[normalized] = remaining - 1;
    throw new Error("simulated storage failure: " + normalized);
  }
  this.values.set(normalized, String(value));
};

MemoryStorage.prototype.removeItem = function (key) {
  this.values.delete(String(key));
};

function migrationOptions(storage, extra) {
  return Object.assign({
    storage: storage,
    stateKey: STATE_KEY,
    backupKey: BACKUP_KEY,
    migratedAt: MIGRATED_AT
  }, extra || {});
}

function migrateFixture() {
  var storage = new MemoryStorage();
  var source = makeLegacyState();
  storage.seed(STATE_KEY, JSON.stringify(source));
  return {
    storage: storage,
    source: source,
    result: ADAPTER.migrateOnce(migrationOptions(storage))
  };
}

function countCorrect(questionStats) {
  return Object.values(questionStats).reduce(function (sum, stats) {
    return sum + Number(stats.correct || 0);
  }, 0);
}

function countManualWeak(questionStats) {
  return Object.values(questionStats).filter(function (stats) {
    return stats.manualWeak === true;
  }).length;
}

function assertNoInvalidValues(value, pathName) {
  var currentPath = pathName || "value";
  assert.notEqual(value, null, currentPath + " must not be null");
  assert.notEqual(value, undefined, currentPath + " must not be undefined");
  if (typeof value === "number") {
    assert.equal(Number.isFinite(value), true, currentPath + " must be finite");
  }
  if (Array.isArray(value)) {
    value.forEach(function (item, index) {
      assertNoInvalidValues(item, currentPath + "[" + index + "]");
    });
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach(function (key) {
      assertNoInvalidValues(value[key], currentPath + "." + key);
    });
  }
}

function applyLegacyOutcome(state, questionId, outcome, answeredAt) {
  var next = cloneJson(state);
  var stats = next.questionStats[questionId];
  var isCorrect = outcome !== "incorrect";
  var answeredDate = answeredAt.slice(0, 10);

  next.totalAnswered += 1;
  next.lastStudyAt = answeredAt;
  next.lastStudyDate = answeredDate;
  stats.attempts += 1;
  stats.lastOutcome = outcome;
  stats.lastAnsweredDate = answeredDate;
  if (isCorrect) {
    stats.correct += 1;
  } else {
    stats.wrong += 1;
    stats.wrongActive = true;
    stats.reviewActive = true;
  }
  if (outcome === "understood") {
    stats.understood += 1;
    stats.understoodStreak += 1;
    stats.lastUnderstandingDate = answeredDate;
  } else {
    stats.understoodStreak = 0;
    stats.lastUnderstandingDate = "";
    stats.reviewActive = true;
    if (outcome === "unsure") {
      stats.unsure += 1;
    } else if (outcome === "guess") {
      stats.guess += 1;
    } else if (outcome === "ambiguous") {
      stats.ambiguous += 1;
    }
  }
  return next;
}

function recordAdapterAnswer(state, questionId, outcome, answeredAt, options) {
  var settings = options || {};
  var question = Object.assign({
    id: questionId,
    stage: 5,
    category: "労働生理",
    theme: "循環",
    choices: ["A", "B"],
    answer: "A"
  }, settings.question || {});
  return ADAPTER.recordAnswerAfterLegacyUpdate(state, {
    question: question,
    outcome: outcome,
    selectedAnswer: outcome === "incorrect" ? "B" : "A",
    correctAnswer: "A",
    isCorrect: outcome !== "incorrect",
    mode: "final30",
    answeredAt: answeredAt,
    reasoningLevel: settings.reasoningLevel,
    questionType: settings.questionType
  });
}

test("資格OS共通JSなしで自己完結して読み込める", function () {
  var source = fs.readFileSync(
    path.join(__dirname, "hygiene-os-v2-learning-data-migration.js"),
    "utf8"
  );

  assert.equal(global.QualificationOSCommon, undefined);
  assert.equal(typeof ADAPTER.migrateOnce, "function");
  assert.equal(source.includes("QualificationOSCommon"), false);
  assert.equal(source.includes("COMMON."), false);
});

test("移行前バックアップを完全保存し、再読込照合後に移行する", function () {
  var fixture = migrateFixture();
  var backups = JSON.parse(fixture.storage.getItem(BACKUP_KEY));

  assert.equal(fixture.result.migrated, true);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].createdAt, MIGRATED_AT);
  assert.equal(backups[0].storageKey, STATE_KEY);
  assert.deepEqual(backups[0].state, fixture.source);
});

test("バックアップ失敗時は元状態を変更せず移行を中止する", function () {
  var storage = new MemoryStorage({
    failures: Object.fromEntries([[BACKUP_KEY, 1]])
  });
  var source = makeLegacyState();
  var rawSource = JSON.stringify(source);
  storage.seed(STATE_KEY, rawSource);

  assert.throws(function () {
    ADAPTER.migrateOnce(migrationOptions(storage));
  }, function (error) {
    return error && error.code === "backup_failed";
  });
  assert.equal(storage.getItem(STATE_KEY), rawSource);
  assert.equal(storage.getItem(BACKUP_KEY), null);
});

test("275回答、243正解、Stage 5、manualWeak 14問を維持する", function () {
  var fixture = migrateFixture();
  var migrated = fixture.result.state;

  assert.equal(migrated.totalAnswered, 275);
  assert.equal(countCorrect(migrated.questionStats), 243);
  assert.equal(migrated.currentStage, 5);
  assert.deepEqual(migrated.unlockedStages, [1, 2, 3, 4, 5]);
  assert.equal(countManualWeak(migrated.questionStats), 14);
  assert.deepEqual(migrated.questionStats, fixture.source.questionStats);
});

test("currentSessionを移行前後で完全維持する", function () {
  var fixture = migrateFixture();
  assert.deepEqual(
    fixture.result.state.currentSession,
    fixture.source.currentSession
  );
});

test("learningDataを旧集計から生成し、履歴を推測しない", function () {
  var learningData = migrateFixture().result.state.learningData;

  assert.equal(learningData.totalAnswered, 275);
  assert.equal(learningData.totalCorrect, 243);
  assert.deepEqual(learningData.answerHistory, []);
  assert.equal(learningData.reviewQueue.weakQuestionIds.length, 14);
  assert.equal(learningData.reviewQueue.wrongQuestionIds.includes("legacy-q01"), true);
  assert.equal(learningData.reviewQueue.unsureQuestionIds.includes("legacy-q03"), true);
  assert.equal(learningData.reviewQueue.guessedQuestionIds.includes("legacy-q04"), true);
  assert.equal(learningData.reviewQueue.ambiguousQuestionIds.includes("legacy-q05"), true);
});

test("Stage 5は適応難易度Level 3、連続状態は0から開始する", function () {
  var difficulty = migrateFixture().result.state.learningData.adaptiveDifficulty;

  assert.equal(difficulty.reasoningLevel, 3);
  assert.equal(difficulty.perfectSetStreak, 0);
  assert.deepEqual(difficulty.recentSets, []);
  assert.deepEqual(difficulty.recentSessions, []);
  assert.equal(Object.prototype.hasOwnProperty.call(difficulty, "lastSet"), false);
});

test("adaptiveSelectionは既知のrecentQuestionIdsだけを引き継ぐ", function () {
  var adaptive = migrateFixture().result.state.adaptiveSelection;

  assert.equal(adaptive.selectionSequence, 0);
  assert.deepEqual(adaptive.recentQuestionIds, [
    "legacy-q13",
    "legacy-q14",
    "legacy-q15"
  ]);
  assert.deepEqual(adaptive.recentStartQuestionIds, []);
  assert.deepEqual(adaptive.recentKnowledgeKeys, []);
  assert.equal(Object.prototype.hasOwnProperty.call(adaptive, "lastSelection"), false);
});

test("migrationMetaを保存する", function () {
  var meta = migrateFixture().result.state.learningData.migrationMeta;

  assert.equal(meta.migratedFromLegacy, true);
  assert.equal(meta.migratedAt, MIGRATED_AT);
  assert.equal(meta.legacyTotalAnswered, 275);
  assert.equal(meta.legacyTotalCorrect, 243);
  assert.equal(meta.legacyManualWeakCount, 14);
  assert.equal(meta.answerHistoryReconstructed, false);
});

test("再読込相当の二回目実行では二重移行しない", function () {
  var fixture = migrateFixture();
  var beforeReload = fixture.storage.getItem(STATE_KEY);
  var second = ADAPTER.migrateOnce(migrationOptions(fixture.storage, {
    migratedAt: "2026-07-27T01:00:00.000Z"
  }));

  assert.equal(second.migrated, false);
  assert.equal(second.reason, "already_migrated");
  assert.equal(fixture.storage.getItem(STATE_KEY), beforeReload);
  assert.equal(JSON.parse(fixture.storage.getItem(BACKUP_KEY)).length, 1);
});

test("対象外の旧状態はskipExpectedMismatch指定時に保存しない", function () {
  var storage = new MemoryStorage();
  var source = makeLegacyState();
  source.totalAnswered = 274;
  source.questionStats["legacy-q01"].attempts = 260;
  var rawSource = JSON.stringify(source);
  storage.seed(STATE_KEY, rawSource);

  var result = ADAPTER.migrateOnce(migrationOptions(storage, {
    skipExpectedMismatch: true
  }));

  assert.equal(result.migrated, false);
  assert.equal(result.reason, "not_target_state");
  assert.equal(storage.getItem(STATE_KEY), rawSource);
  assert.equal(storage.getItem(BACKUP_KEY), null);
});

test("移行結果の保存失敗時は元状態へ完全復旧する", function () {
  var storage = new MemoryStorage({
    failures: Object.fromEntries([[STATE_KEY, 1]])
  });
  var source = makeLegacyState();
  var rawSource = JSON.stringify(source);
  storage.seed(STATE_KEY, rawSource);

  assert.throws(function () {
    ADAPTER.migrateOnce(migrationOptions(storage));
  }, function (error) {
    return error && error.code === "migration_failed";
  });
  assert.equal(storage.getItem(STATE_KEY), rawSource);
  assert.deepEqual(JSON.parse(storage.getItem(BACKUP_KEY))[0].state, source);
});

test("新しい正解1問後、旧集計と新集計が276回答244正解で一致する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T01:23:45.000Z";
  var legacyAfter = applyLegacyOutcome(
    migrated,
    "legacy-q15",
    "understood",
    answeredAt
  );
  var combined = recordAdapterAnswer(
    legacyAfter,
    "legacy-q15",
    "understood",
    answeredAt
  );

  assert.equal(combined.totalAnswered, 276);
  assert.equal(countCorrect(combined.questionStats), 244);
  assert.equal(combined.learningData.totalAnswered, 276);
  assert.equal(combined.learningData.totalCorrect, 244);
  assert.equal(combined.learningData.answerHistory.length, 1);
  assert.equal(combined.learningData.answerHistory[0].questionId, "legacy-q15");
  assert.equal(combined.learningData.questionStats["legacy-q15"].attempts, 2);
  assert.equal(combined.learningData.questionStats["legacy-q15"].correct, 2);
  assert.equal(
    combined.learningData.questionStats["legacy-q15"].lastAnsweredAt,
    answeredAt
  );
  assert.equal(
    combined.learningData.questionStats["legacy-q15"].lastStableAt,
    answeredAt
  );
});

test("新しい不正解1問後、旧集計と新集計の復習状態が一致する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T02:00:00.000Z";
  var legacyAfter = applyLegacyOutcome(
    migrated,
    "legacy-q15",
    "incorrect",
    answeredAt
  );
  var combined = recordAdapterAnswer(
    legacyAfter,
    "legacy-q15",
    "incorrect",
    answeredAt
  );

  assert.equal(combined.totalAnswered, 276);
  assert.equal(countCorrect(combined.questionStats), 243);
  assert.equal(combined.learningData.totalAnswered, 276);
  assert.equal(combined.learningData.totalCorrect, 243);
  assert.equal(combined.questionStats["legacy-q15"].wrongActive, true);
  assert.equal(combined.learningData.questionStats["legacy-q15"].wrongActive, true);
  assert.equal(
    combined.learningData.reviewQueue.wrongQuestionIds.includes("legacy-q15"),
    true
  );
  assert.equal(
    combined.learningData.questionStats["legacy-q15"].lastFluctuationAt,
    answeredAt
  );
});

test("manualWeak追加を旧構造とlearningDataへ同期する", function () {
  var migrated = migrateFixture().result.state;
  var legacyAfter = cloneJson(migrated);
  legacyAfter.questionStats["legacy-q15"].manualWeak = true;
  var combined = ADAPTER.setWeakAfterLegacyUpdate(legacyAfter, {
    questionId: "legacy-q15",
    weak: true,
    changedAt: "2026-07-27T03:00:00.000Z"
  });

  assert.equal(combined.questionStats["legacy-q15"].manualWeak, true);
  assert.equal(combined.learningData.questionStats["legacy-q15"].manualWeak, true);
  assert.equal(
    combined.learningData.reviewQueue.weakQuestionIds.includes("legacy-q15"),
    true
  );
});

test("manualWeak解除を旧構造とlearningDataへ同期する", function () {
  var migrated = migrateFixture().result.state;
  var legacyAfter = cloneJson(migrated);
  legacyAfter.questionStats["legacy-q14"].manualWeak = false;
  var combined = ADAPTER.setWeakAfterLegacyUpdate(legacyAfter, {
    questionId: "legacy-q14",
    weak: false,
    changedAt: "2026-07-27T03:30:00.000Z"
  });

  assert.equal(combined.questionStats["legacy-q14"].manualWeak, false);
  assert.equal(combined.learningData.questionStats["legacy-q14"].manualWeak, false);
  assert.equal(
    combined.learningData.reviewQueue.weakQuestionIds.includes("legacy-q14"),
    false
  );
});

test("エクスポート項目にlearningData、adaptiveSelection、currentSession、selectionLogを保持する", function () {
  var migrated = migrateFixture().result.state;
  var fields = ADAPTER.buildExportFields(migrated);

  assert.deepEqual(fields.learningData, migrated.learningData);
  assert.deepEqual(fields.adaptiveSelection, migrated.adaptiveSelection);
  assert.deepEqual(fields.currentSession, migrated.currentSession);
  assert.deepEqual(
    fields.selectionLog,
    migrated.currentSession.selectionLog
  );
});

test("新形式インポートはlearningData等を保持する", function () {
  var migrated = migrateFixture().result.state;
  migrated.learningData.answerHistory.push({
    questionId: "legacy-q15",
    outcome: "understood",
    isCorrect: true,
    selectedAnswer: "A",
    correctAnswer: "A",
    category: "労働生理",
    theme: "循環",
    difficulty: "",
    questionType: "choice",
    reasoningLevel: 3,
    fluctuation: false,
    mode: "final30",
    answeredAt: "2026-07-27T04:00:00.000Z"
  });
  var imported = ADAPTER.prepareImportedState(migrated, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T04:30:00.000Z"
  });

  assert.equal(imported.learningData.answerHistory.length, 1);
  assert.deepEqual(imported.adaptiveSelection, migrated.adaptiveSelection);
  assert.deepEqual(imported.currentSession, migrated.currentSession);
  assert.deepEqual(
    imported.learningData.migrationMeta,
    migrated.learningData.migrationMeta
  );
});

test("旧形式インポートは保存前に安全な新形式へ変換する", function () {
  var legacy = makeLegacyState();
  var imported = ADAPTER.prepareImportedState(legacy, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T05:00:00.000Z"
  });

  assert.equal(imported.learningData.totalAnswered, 275);
  assert.equal(imported.learningData.totalCorrect, 243);
  assert.deepEqual(imported.learningData.answerHistory, []);
  assert.deepEqual(imported.questionStats, legacy.questionStats);
  assert.deepEqual(imported.currentSession, legacy.currentSession);
});

test("11回答9正解のStage 1旧形式インポートは入力値を維持する", function () {
  var session = {
    stage: 1,
    mode: "today",
    queue: ["generic-q01"],
    index: 0,
    correct: 1,
    recorded: true
  };
  var legacy = makeGenericLegacyState({
    totalAnswered: 11,
    totalCorrect: 9,
    currentStage: 1,
    unlockedStages: [1],
    manualWeakCount: 1,
    currentSession: session
  });
  var imported = ADAPTER.prepareImportedState(legacy, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T05:10:00.000Z"
  });

  assert.equal(imported.totalAnswered, 11);
  assert.equal(imported.learningData.totalAnswered, 11);
  assert.equal(imported.learningData.totalCorrect, 9);
  assert.equal(imported.currentStage, 1);
  assert.deepEqual(imported.unlockedStages, [1]);
  assert.equal(countManualWeak(imported.questionStats), 1);
  assert.deepEqual(imported.questionStats, legacy.questionStats);
  assert.deepEqual(imported.currentSession, session);
  assert.deepEqual(imported.learningData.answerHistory, []);
  assert.equal(imported.learningData.adaptiveDifficulty.reasoningLevel, 1);
});

test("回答0件の旧形式インポートはStage 1のまま成功する", function () {
  var legacy = makeGenericLegacyState({
    totalAnswered: 0,
    totalCorrect: 0,
    currentStage: 1,
    unlockedStages: [1],
    currentSession: null
  });
  var imported = ADAPTER.prepareImportedState(legacy, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T05:20:00.000Z"
  });

  assert.equal(imported.totalAnswered, 0);
  assert.equal(imported.learningData.totalAnswered, 0);
  assert.equal(imported.learningData.totalCorrect, 0);
  assert.equal(imported.currentStage, 1);
  assert.deepEqual(imported.unlockedStages, [1]);
  assert.equal(imported.learningData.answerHistory.length, 0);
});

test("明示されたtotalCorrectがquestionStatsと不一致の旧形式インポートは中止する", function () {
  var legacy = makeGenericLegacyState();
  legacy.totalCorrect = 8;

  assert.throws(function () {
    ADAPTER.prepareImportedState(legacy, {
      stateKey: STATE_KEY
    });
  }, function (error) {
    return error && error.code === "correct_mismatch";
  });
});

test("Stage 1から5の連続した旧形式インポートは集計と解放状態を維持する", function () {
  [
    { stage: 1, unlocked: [1], answered: 0, correct: 0, weak: 0 },
    { stage: 2, unlocked: [1, 2], answered: 12, correct: 10, weak: 1 },
    { stage: 3, unlocked: [1, 2, 3], answered: 18, correct: 14, weak: 2 },
    { stage: 4, unlocked: [1, 2, 3, 4], answered: 24, correct: 19, weak: 3 },
    { stage: 5, unlocked: [1, 2, 3, 4, 5], answered: 30, correct: 24, weak: 4 }
  ].forEach(function (scenario) {
    var legacy = makeGenericLegacyState({
      totalAnswered: scenario.answered,
      totalCorrect: scenario.correct,
      currentStage: scenario.stage,
      unlockedStages: scenario.unlocked,
      manualWeakCount: scenario.weak
    });
    var imported = ADAPTER.prepareImportedState(legacy, {
      stateKey: STATE_KEY,
      migratedAt: "2026-07-27T05:30:00.000Z"
    });

    assert.equal(imported.totalAnswered, scenario.answered);
    assert.equal(imported.learningData.totalAnswered, scenario.answered);
    assert.equal(imported.learningData.totalCorrect, scenario.correct);
    assert.equal(imported.currentStage, scenario.stage);
    assert.deepEqual(imported.unlockedStages, scenario.unlocked);
    assert.equal(countManualWeak(imported.questionStats), scenario.weak);
    assert.equal(
      imported.learningData.adaptiveDifficulty.reasoningLevel,
      scenario.stage === 5 ? 3 : 1
    );
  });
});

test("currentStageが解放されていない旧形式インポートは保存前に拒否する", function () {
  var storage = new MemoryStorage();
  var session = {
    stage: 3,
    mode: "challenge10",
    queue: ["generic-q01"],
    index: 0,
    recorded: false
  };
  var legacy = makeGenericLegacyState({
    currentStage: 3,
    unlockedStages: [1, 2],
    currentSession: session
  });
  var rawLegacy = JSON.stringify(legacy);

  assert.throws(function () {
    ADAPTER.prepareImportedState(legacy, { stateKey: STATE_KEY });
  }, function (error) {
    return error && error.code === "invalid_stage";
  });
  assert.deepEqual(legacy.currentSession, session);

  storage.seed(STATE_KEY, rawLegacy);
  assert.throws(function () {
    ADAPTER.migrateOnce(migrationOptions(storage));
  }, function (error) {
    return error && error.code === "invalid_stage";
  });
  assert.equal(storage.getItem(STATE_KEY), rawLegacy);
  assert.equal(storage.getItem(BACKUP_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem(STATE_KEY)).currentSession, session);
});

test("解放ステージに欠番がある旧形式インポートは保存前に拒否する", function () {
  var legacy = makeGenericLegacyState({
    currentStage: 2,
    unlockedStages: [1, 3]
  });
  var before = cloneJson(legacy);

  assert.throws(function () {
    ADAPTER.prepareImportedState(legacy, { stateKey: STATE_KEY });
  }, function (error) {
    return error && error.code === "invalid_stage";
  });
  assert.deepEqual(legacy, before);
});

test("上位ステージ解放後に下位ステージを選ぶ正当な状態は受理する", function () {
  var legacy = makeGenericLegacyState({
    currentStage: 2,
    unlockedStages: [1, 2, 3],
    totalAnswered: 12,
    totalCorrect: 10
  });
  var imported = ADAPTER.prepareImportedState(legacy, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T05:35:00.000Z"
  });

  assert.equal(imported.currentStage, 2);
  assert.deepEqual(imported.unlockedStages, [1, 2, 3]);
  assert.equal(imported.learningData.totalAnswered, 12);
  assert.equal(imported.learningData.totalCorrect, 10);
});

test("新形式の不整合ステージは保存前に拒否し入力状態を変更しない", function () {
  [
    { currentStage: 3, unlockedStages: [1, 2] },
    { currentStage: 2, unlockedStages: [1, 3] }
  ].forEach(function (scenario) {
    var storage = new MemoryStorage();
    var source = migrateFixture().result.state;
    var session = cloneJson(source.currentSession);
    var before = cloneJson(source);
    var rawStored = JSON.stringify({ marker: "stored-before-import" });

    source.currentStage = scenario.currentStage;
    source.unlockedStages = scenario.unlockedStages;
    before.currentStage = scenario.currentStage;
    before.unlockedStages = scenario.unlockedStages;
    storage.seed(STATE_KEY, rawStored);

    assert.throws(function () {
      ADAPTER.prepareImportedState(source, { stateKey: STATE_KEY });
    }, function (error) {
      return error && error.code === "invalid_stage";
    });
    assert.equal(storage.getItem(STATE_KEY), rawStored);
    assert.deepEqual(source, before);
    assert.deepEqual(source.currentSession, session);
  });
});

test("新形式でも上位解放後に下位ステージを選ぶ状態を維持する", function () {
  var source = migrateFixture().result.state;
  var session = cloneJson(source.currentSession);

  source.currentStage = 2;
  source.unlockedStages = [1, 2, 3, 4];
  var imported = ADAPTER.prepareImportedState(source, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T05:36:00.000Z"
  });

  assert.equal(imported.currentStage, 2);
  assert.deepEqual(imported.unlockedStages, [1, 2, 3, 4]);
  assert.deepEqual(imported.currentSession, session);
  assert.equal(imported.totalAnswered, 275);
  assert.equal(imported.learningData.totalCorrect, 243);
});

test("新規の迷い回答は揺らぎ日時と旧集計を同期する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T05:40:00.000Z";
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q15", "unsure", answeredAt),
    "legacy-q15",
    "unsure",
    answeredAt
  );
  var stats = combined.learningData.questionStats["legacy-q15"];

  assert.equal(stats.unsure, combined.questionStats["legacy-q15"].unsure);
  assert.equal(stats.reviewActive, true);
  assert.equal(stats.lastOutcome, "unsure");
  assert.equal(stats.lastAnsweredAt, answeredAt);
  assert.equal(stats.lastFluctuationAt, answeredAt);
  assert.equal(stats.lastStableAt, "2026-07-25T08:00:00.000Z");
});

test("reasoningLevel 3の新規回答はlearningData.questionStatsへ記録する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T05:50:00.000Z";
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q15", "understood", answeredAt),
    "legacy-q15",
    "understood",
    answeredAt,
    { question: { reasoningLevel: 3 } }
  );

  assert.equal(combined.learningData.questionStats["legacy-q15"].reasoningLevel, 3);
  assert.equal(combined.learningData.answerHistory[0].reasoningLevel, 3);
});

test("reasoningLevelが不明な新規回答は既存の値を保持する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T06:00:00.000Z";
  migrated.learningData.questionStats["legacy-q15"].reasoningLevel = 4;
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q15", "understood", answeredAt),
    "legacy-q15",
    "understood",
    answeredAt
  );

  assert.equal(combined.learningData.questionStats["legacy-q15"].reasoningLevel, 4);
  assert.equal(combined.learningData.answerHistory[0].reasoningLevel, 4);
});

test("manualWeak追加はlearningDataの揺らぎ日時も更新する", function () {
  var migrated = migrateFixture().result.state;
  var changedAt = "2026-07-27T06:10:00.000Z";
  migrated.questionStats["legacy-q15"].manualWeak = true;
  var combined = ADAPTER.setWeakAfterLegacyUpdate(migrated, {
    questionId: "legacy-q15",
    weak: true,
    changedAt: changedAt
  });

  assert.equal(combined.learningData.questionStats["legacy-q15"].manualWeak, true);
  assert.equal(combined.learningData.questionStats["legacy-q15"].lastFluctuationAt, changedAt);
});

test("手動苦手の問題への理解正解は揺らぎ日時を更新し、安定理解にしない", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T06:15:00.000Z";
  var priorHistory = {
    questionId: "legacy-q01",
    outcome: "incorrect",
    fluctuation: true,
    answeredAt: "2026-07-26T06:15:00.000Z"
  };
  migrated.learningData.answerHistory.push(cloneJson(priorHistory));
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q14", "understood", answeredAt),
    "legacy-q14",
    "understood",
    answeredAt
  );
  var stats = combined.learningData.questionStats["legacy-q14"];

  assert.equal(stats.manualWeak, true);
  assert.equal(stats.lastFluctuationAt, answeredAt);
  assert.equal(stats.lastStableAt, "2026-07-25T08:00:00.000Z");
  assert.deepEqual(combined.learningData.answerHistory[0], priorHistory);
  assert.equal(combined.learningData.answerHistory[1].fluctuation, true);
});

test("手動苦手でない理解正解は履歴でも安定理解として記録する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T06:16:00.000Z";
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q15", "understood", answeredAt),
    "legacy-q15",
    "understood",
    answeredAt
  );

  assert.equal(combined.learningData.questionStats["legacy-q15"].manualWeak, false);
  assert.equal(combined.learningData.questionStats["legacy-q15"].lastStableAt, answeredAt);
  assert.equal(combined.learningData.answerHistory[0].fluctuation, false);
});

test("手動苦手の解除後の理解正解は履歴でも安定理解として記録する", function () {
  var migrated = migrateFixture().result.state;
  var released = cloneJson(migrated);
  var answeredAt = "2026-07-27T06:17:00.000Z";

  released.questionStats["legacy-q14"].manualWeak = false;
  released = ADAPTER.setWeakAfterLegacyUpdate(released, {
    questionId: "legacy-q14",
    weak: false,
    changedAt: "2026-07-27T06:16:30.000Z"
  });
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(released, "legacy-q14", "understood", answeredAt),
    "legacy-q14",
    "understood",
    answeredAt
  );

  assert.equal(combined.questionStats["legacy-q14"].manualWeak, false);
  assert.equal(combined.learningData.questionStats["legacy-q14"].manualWeak, false);
  assert.equal(combined.learningData.questionStats["legacy-q14"].lastStableAt, answeredAt);
  assert.equal(combined.learningData.answerHistory[0].fluctuation, false);
  assert.equal(combined.totalAnswered, combined.learningData.totalAnswered);
  assert.equal(
    countCorrect(combined.questionStats),
    combined.learningData.totalCorrect
  );
});

test("adaptiveSelectionの直近IDは既存履歴と新しい履歴を順序どおり結合する", function () {
  var migrated = migrateFixture().result.state;
  migrated.adaptiveSelection.recentQuestionIds = ["old-01", "old-02", "shared"];
  migrated.recentQuestionIds = ["shared", "new-01", "new-02"];
  var reconciled = ADAPTER.reconcileState(migrated, {
    updatedAt: "2026-07-27T06:20:00.000Z"
  });

  assert.deepEqual(reconciled.adaptiveSelection.recentQuestionIds, [
    "old-01", "old-02", "shared", "new-01", "new-02"
  ]);
});

test("旧形式インポートでも既存adaptiveSelectionとstateの直近IDを結合する", function () {
  var source = makeGenericLegacyState({
    currentSession: {
      stage: 1,
      mode: "today3",
      queue: ["generic-q01"],
      index: 0
    }
  });
  source.adaptiveSelection = {
    schemaVersion: 1,
    selectionSequence: 7,
    recentQuestionIds: ["old-01", "shared"],
    recentStartQuestionIds: ["old-01"],
    recentKnowledgeKeys: ["work-hours"],
    lastSelection: {
      questionId: "shared",
      selectionReason: "weak_variant"
    }
  };
  source.recentQuestionIds = ["shared", "generic-q01"];

  var imported = ADAPTER.prepareImportedState(source, {
    stateKey: STATE_KEY,
    migratedAt: "2026-07-27T06:25:00.000Z"
  });

  assert.deepEqual(imported.adaptiveSelection.recentQuestionIds, [
    "old-01", "shared", "generic-q01"
  ]);
  assert.equal(imported.adaptiveSelection.selectionSequence, 7);
  assert.deepEqual(imported.adaptiveSelection.recentStartQuestionIds, ["old-01"]);
  assert.deepEqual(imported.currentSession, source.currentSession);
});

test("adaptiveSelectionの直近IDは重複を除き末尾20件を保持する", function () {
  var migrated = migrateFixture().result.state;
  var existing = Array.from({ length: 12 }, function (_, index) {
    return "old-" + String(index + 1).padStart(2, "0");
  });
  var current = ["old-12"].concat(Array.from({ length: 12 }, function (_, index) {
    return "new-" + String(index + 1).padStart(2, "0");
  }));
  migrated.adaptiveSelection.recentQuestionIds = existing;
  migrated.recentQuestionIds = current;
  var reconciled = ADAPTER.reconcileState(migrated, {
    updatedAt: "2026-07-27T06:30:00.000Z"
  });

  assert.equal(reconciled.adaptiveSelection.recentQuestionIds.length, 20);
  assert.equal(reconciled.adaptiveSelection.recentQuestionIds.includes("old-01"), false);
  assert.equal(reconciled.adaptiveSelection.recentQuestionIds.includes("old-12"), true);
  assert.equal(reconciled.adaptiveSelection.recentQuestionIds.includes("new-12"), true);
  assert.equal(
    new Set(reconciled.adaptiveSelection.recentQuestionIds).size,
    reconciled.adaptiveSelection.recentQuestionIds.length
  );
});

test("adaptiveSelectionの重複IDは最後の出現位置を保持する", function () {
  var normalized = ADAPTER.normalizeAdaptiveSelectionState({
    recentQuestionIds: ["A", "B", "C"]
  }, {
    recentQuestionIds: ["D", "B", "E"]
  });

  assert.deepEqual(normalized.recentQuestionIds, ["A", "C", "D", "B", "E"]);
});

test("最新側に再登場した直近IDは末尾20件に残る", function () {
  var existing = Array.from({ length: 20 }, function (_, index) {
    return "old-" + String(index + 1).padStart(2, "0");
  });
  var current = ["old-01"].concat(Array.from({ length: 19 }, function (_, index) {
    return "new-" + String(index + 1).padStart(2, "0");
  }));
  var normalized = ADAPTER.normalizeAdaptiveSelectionState({
    recentQuestionIds: existing
  }, {
    recentQuestionIds: current
  });

  assert.equal(normalized.recentQuestionIds.length, 20);
  assert.equal(normalized.recentQuestionIds[0], "old-01");
  assert.equal(normalized.recentQuestionIds[19], "new-19");
  assert.equal(new Set(normalized.recentQuestionIds).size, 20);
});

test("不整合のある新形式インポートは受け付けない", function () {
  var migrated = migrateFixture().result.state;
  migrated.learningData.totalCorrect = 242;

  assert.throws(function () {
    ADAPTER.prepareImportedState(migrated, {
      stateKey: STATE_KEY
    });
  }, function (error) {
    return error && error.code === "import_learning_data_mismatch";
  });
});

test("再読み込み後も旧集計と新集計が一致する", function () {
  var migrated = migrateFixture().result.state;
  var answeredAt = "2026-07-27T06:00:00.000Z";
  var combined = recordAdapterAnswer(
    applyLegacyOutcome(migrated, "legacy-q15", "understood", answeredAt),
    "legacy-q15",
    "understood",
    answeredAt
  );
  var reloaded = JSON.parse(JSON.stringify(combined));
  var reconciled = ADAPTER.reconcileState(reloaded);

  assert.equal(reconciled.totalAnswered, 276);
  assert.equal(reconciled.learningData.totalAnswered, 276);
  assert.equal(reconciled.learningData.totalCorrect, 244);
  assert.equal(reconciled.learningData.answerHistory.length, 1);
});

test("生成した新構造にNaN、Infinity、null、undefinedがない", function () {
  var migrated = migrateFixture().result.state;

  assertNoInvalidValues(migrated.learningData, "learningData");
  assertNoInvalidValues(migrated.adaptiveSelection, "adaptiveSelection");
  Object.values(migrated.learningData.questionStats).forEach(function (stats) {
    assert.equal(stats.reasoningLevel >= 1 && stats.reasoningLevel <= 5, true);
  });
});

test("公開版基準HTMLへ互換接続だけが追加されている", function () {
  var html = fs.readFileSync(
    path.join(__dirname, "hygiene-os-v2.html"),
    "utf8"
  );

  assert.match(
    html,
    /qualification-os-common\.js\?v=20260711-common-os-01/
  );
  assert.match(
    html,
    /hygiene-os-v2-learning-data-migration\.js\?v=20260802-learning-data-migration-03/
  );
  assert.match(html, /recordAnswerAfterLegacyUpdate/);
  assert.match(html, /setWeakAfterLegacyUpdate/);
  assert.match(html, /prepareImportedState/);
  assert.match(html, /buildExportFields/);
  assert.doesNotMatch(html, /createLearningEngine/);
  assert.doesNotMatch(html, /ADAPTIVE_SESSION_SELECTOR_VERSION/);
});

test("社労士OSは衛生管理者専用アダプターを読み込まない", function () {
  var sharoshiHtml = fs.readFileSync(
    path.join(__dirname, "sharoshi-intro.html"),
    "utf8"
  );

  assert.equal(
    sharoshiHtml.includes("hygiene-os-v2-learning-data-migration.js"),
    false
  );
});
