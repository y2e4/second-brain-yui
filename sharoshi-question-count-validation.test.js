"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var HTML = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
var DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sharoshi-intro-questions.json"), "utf8")
);

function buildValidator() {
  var start = HTML.indexOf("      function validateData(data) {");
  var end = HTML.indexOf("\n\n      setupDebugVisibility();", start);
  assert.notEqual(start, -1, "validateData start");
  assert.notEqual(end, -1, "validateData end");

  var context = {
    data: DATA
  };
  vm.createContext(context);
  vm.runInContext([
    "var STAGE_FIVE_FULL_LIMIT = 70;",
    "var STAGE_ONE_ID = 1;",
    "var STAGE_TWO_ID = 2;",
    "var STAGE_THREE_ID = 3;",
    "var STAGE_FOUR_ID = 4;",
    "var STAGE_FIVE_ID = 5;",
    "var STAGE_TOTAL = 5;",
    "var DEFAULT_CHOICE_IDS = ['a', 'b', 'c', 'd', 'e'];",
    "function validateAdaptiveDifficultyData() {}",
    "function getChoiceId(choice, index) {",
    "  return choice && typeof choice === 'object' && choice.id",
    "    ? String(choice.id)",
    "    : (DEFAULT_CHOICE_IDS[index] || String(index));",
    "}",
    "function getChoiceText(choice) {",
    "  return choice && typeof choice === 'object' &&",
    "    Object.prototype.hasOwnProperty.call(choice, 'text')",
    "    ? String(choice.text)",
    "    : String(choice);",
    "}",
    HTML.slice(start, end),
    "this.runValidation = function () {",
    "  validateData(data);",
    "  return STAGE_FIVE_FULL_LIMIT;",
    "};"
  ].join("\n"), context);
  return context;
}

test("174問をStage定義と照合して正常に読み込む", function () {
  var context = buildValidator();
  assert.equal(DATA.questions.length, 174);
  assert.equal(context.runValidation(), 72);
});

test("既存の70問Stage 5フォールバックも同じ検証で維持する", function () {
  var fallbackData = JSON.parse(JSON.stringify(DATA));
  fallbackData.questions = fallbackData.questions.filter(function (question) {
    return question.id !== "stage5-question-071" && question.id !== "stage5-question-072";
  });
  fallbackData.stages.find(function (stage) {
    return stage.id === 5;
  }).questionCount = 70;

  var context = buildValidator();
  context.data = fallbackData;
  assert.equal(context.runValidation(), 70);
});

test("問題総数は固定値ではなくStage定義の合計と照合する", function () {
  assert.doesNotMatch(HTML, /data\.questions\.length\s*!==\s*172/);
  assert.doesNotMatch(HTML, /問題172件/);
  assert.match(HTML, /data\.questions\.length !== declaredQuestionCount/);
  assert.match(HTML, /STAGE_FIVE_FULL_LIMIT \+ "問通し演習"/);
  assert.match(HTML, /stageFullChallengeButton\.textContent\s*=\s*\n\s*"ステージ5 " \+ STAGE_FIVE_FULL_LIMIT/);
});

test("Stage定義と実問題数がずれた場合は安全停止する", function () {
  var changedData = JSON.parse(JSON.stringify(DATA));
  changedData.questions.pop();
  var context = buildValidator();
  context.data = changedData;
  assert.throws(function () {
    context.runValidation();
  }, /questionCount合計/);
});
