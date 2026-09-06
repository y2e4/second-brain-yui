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
var QUESTION_ID = "stage5-question-072";
var KNOWLEDGE_KEY = "multiple-business-worker-status-causation-benefit-base";
var QUESTION = DATA.questions.find(function (item) {
  return item.id === QUESTION_ID;
});

test("複数事業労働者の3論点を切り分ける事例問題を1問だけ追加する", function () {
  var stage5 = DATA.stages.find(function (stage) { return stage.id === 5; });
  var stage5Questions = DATA.questions.filter(function (question) { return question.stage === 5; });
  var matchingKnowledge = DATA.questions.filter(function (question) {
    return question.knowledgeKey === KNOWLEDGE_KEY;
  });

  assert.equal(DATA.questions.length, 174);
  assert.equal(stage5.questionCount, 72);
  assert.equal(stage5Questions.length, 72);
  assert.ok(QUESTION);
  assert.deepEqual(matchingKnowledge.map(function (question) { return question.id; }), [QUESTION_ID]);
  assert.equal(QUESTION.variantType, "case");
  assert.equal(QUESTION.correctAnswerId, "b");
  assert.equal(new Set(QUESTION.choices.map(function (choice) { return choice.id; })).size, 4);
  assert.ok(QUESTION.choices.some(function (choice) {
    return choice.id === QUESTION.correctAnswerId;
  }));
});

test("資格・災害原因・給付基礎日額を別の判断段階として説明する", function () {
  assert.match(QUESTION.question, /事業主の異なるA社とB社/);
  assert.match(QUESTION.explanation, /資格の話/);
  assert.match(QUESTION.explanation, /災害原因の話/);
  assert.match(QUESTION.explanation, /給付額の話/);
  assert.match(QUESTION.explanation, /2以上の事業に同時に使用/);
  assert.match(QUESTION.explanation, /複数事業場の負荷を総合評価/);
  assert.match(QUESTION.explanation, /給付基礎日額相当額を合算/);
  assert.match(QUESTION.trap, /一括で決めない/);
});

test("近接する既存の業務災害・通勤災害問題を同じ核知識へ誤接続しない", function () {
  [
    "question-016",
    "question-017",
    "stage2-question-014",
    "stage2-question-015",
    "stage5-question-019",
    "stage5-question-020",
    "stage5-question-064"
  ].forEach(function (id) {
    var existing = DATA.questions.find(function (question) { return question.id === id; });
    assert.ok(existing, id);
    assert.notEqual(existing.knowledgeKey, KNOWLEDGE_KEY, id);
  });
});

test("公式資料を根拠にし、新規問題用のJSONキャッシュ識別子を参照する", function () {
  assert.equal(QUESTION.sourceType, "official");
  assert.match(QUESTION.sourceUrl, /^https:\/\/(www\.)?(check-roudou|mhlw)\.mhlw\.go\.jp\//);
  assert.match(
    HTML,
    /sharoshi-intro-questions\.json\?v=20260906-multiple-business-workers-01/
  );
});
