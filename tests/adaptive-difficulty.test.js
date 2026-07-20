"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const commonSource = fs.readFileSync(path.join(root, "qualification-os-common.js"), "utf8");
const html = fs.readFileSync(path.join(root, "sharoshi-intro.html"), "utf8");
const data = JSON.parse(fs.readFileSync(path.join(root, "sharoshi-intro-questions.json"), "utf8"));
const context = { window: {} };

vm.createContext(context);
vm.runInContext(commonSource, context);

const common = context.window.QualificationOSCommon;
const catalog = data.adaptiveDifficultyCatalog;
const questionById = Object.fromEntries(
  data.questions.concat(data.adaptiveReasoningQuestions || [])
    .map((question) => [question.id, question])
);

function understood(questionId, level) {
  return {
    questionId,
    correct: true,
    understanding: "understood",
    unsure: false,
    guessed: false,
    ambiguous: false,
    weak: false,
    reasoningLevel: level
  };
}

function buildSet(prefix, level) {
  return [1, 2, 3].map((index) => understood(`${prefix}-${index}`, level));
}

let state = common.normalizeAdaptiveDifficulty({
  version: 2,
  reasoningLevel: 3,
  perfectSetStreak: 0
});

let first = common.recordAdaptiveDifficultySet(state, {
  mode: "daily",
  stageLevel: 5,
  answers: buildSet("first", 3),
  completedAt: "2026-07-19T10:00:00+09:00"
});
assert.equal(first.result.perfect, true);
assert.equal(first.result.changed, false);
assert.equal(first.state.reasoningLevel, 3);
assert.equal(first.state.perfectSetStreak, 1);

let second = common.recordAdaptiveDifficultySet(first.state, {
  mode: "daily",
  stageLevel: 5,
  answers: buildSet("second", 3),
  completedAt: "2026-07-19T10:10:00+09:00"
});
assert.equal(second.result.perfect, true);
assert.equal(second.result.changed, true);
assert.equal(second.state.reasoningLevel, 4);
assert.equal(second.state.perfectSetStreak, 0);
assert.equal(second.state.lastIncreasedAt, "2026-07-19T10:10:00+09:00");

const wrongAnswers = buildSet("wrong", 4);
wrongAnswers[1].correct = false;
wrongAnswers[1].understanding = "incorrect";
let wrong = common.recordAdaptiveDifficultySet({
  version: 2,
  reasoningLevel: 4,
  perfectSetStreak: 1
}, {
  mode: "daily",
  stageLevel: 5,
  answers: wrongAnswers
});
assert.equal(wrong.result.perfect, false);
assert.equal(wrong.state.reasoningLevel, 4);
assert.equal(wrong.state.perfectSetStreak, 0);
assert.ok(wrong.result.reasons.includes("不正解がありました"));

const unsureAnswers = buildSet("unsure", 4);
unsureAnswers[2].understanding = "unsure";
unsureAnswers[2].unsure = true;
let unsure = common.recordAdaptiveDifficultySet({
  version: 2,
  reasoningLevel: 4,
  perfectSetStreak: 1
}, {
  mode: "daily",
  stageLevel: 5,
  answers: unsureAnswers
});
assert.equal(unsure.result.perfect, false);
assert.equal(unsure.state.reasoningLevel, 4);
assert.equal(unsure.state.perfectSetStreak, 0);
assert.ok(unsure.result.reasons.includes("迷って正解がありました"));

const reloaded = common.normalizeAdaptiveDifficulty(JSON.parse(JSON.stringify(second.state)));
assert.equal(reloaded.reasoningLevel, 4);
assert.equal(reloaded.perfectSetStreak, 0);
assert.equal(reloaded.lastIncreasedAt, second.state.lastIncreasedAt);

const allCatalogIds = Object.values(catalog.levels).flat().map((entry) => entry.questionId);
assert.equal(new Set(allCatalogIds).size, allCatalogIds.length);
Object.values(catalog.levels).forEach((entries) => assert.equal(entries.length, 6));

const adaptivePool = Object.entries(catalog.levels).flatMap(([level, entries]) =>
  entries.map((entry, index) => {
    const source = questionById[entry.questionId];
    const thinkingLevel = entry.thinkingLevel || source.thinkingLevel ||
      (Number(level) === 1 ? "recall" : Number(level) === 2 ? "comparison" : "");
    return {
      ...source,
      adaptiveReasoningLevel: Number(level),
      reasoningProfile: entry.reasoningProfile,
      thinkingLevel,
      questionType: entry.questionType || source.questionType ||
        (Array.isArray(source.choices) ? "multiple_choice" : "true_false"),
      selectionBucket: entry.selectionBucket || source.selectionBucket || thinkingLevel,
      requiredConditions: entry.requiredConditions || source.requiredConditions,
      estimatedReasoningSteps: entry.estimatedReasoningSteps ||
        source.estimatedReasoningSteps,
      equivalenceKey: entry.equivalenceKey,
      adaptiveOrder: `${level}-${String(index + 1).padStart(2, "0")}`
    };
  })
);

const level3First = common.selectAdaptiveReasoningQuestions(adaptivePool, {
  reasoningLevel: 3,
  count: 3,
  seenQuestionIds: []
});
assert.equal(level3First.shortage, null);
assert.ok(level3First.questions.every((question) => question.adaptiveReasoningLevel === 3));

const level3Second = common.selectAdaptiveReasoningQuestions(adaptivePool, {
  reasoningLevel: 3,
  count: 3,
  recentQuestionIds: level3First.questions.map((question) => question.id),
  recentEquivalenceKeys: level3First.questions.map((question) => question.equivalenceKey)
});
assert.equal(level3Second.shortage, null);
assert.equal(
  level3Second.questions.filter((question) =>
    level3First.questions.some((previous) => previous.id === question.id)
  ).length,
  0
);

const level4 = common.selectAdaptiveReasoningQuestions(adaptivePool, {
  reasoningLevel: second.state.reasoningLevel,
  count: 3
});
assert.ok(level4.questions.every((question) => question.adaptiveReasoningLevel === 4));
assert.deepEqual(
  Array.from(level4.questions, (question) => question.selectionBucket),
  ["multi_condition", "case_judgment", "composite_judgment"]
);
assert.ok(level4.questions.every((question) =>
  question.choices.length === 4 &&
  question.requiredConditions.length >= 3 &&
  question.estimatedReasoningSteps >= 3
));

const level2 = common.selectAdaptiveReasoningQuestions(adaptivePool, {
  reasoningLevel: 2,
  count: 3
});
assert.deepEqual(
  Array.from(level2.questions, (question) => question.selectionBucket),
  ["recall", "comparison", "comparison"]
);
assert.ok(level2.questions.every((question) =>
  !question.thinkingLevel || ["recall", "comparison"].includes(question.thinkingLevel)
));
assert.ok(level2.questions.every((question) =>
  !question.adaptiveSelectionReason.includes("判断条件0件")
));
assert.ok(level4.questions.every((question) =>
  question.thinkingLevel !== "recall" &&
  question.questionType !== "true_false"
));

const level5 = common.selectAdaptiveReasoningQuestions(adaptivePool, {
  reasoningLevel: 5,
  count: 3
});
assert.deepEqual(
  Array.from(level5.questions, (question) => question.selectionBucket),
  ["case_judgment", "composite_judgment", "explanation"]
);
assert.ok(level5.questions.every((question) =>
  question.requiredConditions.length >= 3 &&
  question.adaptiveSelectionReason.includes("必要な判断条件")
));

function average(level, key) {
  const entries = catalog.levels[String(level)];
  return entries.reduce((sum, entry) => sum + Number(entry.reasoningProfile[key] || 0), 0) /
    entries.length;
}

["conditionCount", "comparisonCount", "judgmentSteps"].forEach((metric) => {
  assert.ok(average(4, metric) > average(3, metric), `${metric} must increase from 3 to 4`);
});

assert.ok(html.includes('var STORAGE_KEY = "sharoshiIntroProgressV1";'));
assert.ok(html.includes('understanding: isCorrect ? "understood" : "incorrect"'));
assert.ok(html.includes("理解して正解として記録しました"));
assert.ok(html.includes('new URLSearchParams(window.location.search).get("debug") === "1"'));
assert.ok(html.includes('id="resultAdaptiveSummary"'));
assert.ok(!html.includes("undefined："));

console.log("adaptive difficulty tests: 9 scenarios passed");
