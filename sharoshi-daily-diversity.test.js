"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var HTML_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
var QUESTION_DATA = JSON.parse(
  fs.readFileSync(path.join(ROOT, "sharoshi-intro-questions.json"), "utf8")
);

function loadDailyDiversity() {
  var block = HTML_SOURCE.match(
    /\/\/ DAILY_SUBJECT_DIVERSITY_START([\s\S]*?)\/\/ DAILY_SUBJECT_DIVERSITY_END/
  );
  var context = { Math: Math, STAGE_FIVE_ID: 5 };

  assert.ok(block, "Level 5通常3問の多様性関数を抽出できること");
  vm.createContext(context);
  vm.runInContext(
    block[1] +
      "\nthis.selectDiverse = selectDiverseDailyQuestions;" +
      "\nthis.subjectKey = getDailyDiversitySubjectKey;" +
      "\nthis.topicKeys = getDailyDiversityTopicKeys;" +
      "\nthis.shouldUse = shouldUseDailySubjectDiversity;",
    context
  );
  return context;
}

function seededRandom(seed) {
  var value = seed >>> 0;
  return function () {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function question(id, category, extra) {
  return Object.assign({ id: id, category: category }, extra || {});
}

function buildAdaptiveLevel(level) {
  var sourceById = {};

  QUESTION_DATA.questions.concat(QUESTION_DATA.adaptiveReasoningQuestions || []).forEach(function (item) {
    sourceById[item.id] = item;
  });
  return (QUESTION_DATA.adaptiveDifficultyCatalog.levels[String(level)] || []).map(function (entry) {
    var source = sourceById[entry.questionId];
    return Object.assign({}, source, {
      adaptiveReasoningLevel: Number(level),
      adaptiveSourceStage: Number(source.stage) || 1,
      adaptiveTopic: entry.topic || source.title || source.term || "",
      equivalenceKey: entry.equivalenceKey || entry.questionId,
      selectionBucket: entry.selectionBucket || source.selectionBucket || ""
    });
  });
}

test("Level 5適応候補が1科目だけの場合に限り多様性補完を有効にする", function () {
  var helpers = loadDailyDiversity();
  var level5 = buildAdaptiveLevel(5);

  assert.equal(new Set(level5.map(helpers.subjectKey)).size, 1);
  assert.equal(helpers.shouldUse({ reasoningLevel: 5 }, 5, level5), true);
  assert.equal(helpers.shouldUse({ reasoningLevel: 4 }, 5, level5), false);
  assert.equal(helpers.shouldUse({ reasoningLevel: 5 }, 4, level5), false);
  assert.equal(helpers.shouldUse({ reasoningLevel: 5 }, 5, [
    question("labor", "労働基準法", { adaptiveReasoningLevel: 5 }),
    question("pension", "年金", { adaptiveReasoningLevel: 5 })
  ]), false);
});

test("直近の弱点IDより非直近の同knowledgeKey variantを優先し、別科目を含める", function () {
  var helpers = loadDailyDiversity();
  var source = question("weak-source", "労働基準法", {
    knowledgeKey: "working-time-rule",
    theme: "時間外労働"
  });
  var variant = question("weak-variant", "労働基準法", {
    knowledgeKey: "working-time-rule",
    theme: "36協定"
  });
  var health = question("health", "健康保険", { theme: "傷病手当金" });
  var pension = question("pension", "年金", { theme: "老齢年金" });
  var selected = helpers.selectDiverse([source, variant, health, pension], {
    count: 3,
    recentQuestionIds: [source.id],
    weakQuestionIds: [source.id],
    weakKnowledgeKeys: [source.knowledgeKey],
    weakTopicKeys: helpers.topicKeys(source),
    random: seededRandom(1)
  });
  var ids = Array.from(selected.questions, function (item) { return item.id; });

  assert.ok(ids.includes("weak-variant"));
  assert.ok(!ids.includes("weak-source"));
  assert.equal(selected.questions.filter(function (item) {
    return item.knowledgeKey === "working-time-rule";
  }).length, 1);
  assert.deepEqual(new Set(Array.from(selected.questions, helpers.subjectKey)).size, 3);
  assert.deepEqual(Array.from(selected.reusedCooldownQuestionIds), []);
});

test("候補不足時だけ直近問題を再利用し、学習不能にしない", function () {
  var helpers = loadDailyDiversity();
  var pool = [
    question("recent-labor", "労働基準法"),
    question("recent-pension", "年金")
  ];
  var selected = helpers.selectDiverse(pool, {
    count: 3,
    recentQuestionIds: pool.map(function (item) { return item.id; }),
    random: seededRandom(2)
  });

  assert.deepEqual(Array.from(selected.questions, function (item) { return item.id; }).sort(), [
    "recent-labor", "recent-pension"
  ]);
  assert.deepEqual(Array.from(selected.reusedCooldownQuestionIds).sort(), [
    "recent-labor", "recent-pension"
  ]);
});

test("連続12セッションで直近IDを避け、科目と論点を分散する", function () {
  var helpers = loadDailyDiversity();
  var stage5 = QUESTION_DATA.questions.filter(function (item) {
    return Number(item.stage) === 5;
  });
  var adaptive = buildAdaptiveLevel(5);
  var pool = stage5.concat(adaptive);
  var weakIds = [
    "stage5-question-013",
    "adaptive-d5-leave-02",
    "adaptive-d5-worktime-01",
    "adaptive-d5-leave-04",
    "adaptive-d5-leave-01"
  ];
  var weakQuestions = pool.filter(function (item) {
    return weakIds.includes(item.id);
  });
  var weakTopicKeys = weakQuestions.reduce(function (values, item) {
    return values.concat(helpers.topicKeys(item));
  }, []);
  var recent = [];
  var setKeys = [];
  var allSubjects = [];
  var weakSelections = 0;
  var random = seededRandom(20261018);

  for (var session = 0; session < 12; session += 1) {
    var selected = helpers.selectDiverse(pool, {
      count: 3,
      recentQuestionIds: recent,
      lastQuestionId: recent[recent.length - 1] || "",
      seenQuestionIds: QUESTION_DATA.questions.map(function (item) { return item.id; }),
      weakQuestionIds: weakIds,
      weakTopicKeys: weakTopicKeys,
      random: random
    });
    var ids = Array.from(selected.questions, function (item) { return item.id; });
    var subjects = Array.from(selected.questions, helpers.subjectKey);

    assert.equal(ids.length, 3);
    assert.equal(ids.some(function (id) { return recent.includes(id); }), false);
    assert.ok(new Set(subjects).size >= 2);
    weakSelections += selected.questions.some(function (item) {
      return weakIds.includes(item.id) || helpers.topicKeys(item).some(function (key) {
        return weakTopicKeys.includes(key);
      });
    }) ? 1 : 0;
    setKeys.push(ids.slice().sort().join("|"));
    allSubjects = allSubjects.concat(subjects);
    recent = recent.concat(ids).slice(-6);
  }

  assert.equal(weakSelections, 12);
  assert.ok(new Set(setKeys).size > 2, "同じ2組の単純交互反復にならないこと");
  assert.ok(new Set(allSubjects).size >= 5, "Stage 5内の複数科目へ分散すること");
});

test("多様性補完は通常3問の適応経路だけに接続し、明示モードを変えない", function () {
  assert.ok(HTML_SOURCE.includes(
    'if (sessionMode === "daily" && Number(limit) === ADAPTIVE_SET_SIZE)'
  ));
  assert.ok(HTML_SOURCE.includes('selectionMode: "stage5-subject-diversity"'));
  assert.ok(HTML_SOURCE.includes('if (mode === "mistakes")'));
  assert.ok(HTML_SOURCE.includes('} else if (mode === "stageChallenge") {'));
  assert.ok(HTML_SOURCE.includes('var limit = mode === "challenge" ? 10 : SESSION_QUESTION_LIMIT;'));
});
