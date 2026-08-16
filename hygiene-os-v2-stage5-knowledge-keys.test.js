"use strict";

var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");

var DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var HTML = fs.readFileSync(path.join(__dirname, "hygiene-os-v2.html"), "utf8");
var QUESTIONS = (DATA.questions || []).concat(
  DATA.stage5 && Array.isArray(DATA.stage5.questions)
    ? DATA.stage5.questions
    : []
);
var QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map(function (question) {
  return [question.id, question];
}));
var EXPECTED_GROUPS = {
  "co2-ventilation-concentration-balance": {
    "hm2-hygiene-v02-03": "condition",
    "hm2-stage5-018": "case"
  },
  "bile-properties-and-fat-emulsification": {
    "hm2-physiology-v01-02": "rephrase",
    "hm2-stage5-022": "comparison"
  },
  "digestive-enzyme-substrate-matching": {
    "hm2-physiology-v02-05": "case",
    "hm2-stage5-023": "comparison"
  },
  "liver-functions-and-hemoglobin-synthesis-site": {
    "hm2-physiology-v01-05": "rephrase",
    "hm2-stage5-025": "comparison"
  },
  "humoral-vs-cell-mediated-immunity": {
    "hm2-physiology-v02-10": "rephrase",
    "hm2-stage5-029": "comparison"
  }
};
var NEWLY_ANNOTATED_IDS = Object.values(EXPECTED_GROUPS).flatMap(function (group) {
  return Object.keys(group);
});

function sha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function withoutNewMetadata(value) {
  var copy = JSON.parse(JSON.stringify(value));
  var questions = (copy.questions || []).concat(
    copy.stage5 && Array.isArray(copy.stage5.questions)
      ? copy.stage5.questions
      : []
  );

  questions.forEach(function (question) {
    delete question.knowledgeKey;
    delete question.variantType;
  });
  return copy;
}

function select(sourceId) {
  var source = QUESTION_BY_ID[sourceId];
  return SELECTOR.selectRelatedSupplementQuestions({
    questions: QUESTIONS,
    sourceQuestionId: sourceId,
    outcome: "incorrect",
    manualWeak: false,
    allowedStageIds: [1, 2, 3, 4, 5],
    excludedQuestionIds: [],
    limit: 2
  });
}

test("Stage 5の安全な5組だけへknowledgeKeyとvariantTypeを追加する", function () {
  assert.equal(QUESTIONS.length, 111);
  assert.equal(new Set(QUESTIONS.map(function (question) {
    return question.id;
  })).size, 111);
  assert.equal(Object.keys(EXPECTED_GROUPS).length, 5);
  assert.equal(new Set(NEWLY_ANNOTATED_IDS).size, 10);

  Object.keys(EXPECTED_GROUPS).forEach(function (knowledgeKey) {
    var expected = EXPECTED_GROUPS[knowledgeKey];
    var actualIds = QUESTIONS.filter(function (question) {
      return question.knowledgeKey === knowledgeKey;
    }).map(function (question) {
      return question.id;
    }).sort();

    assert.deepEqual(actualIds, Object.keys(expected).sort(), knowledgeKey);
    actualIds.forEach(function (id) {
      assert.equal(QUESTION_BY_ID[id].variantType, expected[id], id);
    });
  });
});

test("追加対象10問の問題本体、正答、難易度、Stage、解説、覚え方は変更しない", function () {
  assert.equal(
    sha256(withoutNewMetadata(DATA)),
    "51e76084dd5ddd2c2fd5508402acc60390ccded5829881a73246c15a53ae692d"
  );
  NEWLY_ANNOTATED_IDS.forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].reasoningLevel, undefined, id);
  });
});

test("既存36協定2問を含む注釈済みは12問で未設定99問を維持する", function () {
  var annotated = QUESTIONS.filter(function (question) {
    return typeof question.knowledgeKey === "string" && question.knowledgeKey;
  });

  assert.equal(annotated.length, 12);
  assert.equal(QUESTIONS.length - annotated.length, 99);
  assert.deepEqual(
    annotated.filter(function (question) {
      return question.knowledgeKey === "overtime-agreement-limits";
    }).map(function (question) {
      return question.id;
    }).sort(),
    ["hm2-law-v02-07", "hm2-law-v02-08"]
  );
});

test("A分類の5組は両方向とも同じknowledgeKeyの1問だけを補習候補にする", function () {
  Object.keys(EXPECTED_GROUPS).forEach(function (knowledgeKey) {
    var ids = Object.keys(EXPECTED_GROUPS[knowledgeKey]);

    ids.forEach(function (sourceId, index) {
      var result = select(sourceId);
      var expectedId = ids[index === 0 ? 1 : 0];

      assert.equal(result.status, "selected", sourceId);
      assert.deepEqual(result.questionIds, [expectedId], sourceId);
      assert.deepEqual(result.selectionReasons, ["knowledge_variant"], sourceId);
      assert.equal(result.questions[0].knowledgeKey, knowledgeKey, sourceId);
    });
  });
});

test("reasoningLevel未設定の5組は正式reviewContext選択へは昇格しない", function () {
  var source = QUESTION_BY_ID["hm2-stage5-018"];
  var result = SELECTOR.selectKnowledgeReviewVariant({
    questions: QUESTIONS,
    reviewTrigger: {
      questionId: source.id,
      knowledgeKey: source.knowledgeKey,
      outcome: "incorrect",
      fluctuationReason: "incorrect"
    },
    currentQuestionId: source.id,
    currentSession: {
      queue: [source.id],
      index: 0
    },
    allowedStageIds: [1, 2, 3, 4, 5],
    reviewStagePolicy: "allowed",
    targetReasoningLevel: 2
  });

  assert.equal(result.question, null);
  assert.equal(result.questionId, "");
  assert.equal(result.selectionReason, "invalid_review_trigger");
});

test("B/C分類の食中毒群は異なる核知識を無理にknowledgeKeyで結ばない", function () {
  var foodPoisoningIds = [
    "hm2-stage5-013",
    "hm2-hygiene-v01-02",
    "hm2-hygiene-v02-06",
    "hm2-hygiene-v02-07"
  ];

  foodPoisoningIds.forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].knowledgeKey, undefined, id);
  });
  assert.deepEqual(select("hm2-stage5-013").questionIds, [
    "hm2-hygiene-v01-02",
    "hm2-hygiene-v02-06"
  ]);
});

test("換気と消化酵素は旧候補0から無関係問題なしの候補1へ改善する", function () {
  var expected = {
    "hm2-stage5-018": "hm2-hygiene-v02-03",
    "hm2-stage5-023": "hm2-physiology-v02-05"
  };

  Object.keys(expected).forEach(function (sourceId) {
    var result = select(sourceId);
    assert.deepEqual(result.questionIds, [expected[sourceId]], sourceId);
    assert.equal(
      result.questions[0].knowledgeKey,
      QUESTION_BY_ID[sourceId].knowledgeKey,
      sourceId
    );
  });
});

test("HTMLはknowledgeKey整備版のselectorと問題JSONを同じ識別子で読む", function () {
  assert.match(
    HTML,
    /hygiene-os-v2-knowledge-review-selector\.js\?v=20260816-stage5-knowledge-keys-01/
  );
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260816-stage5-knowledge-keys-01/
  );
});
