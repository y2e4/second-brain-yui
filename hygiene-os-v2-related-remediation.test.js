"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");

var HTML = fs.readFileSync(path.join(__dirname, "hygiene-os-v2.html"), "utf8");
var DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var QUESTIONS = DATA.questions.concat(DATA.stage5.questions);

function question(id, extra) {
  return Object.assign({
    id: id,
    stage: 1,
    category: "合成カテゴリ",
    theme: "合成テーマ",
    question: id + "の問題文",
    choices: [
      { id: "A", text: "選択肢A" },
      { id: "B", text: "選択肢B" }
    ],
    answer: "A"
  }, extra || {});
}

function verifiedQuestion(id, variantType, reasoningLevel, extra) {
  return question(id, Object.assign({
    knowledgeKey: "verified-key",
    variantType: variantType,
    reasoningLevel: reasoningLevel,
    variantOfQuestionIds: [],
    equivalenceKey: id + "-equivalence"
  }, extra || {}));
}

function select(source, questions, extra) {
  return SELECTOR.selectRelatedSupplementQuestions(Object.assign({
    questions: questions,
    sourceQuestionId: source.id,
    outcome: "incorrect",
    manualWeak: false,
    allowedStageIds: [1, 2, 3, 4, 5],
    excludedQuestionIds: [],
    limit: 2
  }, extra || {}));
}

function realQuestion(id) {
  return QUESTIONS.find(function (item) {
    return item.id === id;
  });
}

test("同じknowledgeKeyの確認済み派生が2問以上なら元問題以外から2問選ぶ", function () {
  var source = verifiedQuestion("source", "rephrase", 2);
  var direct = verifiedQuestion("direct", "condition", 3, {
    variantOfQuestionIds: [source.id]
  });
  var sibling = verifiedQuestion("sibling", "comparison", 2);
  var result = select(source, [source, sibling, direct]);

  assert.equal(result.status, "selected");
  assert.deepEqual(result.questionIds, ["direct", "sibling"]);
  assert.deepEqual(result.selectionReasons, [
    "direct_knowledge_variant",
    "knowledge_variant"
  ]);
  assert.ok(result.questionIds.every(function (id) { return id !== source.id; }));
});

test("同じknowledgeKeyの確認済み派生が1問なら1問だけ返す", function () {
  var source = verifiedQuestion("source", "rephrase", 2);
  var variant = verifiedQuestion("variant", "exception", 3, {
    variantOfQuestionIds: [source.id]
  });
  var result = select(source, [source, variant]);

  assert.equal(result.status, "selected");
  assert.deepEqual(result.questionIds, ["variant"]);
});

test("段階導入中のミニ補習はreasoningLevel未設定でもknowledgeKeyとvariantTypeを利用する", function () {
  var source = question("source", {
    knowledgeKey: "stage5-key",
    variantType: "case"
  });
  var variant = question("variant", {
    knowledgeKey: "stage5-key",
    variantType: "comparison"
  });
  var result = select(source, [source, variant]);

  assert.equal(source.reasoningLevel, undefined);
  assert.equal(variant.reasoningLevel, undefined);
  assert.deepEqual(result.questionIds, [variant.id]);
  assert.deepEqual(result.selectionReasons, ["knowledge_variant"]);
});

test("同じknowledgeKeyも同じthemeもなければ無関係な同category問題を返さない", function () {
  var source = question("source", { theme: "対象テーマ" });
  var unrelated = question("unrelated", { theme: "別テーマ" });
  var result = select(source, [source, unrelated]);

  assert.equal(result.status, "no_related_supplement");
  assert.deepEqual(result.questionIds, []);
  assert.equal(result.fallback, "continue_normal_learning");
});

test("同じthemeの候補だけを最大2問選び、全問題へフォールバックしない", function () {
  var source = question("source", { theme: "対象テーマ" });
  var relatedA = question("related-a", { theme: "対象テーマ" });
  var relatedB = question("related-b", { theme: "対象テーマ" });
  var relatedC = question("related-c", { theme: "対象テーマ" });
  var unrelated = question("unrelated", { theme: "別テーマ" });
  var result = select(source, [source, unrelated, relatedC, relatedB, relatedA]);

  assert.deepEqual(result.questionIds, ["related-a", "related-b"]);
  assert.ok(result.questions.every(function (item) {
    return item.theme === source.theme;
  }));
});

test("同じthemeでは比較、条件・例外、事例、言い換えの順を優先する", function () {
  var source = question("source");
  var values = [
    source,
    question("rephrase", { variantType: "rephrase" }),
    question("case", { variantType: "case" }),
    question("condition", { variantType: "condition" }),
    question("comparison", { variantType: "comparison" })
  ];
  var result = select(source, values);

  assert.deepEqual(result.questionIds, ["comparison", "condition"]);
  assert.deepEqual(result.selectionReasons, [
    "same_theme_comparison",
    "same_theme_condition"
  ]);
});

test("unsure、incorrect、guess、ambiguousを補習トリガーとして受理する", function () {
  var source = question("source");
  var variant = question("variant");

  ["unsure", "incorrect", "guess", "ambiguous"].forEach(function (outcome) {
    assert.equal(select(source, [source, variant], { outcome: outcome }).status, "selected");
  });
});

test("manualWeak中のunderstoodだけを理解正解の補習トリガーとして受理する", function () {
  var source = question("source");
  var variant = question("variant");

  assert.equal(select(source, [source, variant], {
    outcome: "understood",
    manualWeak: true
  }).status, "selected");
  assert.equal(select(source, [source, variant], {
    outcome: "understood",
    manualWeak: false
  }).status, "stable_understanding");
});

test("同一問題文と同一equivalenceKeyは即時再出題しない", function () {
  var source = question("source", { equivalenceKey: "same" });
  var sameText = question("same-text", { question: source.question });
  var sameEquivalent = question("same-equivalent", { equivalenceKey: "same" });
  var distinct = question("distinct", { equivalenceKey: "distinct" });
  var result = select(source, [source, sameText, sameEquivalent, distinct]);

  assert.deepEqual(result.questionIds, ["distinct"]);
});

test("対象Stage外と明示除外の問題は補習に使わない", function () {
  var source = question("source", { stage: 1 });
  var excluded = question("excluded", { stage: 1 });
  var locked = question("locked", { stage: 2 });
  var result = select(source, [source, excluded, locked], {
    allowedStageIds: [1],
    excludedQuestionIds: [excluded.id]
  });

  assert.equal(result.status, "no_related_supplement");
});

test("問題ID重複は順序に依存せず安全停止する", function () {
  var source = question("source");
  var duplicateA = question("duplicate");
  var duplicateB = question("duplicate", { question: "別の問題文" });
  var first = select(source, [source, duplicateA, duplicateB]);
  var second = select(source, [duplicateB, source, duplicateA]);

  assert.equal(first.status, "invalid_question_catalog");
  assert.equal(second.status, "invalid_question_catalog");
  assert.deepEqual(first.details.duplicateIds, ["duplicate"]);
  assert.deepEqual(second.details.duplicateIds, ["duplicate"]);
});

test("選択結果と入力questionsは参照分離され入力を変更しない", function () {
  var source = question("source");
  var variant = question("variant", { metadata: { tags: ["確認"] } });
  var questions = [source, variant];
  var before = structuredClone(questions);
  var result = select(source, questions);

  result.questions[0].metadata.tags.push("変更");
  assert.deepEqual(questions, before);
  assert.notEqual(result.questions[0], variant);
  assert.notEqual(result.questions[0].metadata, variant.metadata);
});

test("公開中の36協定2問は07から08、08から07を確認済み派生として選べる", function () {
  var general = realQuestion("hm2-law-v02-07");
  var special = realQuestion("hm2-law-v02-08");
  var fromGeneral = select(general, QUESTIONS, {
    allowedStageIds: [3]
  });
  var fromSpecial = select(special, QUESTIONS, {
    allowedStageIds: [3]
  });

  assert.deepEqual(fromGeneral.questionIds, [special.id]);
  assert.deepEqual(fromSpecial.questionIds, [general.id]);
  assert.equal(fromGeneral.selectionReasons[0], "direct_knowledge_variant");
  assert.equal(fromSpecial.selectionReasons[0], "direct_knowledge_variant");
});

test("Stage 5の食中毒、胆汁、肝臓、免疫はknowledgeKeyから選ぶ", function () {
  var expected = {
    "hm2-stage5-013": ["hm2-hygiene-v03-01"],
    "hm2-stage5-022": ["hm2-physiology-v01-02"],
    "hm2-stage5-025": ["hm2-physiology-v01-05"],
    "hm2-stage5-029": ["hm2-physiology-v02-10"]
  };

  Object.keys(expected).forEach(function (id) {
    var result = select(realQuestion(id), QUESTIONS);
    assert.deepEqual(result.questionIds, expected[id]);
    if (id === "hm2-stage5-013") {
      assert.deepEqual(result.selectionReasons, ["direct_knowledge_variant"]);
    } else {
      assert.deepEqual(result.selectionReasons, ["knowledge_variant"]);
    }
  });
});

test("Stage 5の換気・二酸化炭素と消化酵素はknowledgeKeyの1問だけを選ぶ", function () {
  var expected = {
    "hm2-stage5-018": "hm2-hygiene-v02-03",
    "hm2-stage5-023": "hm2-physiology-v02-05"
  };

  Object.keys(expected).forEach(function (id) {
    var result = select(realQuestion(id), QUESTIONS);
    assert.equal(result.status, "selected");
    assert.deepEqual(result.questionIds, [expected[id]]);
    assert.deepEqual(result.selectionReasons, ["knowledge_variant"]);
  });
});

test("視覚、コルチゾール、肺循環はtheme名が違ってもknowledgeKeyで1問へつながる", function () {
  var expected = {
    "hm2-stage5-021": "hm2-physiology-v01-01",
    "hm2-stage5-028": "hm2-physiology-v02-04",
    "hm2-stage5-030": "hm2-physiology-v02-01"
  };

  Object.keys(expected).forEach(function (id) {
    var result = select(realQuestion(id), QUESTIONS);
    assert.equal(result.status, "selected", id);
    assert.deepEqual(result.questionIds, [expected[id]], id);
    assert.deepEqual(result.selectionReasons, ["knowledge_variant"], id);
    assert.equal(
      result.questions[0].knowledgeKey,
      realQuestion(id).knowledgeKey,
      id
    );
  });
});

test("HTMLは関連補習selectorだけを使い正式reviewContext中のミニ補習を抑止する", function () {
  assert.match(HTML, /selectRelatedSupplementQuestions\(\{/);
  assert.match(HTML, /!hasReviewContext\(state\.currentSession\)/);
  assert.match(HTML, /challengeQuestions\.length \+ "問だけ挑戦"/);
  assert.match(HTML, /manualWeak: Boolean\(stats && stats\.manualWeak\)/);
  assert.match(HTML, /stats\.manualWeak === true \|\| Number\(stats\.understoodStreak \|\| 0\) < 2/);
  assert.match(HTML, /renderTeacherSupport\(question, candidateStats\.lastOutcome \|\| "understood"\)/);
  assert.doesNotMatch(HTML, /sameTheme\.length >= 2 \? sameTheme : questions/);
  assert.doesNotMatch(HTML, /item\.theme === question\.theme \|\| item\.category === question\.category/);
});

test("通常3問のbuildPriorityQueueとstartModeは関連補習から分離したまま", function () {
  var normalQueueStart = HTML.indexOf("function buildPriorityQueue(pool, limit, excludedIds)");
  var startModeStart = HTML.indexOf("function startMode(mode)");
  var supplementStart = HTML.indexOf("function getMonsterChallengeSelection");

  assert.ok(normalQueueStart >= 0 && startModeStart > normalQueueStart);
  assert.ok(supplementStart > startModeStart);
  assert.match(HTML, /var queue = buildPriorityQueue\(pool, limit, excluded\);/);
  assert.match(HTML, /today: SESSION_QUESTION_LIMIT/);
});
