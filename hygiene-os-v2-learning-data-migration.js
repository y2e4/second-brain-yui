(function (global) {
  "use strict";

  var MIGRATION_SCHEMA_VERSION = 1;
  var LEARNING_DATA_SCHEMA_VERSION = 7;
  var ADAPTIVE_SELECTION_SCHEMA_VERSION = 1;
  var ADAPTER_VERSION = "hygiene-os-v2-compat-v1";
  var BACKUP_SCHEMA_VERSION = 1;
  var BACKUP_LIMIT = 3;
  var RECENT_QUESTION_LIMIT = 20;
  var ANSWER_HISTORY_LIMIT = 1000;
  var DEFAULT_EXPECTED = {
    totalAnswered: 275,
    totalCorrect: 243,
    currentStage: 5,
    highestUnlockedStage: 5,
    unlockedStages: [1, 2, 3, 4, 5],
    manualWeakCount: 14,
    initialAdaptiveDifficulty: 3
  };
  var NUMERIC_STAT_FIELDS = [
    "attempts",
    "correct",
    "wrong",
    "unsure",
    "guess",
    "ambiguous",
    "understood",
    "understoodStreak",
    "lastShownOrder",
    "fluctuationCount",
    "reviewCount",
    "supplementAttempts",
    "supplementCorrect",
    "supplementUnderstood",
    "supplementWeak",
    "reasoningLevel"
  ];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function uniqueStrings(values) {
    var output = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var normalized = String(value || "");
      if (normalized && output.indexOf(normalized) === -1) {
        output.push(normalized);
      }
    });
    return output;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  function mergeRecentQuestionIds(existingIds, currentIds, limit) {
    var output = [];
    [].concat(
      Array.isArray(existingIds) ? existingIds : [],
      Array.isArray(currentIds) ? currentIds : []
    ).forEach(function (value) {
      var normalized = String(value || "");
      var existingIndex;

      if (!normalized) {
        return;
      }
      existingIndex = output.indexOf(normalized);
      if (existingIndex !== -1) {
        output.splice(existingIndex, 1);
      }
      output.push(normalized);
    });
    return output.slice(-limit);
  }

  function makeError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function asNonNegativeInteger(value, fallback) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return Math.max(0, Number(fallback) || 0);
    }
    return Math.floor(parsed);
  }

  function clampInteger(value, minimum, maximum, fallback) {
    return Math.min(
      maximum,
      Math.max(minimum, asNonNegativeInteger(value, fallback))
    );
  }

  function assertFiniteInteger(value, label) {
    if (typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        Math.floor(value) !== value) {
      throw makeError("invalid_number", label + "が0以上の整数ではありません。");
    }
    return value;
  }

  function assertNoInvalidGeneratedValues(value, path) {
    var currentPath = path || "generated";
    if (value === null || value === undefined) {
      throw makeError("invalid_generated_value", currentPath + "に空の値があります。");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw makeError("invalid_generated_value", currentPath + "に不正な数値があります。");
    }
    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        assertNoInvalidGeneratedValues(item, currentPath + "[" + index + "]");
      });
      return;
    }
    if (isPlainObject(value)) {
      Object.keys(value).forEach(function (key) {
        assertNoInvalidGeneratedValues(value[key], currentPath + "." + key);
      });
    }
  }

  function getHighestUnlockedStage(unlockedStages) {
    var stages = (Array.isArray(unlockedStages) ? unlockedStages : [])
      .map(Number)
      .filter(function (stage) {
        return Number.isFinite(stage);
      });
    return stages.length ? Math.max.apply(null, stages) : 0;
  }

  function dateKeyFromValue(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.getFullYear() + "-" +
      String(date.getMonth() + 1).padStart(2, "0") + "-" +
      String(date.getDate()).padStart(2, "0");
  }

  function sumQuestionStats(questionStats) {
    var totals = {
      attempts: 0,
      correct: 0,
      manualWeakCount: 0
    };
    if (!isPlainObject(questionStats)) {
      throw makeError("invalid_stats", "questionStatsを確認できません。");
    }
    Object.keys(questionStats).forEach(function (questionId) {
      var stats = questionStats[questionId];
      if (!isPlainObject(stats)) {
        throw makeError("invalid_stats", questionId + "のquestionStatsが不正です。");
      }
      NUMERIC_STAT_FIELDS.forEach(function (field) {
        if (Object.prototype.hasOwnProperty.call(stats, field)) {
          assertFiniteInteger(stats[field], questionId + "." + field);
        }
      });
      var attempts = Object.prototype.hasOwnProperty.call(stats, "attempts")
        ? stats.attempts
        : 0;
      var correct = Object.prototype.hasOwnProperty.call(stats, "correct")
        ? stats.correct
        : 0;
      if (correct > attempts) {
        throw makeError("invalid_stats", questionId + "の正解数が回答数を超えています。");
      }
      if (Object.prototype.hasOwnProperty.call(stats, "manualWeak") &&
          typeof stats.manualWeak !== "boolean") {
        throw makeError("invalid_stats", questionId + ".manualWeakが真偽値ではありません。");
      }
      totals.attempts += attempts;
      totals.correct += correct;
      if (stats.manualWeak === true) {
        totals.manualWeakCount += 1;
      }
    });
    return totals;
  }

  function inspectStageState(state) {
    var unlockedStages;
    var expectedUnlockedStages;
    var stageId;
    var currentStage = Number(state && state.currentStage);
    var highestUnlockedStage;

    unlockedStages = (Array.isArray(state.unlockedStages) ? state.unlockedStages : [])
      .map(Number)
      .sort(function (left, right) {
        return left - right;
      });
    highestUnlockedStage = getHighestUnlockedStage(unlockedStages);

    if (!Number.isInteger(currentStage) ||
        currentStage < 1 || currentStage > 5 ||
        !unlockedStages.length || unlockedStages.some(function (stage) {
          return !Number.isInteger(stage) || stage < 1 || stage > 5;
        })) {
      throw makeError("invalid_stage", "currentStageまたはunlockedStagesを確認できません。");
    }
    expectedUnlockedStages = [];
    for (stageId = 1; stageId <= highestUnlockedStage; stageId += 1) {
      expectedUnlockedStages.push(stageId);
    }
    if (unlockedStages.indexOf(currentStage) === -1 ||
        !sameJson(state.unlockedStages, expectedUnlockedStages)) {
      throw makeError(
        "invalid_stage",
        "currentStageは解放済みで、unlockedStagesはStage 1から連続している必要があります。"
      );
    }

    return {
      currentStage: currentStage,
      highestUnlockedStage: highestUnlockedStage,
      unlockedStages: unlockedStages
    };
  }

  function inspectLegacyState(state, expectedInput) {
    var useCurrentStateAsExpected = expectedInput === null;
    var expected = useCurrentStateAsExpected
      ? null
      : Object.assign({}, DEFAULT_EXPECTED, expectedInput || {});
    var questionStats = isPlainObject(state && state.questionStats)
      ? state.questionStats
      : null;
    var totals;
    var totalAnswered;
    var stageState;
    var analysis;

    if (!isPlainObject(state) || !questionStats) {
      throw makeError("invalid_state", "旧学習状態またはquestionStatsを確認できません。");
    }

    totals = sumQuestionStats(questionStats);
    totalAnswered = assertFiniteInteger(state.totalAnswered, "totalAnswered");
    if (totals.attempts !== totalAnswered) {
      throw makeError(
        "attempt_mismatch",
        "questionStatsの回答数合計" + totals.attempts +
        "とtotalAnswered " + totalAnswered + "が一致しません。"
      );
    }
    if (hasOwn(state, "totalCorrect") &&
        assertFiniteInteger(state.totalCorrect, "totalCorrect") !== totals.correct) {
      throw makeError(
        "correct_mismatch",
        "questionStatsの正解数合計" + totals.correct +
        "とtotalCorrect " + state.totalCorrect + "が一致しません。"
      );
    }
    stageState = inspectStageState(state);
    analysis = {
      totalAnswered: totalAnswered,
      totalCorrect: totals.correct,
      manualWeakCount: totals.manualWeakCount,
      currentStage: stageState.currentStage,
      highestUnlockedStage: stageState.highestUnlockedStage,
      unlockedStages: stageState.unlockedStages,
      questionStats: cloneJson(questionStats),
      currentSession: cloneJson(state.currentSession)
    };

    if (useCurrentStateAsExpected) {
      expected = {
        totalAnswered: analysis.totalAnswered,
        totalCorrect: analysis.totalCorrect,
        currentStage: analysis.currentStage,
        highestUnlockedStage: analysis.highestUnlockedStage,
        unlockedStages: cloneJson(analysis.unlockedStages),
        manualWeakCount: analysis.manualWeakCount,
        initialAdaptiveDifficulty: analysis.currentStage === 5 ? 3 : 1
      };
    }

    [
      ["totalAnswered", analysis.totalAnswered],
      ["totalCorrect", analysis.totalCorrect],
      ["manualWeakCount", analysis.manualWeakCount],
      ["currentStage", analysis.currentStage],
      ["highestUnlockedStage", analysis.highestUnlockedStage]
    ].forEach(function (entry) {
      if (entry[1] !== expected[entry[0]]) {
        throw makeError(
          "expected_mismatch",
          entry[0] + "が移行条件と一致しません。期待値：" +
          expected[entry[0]] + "、実値：" + entry[1]
        );
      }
    });
    if (!sameJson(analysis.unlockedStages, expected.unlockedStages)) {
      throw makeError("expected_mismatch", "unlockedStagesが1〜5ではありません。");
    }

    return {
      expected: expected,
      analysis: analysis
    };
  }

  function makeLearningQuestionStats(raw, previous) {
    var source = isPlainObject(raw) ? raw : {};
    var fallback = isPlainObject(previous) ? previous : {};
    var output = Object.assign({}, fallback, source);

    function getValue(field, defaultValue) {
      if (hasOwn(source, field)) {
        return source[field];
      }
      if (hasOwn(fallback, field)) {
        return fallback[field];
      }
      return defaultValue;
    }

    NUMERIC_STAT_FIELDS.forEach(function (field) {
      output[field] = asNonNegativeInteger(getValue(field, 0), 0);
    });
    output.reasoningLevel = clampInteger(getValue("reasoningLevel", 1), 1, 5, 1);
    output.lastUnderstandingDate = String(getValue("lastUnderstandingDate", "") || "");
    output.lastOutcome = String(getValue("lastOutcome", "") || "");
    output.lastAnsweredDate = String(getValue("lastAnsweredDate", "") || "");
    output.lastAnsweredAt = String(getValue("lastAnsweredAt", "") || "");
    output.lastFluctuationAt = String(getValue("lastFluctuationAt", "") || "");
    output.lastFluctuationDate = String(getValue("lastFluctuationDate", "") || "");
    output.lastStableAt = String(getValue("lastStableAt", "") || "");
    output.lastSupplementAt = String(getValue("lastSupplementAt", "") || "");
    output.lastSupplementOutcome = String(getValue("lastSupplementOutcome", "") || "");
    output.wrongActive = getValue("wrongActive", false) === true;
    output.reviewActive = getValue("reviewActive", false) === true;
    output.manualWeak = getValue("manualWeak", false) === true;
    output.graduationCandidate =
      getValue("graduationCandidate", false) === true || output.understoodStreak >= 2;
    return output;
  }

  function normalizeLearningQuestionStatsMap(questionStats, previousQuestionStats) {
    var output = {};
    Object.keys(isPlainObject(questionStats) ? questionStats : {}).forEach(function (questionId) {
      output[questionId] = makeLearningQuestionStats(
        questionStats[questionId],
        isPlainObject(previousQuestionStats) ? previousQuestionStats[questionId] : null
      );
    });
    return output;
  }

  function normalizeAdaptiveDifficulty(raw, initialReasoningLevel) {
    var source = isPlainObject(raw) ? raw : {};
    var output = {
      version: 3,
      level: String(source.level || "standard"),
      highStreak: asNonNegativeInteger(source.highStreak, 0),
      lowStreak: asNonNegativeInteger(source.lowStreak, 0),
      recentSessions: Array.isArray(source.recentSessions)
        ? source.recentSessions.filter(isPlainObject).map(cloneJson).slice(-12)
        : [],
      reasoningLevel: clampInteger(
        source.reasoningLevel,
        1,
        5,
        initialReasoningLevel || 1
      ),
      perfectSetStreak: clampInteger(source.perfectSetStreak, 0, 2, 0),
      recentSets: Array.isArray(source.recentSets)
        ? source.recentSets.filter(isPlainObject).map(cloneJson).slice(-12)
        : [],
      lastIncreasedAt: String(source.lastIncreasedAt || ""),
      lastEvaluatedAt: String(source.lastEvaluatedAt || ""),
      lastAdjustedAt: String(source.lastAdjustedAt || ""),
      lastAdjustment: String(source.lastAdjustment || "")
    };
    if (isPlainObject(source.lastSet)) {
      output.lastSet = cloneJson(source.lastSet);
    }
    return output;
  }

  function normalizeAdaptiveSelectionState(raw, options) {
    var source = isPlainObject(raw) ? raw : {};
    var settings = options || {};
    var recentLimit = clampInteger(
      settings.recentLimit,
      1,
      100,
      RECENT_QUESTION_LIMIT
    );
    var output = {
      schemaVersion: Math.max(
        ADAPTIVE_SELECTION_SCHEMA_VERSION,
        asNonNegativeInteger(source.schemaVersion, ADAPTIVE_SELECTION_SCHEMA_VERSION)
      ),
      selectionSequence: asNonNegativeInteger(source.selectionSequence, 0),
      recentQuestionIds: mergeRecentQuestionIds(
        source.recentQuestionIds,
        settings.recentQuestionIds,
        recentLimit
      ),
      recentStartQuestionIds: uniqueStrings(source.recentStartQuestionIds)
        .slice(-recentLimit),
      recentKnowledgeKeys: uniqueStrings(source.recentKnowledgeKeys)
        .slice(-recentLimit)
    };
    if (isPlainObject(source.lastSelection) &&
        String(source.lastSelection.questionId || "")) {
      output.lastSelection = cloneJson(source.lastSelection);
    }
    return output;
  }

  function rebuildLearningQueues(learningData) {
    var wrong = [];
    var unsure = [];
    var guessed = [];
    var ambiguous = [];
    var weak = [];
    var understood = [];
    var answered = 0;
    var understoodCount = 0;

    Object.keys(learningData.questionStats || {}).forEach(function (questionId) {
      var stats = makeLearningQuestionStats(learningData.questionStats[questionId]);
      learningData.questionStats[questionId] = stats;
      if (stats.attempts > 0) {
        answered += 1;
      }
      if (stats.wrongActive) {
        wrong.push(questionId);
      }
      if (stats.reviewActive || stats.unsure > 0) {
        unsure.push(questionId);
      }
      if (stats.guess > 0) {
        guessed.push(questionId);
      }
      if (stats.ambiguous > 0) {
        ambiguous.push(questionId);
      }
      if (stats.manualWeak || stats.wrong >= 2 ||
          stats.unsure + stats.guess + stats.ambiguous >= 2 ||
          stats.supplementWeak >= 2) {
        weak.push(questionId);
      }
      if (stats.understood > 0 || stats.understoodStreak >= 2) {
        understood.push(questionId);
        understoodCount += 1;
      }
    });

    learningData.reviewQueue = {
      wrongQuestionIds: uniqueStrings(wrong),
      unsureQuestionIds: uniqueStrings(unsure),
      guessedQuestionIds: uniqueStrings(guessed),
      ambiguousQuestionIds: uniqueStrings(ambiguous),
      weakQuestionIds: uniqueStrings(weak),
      graduationCandidateThemes: uniqueStrings(
        learningData.reviewQueue &&
        learningData.reviewQueue.graduationCandidateThemes
      )
    };
    learningData.understanding = {
      understoodQuestionIds: uniqueStrings(understood),
      unsureQuestionIds: uniqueStrings(unsure),
      guessedQuestionIds: uniqueStrings(guessed),
      ambiguousQuestionIds: uniqueStrings(ambiguous),
      wrongQuestionIds: uniqueStrings(wrong),
      score: answered ? Math.round((understoodCount / answered) * 100) : 0
    };
    return learningData;
  }

  function buildLearningData(state, options) {
    var settings = options || {};
    var source = isPlainObject(settings.previousLearningData)
      ? cloneJson(settings.previousLearningData)
      : {};
    var totals = sumQuestionStats(state.questionStats);
    var reasoningLevel = Number(state.currentStage) === 5 ? 3 : 1;
    var output = Object.assign({}, source, {
      schemaVersion: Math.max(
        LEARNING_DATA_SCHEMA_VERSION,
        asNonNegativeInteger(source.schemaVersion, LEARNING_DATA_SCHEMA_VERSION)
      ),
      engineVersion: String(source.engineVersion || ADAPTER_VERSION),
      adapterVersion: ADAPTER_VERSION,
      qualification: String(source.qualification || "eisei"),
      title: String(source.title || "第二種衛生管理者OS"),
      totalAnswered: asNonNegativeInteger(state.totalAnswered, 0),
      totalCorrect: totals.correct,
      answerHistory: Array.isArray(source.answerHistory)
        ? source.answerHistory.filter(isPlainObject).map(cloneJson).slice(-ANSWER_HISTORY_LIMIT)
        : [],
      supplementHistory: Array.isArray(source.supplementHistory)
        ? source.supplementHistory.filter(isPlainObject).map(cloneJson).slice(-ANSWER_HISTORY_LIMIT)
        : [],
      questionStats: normalizeLearningQuestionStatsMap(
        state.questionStats,
        source.questionStats
      ),
      themeStats: isPlainObject(source.themeStats) ? cloneJson(source.themeStats) : {},
      materialHistory: isPlainObject(source.materialHistory)
        ? cloneJson(source.materialHistory)
        : {
          learnedMaterialIds: [],
          reviewMaterialIds: [],
          lastMaterialId: "",
          lastStudiedAt: ""
        },
      adaptiveDifficulty: normalizeAdaptiveDifficulty(
        source.adaptiveDifficulty,
        settings.initialAdaptiveDifficulty || reasoningLevel
      ),
      currentDifficulty: "Level " + clampInteger(
        source.adaptiveDifficulty && source.adaptiveDifficulty.reasoningLevel,
        1,
        5,
        settings.initialAdaptiveDifficulty || reasoningLevel
      ),
      lastStudyDate: String(state.lastStudyDate || source.lastStudyDate || ""),
      lastStudyAt: String(state.lastStudyAt || source.lastStudyAt || ""),
      updatedAt: String(settings.updatedAt || state.lastSavedAt || source.updatedAt || "")
    });

    return rebuildLearningQueues(output);
  }

  function preserveMigrationMeta(previousLearningData, nextLearningData) {
    var next = isPlainObject(nextLearningData) ? cloneJson(nextLearningData) : {};
    if (isPlainObject(previousLearningData) &&
        isPlainObject(previousLearningData.migrationMeta)) {
      next.migrationMeta = cloneJson(previousLearningData.migrationMeta);
    }
    return next;
  }

  function buildMigratedState(state, inspected, options, migratedAt) {
    var expected = inspected.expected;
    var analysis = inspected.analysis;
    var nextState = cloneJson(state);
    var learningData = buildLearningData(nextState, {
      initialAdaptiveDifficulty: expected.initialAdaptiveDifficulty,
      updatedAt: migratedAt
    });

    learningData.totalAnswered = analysis.totalAnswered;
    learningData.totalCorrect = analysis.totalCorrect;
    learningData.answerHistory = [];
    learningData.adaptiveDifficulty = normalizeAdaptiveDifficulty({
      reasoningLevel: expected.initialAdaptiveDifficulty,
      perfectSetStreak: 0,
      recentSets: [],
      recentSessions: []
    }, expected.initialAdaptiveDifficulty);
    learningData.currentDifficulty =
      "Level " + expected.initialAdaptiveDifficulty;
    learningData.updatedAt = migratedAt;
    learningData.migrationMeta = {
      schemaVersion: MIGRATION_SCHEMA_VERSION,
      migratedFromLegacy: true,
      migratedAt: migratedAt,
      sourceStorageKey: options.stateKey,
      legacyTotalAnswered: analysis.totalAnswered,
      legacyTotalCorrect: analysis.totalCorrect,
      legacyManualWeakCount: analysis.manualWeakCount,
      answerHistoryReconstructed: false,
      historyStartsAt: migratedAt
    };

    nextState.learningData = learningData;
    nextState.adaptiveSelection = normalizeAdaptiveSelectionState(
      state.adaptiveSelection,
      {
        recentQuestionIds: state.recentQuestionIds,
        recentLimit: RECENT_QUESTION_LIMIT
      }
    );
    nextState.lastSavedAt = migratedAt;
    return nextState;
  }

  function validateMigratedState(original, migrated, inspected) {
    var expected = inspected.expected;
    var learningData = migrated.learningData;
    var adaptiveSelection = migrated.adaptiveSelection;
    var migratedTotals;

    if (migrated.totalAnswered !== original.totalAnswered ||
        (hasOwn(original, "totalCorrect") &&
          migrated.totalCorrect !== original.totalCorrect) ||
        !sameJson(migrated.currentStage, original.currentStage) ||
        !sameJson(migrated.unlockedStages, original.unlockedStages)) {
      throw makeError("postcheck_failed", "ステージまたは累計値が移行前後で変化しました。");
    }
    if (!sameJson(original.questionStats, migrated.questionStats)) {
      throw makeError("postcheck_failed", "既存questionStatsが変更されています。");
    }
    if (!sameJson(original.currentSession, migrated.currentSession)) {
      throw makeError("postcheck_failed", "既存currentSessionが変更されています。");
    }
    if (!isPlainObject(learningData) ||
        learningData.totalAnswered !== expected.totalAnswered ||
        learningData.totalCorrect !== expected.totalCorrect ||
        !Array.isArray(learningData.answerHistory) ||
        learningData.answerHistory.length !== 0 ||
        !isPlainObject(learningData.reviewQueue) ||
        !isPlainObject(learningData.understanding) ||
        !isPlainObject(learningData.migrationMeta)) {
      throw makeError("postcheck_failed", "learningDataの生成結果が移行条件と一致しません。");
    }
    if (learningData.migrationMeta.migratedFromLegacy !== true ||
        learningData.migrationMeta.legacyTotalAnswered !== expected.totalAnswered ||
        learningData.migrationMeta.legacyTotalCorrect !== expected.totalCorrect ||
        learningData.migrationMeta.legacyManualWeakCount !== expected.manualWeakCount ||
        learningData.migrationMeta.answerHistoryReconstructed !== false) {
      throw makeError("postcheck_failed", "移行メタデータが正しくありません。");
    }
    if (!isPlainObject(learningData.adaptiveDifficulty) ||
        learningData.adaptiveDifficulty.reasoningLevel !==
          expected.initialAdaptiveDifficulty ||
        learningData.adaptiveDifficulty.perfectSetStreak !== 0 ||
        learningData.adaptiveDifficulty.recentSets.length ||
        learningData.adaptiveDifficulty.recentSessions.length) {
      throw makeError("postcheck_failed", "適応難易度の初期状態が正しくありません。");
    }
    if (!sameJson(
      adaptiveSelection,
      normalizeAdaptiveSelectionState(original.adaptiveSelection, {
        recentQuestionIds: original.recentQuestionIds,
        recentLimit: RECENT_QUESTION_LIMIT
      })
    )) {
      throw makeError("postcheck_failed", "adaptiveSelectionに未知の履歴が含まれています。");
    }

    migratedTotals = sumQuestionStats(migrated.questionStats);
    if (migratedTotals.correct !== expected.totalCorrect ||
        migratedTotals.manualWeakCount !== expected.manualWeakCount) {
      throw makeError("postcheck_failed", "正解数またはmanualWeak数が変化しました。");
    }
    assertNoInvalidGeneratedValues(learningData, "learningData");
    assertNoInvalidGeneratedValues(adaptiveSelection, "adaptiveSelection");
    return true;
  }

  function assertLearningMatchesLegacy(state) {
    var totals;
    if (!isPlainObject(state) || !isPlainObject(state.learningData)) {
      throw makeError("learning_data_missing", "learningDataを確認できません。");
    }
    totals = sumQuestionStats(state.questionStats);
    if (totals.attempts !== state.totalAnswered ||
        state.learningData.totalAnswered !== state.totalAnswered ||
        state.learningData.totalCorrect !== totals.correct) {
      throw makeError("learning_data_mismatch", "旧集計とlearningDataの累計値が一致しません。");
    }
    Object.keys(state.questionStats).forEach(function (questionId) {
      var learningStats = state.learningData.questionStats[questionId];
      if (!learningStats ||
          learningStats.attempts !== state.questionStats[questionId].attempts ||
          learningStats.correct !== state.questionStats[questionId].correct ||
          learningStats.manualWeak !== (state.questionStats[questionId].manualWeak === true)) {
        throw makeError(
          "learning_data_mismatch",
          questionId + "の旧集計とlearningDataが一致しません。"
        );
      }
    });
    return true;
  }

  function reconcileState(state, options) {
    var settings = options || {};
    var nextState;
    var previousLearningData;

    if (!isPlainObject(state) || !isPlainObject(state.learningData)) {
      return cloneJson(state);
    }
    nextState = cloneJson(state);
    previousLearningData = nextState.learningData;
    nextState.learningData = buildLearningData(nextState, {
      previousLearningData: previousLearningData,
      initialAdaptiveDifficulty: Number(nextState.currentStage) === 5 ? 3 : 1,
      updatedAt: settings.updatedAt || nextState.lastSavedAt
    });
    nextState.learningData = preserveMigrationMeta(
      previousLearningData,
      nextState.learningData
    );
    nextState.adaptiveSelection = normalizeAdaptiveSelectionState(
      nextState.adaptiveSelection,
      {
        recentQuestionIds: nextState.recentQuestionIds,
        recentLimit: RECENT_QUESTION_LIMIT
      }
    );
    assertLearningMatchesLegacy(nextState);
    assertNoInvalidGeneratedValues(nextState.learningData, "learningData");
    assertNoInvalidGeneratedValues(nextState.adaptiveSelection, "adaptiveSelection");
    return nextState;
  }

  function normalizeOutcome(value) {
    var normalized = String(value || "");
    return ["understood", "unsure", "guess", "ambiguous", "incorrect"]
      .indexOf(normalized) !== -1
      ? normalized
      : "incorrect";
  }

  function getKnownReasoningLevel(entry, question, stats) {
    var candidates = [
      entry && entry.reasoningLevel,
      question && question.reasoningLevel
    ];
    var index;
    var value;

    for (index = 0; index < candidates.length; index += 1) {
      value = Number(candidates[index]);
      if (Number.isInteger(value) && value >= 1 && value <= 5) {
        return value;
      }
    }
    return clampInteger(stats && stats.reasoningLevel, 1, 5, 1);
  }

  function syncLearningQuestionStatsFromLegacy(legacyStats, learningStats) {
    return makeLearningQuestionStats(legacyStats, learningStats);
  }

  function isFluctuationOutcome(outcome, safeEntry, stats) {
    return outcome !== "understood" ||
      safeEntry.weak === true || stats.manualWeak === true;
  }

  function updateLearningAnswerStats(nextState, safeEntry, question, questionId, outcome, answeredAt) {
    var legacyStats = isPlainObject(nextState.questionStats)
      ? nextState.questionStats[questionId]
      : null;
    var stats = syncLearningQuestionStatsFromLegacy(
      legacyStats,
      nextState.learningData.questionStats[questionId]
    );
    var reasoningLevel = getKnownReasoningLevel(safeEntry, question, stats);
    var isFluctuation = isFluctuationOutcome(outcome, safeEntry, stats);

    stats.lastAnsweredAt = answeredAt;
    stats.lastAnsweredDate = dateKeyFromValue(answeredAt) || stats.lastAnsweredDate;
    stats.lastOutcome = outcome;
    stats.reasoningLevel = reasoningLevel;
    if (typeof question.difficulty === "string" && question.difficulty) {
      stats.difficulty = question.difficulty;
    }
    if (typeof safeEntry.questionType === "string" && safeEntry.questionType) {
      stats.questionType = safeEntry.questionType;
    }
    if (isFluctuation) {
      stats.fluctuationCount = asNonNegativeInteger(stats.fluctuationCount, 0) + 1;
      stats.lastFluctuationAt = answeredAt;
      stats.lastFluctuationDate = dateKeyFromValue(answeredAt);
    } else {
      stats.lastStableAt = answeredAt;
    }
    if (/mistake|wrong|review|weak|firekeeper/.test(String(safeEntry.mode || ""))) {
      stats.reviewCount = asNonNegativeInteger(stats.reviewCount, 0) + 1;
    }
    nextState.learningData.questionStats[questionId] = stats;
    nextState.learningData = rebuildLearningQueues(nextState.learningData);
    return stats;
  }

  function recordAnswerAfterLegacyUpdate(state, entry) {
    var safeEntry = isPlainObject(entry) ? entry : {};
    var question = isPlainObject(safeEntry.question) ? safeEntry.question : {};
    var questionId = String(safeEntry.questionId || question.id || "");
    var outcome = normalizeOutcome(safeEntry.outcome);
    var answeredAt = String(safeEntry.answeredAt || new Date().toISOString());
    var nextState;
    var stats;
    var isFluctuation;

    if (!questionId || !isPlainObject(state && state.learningData)) {
      return cloneJson(state);
    }
    nextState = reconcileState(state, {
      updatedAt: answeredAt
    });
    stats = updateLearningAnswerStats(
      nextState,
      safeEntry,
      question,
      questionId,
      outcome,
      answeredAt
    );
    isFluctuation = isFluctuationOutcome(outcome, safeEntry, stats);
    nextState.learningData.answerHistory.push({
      questionId: questionId,
      outcome: outcome,
      isCorrect: typeof safeEntry.isCorrect === "boolean"
        ? safeEntry.isCorrect
        : outcome !== "incorrect",
      selectedAnswer: safeEntry.selectedAnswer === undefined ||
        safeEntry.selectedAnswer === null
        ? ""
        : String(safeEntry.selectedAnswer),
      correctAnswer: safeEntry.correctAnswer === undefined ||
        safeEntry.correctAnswer === null
        ? String(question.answer || "")
        : String(safeEntry.correctAnswer),
      category: String(question.category || ""),
      theme: String(question.theme || ""),
      difficulty: String(question.difficulty || ""),
      questionType: String(safeEntry.questionType || "choice"),
      reasoningLevel: stats.reasoningLevel,
      fluctuation: isFluctuation,
      mode: String(safeEntry.mode || ""),
      answeredAt: answeredAt
    });
    nextState.learningData.answerHistory =
      nextState.learningData.answerHistory.slice(-ANSWER_HISTORY_LIMIT);
    nextState.learningData.updatedAt = answeredAt;
    assertLearningMatchesLegacy(nextState);
    assertNoInvalidGeneratedValues(nextState.learningData, "learningData");
    return nextState;
  }

  function setWeakAfterLegacyUpdate(state, entry) {
    var safeEntry = isPlainObject(entry) ? entry : {};
    var changedAt = String(safeEntry.changedAt || new Date().toISOString());
    var nextState = reconcileState(state, {
      updatedAt: changedAt
    });
    var questionId = String(safeEntry.questionId || "");
    var stats;

    if (!questionId || safeEntry.weak !== true ||
        !nextState.learningData.questionStats[questionId]) {
      return nextState;
    }
    stats = makeLearningQuestionStats(nextState.learningData.questionStats[questionId]);
    stats.fluctuationCount = asNonNegativeInteger(stats.fluctuationCount, 0) + 1;
    stats.lastFluctuationAt = changedAt;
    stats.lastFluctuationDate = dateKeyFromValue(changedAt);
    nextState.learningData.questionStats[questionId] = stats;
    nextState.learningData.updatedAt = changedAt;
    nextState.learningData = rebuildLearningQueues(nextState.learningData);
    assertLearningMatchesLegacy(nextState);
    assertNoInvalidGeneratedValues(nextState.learningData, "learningData");
    return nextState;
  }

  function prepareImportedState(state, options) {
    var settings = options || {};
    var importedAt = String(settings.migratedAt || new Date().toISOString());
    var source = cloneJson(state);
    var inspected;

    if (!isPlainObject(source.learningData)) {
      inspected = settings.strictExpected === true
        ? inspectLegacyState(source, settings.expected)
        : inspectLegacyState(source, null);
      return buildMigratedState(source, inspected, {
        stateKey: String(settings.stateKey || "")
      }, importedAt);
    }
    inspectStageState(source);
    if (source.learningData.totalAnswered !== source.totalAnswered ||
        source.learningData.totalCorrect !== sumQuestionStats(source.questionStats).correct) {
      throw makeError(
        "import_learning_data_mismatch",
        "インポートデータの旧集計とlearningDataが一致しません。"
      );
    }
    return reconcileState(source, {
      updatedAt: source.learningData.updatedAt || importedAt
    });
  }

  function buildExportFields(state) {
    var source = isPlainObject(state) ? state : {};
    var currentSession = Object.prototype.hasOwnProperty.call(source, "currentSession")
      ? cloneJson(source.currentSession)
      : null;
    return {
      learningData: isPlainObject(source.learningData)
        ? cloneJson(source.learningData)
        : {},
      adaptiveSelection: isPlainObject(source.adaptiveSelection)
        ? cloneJson(source.adaptiveSelection)
        : {},
      currentSession: currentSession,
      selectionLog: isPlainObject(currentSession) &&
        Array.isArray(currentSession.selectionLog)
        ? cloneJson(currentSession.selectionLog)
        : []
    };
  }

  function readBackups(storage, backupKey) {
    var raw = storage.getItem(backupKey);
    var parsed;
    if (!raw) {
      return [];
    }
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw makeError("backup_invalid", "移行バックアップの保存形式が不正です。");
    }
    return parsed;
  }

  function createVerifiedBackup(storage, backupKey, stateKey, state, createdAt) {
    var entry = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      id: "learning-data-migration-" + createdAt.replace(/[^0-9A-Za-z]/g, ""),
      createdAt: createdAt,
      storageKey: stateKey,
      state: cloneJson(state)
    };
    var backups;
    var verified;

    try {
      backups = readBackups(storage, backupKey);
      backups.push(entry);
      backups = backups.slice(-BACKUP_LIMIT);
      storage.setItem(backupKey, JSON.stringify(backups));
      verified = readBackups(storage, backupKey);
      if (!verified.length ||
          verified[verified.length - 1].id !== entry.id ||
          !sameJson(verified[verified.length - 1].state, state)) {
        throw makeError("backup_verify_failed", "保存後のバックアップ照合に失敗しました。");
      }
    } catch (error) {
      throw makeError(
        "backup_failed",
        "移行前バックアップを保存できないため、移行を中止しました：" +
        (error.message || "保存領域を確認してください。")
      );
    }
    return entry;
  }

  function migrateOnce(options) {
    var settings = options || {};
    var storage = settings.storage;
    var stateKey = String(settings.stateKey || "");
    var backupKey = String(settings.backupKey || "");
    var rawState;
    var state;
    var inspected;
    var backup;
    var migratedAt;
    var nextState;
    var storedNext;

    if (!storage || !stateKey || !backupKey) {
      throw makeError("invalid_options", "移行処理の保存先が未設定です。");
    }

    rawState = storage.getItem(stateKey);
    if (!rawState) {
      return { migrated: false, reason: "no_state", state: null };
    }
    state = JSON.parse(rawState);
    if (isPlainObject(state.learningData)) {
      return {
        migrated: false,
        reason: isPlainObject(state.learningData.migrationMeta) &&
          state.learningData.migrationMeta.migratedFromLegacy === true
          ? "already_migrated"
          : "learning_data_exists",
        state: state
      };
    }

    try {
      inspected = inspectLegacyState(state, settings.expected);
    } catch (error) {
      if (settings.skipExpectedMismatch === true &&
          error && error.code === "expected_mismatch") {
        return {
          migrated: false,
          reason: "not_target_state",
          state: state
        };
      }
      throw error;
    }
    migratedAt = String(settings.migratedAt || new Date().toISOString());
    backup = createVerifiedBackup(
      storage,
      backupKey,
      stateKey,
      state,
      migratedAt
    );
    nextState = buildMigratedState(state, inspected, {
      stateKey: stateKey
    }, migratedAt);
    validateMigratedState(state, nextState, inspected);

    try {
      storage.setItem(stateKey, JSON.stringify(nextState));
      storedNext = JSON.parse(storage.getItem(stateKey));
      validateMigratedState(state, storedNext, inspected);
    } catch (error) {
      try {
        storage.setItem(stateKey, rawState);
        if (storage.getItem(stateKey) !== rawState) {
          throw new Error("rollback verification failed");
        }
      } catch (rollbackError) {
        throw makeError(
          "rollback_failed",
          "移行に失敗し、元状態の自動復旧にも失敗しました。" +
          "専用バックアップから復旧してください。"
        );
      }
      throw makeError(
        "migration_failed",
        "移行結果を保存できないため、元状態へ復旧しました：" +
        (error.message || "保存領域を確認してください。")
      );
    }

    return {
      migrated: true,
      reason: "migrated",
      state: storedNext,
      backup: backup,
      analysis: inspected.analysis
    };
  }

  global.HygieneOSV2LearningDataMigration = {
    MIGRATION_SCHEMA_VERSION: MIGRATION_SCHEMA_VERSION,
    LEARNING_DATA_SCHEMA_VERSION: LEARNING_DATA_SCHEMA_VERSION,
    ADAPTER_VERSION: ADAPTER_VERSION,
    DEFAULT_EXPECTED: cloneJson(DEFAULT_EXPECTED),
    inspectLegacyState: inspectLegacyState,
    normalizeAdaptiveDifficulty: normalizeAdaptiveDifficulty,
    normalizeAdaptiveSelectionState: normalizeAdaptiveSelectionState,
    preserveMigrationMeta: preserveMigrationMeta,
    validateMigratedState: validateMigratedState,
    reconcileState: reconcileState,
    recordAnswerAfterLegacyUpdate: recordAnswerAfterLegacyUpdate,
    setWeakAfterLegacyUpdate: setWeakAfterLegacyUpdate,
    prepareImportedState: prepareImportedState,
    buildExportFields: buildExportFields,
    migrateOnce: migrateOnce
  };
}(typeof window !== "undefined" ? window : globalThis));
