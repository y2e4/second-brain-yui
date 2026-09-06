"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var ROOT = __dirname;
var DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sharoshi-intro-questions.json"), "utf8")
);
var HTML = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
var QUESTION_ID = "stage5-question-071";
var KNOWLEDGE_KEY = "overtime-premium-base-allowance-exclusions";
var QUESTION = DATA.questions.find(function (item) {
  return item.id === QUESTION_ID;
});

test("割増賃金の算定基礎を支給条件から判断する1問だけを追加する", function () {
  var stage5 = DATA.stages.find(function (stage) { return stage.id === 5; });
  var stage5Questions = DATA.questions.filter(function (question) { return question.stage === 5; });
  var matchingKnowledge = DATA.questions.filter(function (question) {
    return question.knowledgeKey === KNOWLEDGE_KEY;
  });

  assert.equal(DATA.questions.length, 173);
  assert.equal(stage5.questionCount, 71);
  assert.equal(stage5Questions.length, 71);
  assert.ok(QUESTION);
  assert.deepEqual(matchingKnowledge.map(function (question) { return question.id; }), [QUESTION_ID]);
  assert.equal(QUESTION.variantType, "condition");
  assert.equal(QUESTION.correctAnswerId, "b");
  assert.equal(new Set(QUESTION.choices.map(function (choice) { return choice.id; })).size, 4);
  assert.ok(QUESTION.choices.some(function (choice) {
    return choice.id === QUESTION.correctAnswerId;
  }));
});

test("手当名ではなく家族数と通勤距離の支給条件を判断軸にする", function () {
  assert.match(QUESTION.question, /扶養家族の有無や人数にかかわらず/);
  assert.match(QUESTION.question, /通勤距離に応じた実費相当額/);
  assert.match(QUESTION.explanation, /名称ではなく、実際の支給条件/);
  assert.match(QUESTION.explanation, /一律に支給する手当は算定基礎に含め/);
  assert.match(QUESTION.explanation, /通勤手当は除外/);
});

test("既存の割増賃金3問を別の核知識へ誤接続しない", function () {
  ["stage4-question-001", "stage5-question-014", "stage5-question-055"].forEach(function (id) {
    var existing = DATA.questions.find(function (question) { return question.id === id; });
    assert.ok(existing, id);
    assert.notEqual(existing.knowledgeKey, KNOWLEDGE_KEY, id);
  });
});

test("社労士画面は追加問題用のJSONキャッシュ識別子を参照する", function () {
  assert.match(
    HTML,
    /sharoshi-intro-questions\.json\?v=20260906-overtime-premium-base-01/
  );
});
