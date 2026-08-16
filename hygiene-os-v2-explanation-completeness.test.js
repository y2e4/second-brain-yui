"use strict";

var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var HTML = fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2.html"),
  "utf8"
);
var TARGET_IDS = [
  "hm2-physiology-v01-05",
  "hm2-stage5-007",
  "hm2-stage5-010",
  "hm2-stage5-025",
  "hm2-stage5-027"
];
var TARGET_ID_SET = new Set(TARGET_IDS);
var ALL_QUESTIONS = (DATA.questions || []).concat(
  DATA.stage5 && Array.isArray(DATA.stage5.questions)
    ? DATA.stage5.questions
    : []
);
var QUESTION_BY_ID = Object.fromEntries(ALL_QUESTIONS.map(function (question) {
  return [question.id, question];
}));

function sha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function withoutExplanations(value) {
  var copy = JSON.parse(JSON.stringify(value));
  (copy.questions || []).forEach(function (question) {
    delete question.explanation;
  });
  if (copy.stage5 && Array.isArray(copy.stage5.questions)) {
    copy.stage5.questions.forEach(function (question) {
      delete question.explanation;
    });
  }
  return copy;
}

test("解説改善で問題数、問題文、正答、ID、学習metadataを変更しない", function () {
  assert.equal((DATA.questions || []).length, 81);
  assert.equal((DATA.stage5.questions || []).length, 30);
  assert.equal(ALL_QUESTIONS.length, 111);
  assert.equal(new Set(ALL_QUESTIONS.map(function (question) {
    return question.id;
  })).size, 111);
  assert.equal(
    sha256(withoutExplanations(DATA)),
    "cee650999e48b313709e64f3fb12db78ec4c4dc7e2655b74fa6e729a166ac206"
  );
});

test("改善対象外106問の解説を変更しない", function () {
  var untouchedExplanations = ALL_QUESTIONS.filter(function (question) {
    return !TARGET_ID_SET.has(question.id);
  }).map(function (question) {
    return { id: question.id, explanation: question.explanation };
  });

  assert.equal(untouchedExplanations.length, 106);
  assert.equal(
    sha256(untouchedExplanations),
    "01ea51440dca5d2e8f362bbe36491e7f1cd3660bc57898599c83e7d07e453d95"
  );
});

test("肝臓の誤文はヘモグロビンの主な合成場所まで示す", function () {
  ["hm2-physiology-v01-05", "hm2-stage5-025"].forEach(function (id) {
    var explanation = QUESTION_BY_ID[id].explanation;
    assert.match(explanation, /誤り/);
    assert.match(explanation, /骨髄/);
    assert.match(explanation, /赤血球系細胞/);
  });
});

test("長時間労働者の面接指導は通常労働者の正しい要件まで示す", function () {
  var explanation = QUESTION_BY_ID["hm2-stage5-007"].explanation;

  assert.match(explanation, /月100時間を超えれば本人の申出なし/);
  assert.match(explanation, /誤り/);
  assert.match(explanation, /1週40時間/);
  assert.match(explanation, /月80時間を超え/);
  assert.match(explanation, /疲労の蓄積/);
  assert.match(explanation, /本人から申出/);
});

test("機械換気設備は正しい点検時期と保存期間まで示す", function () {
  var explanation = QUESTION_BY_ID["hm2-stage5-010"].explanation;

  assert.match(explanation, /6か月以内ごとに1回.*誤り/);
  assert.match(explanation, /2か月以内ごとに1回/);
  assert.match(explanation, /3年間保存/);
  assert.match(explanation, /照明設備/);
});

test("血液の誤文は血漿と血球の正しい体積割合まで示す", function () {
  var explanation = QUESTION_BY_ID["hm2-stage5-027"].explanation;

  assert.match(explanation, /約60%を占める.*誤り/);
  assert.match(explanation, /血漿が約55%/);
  assert.match(explanation, /血球が約45%/);
  assert.match(explanation, /赤血球.*血球の中では最も多い/);
});

test("HTMLは改善版問題JSONの新しいキャッシュ識別子を参照する", function () {
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260816-explanation-01/
  );
  assert.doesNotMatch(HTML, /20260802-overtime-review-01/);
});
