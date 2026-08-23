"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SHUFFLE = require("./hygiene-os-v2-choice-shuffle.js");

var ROOT = __dirname;
var DATA = JSON.parse(fs.readFileSync(
  path.join(ROOT, "hygiene-os-v2-questions.json"),
  "utf8"
));
var HTML = fs.readFileSync(path.join(ROOT, "hygiene-os-v2.html"), "utf8");
var STAGE5_QUESTIONS = DATA.stage5.questions;
var AUDIT = {
  A: [
    "hm2-stage5-001", "hm2-stage5-002", "hm2-stage5-003",
    "hm2-stage5-004", "hm2-stage5-005", "hm2-stage5-006",
    "hm2-stage5-007", "hm2-stage5-008", "hm2-stage5-009",
    "hm2-stage5-010", "hm2-stage5-011", "hm2-stage5-012",
    "hm2-stage5-013", "hm2-stage5-014", "hm2-stage5-015",
    "hm2-stage5-016", "hm2-stage5-017", "hm2-stage5-018",
    "hm2-stage5-019", "hm2-stage5-020", "hm2-stage5-021",
    "hm2-stage5-022", "hm2-stage5-023", "hm2-stage5-024",
    "hm2-stage5-025", "hm2-stage5-026", "hm2-stage5-027",
    "hm2-stage5-028", "hm2-stage5-029", "hm2-stage5-030"
  ],
  B: [],
  C: []
};

function normalizeStage5Question(raw) {
  var choices = raw.choices.map(function (text, index) {
    return { id: String.fromCharCode(65 + index), text: text };
  });
  return {
    id: raw.id,
    stage: raw.stage,
    question: raw.question,
    choices: choices,
    answer: choices[raw.correctIndex].id,
    correctIndex: raw.correctIndex,
    shuffleChoicesAllowed: raw.shuffleChoicesAllowed !== false
  };
}

function sequenceRandom(values) {
  var index = 0;
  return function () {
    var value = values[index % values.length];
    index += 1;
    return value;
  };
}

test("Stage 5の30問は順序安全A、要確認Bと不可Cは0問", function () {
  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.deepEqual(STAGE5_QUESTIONS.map(function (question) {
    return question.id;
  }), AUDIT.A);
  assert.deepEqual(AUDIT.B, []);
  assert.deepEqual(AUDIT.C, []);
  assert.deepEqual(SHUFFLE.AUDITED_STAGE5_QUESTION_IDS, AUDIT.A);

  STAGE5_QUESTIONS.forEach(function (question) {
    var normalized = normalizeStage5Question(question);
    assert.equal(question.choices.length, 5, question.id);
    assert.ok(Number.isInteger(question.correctIndex), question.id);
    assert.ok(question.correctIndex >= 0 && question.correctIndex < 5, question.id);
    assert.equal(SHUFFLE.isShuffleAllowed(normalized), true, question.id);
    assert.doesNotMatch(question.question,
      /(?:上記|前記)のうち|[ア-オ]\s*(?:〜|～|-)\s*[ア-オ]|[１-５1-5]\s*と\s*[１-５1-5]|(?:表|図|文章中)の?[１-５1-5]/u,
      question.id);
    question.choices.forEach(function (choice) {
      assert.doesNotMatch(choice, /^\s*[ア-オＡ-ＥA-E１-５1-5][.．、:：)]\s*/u, question.id);
      assert.doesNotMatch(choice, /(?:上記|前記|選択肢)[^。]{0,12}[ア-オＡ-ＥA-E１-５1-5]/u, question.id);
    });
  });
});

test("順序安全問題は表示用コピーだけをFisher-Yatesで並べ替える", function () {
  var question = normalizeStage5Question(STAGE5_QUESTIONS[0]);
  var before = structuredClone(question);
  var display = SHUFFLE.getDisplayChoices(question, function () { return 0; });

  assert.notDeepEqual(display.map(function (choice) { return choice.id; }),
    before.choices.map(function (choice) { return choice.id; }));
  assert.deepEqual(question, before);
  assert.deepEqual(display.map(function (choice) { return choice.displayLabel; }),
    ["A", "B", "C", "D", "E"]);
});

test("choice.idと正答IDは表示順変更後も不変で正誤判定できる", function () {
  var question = normalizeStage5Question(STAGE5_QUESTIONS[9]);
  var answerBefore = question.answer;
  var idsBefore = question.choices.map(function (choice) { return choice.id; }).sort();
  var display = SHUFFLE.getDisplayChoices(question, sequenceRandom([0.1, 0.8, 0.2, 0.7]));
  var correct = display.find(function (choice) { return choice.id === question.answer; });
  var incorrect = display.find(function (choice) { return choice.id !== question.answer; });

  assert.equal(question.answer, answerBefore);
  assert.deepEqual(display.map(function (choice) { return choice.id; }).sort(), idsBefore);
  assert.equal(correct.id === question.answer, true);
  assert.equal(incorrect.id === question.answer, false);
});

test("同じ問題を複数回描画しても表示位置へ固定されない", function () {
  var question = normalizeStage5Question(STAGE5_QUESTIONS[20]);
  var first = SHUFFLE.getDisplayChoices(question, sequenceRandom([0, 0, 0, 0]));
  var second = SHUFFLE.getDisplayChoices(question, sequenceRandom([0.99, 0.99, 0.99, 0.99]));

  assert.notDeepEqual(first.map(function (choice) { return choice.id; }),
    second.map(function (choice) { return choice.id; }));
  assert.deepEqual(first.map(function (choice) { return choice.displayLabel; }),
    second.map(function (choice) { return choice.displayLabel; }));
});

test("未監査問題、明示除外問題、正誤問題はシャッフルしない", function () {
  var unreviewed = {
    id: "hm2-stage5-future",
    stage: 5,
    choices: [{ id: "A", text: "ア" }, { id: "B", text: "イ" }],
    answer: "A"
  };
  var explicitlyDisabled = normalizeStage5Question(STAGE5_QUESTIONS[0]);
  var trueFalse = {
    id: "hm2-law-v01-01",
    stage: 1,
    choices: [{ id: "O", text: "〇" }, { id: "X", text: "×" }],
    answer: "O"
  };
  explicitlyDisabled.shuffleChoicesAllowed = false;

  [unreviewed, explicitlyDisabled, trueFalse].forEach(function (question) {
    var before = question.choices.map(function (choice) { return choice.id; });
    var after = SHUFFLE.getDisplayChoices(question, function () { return 0; });
    assert.equal(SHUFFLE.isShuffleAllowed(question), false, question.id);
    assert.deepEqual(after.map(function (choice) { return choice.id; }), before, question.id);
  });
});

test("不正なchoice.idまたは正答IDでは安全側で登録順を維持する", function () {
  [
    {
      id: AUDIT.A[0], stage: 5,
      choices: [{ id: "A", text: "1" }, { id: "A", text: "2" }], answer: "A"
    },
    {
      id: AUDIT.A[0], stage: 5,
      choices: [{ id: "A", text: "1" }, { id: "B", text: "2" }], answer: "C"
    }
  ].forEach(function (question) {
    assert.equal(SHUFFLE.isShuffleAllowed(question), false);
    assert.deepEqual(SHUFFLE.getDisplayChoices(question, function () { return 0; })
      .map(function (choice) { return choice.id; }),
    question.choices.map(function (choice) { return choice.id; }));
  });
});

test("HTMLは通常問題・reviewContext・ミニ補習へ同じ表示契約を接続する", function () {
  assert.match(HTML,
    /hygiene-os-v2-choice-shuffle\.js\?v=20260823-stage5-choice-shuffle-01/);
  assert.match(HTML, /var CHOICE_SHUFFLE = window\.HygieneOSV2ChoiceShuffle \|\| null/);
  assert.match(HTML, /displayChoices = getDisplayChoices\(question\)/);
  assert.match(HTML, /data-answer", choice\.id/);
  assert.match(HTML, /data-display-label", choice\.displayLabel/);
  assert.match(HTML, /selection\.questions\.map\(copyChallengeQuestionForDisplay\)/);
  assert.match(HTML, /function getReviewDisplay\(session\)/);
  assert.match(HTML, /function renderQuestion\(\)/);
});

test("専用モジュールが利用不能でも登録順で通常学習を継続する", function () {
  assert.match(HTML, /if \(CHOICE_SHUFFLE && typeof CHOICE_SHUFFLE\.getDisplayChoices/);
  assert.match(HTML, /登録順で表示します/);
  assert.match(HTML, /displayLabel: choice\.id/);
});

test("表示順はstate・currentSession・回答保存へ追加しない", function () {
  assert.doesNotMatch(HTML, /state\.choiceOrder|currentSession\.choiceOrder|localStorage[^\n]*choiceOrder/);
  assert.match(HTML, /recordAnswerAfterLegacyUpdate\(state, \{/);
  assert.match(HTML, /selectedAnswer: selectedAnswer/);
  assert.match(HTML, /correctAnswer: question\.answer/);
});
