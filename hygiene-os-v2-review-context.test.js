"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var REVIEW = require("./hygiene-os-v2-review-context.js");

var NOW = "2026-08-02T12:00:00+09:00";
var KEY = "wbgt-heat-risk-assessment";

function question(id, knowledgeKey, stage, extra) {
  return Object.assign({
    id: id,
    knowledgeKey: knowledgeKey || KEY,
    stage: stage || 1,
    question: id + "の問題",
    variantType: "condition",
    reasoningLevel: 2,
    equivalenceKey: id + "-equivalence",
    variantOfQuestionIds: []
  }, extra || {});
}

function catalog(extra) {
  return Object.assign({
    source: question("source-question", KEY, 1, {
      variantType: "rephrase",
      reasoningLevel: 1,
      equivalenceKey: "source-equivalence"
    }),
    variantOne: question("variant-one", KEY, 1, {
      variantType: "condition",
      reasoningLevel: 2,
      equivalenceKey: "variant-one-equivalence",
      variantOfQuestionIds: ["source-question"]
    }),
    variantTwo: question("variant-two", KEY, 1, {
      variantType: "comparison",
      reasoningLevel: 3,
      equivalenceKey: "variant-two-equivalence",
      variantOfQuestionIds: ["source-question"]
    }),
    foreign: question("foreign-question", "other-knowledge", 1, {
      variantType: "case",
      reasoningLevel: 2
    })
  }, extra || {});
}

function questionsOf(values) {
  return Object.keys(values).map(function (key) {
    return values[key];
  });
}

function session(extra) {
  return Object.assign({
    id: "session-1",
    queue: ["source-question", "foreign-question"],
    index: 0,
    correct: 0,
    recorded: false,
    answerRecords: [],
    questionStats: { "older-question": { attempts: 2, wrongActive: true } },
    learningData: { totalAnswered: 2, totalCorrect: 1 },
    otherSessionState: { selectedMode: "today-3" }
  }, extra || {});
}

function trigger(source, outcome, reason) {
  return {
    questionId: source.id,
    knowledgeKey: source.knowledgeKey,
    outcome: outcome || "incorrect",
    fluctuationReason: reason || outcome || "incorrect",
    triggeredAt: NOW
  };
}

function start(currentSession, extra) {
  var values = (extra && extra.values) || catalog();
  var source = (extra && extra.source) || values.source;
  var result = REVIEW.selectAndApplyReviewVariant(Object.assign({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    sourceQuestion: source,
    reviewTrigger: trigger(source),
    targetReasoningLevel: 2,
    recentQuestionIds: []
  }, extra || {}));
  return result;
}

function startedSession(extra) {
  var result = start(session(), extra);
  assert.equal(result.status, "started");
  return result.currentSession;
}

function record(currentSession, questionValue, outcome, extra) {
  var values = (extra && extra.values) || catalog();
  return REVIEW.recordReviewOutcome(Object.assign({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    question: questionValue,
    outcome: outcome,
    manualWeakQuestionIdsForKnowledgeKey: []
  }, extra || {}));
}

function evaluate(currentSession, extra) {
  var values = (extra && extra.values) || catalog();
  return REVIEW.evaluateReviewCompletion(Object.assign({
    reviewContext: currentSession.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  }, extra || {}));
}

function completeReview() {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;
  return { values: values, currentSession: currentSession };
}

function expandedCatalog(size) {
  var values = catalog();
  var index;

  for (index = 3; index <= size; index += 1) {
    values["variant" + index] = question("variant-" + index, KEY, 1, {
      variantType: ["rephrase", "condition", "comparison", "exception", "case"][index % 5],
      reasoningLevel: Math.min(5, index),
      equivalenceKey: "variant-" + index + "-equivalence",
      variantOfQuestionIds: [values.source.id]
    });
  }
  return values;
}

function overlay(currentSession, values, extra) {
  return REVIEW.validateReviewSessionOverlay(Object.assign({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1]
  }, extra || {}));
}

test("正常な補習開始は検証済み派生をpendingとして保存する", function () {
  var values = catalog();
  var original = session();
  var result = start(original, { values: values });
  var context = result.currentSession.reviewContext;

  assert.equal(result.status, "started");
  assert.notEqual(result.currentSession, original);
  assert.equal(context.version, 1);
  assert.equal(context.knowledgeKey, KEY);
  assert.equal(context.sourceQuestionId, values.source.id);
  assert.equal(context.phase, "variant_pending");
  assert.equal(context.pendingQuestionId, values.variantOne.id);
  assert.equal(context.pendingQuestionRole, "variant");
  assert.deepEqual(context.verifiedVariantIds, [values.variantOne.id]);
  assert.equal(context.latestOutcomeByQuestionId[values.source.id], "incorrect");
  assert.equal(original.reviewContext, undefined);
});

test("必須のcatalog、sourceQuestion、reviewTriggerが不正なら開始しない", function () {
  var values = catalog();
  [
    { questions: [] },
    { sourceQuestion: question("missing") },
    { reviewTrigger: trigger(values.source, "understood", "understood") }
  ].forEach(function (extra) {
    var result = start(session(), Object.assign({ values: values }, extra));
    assert.notEqual(result.status, "started");
    assert.equal(result.currentSession.reviewContext, undefined);
  });
});

test("sourceQuestionとknowledgeKeyの不一致、reviewTriggerとの不一致を拒否する", function () {
  var values = catalog();
  var wrongKeySource = question(values.source.id, "other-knowledge");
  var mismatchTrigger = trigger(values.source);
  mismatchTrigger.questionId = "variant-one";

  assert.equal(start(session(), { values: values, sourceQuestion: wrongKeySource }).status, "invalid_review_start");
  assert.equal(start(session(), { values: values, reviewTrigger: mismatchTrigger }).status, "invalid_review_start");
});

test("manualWeakの揺らぎはunderstoodを元問題の最新結果として開始できる", function () {
  var values = catalog();
  var result = start(session(), {
    values: values,
    reviewTrigger: trigger(values.source, "understood", "manualWeak")
  });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.latestOutcomeByQuestionId[values.source.id], "understood");
});

test("補習中に選択APIを再実行してもreviewContextを上書きしない", function () {
  var currentSession = startedSession();
  var result = start(currentSession);

  assert.equal(result.status, "invalid_review_phase");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, "variant-one");
});

test("variant_pendingでは保存済みpending派生だけを記録する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var wrong = record(currentSession, values.variantTwo, "understood", { values: values });
  var foreign = record(currentSession, values.foreign, "understood", { values: values });
  var source = record(currentSession, values.source, "understood", { values: values });

  assert.equal(wrong.status, "ignored_unverified_answer");
  assert.equal(foreign.status, "ignored_unverified_answer");
  assert.equal(source.status, "ignored_unverified_answer");
  assert.deepEqual(wrong.currentSession.reviewContext.attemptedVariantIds, []);
});

test("存在しない派生IDと未検証派生IDはpendingにできない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var raw = structuredClone(currentSession.reviewContext);
  raw.pendingQuestionId = "missing-variant";
  raw.verifiedVariantIds = ["missing-variant"];
  var normalized = REVIEW.normalizeReviewContext({
    reviewContext: raw,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });

  assert.equal(normalized, null);
});

test("派生understood後はsource_retry_pendingへ遷移する", function () {
  var values = catalog();
  var result = record(startedSession({ values: values }), values.variantOne, "understood", { values: values });
  var context = result.currentSession.reviewContext;

  assert.equal(result.status, "recorded");
  assert.equal(context.phase, "source_retry_pending");
  assert.equal(context.pendingQuestionId, values.source.id);
  assert.equal(context.pendingQuestionRole, "source");
  assert.deepEqual(context.attemptedVariantIds, [values.variantOne.id]);
});

test("派生incorrect後はunresolved_variant_pendingで同じ派生を再挑戦できる", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  assert.equal(currentSession.reviewContext.phase, "unresolved_variant_pending");
  assert.equal(currentSession.reviewContext.pendingQuestionId, values.variantOne.id);

  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  assert.equal(currentSession.reviewContext.latestOutcomeByQuestionId[values.variantOne.id], "understood");
  assert.equal(currentSession.reviewContext.phase, "source_retry_pending");
});

test("source_retry_pendingでは元問題だけを記録する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  assert.equal(record(currentSession, values.variantOne, "understood", { values: values }).status, "ignored_unverified_answer");
  assert.equal(record(currentSession, values.source, "understood", { values: values }).status, "recorded");
});

test("元問題と派生の理解正解でcompletion_candidateになるが自動clearしない", function () {
  var completed = completeReview();
  var context = completed.currentSession.reviewContext;

  assert.equal(context.phase, "completion_candidate");
  assert.equal(context.pendingQuestionId, "");
  assert.equal(evaluate(completed.currentSession, { values: completed.values }).status, "completion_candidate");
  assert.ok(completed.currentSession.reviewContext);
});

test("manualWeak情報が欠損している場合は終了判定も回答記録も拒否する", function () {
  var completed = completeReview();
  var evaluation = REVIEW.evaluateReviewCompletion({
    reviewContext: completed.currentSession.reviewContext,
    questions: questionsOf(completed.values),
    allowedStageIds: [1]
  });
  var currentSession = startedSession({ values: completed.values });
  var recordResult = REVIEW.recordReviewOutcome({
    currentSession: currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    question: completed.values.variantOne,
    outcome: "understood"
  });

  assert.equal(evaluation.status, "invalid_manual_weak_input");
  assert.equal(recordResult.status, "invalid_manual_weak_input");
});

test("manualWeak空配列は確認済みなしとして終了候補を許可する", function () {
  var completed = completeReview();
  assert.equal(evaluate(completed.currentSession, { values: completed.values }).status, "completion_candidate");
});

test("同じknowledgeKeyのmanualWeakが1件でもあれば終了しない", function () {
  var completed = completeReview();
  var result = evaluate(completed.currentSession, {
    values: completed.values,
    manualWeakQuestionIdsForKnowledgeKey: [completed.values.variantTwo.id]
  });

  assert.equal(result.status, "continue_review");
  assert.ok(result.reasons.includes("manual_weak_active"));
});

test("manualWeak解除だけでは元問題の再確認なしに終了しない", function () {
  var values = catalog();
  var currentSession = startedSession({
    values: values,
    reviewTrigger: trigger(values.source, "understood", "manualWeak")
  });
  currentSession = record(currentSession, values.variantOne, "understood", {
    values: values,
    manualWeakQuestionIdsForKnowledgeKey: [values.source.id]
  }).currentSession;
  assert.equal(currentSession.reviewContext.phase, "source_retry_pending");
  assert.equal(evaluate(currentSession, { values: values }).status, "continue_review");
});

test("attemptedVariantIdsがverifiedVariantIdsの部分集合でないcontextは終了候補にしない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var raw = structuredClone(currentSession.reviewContext);
  raw.attemptedVariantIds = ["unverified"];
  var result = REVIEW.evaluateReviewCompletion({
    reviewContext: raw,
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.status, "invalid_review_context");
  assert.equal(result.completionCandidate, false);
});

test("true派生なしはblocked_no_verified_variantとして保存する", function () {
  var only = catalog().source;
  var values = { source: only };
  var result = start(session(), {
    values: values
  });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.phase, "blocked_no_verified_variant");
  assert.equal(evaluate(result.currentSession, { values: values }).status, "blocked_no_verified_variant");
});

test("派生ありで一時除外はno_eligible_variantとして保存する", function () {
  var values = catalog();
  var result = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  });

  assert.equal(result.currentSession.reviewContext.phase, "no_eligible_variant");
  assert.equal(evaluate(result.currentSession, { values: values }).status, "no_eligible_variant");
  assert.equal(evaluate(result.currentSession, { values: values }).completionCandidate, false);
});

test("pendingとphaseはJSON往復後も維持される", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var restored = JSON.parse(JSON.stringify(currentSession));

  assert.equal(restored.reviewContext.phase, "variant_pending");
  assert.equal(restored.reviewContext.pendingQuestionId, values.variantOne.id);
  assert.equal(evaluate(restored, { values: values }).status, "continue_review");
});

test("completion_candidateもJSON往復後に維持される", function () {
  var completed = completeReview();
  var restored = JSON.parse(JSON.stringify(completed.currentSession));

  assert.equal(restored.reviewContext.phase, "completion_candidate");
  assert.equal(evaluate(restored, { values: completed.values }).status, "completion_candidate");
});

test("選択APIだけが確認済み派生をpendingへ設定する", function () {
  var values = catalog();
  var currentSession = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  }).currentSession;
  var result = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    recentQuestionIds: []
  });

  assert.equal(result.status, "selection_applied");
  assert.equal(result.currentSession.reviewContext.phase, "variant_pending");
  assert.deepEqual(result.currentSession.reviewContext.verifiedVariantIds, [values.variantOne.id]);
});

test("variant_pendingから任意の新規派生を追加しない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var result = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    recentQuestionIds: []
  });

  assert.equal(result.status, "invalid_review_phase");
  assert.deepEqual(result.currentSession.reviewContext.verifiedVariantIds, [values.variantOne.id]);
});

test("retry選択は未解決かつverifiedの派生だけをpendingにできる", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  var result = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    recentQuestionIds: [values.variantOne.id]
  });

  assert.equal(result.status, "selection_applied");
  assert.equal(result.currentSession.reviewContext.phase, "unresolved_variant_pending");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
});

test("外部selectionResultは再挑戦を誘導できない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  var result = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    selectionResult: { questionId: values.variantTwo.id, selectionMode: "new_variant" }
  });

  assert.equal(result.status, "selection_applied");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
});

test("原子的APIは実際のセレクター出力だけで開始と再挑戦を接続する", function () {
  var source = Object.assign(question("source-question"), {
    variantType: "rephrase",
    reasoningLevel: 1,
    equivalenceKey: "source-equivalence",
    variantOfQuestionIds: []
  });
  var variant = Object.assign(question("variant-one"), {
    variantType: "condition",
    reasoningLevel: 2,
    equivalenceKey: "variant-equivalence",
    variantOfQuestionIds: [source.id]
  });
  var values = catalog({ source: source, variantOne: variant });
  var currentSession = REVIEW.selectAndApplyReviewVariant({
    currentSession: session(),
    questions: questionsOf(values),
    allowedStageIds: [1],
    sourceQuestion: source,
    reviewTrigger: trigger(source),
    targetReasoningLevel: 2,
    recentQuestionIds: []
  }).currentSession;
  var retry;

  assert.equal(currentSession.reviewContext.pendingQuestionId, variant.id);
  currentSession = record(currentSession, variant, "incorrect", { values: values }).currentSession;
  retry = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    targetReasoningLevel: 2,
    recentQuestionIds: [variant.id]
  });

  assert.equal(retry.status, "selection_applied");
  assert.equal(retry.currentSession.reviewContext.pendingQuestionId, variant.id);
});

test("再回答の最新結果を採用し、未解決がなくなれば終了候補に進める", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "guess", { values: values }).currentSession;
  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;

  assert.equal(currentSession.reviewContext.latestOutcomeByQuestionId[values.variantOne.id], "understood");
  assert.equal(currentSession.reviewContext.phase, "completion_candidate");
});

test("Stage跨ぎpendingは許可Stage内なら維持し、未解放Stageなら正規化で拒否する", function () {
  var values = catalog({ variantOne: question("variant-one", KEY, 2, {
    variantType: "condition",
    reasoningLevel: 2,
    equivalenceKey: "variant-one-equivalence",
    variantOfQuestionIds: ["source-question"]
  }) });
  var currentSession = start(session(), {
    values: values,
    allowedStageIds: [1, 2],
    reviewStagePolicy: "allowed"
  }).currentSession;
  var accepted = REVIEW.normalizeReviewContext({
    reviewContext: currentSession.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1, 2]
  });
  var rejected = REVIEW.normalizeReviewContext({
    reviewContext: currentSession.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });

  assert.ok(accepted);
  assert.equal(rejected, null);
});

test("clearはphaseに対応する指定理由でreviewContextだけを消す", function () {
  ["stage_changed", "new_session_started", "session_discarded"].forEach(function (reason) {
    var currentSession = startedSession();
    var before = structuredClone(currentSession);
    var result = REVIEW.clearReviewContext({ currentSession: currentSession, reason: reason });

    assert.equal(result.status, "cleared");
    assert.equal(result.currentSession.reviewContext, undefined);
    assert.deepEqual(result.currentSession.queue, before.queue);
    assert.equal(result.currentSession.index, before.index);
    assert.equal(result.currentSession.correct, before.correct);
    assert.equal(result.currentSession.recorded, before.recorded);
    assert.deepEqual(currentSession, before);
  });
});

test("不正なclear理由ではreviewContextを消さない", function () {
  var currentSession = startedSession();
  var result = REVIEW.clearReviewContext({ currentSession: currentSession, reason: "automatic" });

  assert.equal(result.status, "invalid_clear_reason");
  assert.ok(result.currentSession.reviewContext);
});

test("wrongActive、manualWeak、questionStats、learningDataを変更しない", function () {
  var values = catalog();
  var original = session({
    wrongActive: true,
    manualWeak: [values.source.id],
    questionStats: { [values.source.id]: { attempts: 4, wrongActive: true } },
    learningData: { totalAnswered: 4, totalCorrect: 2, reviewQueue: [values.source.id] }
  });
  var before = structuredClone(original);
  var currentSession = start(original, { values: values }).currentSession;
  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;

  assert.deepEqual(original, before);
  assert.deepEqual(currentSession.questionStats, before.questionStats);
  assert.deepEqual(currentSession.learningData, before.learningData);
  assert.deepEqual(currentSession.manualWeak, before.manualWeak);
  assert.equal(currentSession.wrongActive, true);
});

test("正規化は不正version、不正outcome、sourceの派生混入を拒否する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var invalidVersion = structuredClone(currentSession.reviewContext);
  var invalidOutcome = structuredClone(currentSession.reviewContext);
  var sourceAsVariant = structuredClone(currentSession.reviewContext);
  invalidVersion.version = 2;
  invalidOutcome.latestOutcomeByQuestionId[values.source.id] = "invalid";
  sourceAsVariant.verifiedVariantIds = [values.source.id];

  assert.equal(REVIEW.normalizeReviewContext({ reviewContext: invalidVersion }), null);
  assert.ok(REVIEW.normalizeReviewContext({
    reviewContext: invalidOutcome,
    questions: questionsOf(values),
    allowedStageIds: [1]
  }));
  assert.equal(REVIEW.normalizeReviewContext({
    reviewContext: sourceAsVariant,
    questions: questionsOf(values),
    allowedStageIds: [1]
  }), null);
});

test("元問題だけunderstoodでも、派生だけunderstoodでも終了候補にならない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession.reviewContext.latestOutcomeByQuestionId[values.source.id] = "understood";
  assert.equal(evaluate(currentSession, { values: values }).status, "continue_review");

  currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  assert.equal(evaluate(currentSession, { values: values }).status, "continue_review");
});

test("未解決の確認済み派生はsource理解後もpendingへ戻す", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  currentSession.reviewContext.phase = "source_retry_pending";
  currentSession.reviewContext.pendingQuestionId = values.source.id;
  currentSession.reviewContext.pendingQuestionRole = "source";
  currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;

  assert.equal(currentSession.reviewContext.phase, "unresolved_variant_pending");
  assert.equal(currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
});

test("同じ派生の再回答はattemptedVariantIdsを重複させず最新順を維持する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  currentSession = record(currentSession, values.variantOne, "guess", { values: values }).currentSession;

  assert.deepEqual(currentSession.reviewContext.attemptedVariantIds, [values.variantOne.id]);
  assert.equal(currentSession.reviewContext.latestOutcomeByQuestionId[values.variantOne.id], "guess");
});

test("blockedとno_eligibleのcontextはclearまで残り、終了候補にはならない", function () {
  var only = catalog().source;
  var blocked = start(session(), { values: { source: only } }).currentSession;
  var values = catalog();
  var noEligible = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  }).currentSession;

  assert.equal(blocked.reviewContext.phase, "blocked_no_verified_variant");
  assert.equal(noEligible.reviewContext.phase, "no_eligible_variant");
  assert.equal(evaluate(blocked, { values: { source: only } }).completionCandidate, false);
  assert.equal(evaluate(noEligible, { values: values }).completionCandidate, false);
});

test("入力と戻り値は共有参照せず、unknown項目を保存しない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var raw = structuredClone(currentSession.reviewContext);
  raw.unknown = { nested: true };
  var normalized = REVIEW.normalizeReviewContext({
    reviewContext: raw,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });
  normalized.verifiedVariantIds.push("changed");
  normalized.latestOutcomeByQuestionId[values.source.id] = "understood";

  assert.deepEqual(raw.verifiedVariantIds, [values.variantOne.id]);
  assert.equal(raw.latestOutcomeByQuestionId[values.source.id], "incorrect");
  assert.equal(normalized.unknown, undefined);
});

test("無関係なmetadata未設定問題があっても対象knowledgeKeyの補習は開始できる", function () {
  var values = catalog({ unrelatedLegacyQuestion: { id: "legacy-no-metadata", question: "旧形式" } });
  var result = start(session(), { values: values });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
});

test("対象knowledgeKey内の不正metadataは補習開始を拒否する", function () {
  var values = catalog({
    invalidSibling: { id: "invalid-sibling", knowledgeKey: KEY, stage: 1, question: "不完全" }
  });
  var result = start(session(), { values: values });

  assert.equal(result.status, "invalid_review_start");
  assert.equal(result.currentSession.reviewContext, undefined);
});

test("問題ID重複は無関係な旧形式問題でもcatalog全体の契約違反として拒否する", function () {
  var values = catalog({ duplicateLegacyQuestion: { id: "source-question", question: "重複" } });
  var result = start(session(), { values: values });

  assert.equal(result.status, "invalid_review_start");
});

test("保存JSONに未検証のverifiedVariantIdを追加しても回答記録を拒否する", function () {
  var values = catalog();
  var tampered = startedSession({ values: values });
  var afterTamper;
  var result;

  tampered.reviewContext.verifiedVariantIds.push(values.variantTwo.id);
  tampered.reviewContext.pendingQuestionId = values.variantTwo.id;
  tampered.reviewContext.pendingQuestionRole = "variant";
  tampered.reviewContext.phase = "variant_pending";
  afterTamper = structuredClone(tampered);
  result = record(tampered, values.variantTwo, "understood", { values: values });

  assert.equal(result.status, "invalid_review_context");
  assert.deepEqual(tampered, afterTamper);
  assert.equal(afterTamper.reviewContext.verifiedSelectionProofsByQuestionId[values.variantTwo.id], undefined);
});

test("pendingQuestionIdの改ざんと別knowledgeKeyの証跡混入を正規化で拒否する", function () {
  var values = catalog();
  var pendingTampered = startedSession({ values: values });
  var foreignTampered = startedSession({ values: values });

  pendingTampered.reviewContext.pendingQuestionId = values.variantTwo.id;
  foreignTampered.reviewContext.verifiedVariantIds.push(values.foreign.id);
  foreignTampered.reviewContext.verifiedSelectionProofsByQuestionId[values.foreign.id] = {};

  assert.equal(REVIEW.normalizeReviewContext({
    reviewContext: pendingTampered.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1]
  }), null);
  assert.equal(REVIEW.normalizeReviewContext({
    reviewContext: foreignTampered.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1]
  }), null);
});

test("selectionProofはJSON往復後も問題一覧から検証できる", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var restored = JSON.parse(JSON.stringify(currentSession));
  var normalized = REVIEW.normalizeReviewContext({
    reviewContext: restored.reviewContext,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });

  assert.ok(normalized);
  assert.equal(
    normalized.verifiedSelectionProofsByQuestionId[values.variantOne.id].questionId,
    values.variantOne.id
  );
});

test("1問群はblocked_no_verified_variantとなり補習完了にはしない", function () {
  var only = catalog().source;
  var values = { source: only };
  var result = start(session(), {
    values: values,
    selectionResult: { reviewAvailability: "blocked_no_verified_variant" }
  });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.phase, "blocked_no_verified_variant");
  assert.equal(evaluate(result.currentSession, { values: values }).completionCandidate, false);
});

test("5問群と10問群でも未試行の兄弟全問を要求せず補習を終了できる", function () {
  [5, 10].forEach(function (size) {
    var values = expandedCatalog(size);
    var currentSession = startedSession({ values: values });

    currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
    currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;
    assert.equal(currentSession.reviewContext.phase, "completion_candidate", String(size));
  });
});

test("固定キュー整合APIは補習中にpending問題を優先しqueue/indexを変更しない", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var before = structuredClone(currentSession);
  var state = overlay(currentSession, values);
  var displayed = REVIEW.resolveDisplayedQuestion({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });

  assert.equal(state.status, "review_pending");
  assert.equal(state.questionId, values.variantOne.id);
  assert.equal(state.questionRole, "variant");
  assert.equal(state.shouldAdvanceQueue, false);
  assert.equal(displayed.question.id, values.variantOne.id);
  displayed.question.question = "変更しても入力は不変";
  assert.equal(currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
  assert.deepEqual(currentSession, before);
});

test("固定キューのindexがsourceQuestionIdと食い違う場合は安全停止する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var before = structuredClone(currentSession);
  currentSession.index = 1;
  var state = overlay(currentSession, values);

  assert.equal(state.status, "source_queue_mismatch");
  assert.equal(state.questionId, "");
  assert.equal(currentSession.queue[1], values.foreign.id);
  assert.equal(before.index, 0);
});

test("pending問題の欠損、未解放Stage、phaseとrole不一致はoverlayで安全停止する", function () {
  var values = catalog();
  var missing = startedSession({ values: values });
  var stageValues = catalog({ variantOne: question("variant-one", KEY, 2, {
    variantType: "condition",
    reasoningLevel: 2,
    equivalenceKey: "variant-one-equivalence",
    variantOfQuestionIds: ["source-question"]
  }) });
  var stageSession = start(session(), {
    values: stageValues,
    allowedStageIds: [1, 2],
    reviewStagePolicy: "allowed"
  }).currentSession;
  var roleMismatch = startedSession({ values: values });

  delete values.variantOne;
  roleMismatch.reviewContext.pendingQuestionRole = "source";
  assert.equal(overlay(missing, values).status, "invalid_review_context");
  assert.equal(overlay(stageSession, stageValues, { allowedStageIds: [1] }).status, "invalid_review_context");
  assert.equal(overlay(roleMismatch, catalog()).status, "invalid_review_context");
});

test("completion_candidateは再読み込み後もqueueを進めず、finalize後に1回だけ進める", function () {
  var completed = completeReview();
  var restored = JSON.parse(JSON.stringify(completed.currentSession));
  var before = structuredClone(restored);
  var state = overlay(restored, completed.values);
  var finalized = REVIEW.finalizeCompletedReview({
    currentSession: restored,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(state.status, "completion_candidate");
  assert.equal(restored.index, before.index);
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.currentSession.index, before.index + 1);
  assert.equal(overlay(finalized.currentSession, completed.values).questionId, completed.values.foreign.id);
});

test("blocked/no_eligibleはblocked_route_selectedでcontextだけをclearできる", function () {
  var values = catalog();
  var blocked = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  }).currentSession;
  var before = structuredClone(blocked);
  var overlayState = overlay(blocked, values);
  var routed = REVIEW.clearReviewContext({
    currentSession: blocked,
    reason: "blocked_route_selected"
  });
  var left = REVIEW.clearReviewContext({
    currentSession: before,
    reason: "user_left_review"
  });

  assert.equal(overlayState.status, "no_eligible_variant");
  assert.equal(routed.status, "cleared");
  assert.equal(left.status, "invalid_clear_phase");
  assert.deepEqual(routed.currentSession.queue, blocked.queue);
  assert.equal(routed.currentSession.index, blocked.index);
});

test("旧selection入力APIは公開せず、選択proofを呼び出し側で生成できない", function () {
  assert.equal(typeof REVIEW.createReviewContext, "undefined");
  assert.equal(typeof REVIEW.applyReviewSelection, "undefined");
});

test("原子的選択APIは呼び出し側のquestionIdやproofを信用しない", function () {
  var values = catalog();
  var result = start(session(), {
    values: values,
    selectionResult: {
      questionId: values.foreign.id,
      question: values.foreign,
      selectionProof: { proofToken: "forged" },
      reviewAvailability: "eligible"
    }
  });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
  assert.deepEqual(result.currentSession.reviewContext.verifiedVariantIds, [values.variantOne.id]);
});

test("no_eligibleは条件解除後に同じ原子的APIで再選択できる", function () {
  var values = catalog();
  var currentSession = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  }).currentSession;
  var result = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    targetReasoningLevel: 2,
    recentQuestionIds: []
  });

  assert.equal(currentSession.reviewContext.phase, "no_eligible_variant");
  assert.equal(result.status, "selection_applied");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
});

test("user_completed_reviewはcompletion_candidate以外で直接clearできずfinalizeを要求する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var result = REVIEW.clearReviewContext({
    currentSession: currentSession,
    reason: "user_completed_review",
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.status, "completion_requires_finalize");
  assert.ok(result.currentSession.reviewContext);
});

test("completion_candidateも直接clearできずfinalizeを要求する", function () {
  var completed = completeReview();
  var before = structuredClone(completed.currentSession);
  var result = REVIEW.clearReviewContext({
    currentSession: completed.currentSession,
    reason: "user_completed_review",
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.status, "completion_requires_finalize");
  assert.deepEqual(result.currentSession, before);
});

test("user_left_reviewはpending補習だけをclearできる", function () {
  var values = catalog();
  var pending = REVIEW.clearReviewContext({
    currentSession: startedSession({ values: values }),
    reason: "user_left_review"
  });
  var completed = completeReview();
  var candidate = REVIEW.clearReviewContext({
    currentSession: completed.currentSession,
    reason: "user_left_review"
  });

  assert.equal(pending.status, "cleared");
  assert.equal(candidate.status, "invalid_clear_phase");
});

test("finalizeは直前にmanualWeakがあれば進行しない", function () {
  var completed = completeReview();
  var before = structuredClone(completed.currentSession);
  var result = REVIEW.finalizeCompletedReview({
    currentSession: completed.currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: [completed.values.source.id]
  });

  assert.equal(result.status, "completion_not_confirmed");
  assert.equal(result.currentSession.index, before.index);
  assert.ok(result.currentSession.reviewContext);
});

test("finalizeは二度呼んでもqueueを一度だけ進める", function () {
  var completed = completeReview();
  var first = REVIEW.finalizeCompletedReview({
    currentSession: completed.currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  var second = REVIEW.finalizeCompletedReview({
    currentSession: first.currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(first.status, "finalized");
  assert.equal(second.status, "no_review_context");
  assert.equal(second.currentSession.index, completed.currentSession.index + 1);
});

test("finalizeはreviewContextだけを消し学習統計を変更しない", function () {
  var completed = completeReview();
  completed.currentSession.correct = 7;
  completed.currentSession.learningData = { totalAnswered: 12, totalCorrect: 10 };
  var before = structuredClone(completed.currentSession);
  var result = REVIEW.finalizeCompletedReview({
    currentSession: completed.currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.currentSession.correct, before.correct);
  assert.deepEqual(result.currentSession.learningData, before.learningData);
  assert.equal(result.currentSession.recorded, false);
  assert.equal(result.currentSession.reviewContext, undefined);
});

test("recorded=trueで再読み込みしてもpending問題を優先して復元する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  currentSession.recorded = true;
  var restored = JSON.parse(JSON.stringify(currentSession));
  var displayed = REVIEW.resolveDisplayedQuestion({
    currentSession: restored,
    questions: questionsOf(values),
    allowedStageIds: [1]
  });

  assert.equal(displayed.status, "review_pending");
  assert.equal(displayed.questionId, values.variantOne.id);
});

test("completion_candidateをrecorded=trueで再読み込みしても自動進行しない", function () {
  var completed = completeReview();
  var restored = JSON.parse(JSON.stringify(completed.currentSession));
  restored.recorded = true;
  var overlayState = overlay(restored, completed.values);

  assert.equal(overlayState.status, "completion_candidate");
  assert.equal(restored.index, 0);
});

test("selectAndApplyReviewVariantとfinalizeは入力session、questions、learningDataを変更しない", function () {
  var values = catalog();
  var original = session({ learningData: { totalAnswered: 8, totalCorrect: 6 } });
  var before = structuredClone(original);
  var started = start(original, { values: values });
  var completed;
  var result;

  assert.deepEqual(original, before);
  completed = record(started.currentSession, values.variantOne, "understood", { values: values }).currentSession;
  completed = record(completed, values.source, "understood", { values: values }).currentSession;
  result = REVIEW.finalizeCompletedReview({
    currentSession: completed,
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  assert.equal(result.status, "finalized");
  assert.deepEqual(original, before);
  assert.equal(values.variantOne.variantOfQuestionIds[0], values.source.id);
});

test("外部がblockedやno_eligibleを指定しても原子的APIは実際の候補から判定する", function () {
  var values = catalog();
  var result = start(session(), {
    values: values,
    selectionResult: { reviewAvailability: "blocked_no_verified_variant" },
    reviewAvailability: "no_eligible_variant"
  });

  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.phase, "variant_pending");
});

test("finalizeは完了直前に未解決揺らぎが復活していれば進行しない", function () {
  var completed = completeReview();
  var tampered = structuredClone(completed.currentSession);
  tampered.reviewContext.latestOutcomeByQuestionId[completed.values.variantOne.id] = "guess";
  var result = REVIEW.finalizeCompletedReview({
    currentSession: tampered,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.status, "completion_not_confirmed");
  assert.equal(result.currentSession.index, 0);
  assert.equal(result.currentSession.reviewContext.phase, "completion_candidate");
});

test("固定キューanchorがsourceと不一致なら補習開始を拒否し状態を変更しない", function () {
  var values = catalog();
  var original = session({ index: 1, recorded: true });
  var before = structuredClone(original);
  var result = start(original, { values: values });

  assert.equal(result.status, "source_queue_mismatch");
  assert.equal(result.currentSession.reviewContext, undefined);
  assert.deepEqual(result.currentSession, before);
  assert.deepEqual(original, before);
});

test("固定キューanchorにqueueまたは有効indexがなければ補習開始を拒否する", function () {
  var values = catalog();
  var missingQueue = session({ queue: null });
  var invalidIndex = session({ index: 2 });
  var missingQueueBefore = structuredClone(missingQueue);
  var invalidIndexBefore = structuredClone(invalidIndex);
  var missingQueueResult = start(missingQueue, { values: values });
  var invalidIndexResult = start(invalidIndex, { values: values });

  assert.equal(missingQueueResult.status, "fixed_queue_missing");
  assert.equal(invalidIndexResult.status, "fixed_queue_index_invalid");
  assert.deepEqual(missingQueueResult.currentSession, missingQueueBefore);
  assert.deepEqual(invalidIndexResult.currentSession, invalidIndexBefore);
  assert.deepEqual(missingQueue, missingQueueBefore);
  assert.deepEqual(invalidIndex, invalidIndexBefore);
});

test("補習中に固定キューanchorがずれた場合は回答を記録せず状態を完全維持する", function () {
  var values = catalog();
  var currentSession = startedSession({ values: values });
  var before;
  var result;

  currentSession.index = 1;
  before = structuredClone(currentSession);
  result = record(currentSession, values.variantOne, "understood", { values: values });

  assert.equal(result.status, "source_queue_mismatch");
  assert.deepEqual(result.currentSession, before);
  assert.deepEqual(currentSession, before);
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);
  assert.equal(result.currentSession.reviewContext.phase, "variant_pending");
  assert.deepEqual(result.currentSession.reviewContext.attemptedVariantIds, []);
  assert.deepEqual(result.currentSession.reviewContext.latestOutcomeByQuestionId, {
    "source-question": "incorrect"
  });
});

test("finalize直前に固定キューanchorがずれた場合は完了処理を拒否する", function () {
  var completed = completeReview();
  var currentSession = structuredClone(completed.currentSession);
  var before;
  var result;

  currentSession.index = 1;
  before = structuredClone(currentSession);
  result = REVIEW.finalizeCompletedReview({
    currentSession: currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(result.status, "source_queue_mismatch");
  assert.deepEqual(result.currentSession, before);
  assert.deepEqual(currentSession, before);
});

test("1派生は不正解から原子的retry、理解正解、元問題再挑戦を経てfinalizeできる", function () {
  var values = catalog();
  var currentSession;
  var retry;
  var finalized;

  delete values.variantTwo;
  currentSession = startedSession({ values: values });
  currentSession = record(currentSession, values.variantOne, "incorrect", { values: values }).currentSession;
  assert.equal(currentSession.reviewContext.phase, "unresolved_variant_pending");

  retry = REVIEW.selectAndApplyReviewVariant({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    targetReasoningLevel: 2,
    recentQuestionIds: [values.variantOne.id]
  });
  assert.equal(retry.status, "selection_applied");
  assert.equal(retry.currentSession.reviewContext.pendingQuestionId, values.variantOne.id);

  currentSession = record(retry.currentSession, values.variantOne, "understood", { values: values }).currentSession;
  currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;
  assert.equal(currentSession.reviewContext.phase, "completion_candidate");

  finalized = REVIEW.finalizeCompletedReview({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.currentSession.index, 1);
  assert.equal(finalized.currentSession.reviewContext, undefined);
  assert.equal(finalized.currentSession.recorded, false);
});

test("5問群と10問群は未試行派生を要求せずfinalizeまで完了できる", function () {
  [5, 10].forEach(function (size) {
    var values = expandedCatalog(size);
    var currentSession = startedSession({ values: values });
    var finalized;

    currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
    currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;
    assert.equal(currentSession.reviewContext.phase, "completion_candidate", String(size));
    finalized = REVIEW.finalizeCompletedReview({
      currentSession: currentSession,
      questions: questionsOf(values),
      allowedStageIds: [1],
      manualWeakQuestionIdsForKnowledgeKey: []
    });
    assert.equal(finalized.status, "finalized", String(size));
    assert.equal(finalized.currentSession.index, 1, String(size));
    assert.equal(finalized.currentSession.reviewContext, undefined, String(size));
  });
});

test("固定キューindexは数値型整数以外を補習開始前に拒否する", function () {
  var values = catalog();
  [
    { label: "文字列", value: "0" },
    { label: "null", value: null },
    { label: "false", value: false },
    { label: "空文字", value: "" },
    { label: "NaN", value: NaN },
    { label: "Infinity", value: Infinity },
    { label: "小数", value: 0.5 },
    { label: "負数", value: -1 },
    { label: "queue範囲外", value: 2 }
  ].forEach(function (fixture) {
    var original = session({ index: fixture.value });
    var before = structuredClone(original);
    var result = start(original, { values: values });

    assert.equal(result.status, "fixed_queue_index_invalid", fixture.label);
    assert.deepEqual(result.currentSession, before, fixture.label);
    assert.deepEqual(original, before, fixture.label);
  });
});

test("数値型index 0だけが通常キューと補習anchorの有効な開始位置になる", function () {
  var values = catalog();
  var normal = REVIEW.resolveDisplayedQuestion({
    currentSession: session({ index: 0 }),
    questions: questionsOf(values),
    allowedStageIds: [1]
  });
  var stringIndex = REVIEW.resolveDisplayedQuestion({
    currentSession: session({ index: "0" }),
    questions: questionsOf(values),
    allowedStageIds: [1]
  });
  var result = start(session({ index: 0 }), { values: values });

  assert.equal(normal.status, "normal_queue");
  assert.equal(stringIndex.status, "queue_question_missing");
  assert.equal(result.status, "started");
  assert.equal(typeof result.currentSession.index, "number");
  assert.equal(result.currentSession.index, 0);
});

test("completion overlayはclearを案内せずfinalize専用actionを返す", function () {
  var completed = completeReview();
  var state = overlay(completed.currentSession, completed.values);

  assert.equal(state.status, "completion_candidate");
  assert.equal(Object.prototype.hasOwnProperty.call(state.details, "clearReason"), false);
  assert.equal(state.details.completionAction, "finalizeCompletedReview");
});

test("補習pendingにはfinalize actionを返さず、blocked状態は従来のclear理由を維持する", function () {
  var values = catalog();
  var pending = overlay(startedSession({ values: values }), values);
  var blockedSession = start(session(), {
    values: values,
    recentQuestionIds: [values.variantOne.id, values.variantTwo.id]
  }).currentSession;
  var blocked = overlay(blockedSession, values);

  assert.equal(Object.prototype.hasOwnProperty.call(pending.details, "completionAction"), false);
  assert.equal(blocked.status, "no_eligible_variant");
  assert.equal(blocked.details.clearReason, "blocked_route_selected");
  assert.equal(Object.prototype.hasOwnProperty.call(blocked.details, "completionAction"), false);
});

test("finalizeは数値型indexを維持し、非数値indexではsessionを完全維持して拒否する", function () {
  var completed = completeReview();
  var valid = REVIEW.finalizeCompletedReview({
    currentSession: completed.currentSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  var invalidSession = structuredClone(completed.currentSession);
  var invalidBefore;
  var invalid;

  invalidSession.index = "0";
  invalidBefore = structuredClone(invalidSession);
  invalid = REVIEW.finalizeCompletedReview({
    currentSession: invalidSession,
    questions: questionsOf(completed.values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(valid.status, "finalized");
  assert.equal(typeof valid.currentSession.index, "number");
  assert.equal(valid.currentSession.index, 1);
  assert.notEqual(valid.currentSession.index, "01");
  assert.equal(invalid.status, "fixed_queue_index_invalid");
  assert.deepEqual(invalid.currentSession, invalidBefore);
  assert.deepEqual(invalidSession, invalidBefore);
});

test("キュー最終問題でもfinalizeは終了位置へ1回だけ進め学習統計を維持する", function () {
  var values = catalog();
  var initial = session({
    queue: [values.foreign.id, values.variantTwo.id, values.source.id],
    index: 2,
    recorded: true,
    correct: 4,
    learningData: { totalAnswered: 12, totalCorrect: 10 }
  });
  var currentSession = start(initial, { values: values }).currentSession;
  var beforeFinalize;
  var finalized;

  currentSession = record(currentSession, values.variantOne, "understood", { values: values }).currentSession;
  currentSession = record(currentSession, values.source, "understood", { values: values }).currentSession;
  beforeFinalize = structuredClone(currentSession);
  finalized = REVIEW.finalizeCompletedReview({
    currentSession: currentSession,
    questions: questionsOf(values),
    allowedStageIds: [1],
    manualWeakQuestionIdsForKnowledgeKey: []
  });

  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.currentSession.index, finalized.currentSession.queue.length);
  assert.equal(typeof finalized.currentSession.index, "number");
  assert.equal(finalized.currentSession.recorded, false);
  assert.equal(finalized.currentSession.reviewContext, undefined);
  assert.equal(finalized.currentSession.correct, beforeFinalize.correct);
  assert.deepEqual(finalized.currentSession.learningData, beforeFinalize.learningData);
  assert.equal(overlay(finalized.currentSession, values).status, "queue_question_missing");
});
