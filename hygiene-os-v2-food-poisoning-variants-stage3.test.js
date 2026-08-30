"use strict";

var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");
var SHUFFLE = require("./hygiene-os-v2-choice-shuffle.js");

var DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var HTML = fs.readFileSync(path.join(__dirname, "hygiene-os-v2.html"), "utf8");
var CORE_QUESTIONS = DATA.questions || [];
var STAGE5_QUESTIONS = DATA.stage5 && Array.isArray(DATA.stage5.questions)
  ? DATA.stage5.questions
  : [];
var QUESTIONS = CORE_QUESTIONS.concat(STAGE5_QUESTIONS);
var QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map(function (question) {
  return [question.id, question];
}));
var KNOWLEDGE_KEY = "food-poisoning-infection-vs-preformed-toxin-type";
var SOURCE_ID = "hm2-stage5-013";
var CASE_ID = "hm2-hygiene-v03-01";
var CONDITION_ID = "hm2-hygiene-v03-02";
var OTHER_FOOD_POISONING_IDS = [
  "hm2-hygiene-v01-02",
  "hm2-hygiene-v02-06",
  "hm2-hygiene-v02-07"
];

function sha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function beforeStage3Data(value) {
  var copy = JSON.parse(JSON.stringify(value));
  var source;

  copy.newQuestionCount = 30;
  copy.verifiedShortageCount = 39;
  copy.stages.find(function (stage) { return stage.id === 4; }).questionCount = 18;
  copy.questions = copy.questions.filter(function (question) {
    return question.id !== CASE_ID && question.id !== CONDITION_ID;
  });
  source = copy.stage5.questions.find(function (question) {
    return question.id === SOURCE_ID;
  });
  delete source.knowledgeKey;
  delete source.variantType;
  return copy;
}

function selectRelated(sourceId, allowedStageIds) {
  return SELECTOR.selectRelatedSupplementQuestions({
    questions: QUESTIONS,
    sourceQuestionId: sourceId,
    outcome: "incorrect",
    manualWeak: false,
    allowedStageIds: allowedStageIds || [1, 2, 3, 4, 5],
    excludedQuestionIds: [],
    limit: 2
  });
}

test("既存111問は変更せず、Stage 4の食中毒variantを2問だけ追加する", function () {
  assert.equal(CORE_QUESTIONS.length, 83);
  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.equal(QUESTIONS.length, 113);
  assert.equal(new Set(QUESTIONS.map(function (question) {
    return question.id;
  })).size, 113);
  assert.equal(
    sha256(beforeStage3Data(DATA)),
    "117c0cd2313b199d0d47f248725314fed7304495454686414d2070ebab89feb8"
  );
  assert.equal(DATA.newQuestionCount, 32);
  assert.equal(DATA.verifiedShortageCount, 37);
  assert.deepEqual(DATA.stages.map(function (stage) {
    return stage.questionCount;
  }), [30, 19, 14, 20, 30]);
});

test("感染型と食物内毒素型の核知識は比較・事例・条件の3問だけで共有する", function () {
  var group = QUESTIONS.filter(function (question) {
    return question.knowledgeKey === KNOWLEDGE_KEY;
  });

  assert.deepEqual(group.map(function (question) {
    return question.id;
  }).sort(), [CASE_ID, CONDITION_ID, SOURCE_ID].sort());
  assert.equal(QUESTION_BY_ID[SOURCE_ID].variantType, "comparison");
  assert.equal(QUESTION_BY_ID[CASE_ID].variantType, "case");
  assert.equal(QUESTION_BY_ID[CONDITION_ID].variantType, "condition");
  assert.deepEqual(QUESTION_BY_ID[CASE_ID].variantOfQuestionIds, [SOURCE_ID]);
  assert.deepEqual(QUESTION_BY_ID[CONDITION_ID].variantOfQuestionIds, [SOURCE_ID, CASE_ID]);
  assert.notEqual(QUESTION_BY_ID[SOURCE_ID].question, QUESTION_BY_ID[CASE_ID].question);
  assert.notEqual(QUESTION_BY_ID[CASE_ID].question, QUESTION_BY_ID[CONDITION_ID].question);
});

test("カンピロバクターと黄色ブドウ球菌を判断軸に沿って正確に区別する", function () {
  var source = QUESTION_BY_ID[SOURCE_ID];
  var caseQuestion = QUESTION_BY_ID[CASE_ID];

  assert.equal(source.correctIndex, 4);
  assert.match(source.explanation, /カンピロバクターは感染型/);
  assert.match(caseQuestion.question, /加熱不十分な鶏肉/);
  assert.match(caseQuestion.question, /黄色ブドウ球菌.*エンテロトキシン/);
  assert.equal(caseQuestion.answer, true);
  assert.equal(caseQuestion.choices[0].id, "O");
  assert.match(caseQuestion.choices[0].text, /Aは感染型、Bは食物内毒素型/);
  assert.match(caseQuestion.explanation, /食品中であらかじめ産生された/);
  assert.match(caseQuestion.sourceTitle, /厚生労働省/);
  assert.match(caseQuestion.sourceUrl, /^https:\/\/www\.mhlw\.go\.jp\//);
});

test("黄色ブドウ球菌の菌と産生済みエンテロトキシンの加熱条件を区別する", function () {
  var conditionQuestion = QUESTION_BY_ID[CONDITION_ID];

  assert.equal(conditionQuestion.answer, false);
  assert.match(conditionQuestion.question, /菌そのものを死滅/);
  assert.match(conditionQuestion.question, /すでに産生されていたエンテロトキシン/);
  assert.match(conditionQuestion.explanation, /部分が誤り/);
  assert.match(conditionQuestion.explanation, /黄色ブドウ球菌自体は熱に強くありません/);
  assert.match(conditionQuestion.explanation, /通常の加熱調理では無毒化できません/);
  assert.match(conditionQuestion.explanation, /混同しない/);
  assert.match(conditionQuestion.sourceTitle, /農林水産省/);
  assert.match(conditionQuestion.sourceUrl, /^https:\/\/www\.maff\.go\.jp\//);
});

test("ボツリヌス神経毒、ノロ対策、ヒスタミンは別の核知識として接続しない", function () {
  OTHER_FOOD_POISONING_IDS.forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].knowledgeKey, undefined, id);
    assert.equal(QUESTION_BY_ID[id].variantType, undefined, id);
  });
});

test("Stage 5の比較問から別IDの事例問と条件問だけを補習として選ぶ", function () {
  var result = selectRelated(SOURCE_ID);

  assert.equal(result.status, "selected");
  assert.deepEqual(result.questionIds, [CASE_ID, CONDITION_ID]);
  assert.deepEqual(result.selectionReasons, [
    "direct_knowledge_variant",
    "direct_knowledge_variant"
  ]);
  assert.ok(result.questions.every(function (question) {
    return question.knowledgeKey === KNOWLEDGE_KEY;
  }));
  assert.ok(OTHER_FOOD_POISONING_IDS.every(function (id) {
    return result.questionIds.indexOf(id) === -1;
  }));
});

test("事例問から条件問と比較問へ進め、Stage 4内でも条件問へつながる", function () {
  var allowed = selectRelated(CASE_ID);
  var stage4Only = selectRelated(CASE_ID, [1, 2, 3, 4]);

  assert.deepEqual(allowed.questionIds, [CONDITION_ID, SOURCE_ID]);
  assert.deepEqual(allowed.selectionReasons, [
    "direct_knowledge_variant",
    "direct_knowledge_variant"
  ]);
  assert.equal(stage4Only.status, "selected");
  assert.deepEqual(stage4Only.questionIds, [CONDITION_ID]);
  assert.deepEqual(stage4Only.selectionReasons, ["direct_knowledge_variant"]);
});

test("Stage 5通常キューは30問内に留まり、新規Stage 4問はシャッフル対象外", function () {
  var caseQuestion = QUESTION_BY_ID[CASE_ID];
  var conditionQuestion = QUESTION_BY_ID[CONDITION_ID];

  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.ok(STAGE5_QUESTIONS.every(function (question) {
    return question.stage === 5 && question.id !== CASE_ID;
  }));
  assert.equal(SHUFFLE.isShuffleAllowed(caseQuestion), false);
  assert.equal(SHUFFLE.isShuffleAllowed(conditionQuestion), false);
  assert.equal(QUESTION_BY_ID[SOURCE_ID].stage, 5);
});

test("正式reviewContextへ昇格せず、問題JSONだけ新キャッシュ識別子で読む", function () {
  assert.equal(QUESTION_BY_ID[SOURCE_ID].reasoningLevel, undefined);
  assert.equal(QUESTION_BY_ID[CASE_ID].reasoningLevel, undefined);
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260830-staphylococcus-toxin-01/
  );
  assert.match(
    HTML,
    /hygiene-os-v2-knowledge-review-selector\.js\?v=20260823-question-cooldown-01/
  );
  assert.match(
    HTML,
    /hygiene-os-v2-choice-shuffle\.js\?v=20260823-stage5-choice-shuffle-01/
  );
});
