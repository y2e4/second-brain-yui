"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");

var NOW = "2026-08-02T12:00:00+09:00";
var TYPES = ["rephrase", "condition", "comparison", "exception", "case"];

function question(id, knowledgeKey, variantType, reasoningLevel, extra) {
  return Object.assign({
    id: id,
    stage: 1,
    category: "合成",
    theme: knowledgeKey,
    question: id + "の問題",
    choices: ["A", "B"],
    answer: "A",
    knowledgeKey: knowledgeKey,
    variantOfQuestionIds: [],
    variantType: variantType,
    reasoningLevel: reasoningLevel,
    equivalenceKey: id + "-equivalence"
  }, extra || {});
}

function family(size, key) {
  var knowledgeKey = key || "knowledge-a";
  var root = question("root", knowledgeKey, "rephrase", 1);
  var values = [root];
  var index;

  for (index = 1; index < size; index += 1) {
    values.push(question(
      "variant-" + index,
      knowledgeKey,
      TYPES[index % TYPES.length],
      Math.min(5, 1 + index),
      { variantOfQuestionIds: [root.id] }
    ));
  }
  return values;
}

function trigger(questionValue, outcome, fluctuationReason) {
  var resolvedOutcome = outcome || "incorrect";
  return {
    questionId: questionValue.id,
    knowledgeKey: questionValue.knowledgeKey,
    outcome: resolvedOutcome,
    fluctuationReason: fluctuationReason || resolvedOutcome,
    triggeredAt: NOW
  };
}

function select(questions, source, extra) {
  return SELECTOR.selectKnowledgeReviewVariant(Object.assign({
    questions: questions,
    reviewTrigger: trigger(source),
    allowedStageIds: [1],
    targetReasoningLevel: 3,
    learningData: {
      totalAnswered: 44,
      adaptiveDifficulty: { reasoningLevel: 3 },
      questionStats: {}
    },
    currentSession: { queue: [], index: 0, recorded: false, answerRecords: [] },
    recentQuestionIds: []
  }, extra || {}));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  Object.keys(value).forEach(function (key) {
    deepFreeze(value[key]);
  });
  return value;
}

test("1問だけのknowledgeKeyでは候補なし", function () {
  var only = family(1)[0];
  var result = select([only], only);
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "no_verified_variant");
  assert.equal(result.fallback, "continue_normal_learning");
});

test("5問群で基礎問題の揺らぎから別問題を選べる", function () {
  var values = family(5);
  var result = select(values, values[0]);
  assert.notEqual(result.questionId, values[0].id);
  assert.equal(result.knowledgeKey, values[0].knowledgeKey);
});

test("10問群で基礎問題の揺らぎから別問題を選べる", function () {
  var values = family(10);
  var result = select(values, values[0]);
  assert.notEqual(result.questionId, values[0].id);
  assert.equal(result.directRelation, true);
});

test("兄弟派生問題の揺らぎから別の兄弟問題を選べる", function () {
  var values = family(5);
  var result = select(values, values[2], { targetReasoningLevel: 3 });
  assert.notEqual(result.questionId, values[2].id);
  assert.notEqual(result.questionId, values[0].id);
  assert.equal(result.knowledgeKey, values[2].knowledgeKey);
});

test("末端派生問題の揺らぎから別角度問題を選べる", function () {
  var values = family(5);
  var result = select(values, values[4], { targetReasoningLevel: 3 });
  assert.notEqual(result.questionId, values[4].id);
  assert.notEqual(result.variantType, values[4].variantType);
});

test("新規問題を1問追加しても既存問題のメタデータ変更不要", function () {
  var existing = family(5);
  var snapshot = structuredClone(existing);
  var appended = question("variant-5", "knowledge-a", "case", 5, {
    variantOfQuestionIds: ["root"]
  });
  var result = select(existing.concat([appended]), existing[0], {
    targetReasoningLevel: 5
  });
  assert.deepEqual(existing, snapshot);
  assert.ok(result.question);
  assert.equal(appended.variantOfQuestionIds[0], "root");
});

test("複数の過去揺らぎがあっても直前reviewTriggerを優先", function () {
  var oldRoot = question("old-root", "old-key", "rephrase", 1);
  var oldVariant = question("old-variant", "old-key", "condition", 3, {
    variantOfQuestionIds: ["old-root"]
  });
  var latestRoot = question("latest-root", "latest-key", "rephrase", 1);
  var latestVariant = question("latest-variant", "latest-key", "condition", 3, {
    variantOfQuestionIds: ["latest-root"]
  });
  var result = select([oldRoot, oldVariant, latestRoot, latestVariant], latestRoot, {
    learningData: {
      questionStats: {
        "old-root": { wrongActive: true, lastOutcome: "incorrect" },
        "latest-root": { wrongActive: true, lastOutcome: "incorrect" }
      }
    }
  });
  assert.equal(result.questionId, "latest-variant");
  assert.equal(result.triggerQuestionId, "latest-root");
});

test("直接派生関係を最優先", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var direct = question("direct", "knowledge-a", "rephrase", 2, {
    variantOfQuestionIds: ["root"]
  });
  var sibling = question("sibling", "knowledge-a", "condition", 3);
  var result = select([root, direct, sibling], root);
  assert.equal(result.questionId, "direct");
  assert.equal(result.selectionReason, "direct_variant");
});

test("直接派生がなければ異なるvariantTypeを優先", function () {
  var root = question("root", "knowledge-a", "condition", 2);
  var sameType = question("same-type", "knowledge-a", "condition", 3);
  var differentType = question("different-type", "knowledge-a", "comparison", 3);
  var result = select([root, sameType, differentType], root);
  assert.equal(result.questionId, "different-type");
  assert.equal(result.selectionReason, "knowledge_variant_type");
});

test("適応難易度に近い問題を選ぶ", function () {
  var root = question("root", "knowledge-a", "condition", 1);
  var low = question("low", "knowledge-a", "condition", 2);
  var high = question("high", "knowledge-a", "condition", 4);
  var result = select([root, low, high], root, { targetReasoningLevel: 4 });
  assert.equal(result.questionId, "high");
});

test("現在問題を除外", function () {
  var values = family(3);
  var result = select(values, values[0], { currentQuestionId: "variant-1" });
  assert.notEqual(result.questionId, "variant-1");
});

test("セッション内回答済み問題を除外", function () {
  var values = family(4);
  var result = select(values, values[0], {
    currentSession: {
      queue: ["variant-1"],
      index: 0,
      recorded: true,
      answerRecords: [{ questionId: "variant-1" }]
    }
  });
  assert.notEqual(result.questionId, "variant-1");
});

test("recentQuestionIdsを除外", function () {
  var values = family(4);
  var result = select(values, values[0], { recentQuestionIds: ["variant-1"] });
  assert.notEqual(result.questionId, "variant-1");
});

test("同一equivalenceKeyを除外", function () {
  var root = question("root", "knowledge-a", "rephrase", 1, {
    equivalenceKey: "same"
  });
  var duplicate = question("duplicate", "knowledge-a", "condition", 3, {
    variantOfQuestionIds: ["root"],
    equivalenceKey: "same"
  });
  var distinct = question("distinct", "knowledge-a", "comparison", 3, {
    equivalenceKey: "different"
  });
  var result = select([root, duplicate, distinct], root);
  assert.equal(result.questionId, "distinct");
});

test("対象Stage外と固定キュー内の問題を除外", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var stageTwo = question("stage-two", "knowledge-a", "condition", 3, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var queued = question("queued", "knowledge-a", "comparison", 3, {
    variantOfQuestionIds: ["root"]
  });
  var fallback = question("fallback", "knowledge-a", "exception", 3);
  var result = select([root, stageTwo, queued, fallback], root, {
    fixedQueueQuestionIds: ["queued"],
    excludeFixedQueueQuestionIds: true,
    allowedStageIds: [1]
  });
  assert.equal(result.questionId, "fallback");
});

test("対象Stageが省略されたreview選択は補習元と同じStageに限定する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var locked = question("locked", "knowledge-a", "condition", 3, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var current = question("current", "knowledge-a", "comparison", 3);
  var result = select([root, locked, current], root, { allowedStageIds: [] });
  assert.equal(result.questionId, "current");
});

test("全候補除外時はnull", function () {
  var values = family(2);
  var result = select(values, values[0], { recentQuestionIds: ["variant-1"] });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "no_verified_variant");
});

test("候補なし時に無関係な問題を返さない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var unrelated = question("unrelated", "knowledge-b", "condition", 3);
  var result = select([root, unrelated], root);
  assert.equal(result.question, null);
  assert.equal(result.fallback, "continue_normal_learning");
});

test("通常学習では同じknowledgeKeyが連続出題を占有しない", function () {
  var last = question("last", "knowledge-a", "rephrase", 1);
  var sibling = question("sibling", "knowledge-a", "condition", 2);
  var other = question("other", "knowledge-b", "condition", 2);
  var result = SELECTOR.selectNormalLearningQuestion({
    questions: [last, sibling, other],
    recentQuestionIds: ["last"],
    allowedStageIds: [1],
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "other");
});

test("通常学習で対象Stageが不明なら安全に候補なしを返す", function () {
  var values = family(2);
  var result = SELECTOR.selectNormalLearningQuestion({
    questions: values,
    recentQuestionIds: []
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "missing_allowed_stages");
});

test("選択関数は1問だけ返す", function () {
  var values = family(10);
  var result = select(values, values[0]);
  assert.ok(result.question);
  assert.equal(Array.isArray(result.questions), false);
});

test("questions、learningData、currentSessionを変更しない", function () {
  var values = family(5);
  var learningData = { adaptiveDifficulty: { reasoningLevel: 3 }, questionStats: {} };
  var currentSession = { queue: ["root"], index: 0, recorded: true, answerRecords: [] };
  var input = {
    questions: values,
    reviewTrigger: trigger(values[0]),
    allowedStageIds: [1],
    learningData: learningData,
    currentSession: currentSession,
    recentQuestionIds: []
  };
  var snapshot = structuredClone(input);
  SELECTOR.selectKnowledgeReviewVariant(input);
  assert.deepEqual(input, snapshot);
});

test("凍結した入力でも選択できる", function () {
  var values = family(3);
  var input = deepFreeze({
    questions: values,
    reviewTrigger: trigger(values[0]),
    allowedStageIds: [1],
    targetReasoningLevel: 3,
    learningData: { adaptiveDifficulty: { reasoningLevel: 3 }, questionStats: {} },
    currentSession: { queue: [], index: 0, recorded: false, answerRecords: [] },
    recentQuestionIds: []
  });
  var result = SELECTOR.selectKnowledgeReviewVariant(input);
  assert.ok(result.question);
  assert.notEqual(result.questionId, "root");
});

test("問題順が変わっても同じ契約で同じ候補を返す", function () {
  var values = family(5);
  var forward = select(values, values[0]);
  var reverse = select(values.slice().reverse(), values[0]);
  assert.equal(forward.questionId, reverse.questionId);
});

test("5問から10問へ増やしても既存問題を変更せず選べる", function () {
  var five = family(5);
  var snapshot = structuredClone(five);
  var ten = five.concat(family(10).slice(5));
  var result = select(ten, five[0], { targetReasoningLevel: 5 });
  assert.deepEqual(five, snapshot);
  assert.ok(result.question);
  assert.notEqual(result.questionId, "root");
});

test("欠損knowledgeKeyを安全に除外", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var invalid = question("invalid", "knowledge-a", "condition", 3, {
    knowledgeKey: ""
  });
  var unrelated = question("unrelated", "knowledge-b", "case", 3);
  var result = select([root, invalid, unrelated], root);
  assert.equal(result.question, null);
  assert.equal(result.details.invalidQuestionCount, 1);
});

test("不正なvariantTypeでも処理停止せず安全な候補を選ぶ", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var invalid = question("invalid", "knowledge-a", "not-a-type", 3, {
    variantOfQuestionIds: ["root"]
  });
  var valid = question("valid", "knowledge-a", "condition", 3);
  var result = select([root, invalid, valid], root);
  assert.equal(result.questionId, "valid");
  assert.equal(result.details.invalidQuestionCount, 1);
});

test("reviewTriggerが不正なら安全にnullを返す", function () {
  var values = family(2);
  var result = SELECTOR.selectKnowledgeReviewVariant({
    questions: values,
    reviewTrigger: { questionId: "root", knowledgeKey: "knowledge-a" },
    allowedStageIds: [1]
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_trigger");
});

test("understoodだけでは補習を開始しない", function () {
  var values = family(2);
  var result = select(values, values[0], {
    reviewTrigger: trigger(values[0], "understood", "understood")
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_trigger");
});

test("manualWeak中の理解正解は明示理由があれば補習対象になる", function () {
  var values = family(2);
  var result = select(values, values[0], {
    reviewTrigger: trigger(values[0], "understood", "manualWeak")
  });
  assert.equal(result.questionId, "variant-1");
  assert.equal(result.triggerQuestionId, "root");
});

test("fluctuationReason欠損は安全にnullを返す", function () {
  var values = family(2);
  var invalidTrigger = trigger(values[0]);
  delete invalidTrigger.fluctuationReason;
  var result = select(values, values[0], { reviewTrigger: invalidTrigger });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_trigger");
});

test("不正なfluctuationReasonは安全にnullを返す", function () {
  var values = family(2);
  var result = select(values, values[0], {
    reviewTrigger: trigger(values[0], "incorrect", "stable")
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_trigger");
});

test("目標Level 2では直接Level 5より範囲内の兄弟Level 2を優先する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var directHigh = question("direct-high", "knowledge-a", "case", 5, {
    variantOfQuestionIds: ["root"]
  });
  var siblingNear = question("sibling-near", "knowledge-a", "comparison", 2);
  var result = select([root, directHigh, siblingNear], root, {
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "sibling-near");
});

test("許容範囲に候補がない場合だけ最も近いLevelへ拡張する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelFour = question("level-four", "knowledge-a", "condition", 4);
  var levelFive = question("level-five", "knowledge-a", "case", 5, {
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, levelFive, levelFour], root, {
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "level-four");
  assert.equal(result.reasoningLevel, 4);
});

test("recentQuestionIdsは最後の出現を保持して通常学習の直近論点を判定する", function () {
  var first = question("first", "knowledge-a", "rephrase", 1);
  var middle = question("middle", "knowledge-b", "condition", 1);
  var sameKey = question("same-key", "knowledge-a", "comparison", 1);
  var other = question("other", "knowledge-c", "case", 1);
  var result = SELECTOR.selectNormalLearningQuestion({
    questions: [first, middle, sameKey, other],
    recentQuestionIds: ["first", "middle", "first"],
    allowedStageIds: [1],
    targetReasoningLevel: 1
  });
  assert.deepEqual(result.details.recentKnowledgeTrail, ["knowledge-b", "knowledge-a"]);
  assert.equal(result.questionId, "other");
});

test("recentQuestionIdsは末尾20件だけを除外に使う", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var stale = question("stale", "knowledge-a", "condition", 2);
  var recentIds = ["stale"];
  var index;
  for (index = 1; index <= 20; index += 1) {
    recentIds.push("recent-" + index);
  }
  var result = select([root, stale], root, { recentQuestionIds: recentIds });
  assert.equal(result.questionId, "stale");
});

test("補習元StageがallowedStageIds外ならnullを返す", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var candidate = question("candidate", "knowledge-a", "condition", 2, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, candidate], root, { allowedStageIds: [2] });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "trigger_stage_not_allowed");
});

test("許可Stageが複数でも補習候補は補習元と同じStageに限定する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var sameStage = question("same-stage", "knowledge-a", "comparison", 2);
  var laterStage = question("later-stage", "knowledge-a", "condition", 2, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, sameStage, laterStage], root, {
    allowedStageIds: [1, 2],
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "same-stage");
  assert.equal(result.question.stage, 1);
});

test("補習元と明示された現在問題のequivalenceKeyをどちらも除外する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1, {
    equivalenceKey: "trigger-equivalence"
  });
  var current = question("current", "other-key", "case", 2, {
    equivalenceKey: "current-equivalence"
  });
  var triggerEquivalent = question("trigger-equivalent", "knowledge-a", "condition", 2, {
    equivalenceKey: "trigger-equivalence"
  });
  var currentEquivalent = question("current-equivalent", "knowledge-a", "comparison", 2, {
    equivalenceKey: "current-equivalence"
  });
  var distinct = question("distinct", "knowledge-a", "exception", 2, {
    equivalenceKey: "distinct-equivalence"
  });
  var result = select(
    [root, current, triggerEquivalent, currentEquivalent, distinct],
    root,
    { currentQuestionId: "current", targetReasoningLevel: 2 }
  );
  assert.equal(result.questionId, "distinct");
});

test("重複IDがある問題配列は順序に関係なく安全にnullを返す", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var duplicateLow = question("duplicate", "knowledge-a", "condition", 2);
  var duplicateHigh = question("duplicate", "knowledge-a", "case", 5, {
    variantOfQuestionIds: ["root"]
  });
  var forward = select([root, duplicateLow, duplicateHigh], root);
  var reverse = select([root, duplicateHigh, duplicateLow], root);
  assert.equal(forward.question, null);
  assert.equal(reverse.question, null);
  assert.equal(forward.selectionReason, "duplicate_question_ids");
  assert.equal(reverse.selectionReason, "duplicate_question_ids");
  assert.deepEqual(forward.details.duplicateIds, ["duplicate"]);
  assert.deepEqual(reverse.details.duplicateIds, ["duplicate"]);
});

test("同点候補はUnicodeコードポイント順で安定して決まる", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var latin = question("A", "knowledge-a", "condition", 2);
  var japanese = question("あ", "knowledge-a", "comparison", 2);
  var forward = select([root, japanese, latin], root, { targetReasoningLevel: 2 });
  var reverse = select([root, latin, japanese], root, { targetReasoningLevel: 2 });
  assert.equal(forward.questionId, "A");
  assert.equal(reverse.questionId, "A");
});

test("戻り値questionを変更しても入力questionsは変わらない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var candidate = question("candidate", "knowledge-a", "condition", 2, {
    variantOfQuestionIds: ["root"],
    choices: [{ id: "A", text: "変更前" }],
    source: { title: "変更前" }
  });
  var values = [root, candidate];
  var result = select(values, root, { targetReasoningLevel: 2 });
  result.question.variantOfQuestionIds.push("added");
  result.question.choices[0].text = "変更後";
  result.question.source.title = "変更後";
  assert.deepEqual(values[1].variantOfQuestionIds, ["root"]);
  assert.equal(values[1].choices[0].text, "変更前");
  assert.equal(values[1].source.title, "変更前");
});

test("Level 2でLevel 5しかない場合は最大許容距離を超えるためnull", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelFive = question("level-five", "knowledge-a", "case", 5, {
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, levelFive], root, { targetReasoningLevel: 2 });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "no_verified_variant");
  assert.equal(result.details.maxReasoningDistance, 2);
});

test("Level 2でLevel 4は最大距離2なら選択できる", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelFour = question("level-four", "knowledge-a", "condition", 4);
  var result = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: 2
  });
  assert.equal(result.questionId, "level-four");
});

test("最大距離1ではLevel 2からLevel 4へ拡張しない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelFour = question("level-four", "knowledge-a", "condition", 4);
  var result = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: 1
  });
  assert.equal(result.question, null);
});

test("最大距離0では目標Levelと同じ候補だけを選ぶ", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelTwo = question("level-two", "knowledge-a", "condition", 2);
  var levelThree = question("level-three", "knowledge-a", "comparison", 3, {
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, levelThree, levelTwo], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: 0
  });
  assert.equal(result.questionId, "level-two");
});

test("maxReasoningDistanceの負数、NaN、null、空文字は既定値2へ正規化する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var levelFour = question("level-four", "knowledge-a", "condition", 4);
  var negative = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: -1
  });
  var nan = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: Number.NaN
  });
  var nil = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: null
  });
  var blank = select([root, levelFour], root, {
    targetReasoningLevel: 2,
    maxReasoningDistance: ""
  });
  assert.equal(negative.questionId, "level-four");
  assert.equal(nan.questionId, "level-four");
  assert.equal(nil.questionId, "level-four");
  assert.equal(blank.questionId, "level-four");
  assert.equal(negative.details.maxReasoningDistance, 2);
  assert.equal(nan.details.maxReasoningDistance, 2);
  assert.equal(nil.details.maxReasoningDistance, 2);
  assert.equal(blank.details.maxReasoningDistance, 2);
});

test("±1候補があれば遠い直接派生を優先しない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var directFar = question("direct-far", "knowledge-a", "case", 4, {
    variantOfQuestionIds: ["root"]
  });
  var siblingNear = question("sibling-near", "knowledge-a", "comparison", 2);
  var result = select([root, directFar, siblingNear], root, {
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "sibling-near");
});

test("戻り値の入れ子metadataを変更しても入力問題は変わらない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var candidate = question("candidate", "knowledge-a", "condition", 2, {
    variantOfQuestionIds: ["root"],
    metadata: {
      audit: { verified: true },
      tags: ["before"]
    }
  });
  var values = [root, candidate];
  var result = select(values, root, { targetReasoningLevel: 2 });
  result.question.metadata.audit.verified = false;
  result.question.metadata.tags.push("after");
  result.question.variantOfQuestionIds.push("added");
  assert.equal(values[1].metadata.audit.verified, true);
  assert.deepEqual(values[1].metadata.tags, ["before"]);
  assert.deepEqual(values[1].variantOfQuestionIds, ["root"]);
});

test("reviewStagePolicy sameは同一Stageだけを候補にする", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var sameStage = question("same-stage", "knowledge-a", "comparison", 2);
  var laterStage = question("later-stage", "knowledge-a", "condition", 2, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, sameStage, laterStage], root, {
    reviewStagePolicy: "same",
    allowedStageIds: [1, 2],
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "same-stage");
});

test("reviewStagePolicy sameで補習元Stageが許可外ならnull", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var candidate = question("candidate", "knowledge-a", "condition", 2, { stage: 2 });
  var result = select([root, candidate], root, {
    reviewStagePolicy: "same",
    allowedStageIds: [2]
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "trigger_stage_not_allowed");
});

test("reviewStagePolicy allowedならStage 1から解放済みStage 2候補を選べる", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var stageTwo = question("stage-two", "knowledge-a", "condition", 2, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, stageTwo], root, {
    reviewStagePolicy: "allowed",
    allowedStageIds: [1, 2],
    targetReasoningLevel: 2
  });
  assert.equal(result.questionId, "stage-two");
});

test("reviewStagePolicy allowedで解放Stage一覧がなければ安全にnullを返す", function () {
  var values = family(2);
  var result = select(values, values[0], {
    reviewStagePolicy: "allowed",
    allowedStageIds: []
  });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "missing_allowed_stages");
});

test("reviewStagePolicy allowedならStage 2から解放済みStage 3候補を選べる", function () {
  var root = question("root", "knowledge-a", "condition", 2, { stage: 2 });
  var stageThree = question("stage-three", "knowledge-a", "case", 3, {
    stage: 3,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, stageThree], root, {
    reviewStagePolicy: "allowed",
    allowedStageIds: [2, 3],
    targetReasoningLevel: 3
  });
  assert.equal(result.questionId, "stage-three");
});

test("reviewStagePolicy allowedでも未解放Stageは除外する", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var stageThree = question("stage-three", "knowledge-a", "condition", 2, {
    stage: 3,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, stageThree], root, {
    reviewStagePolicy: "allowed",
    allowedStageIds: [1, 2],
    targetReasoningLevel: 2
  });
  assert.equal(result.question, null);
});

test("reviewStagePolicy allowedでも別knowledgeKeyは補習候補にしない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var unrelated = question("unrelated", "knowledge-b", "condition", 2, {
    stage: 2,
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, unrelated], root, {
    reviewStagePolicy: "allowed",
    allowedStageIds: [1, 2],
    targetReasoningLevel: 2
  });
  assert.equal(result.question, null);
});

test("不正なreviewStagePolicyは安全にnullを返す", function () {
  var values = family(2);
  var result = select(values, values[0], { reviewStagePolicy: "all" });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_stage_policy");
});

test("存在しないcurrentQuestionIdが明示された場合は安全にnullを返す", function () {
  var values = family(2);
  var result = select(values, values[0], { currentQuestionId: "missing" });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "current_question_missing");
});

test("currentQuestionId未指定時はreviewTrigger.questionIdを現在問題として使う", function () {
  var values = family(2);
  var result = select(values, values[0]);
  assert.equal(result.questionId, "variant-1");
  assert.notEqual(result.questionId, "root");
});

test("incorrect、unsure、guess、ambiguousはそれぞれ補習トリガーとして有効", function () {
  var values = family(2);
  ["incorrect", "unsure", "guess", "ambiguous"].forEach(function (outcome) {
    var result = select(values, values[0], {
      reviewTrigger: trigger(values[0], outcome, outcome)
    });
    assert.equal(result.questionId, "variant-1", outcome);
  });
});

test("understood + manualWeakだけがmanualWeak補習トリガーとして有効", function () {
  var values = family(2);
  var valid = select(values, values[0], {
    reviewTrigger: trigger(values[0], "understood", "manualWeak")
  });
  var invalid = select(values, values[0], {
    reviewTrigger: trigger(values[0], "understood", "incorrect")
  });
  assert.equal(valid.questionId, "variant-1");
  assert.equal(invalid.question, null);
  assert.equal(invalid.selectionReason, "invalid_review_trigger");
});

test("同じknowledgeKeyに確認済み派生がなければblocked_no_verified_variantを明示する", function () {
  var only = family(1)[0];
  var result = select([only], only);
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "no_verified_variant");
  assert.equal(result.reviewAvailability, "blocked_no_verified_variant");
});

test("派生はあるが直近除外ならno_eligible_variantを明示する", function () {
  var values = family(2);
  var result = select(values, values[0], { recentQuestionIds: ["variant-1"] });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "no_verified_variant");
  assert.equal(result.reviewAvailability, "no_eligible_variant");
});

test("retry_unresolved_variantは回答済み・直近の確認済み派生を再挑戦候補にできる", function () {
  var values = family(2);
  var result = select(values, values[0], {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["variant-1"],
    verifiedVariantQuestionIds: ["variant-1"],
    currentQuestionId: "variant-1",
    currentSession: {
      queue: ["root", "variant-1"],
      index: 1,
      recorded: true,
      answerRecords: [{ questionId: "root" }, { questionId: "variant-1" }]
    },
    recentQuestionIds: ["variant-1"]
  });
  assert.equal(result.questionId, "variant-1");
  assert.equal(result.selectionMode, "retry_unresolved_variant");
  assert.equal(result.reviewAvailability, "eligible");
});

test("retry_unresolved_variantは対象IDなしでは安全に停止する", function () {
  var values = family(2);
  var result = select(values, values[0], { selectionMode: "retry_unresolved_variant" });
  assert.equal(result.question, null);
  assert.equal(result.selectionReason, "invalid_review_selection_mode");
});

test("retry_unresolved_variantは確認済みでないIDを再挑戦候補にしない", function () {
  var values = family(3);
  var result = select(values, values[0], {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["variant-1"],
    verifiedVariantQuestionIds: ["variant-2"]
  });
  assert.equal(result.question, null);
  assert.equal(result.reviewAvailability, "no_eligible_variant");
});

test("retry_unresolved_variantでも元問題と同値の派生は選ばない", function () {
  var root = question("root", "knowledge-a", "rephrase", 2, {
    equivalenceKey: "same-meaning"
  });
  var equivalent = question("equivalent", "knowledge-a", "condition", 2, {
    equivalenceKey: "same-meaning",
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, equivalent], root, {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["equivalent"],
    verifiedVariantQuestionIds: ["equivalent"],
    currentQuestionId: "equivalent"
  });
  assert.equal(result.question, null);
  assert.equal(result.reviewAvailability, "no_eligible_variant");
});

test("selector結果のselectionProofはJSON往復後も問題メタデータと照合できる", function () {
  var values = family(2);
  var result = select(values, values[0], { targetReasoningLevel: 2 });
  var proof = JSON.parse(JSON.stringify(result.selectionProof));

  assert.ok(proof);
  assert.equal(SELECTOR.verifySelectionProof({
    proof: proof,
    question: values[1],
    knowledgeKey: values[0].knowledgeKey,
    sourceQuestionId: values[0].id,
    selectionReason: result.selectionReason,
    selectionMode: result.selectionMode,
    selectedAt: proof.selectedAt
  }), true);
  proof.reasoningLevel = 5;
  assert.equal(SELECTOR.verifySelectionProof({
    proof: proof,
    question: values[1],
    knowledgeKey: values[0].knowledgeKey,
    sourceQuestionId: values[0].id,
    selectionReason: result.selectionReason,
    selectionMode: result.selectionMode,
    selectedAt: proof.selectedAt
  }), false);
});

test("retryでも明示されたequivalenceKey除外は解除しない", function () {
  var root = question("root", "knowledge-a", "rephrase", 1);
  var protectedVariant = question("protected", "knowledge-a", "condition", 2, {
    equivalenceKey: "must-stay-excluded",
    variantOfQuestionIds: ["root"]
  });
  var result = select([root, protectedVariant], root, {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["protected"],
    verifiedVariantQuestionIds: ["protected"],
    currentQuestionId: "protected",
    recentQuestionIds: ["protected"],
    excludedEquivalenceKeys: ["must-stay-excluded"]
  });

  assert.equal(result.question, null);
  assert.equal(result.reviewAvailability, "no_eligible_variant");
});

test("createSelectionProofは外部公開APIに含めない", function () {
  assert.equal(Object.prototype.hasOwnProperty.call(SELECTOR, "createSelectionProof"), false);
  assert.equal(typeof SELECTOR.createSelectionProof, "undefined");
});

test("retryは現在の再挑戦対象だけ弱い除外を解除する", function () {
  var values = family(3);
  var result = select(values, values[0], {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["variant-1"],
    verifiedVariantQuestionIds: ["variant-1"],
    currentQuestionId: "variant-1",
    currentSession: {
      answerRecords: [{ questionId: "variant-1" }, { questionId: "variant-2" }]
    },
    recentQuestionIds: ["variant-1", "variant-2"],
    fixedQueueQuestionIds: ["variant-1", "variant-2"]
  });

  assert.equal(result.questionId, "variant-1");
});

test("retry対象以外の派生は弱い除外が残る", function () {
  var values = family(3);
  var result = select(values, values[0], {
    selectionMode: "retry_unresolved_variant",
    retryVariantQuestionIds: ["variant-2"],
    verifiedVariantQuestionIds: ["variant-2"],
    currentQuestionId: "variant-1",
    recentQuestionIds: ["variant-2"]
  });

  assert.equal(result.question, null);
  assert.equal(result.reviewAvailability, "no_eligible_variant");
});
