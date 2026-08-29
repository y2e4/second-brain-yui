"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-teacher-mode.js"), "utf8");
var HTML_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
var QUESTION_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sharoshi-intro-questions.json"), "utf8")
);

function loadModule() {
  var context = { window: {} };
  vm.createContext(context);
  vm.runInContext(MODULE_SOURCE, context);
  return context.window.SharoshiTeacherModeBeta;
}

function loadSessionTopicCooldown() {
  var block = HTML_SOURCE.match(
    /\/\/ SESSION_TOPIC_COOLDOWN_START([\s\S]*?)\/\/ SESSION_TOPIC_COOLDOWN_END/
  );
  var context = {};

  assert.ok(block, "通常キュー用topic cooldown関数を抽出できること");
  vm.createContext(context);
  vm.runInContext(block[1] + "\nthis.prioritize = prioritizeNextSessionTopicFamilies;", context);
  return context.prioritize;
}

function question(id, category, extra) {
  return Object.assign({ id: id, category: category }, extra || {});
}

function adaptiveLevelPool(level) {
  var sourceById = {};

  QUESTION_DATA.questions.concat(QUESTION_DATA.adaptiveReasoningQuestions || []).forEach(function (item) {
    sourceById[item.id] = item;
  });
  return (QUESTION_DATA.adaptiveDifficultyCatalog.levels[String(level)] || []).map(function (entry, index) {
    var source = sourceById[entry.questionId];
    return Object.assign({}, source, {
      adaptiveReasoningLevel: Number(level),
      selectionBucket: entry.selectionBucket || source.selectionBucket || source.thinkingLevel || "",
      adaptiveSourceStage: Number(source.stage) || 1,
      adaptiveTopic: entry.topic || source.title || source.term || "",
      equivalenceKey: entry.equivalenceKey || entry.questionId,
      adaptiveOrder: String(level) + "-" + String(index + 1).padStart(2, "0")
    });
  });
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

test("補習出口後は通常3問の未回答2枠を別系統へ差し替える", function () {
  var prioritize = loadSessionTopicCooldown();
  var source = question("source", "雇用保険", {
    theme: "基本手当",
    equivalenceKey: "employment-basic",
    adaptiveReasoningLevel: 2,
    selectionBucket: "comparison",
    adaptiveSourceStage: 2
  });
  var sameCategory = question("same-category", "雇用保険", {
    theme: "受給資格",
    equivalenceKey: "employment-eligibility",
    adaptiveReasoningLevel: 2,
    selectionBucket: "comparison",
    adaptiveSourceStage: 2
  });
  var sameTheme = question("same-theme", "健康保険", {
    theme: "基本手当",
    equivalenceKey: "health-basic",
    adaptiveReasoningLevel: 2,
    selectionBucket: "case",
    adaptiveSourceStage: 2
  });
  var labor = question("labor", "労働基準法", {
    theme: "労働時間",
    equivalenceKey: "labor-hours",
    adaptiveReasoningLevel: 2,
    selectionBucket: "comparison",
    adaptiveSourceStage: 2,
    adaptiveOrder: "2-10"
  });
  var pension = question("pension", "厚生年金保険法", {
    theme: "老齢厚生年金",
    equivalenceKey: "pension-old-age",
    adaptiveReasoningLevel: 2,
    selectionBucket: "case",
    adaptiveSourceStage: 2,
    adaptiveOrder: "2-20"
  });
  var original = [source, sameCategory, sameTheme];
  var selected = prioritize(original, 0, source, original.concat([labor, pension]), {
    maxQuestions: 2,
    currentStageId: 2,
    reasoningLevel: 2,
    recentQuestionIds: [],
    seenQuestionIds: []
  });

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["source", "labor", "pension"]);
  assert.deepEqual(Array.from(original, function (item) { return item.id; }), [
    "source", "same-category", "same-theme"
  ]);
});

test("通常queue差し替えは同じlevelとslotを守り、未解放Stageを使わない", function () {
  var prioritize = loadSessionTopicCooldown();
  var source = question("source", "雇用保険", {
    adaptiveReasoningLevel: 3,
    selectionBucket: "case",
    adaptiveSourceStage: 3
  });
  var same = question("same", "雇用保険", {
    adaptiveReasoningLevel: 3,
    selectionBucket: "case",
    adaptiveSourceStage: 3
  });
  var safe = question("safe", "労働基準法", {
    adaptiveReasoningLevel: 3,
    selectionBucket: "case",
    adaptiveSourceStage: 3
  });
  var wrongLevel = question("wrong-level", "健康保険", {
    adaptiveReasoningLevel: 2,
    selectionBucket: "case",
    adaptiveSourceStage: 2
  });
  var wrongSlot = question("wrong-slot", "国民年金法", {
    adaptiveReasoningLevel: 3,
    selectionBucket: "comparison",
    adaptiveSourceStage: 3
  });
  var locked = question("locked", "厚生年金保険法", {
    adaptiveReasoningLevel: 3,
    selectionBucket: "case",
    adaptiveSourceStage: 4
  });
  var selected = prioritize([source, same], 0, source, [wrongLevel, wrongSlot, locked, safe], {
    currentStageId: 3,
    reasoningLevel: 3
  });

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["source", "safe"]);
});

test("別categoryがない適応3問でもequivalenceKey系列が違う論点へ移れる", function () {
  var prioritize = loadSessionTopicCooldown();
  var pool = adaptiveLevelPool(3);
  var source = pool.find(function (item) {
    return item.id === "adaptive-d3-leave-02";
  });
  var sameFamily = pool.find(function (item) {
    return item.id === "adaptive-d3-leave-03";
  });
  var selected = prioritize([source, sameFamily], 0, source, pool, {
    currentStageId: 3,
    reasoningLevel: 3
  });

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), [
    "adaptive-d3-leave-02", "adaptive-d3-worktime-02"
  ]);
});

test("別系統候補が不足する場合は固定queueを維持し、学習不能にしない", function () {
  var prioritize = loadSessionTopicCooldown();
  var source = question("source", "雇用保険", {
    adaptiveReasoningLevel: 2,
    selectionBucket: "comparison"
  });
  var same = question("same", "雇用保険", {
    adaptiveReasoningLevel: 2,
    selectionBucket: "comparison"
  });
  var selected = prioritize([source, same], 0, source, [source, same], {
    currentStageId: 2,
    reasoningLevel: 2
  });

  assert.deepEqual(Array.from(selected, function (item) { return item.id; }), ["source", "same"]);
});

test("既存固定queueでは未回答部分だけを並べ替え、別論点2問後に元弱点を残す", function () {
  var prioritize = loadSessionTopicCooldown();
  var source = question("employment-source", "雇用保険");
  var sameOne = question("employment-one", "雇用保険");
  var sameTwo = question("employment-two", "雇用保険");
  var labor = question("labor", "労働基準法");
  var health = question("health", "健康保険");
  var original = [source, sameOne, sameTwo, labor, health];
  var selected = prioritize(original, 0, source, original.slice(1), {
    maxQuestions: 2,
    currentStageId: 5
  });

  assert.equal(selected[0].id, "employment-source");
  assert.deepEqual(Array.from(selected.slice(1, 3), function (item) { return item.id; }).sort(), [
    "health", "labor"
  ]);
  assert.deepEqual(Array.from(selected.slice(3), function (item) { return item.id; }).sort(), [
    "employment-one", "employment-two"
  ]);
  assert.deepEqual(Array.from(original, function (item) { return item.id; }), [
    "employment-source", "employment-one", "employment-two", "labor", "health"
  ]);
});

test("HTMLは補習完了を通常キューの別論点繰り上げへ接続する", function () {
  assert.match(HTML_SOURCE, /sharoshi-teacher-mode\.js\?v=20260823-manual-topic-exit-01/);
  assert.match(HTML_SOURCE, /onChallengeComplete:\s*function \(result\)/);
  assert.match(HTML_SOURCE, /prioritizeNextDifferentTopic\(\s*sessionQuestions,\s*sessionIndex,\s*result\.topicKey/);
  assert.match(HTML_SOURCE, /applySessionTopicCooldownAfterChallenge\(sourceQuestion\)/);
  assert.match(HTML_SOURCE, /adaptiveDaily = sessionMode === "daily" && sessionAdaptiveEligible/);
  assert.match(HTML_SOURCE, /adaptiveDaily \? adaptiveQuestionBank : sessionQuestions\.slice\(sessionIndex \+ 1\)/);
  assert.match(HTML_SOURCE, /prioritizeNextSessionTopicFamilies\(/);
  assert.match(HTML_SOURCE, /maxQuestions:\s*2/);
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
