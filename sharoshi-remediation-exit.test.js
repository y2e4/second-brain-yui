"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-teacher-mode.js"), "utf8");
var HTML_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");

function loadModule() {
  var context = { window: {} };
  vm.createContext(context);
  vm.runInContext(MODULE_SOURCE, context);
  return context.window.SharoshiTeacherModeBeta;
}

function question(id, category, extra) {
  return Object.assign({ id: id, category: category }, extra || {});
}

test("補習は同一論点を最大2問に制限し、重複IDを除く", function () {
  var module = loadModule();
  var selected = module.getChallengeQuestions([
    question("related-1", "雇用保険"),
    question("related-1", "雇用保険"),
    question("related-2", "雇用保険"),
    question("related-3", "雇用保険")
  ]);

  assert.equal(module.MAX_REMEDIATION_QUESTIONS, 2);
  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["related-1", "related-2"]);
});

test("knowledgeKeyを最優先し、現行雇用保険問題は同じ補習論点として扱う", function () {
  var module = loadModule();

  assert.equal(
    module.getQuestionTopicKey(question("knowledge", "雇用保険", {
      knowledgeKey: "unemployment-benefit-eligibility",
      theme: "基本手当"
    })),
    "knowledge:unemployment-benefit-eligibility"
  );
  assert.equal(module.getQuestionTopicKey(question("employment-1", "雇用保険")), "category:雇用保険");
  assert.equal(
    module.getQuestionTopicKey(question("employment-2", ["労働基準法", "雇用保険"])),
    "category:雇用保険"
  );
});

test("関連2問完了後は同論点を止め、別論点を1問挟むと再許可する", function () {
  var module = loadModule();
  var gate = module.createRemediationGate();

  gate.markCompleted("knowledge:weak-topic");
  assert.equal(gate.isBlocked("knowledge:weak-topic"), true);

  gate.noteMainQuestion("knowledge:weak-topic");
  assert.equal(gate.isBlocked("knowledge:weak-topic"), true);

  gate.noteMainQuestion("knowledge:other-topic");
  assert.equal(gate.isBlocked("knowledge:weak-topic"), false);
});

test("補習後は固定済み通常キュー内の別論点を次へ繰り上げる", function () {
  var module = loadModule();
  var source = question("source", "雇用保険");
  var same = question("same", "雇用保険");
  var other = question("other", "健康保険");
  var selected = module.prioritizeNextDifferentTopic(
    [source, same, other],
    0,
    "category:雇用保険"
  );

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["source", "other", "same"]);
  assert.deepEqual([source.id, same.id, other.id], ["source", "same", "other"]);
});

test("別論点候補がなければ通常キューを壊さずそのまま進める", function () {
  var module = loadModule();
  var selected = module.prioritizeNextDifferentTopic([
    question("source", "雇用保険"),
    question("same-1", "雇用保険"),
    question("same-2", "雇用保険")
  ], 0, "category:雇用保険");

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["source", "same-1", "same-2"]);
});

test("HTMLは補習完了を通常キューの別論点繰り上げへ接続する", function () {
  assert.match(HTML_SOURCE, /sharoshi-teacher-mode\.js\?v=20260823-manual-topic-exit-01/);
  assert.match(HTML_SOURCE, /onChallengeComplete:\s*function \(result\)/);
  assert.match(HTML_SOURCE, /prioritizeNextDifferentTopic\(\s*sessionQuestions,\s*sessionIndex,\s*result\.topicKey/);
  assert.match(HTML_SOURCE, /teacherMode\.noteMainQuestion\(topicKey\)/);
  assert.match(HTML_SOURCE, /topicKey:\s*topicKey/);
});

test("2問補習の完了後は同じ挑戦ボタンから再起動できない", function () {
  assert.match(MODULE_SOURCE, /controller\.challengeButton\.hidden = true/);
  assert.match(
    MODULE_SOURCE,
    /controller\.remediationGate\.isBlocked\(context\.topicKey\)[\s\S]*questions\.length < MAX_REMEDIATION_QUESTIONS/
  );
  assert.match(MODULE_SOURCE, /controller\.challenge = null;\n\s*renderCooldownCard\(controller\);/);
});

test("補習回答は既存どおり学習活動だけを記録し、弱点解除や通常解答加算を行わない", function () {
  var callbackMatch = HTML_SOURCE.match(
    /onSupplementAnswer:\s*function \(\) \{([\s\S]*?)\n\s*\},\n\s*onChallengeComplete:/
  );

  assert.ok(callbackMatch);
  assert.match(callbackMatch[1], /markLearningActivity\("teacher_monster", \{ save: true, update: true \}\)/);
  assert.doesNotMatch(callbackMatch[1], /recordAnswer|recordCorrectReview|totalAnswers|correctAnswers/);
});

test("通常問題と補習問題の選択肢シャッフルは安定IDで正答判定を維持する", function () {
  assert.match(HTML_SOURCE, /shuffled\(question\.choices\.map\(function \(choice, index\)/);
  assert.match(HTML_SOURCE, /button\.setAttribute\("data-choice-id", choice\.id\)/);
  assert.match(
    HTML_SOURCE,
    /return String\(selectedAnswer\) === getCorrectChoiceId\(question\)/
  );
  assert.match(MODULE_SOURCE, /\? shuffled\(question\.choices\)/);
  assert.match(
    MODULE_SOURCE,
    /return String\(selectedAnswer\) === getCorrectChoiceId\(question\)/
  );
});
