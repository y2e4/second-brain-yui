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
    return question.id !== CASE_ID;
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

test("既存111問は変更せず、Stage 4の事例variantを1問だけ追加する", function () {
  assert.equal(CORE_QUESTIONS.length, 82);
  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.equal(QUESTIONS.length, 112);
  assert.equal(new Set(QUESTIONS.map(function (question) {
    return question.id;
  })).size, 112);
  assert.equal(
    sha256(beforeStage3Data(DATA)),
    "117c0cd2313b199d0d47f248725314fed7304495454686414d2070ebab89feb8"
  );
  assert.equal(DATA.newQuestionCount, 31);
  assert.equal(DATA.verifiedShortageCount, 38);
  assert.deepEqual(DATA.stages.map(function (stage) {
    return stage.questionCount;
  }), [30, 19, 14, 19, 30]);
});

test("感染型と食物内毒素型の核知識は比較問と事例問の2問だけで共有する", function () {
  var group = QUESTIONS.filter(function (question) {
    return question.knowledgeKey === KNOWLEDGE_KEY;
  });

  assert.deepEqual(group.map(function (question) {
    return question.id;
  }).sort(), [CASE_ID, SOURCE_ID].sort());
  assert.equal(QUESTION_BY_ID[SOURCE_ID].variantType, "comparison");
  assert.equal(QUESTION_BY_ID[CASE_ID].variantType, "case");
  assert.deepEqual(QUESTION_BY_ID[CASE_ID].variantOfQuestionIds, [SOURCE_ID]);
  assert.notEqual(QUESTION_BY_ID[SOURCE_ID].question, QUESTION_BY_ID[CASE_ID].question);
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

test("ボツリヌス神経毒、ノロ対策、ヒスタミンは別の核知識として接続しない", function () {
  OTHER_FOOD_POISONING_IDS.forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].knowledgeKey, undefined, id);
    assert.equal(QUESTION_BY_ID[id].variantType, undefined, id);
  });
});

test("Stage 5の比較問から別IDの事例問だけを補習として選ぶ", function () {
  var result = selectRelated(SOURCE_ID);

  assert.equal(result.status, "selected");
  assert.deepEqual(result.questionIds, [CASE_ID]);
  assert.deepEqual(result.selectionReasons, ["direct_knowledge_variant"]);
  assert.equal(result.questions[0].knowledgeKey, KNOWLEDGE_KEY);
  assert.ok(OTHER_FOOD_POISONING_IDS.every(function (id) {
    return result.questionIds.indexOf(id) === -1;
  }));
});

test("事例問からも比較問へ戻れ、未解放Stageや無関係themeへは広がらない", function () {
  var allowed = selectRelated(CASE_ID);
  var stage4Only = selectRelated(CASE_ID, [1, 2, 3, 4]);

  assert.deepEqual(allowed.questionIds, [SOURCE_ID]);
  assert.deepEqual(allowed.selectionReasons, ["direct_knowledge_variant"]);
  assert.equal(stage4Only.status, "no_related_supplement");
  assert.deepEqual(stage4Only.questionIds, []);
  assert.equal(stage4Only.fallback, "continue_normal_learning");
});

test("Stage 5通常キューは30問内に留まり、新規Stage 4問はシャッフル対象外", function () {
  var caseQuestion = QUESTION_BY_ID[CASE_ID];

  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.ok(STAGE5_QUESTIONS.every(function (question) {
    return question.stage === 5 && question.id !== CASE_ID;
  }));
  assert.equal(SHUFFLE.isShuffleAllowed(caseQuestion), false);
  assert.equal(QUESTION_BY_ID[SOURCE_ID].stage, 5);
});

test("正式reviewContextへ昇格せず、問題JSONだけ新キャッシュ識別子で読む", function () {
  assert.equal(QUESTION_BY_ID[SOURCE_ID].reasoningLevel, undefined);
  assert.equal(QUESTION_BY_ID[CASE_ID].reasoningLevel, undefined);
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260823-food-poisoning-variants-03/
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
