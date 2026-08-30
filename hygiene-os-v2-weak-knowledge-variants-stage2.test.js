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
  "retinal-photoreceptor-color-light-functions": {
    "hm2-physiology-v01-01": "rephrase",
    "hm2-stage5-021": "comparison"
  },
  "cortisol-adrenal-cortex-blood-glucose-effect": {
    "hm2-physiology-v02-04": "condition",
    "hm2-stage5-028": "comparison"
  },
  "pulmonary-circulation-route": {
    "hm2-physiology-v02-01": "case",
    "hm2-stage5-030": "comparison"
  }
};
var TARGET_IDS = Object.values(EXPECTED_GROUPS).flatMap(function (group) {
  return Object.keys(group);
});

function sha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function withoutStage2Metadata(value) {
  var copy = JSON.parse(JSON.stringify(value));
  copy.newQuestionCount = 30;
  copy.verifiedShortageCount = 39;
  copy.stages.find(function (stage) { return stage.id === 4; }).questionCount = 18;
  copy.questions = copy.questions.filter(function (question) {
    return question.id !== "hm2-hygiene-v03-01" &&
      question.id !== "hm2-hygiene-v03-02";
  });
  var questions = (copy.questions || []).concat(
    copy.stage5 && Array.isArray(copy.stage5.questions)
      ? copy.stage5.questions
      : []
  );

  questions.forEach(function (question) {
    if (TARGET_IDS.indexOf(question.id) !== -1) {
      delete question.knowledgeKey;
      delete question.variantType;
    }
    if (question.id === "hm2-stage5-013") {
      delete question.knowledgeKey;
      delete question.variantType;
    }
  });
  return copy;
}

function selectRelated(sourceId) {
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

test("第2段階は安全な既存3組6問だけへknowledgeKeyとvariantTypeを追加する", function () {
  assert.equal(Object.keys(EXPECTED_GROUPS).length, 3);
  assert.equal(new Set(TARGET_IDS).size, 6);

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
    assert.equal(new Set(actualIds.map(function (id) {
      return QUESTION_BY_ID[id].variantType;
    })).size, 2, knowledgeKey);
  });
});

test("問題本文、正答、Stage、難易度、解説、覚え方と問題数は変更しない", function () {
  assert.equal((DATA.questions || []).length, 83);
  assert.equal((DATA.stage5.questions || []).length, 30);
  assert.equal(QUESTIONS.length, 113);
  assert.equal(new Set(QUESTIONS.map(function (question) {
    return question.id;
  })).size, 113);
  assert.equal(
    sha256(withoutStage2Metadata(DATA)),
    "039e8453cbb67a98ac8d4450b4e3b1867c71c4275fd6874502b4833f0c324d0f"
  );

  TARGET_IDS.forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].reasoningLevel, undefined, id);
    assert.equal(QUESTION_BY_ID[id].variantOfQuestionIds, undefined, id);
    assert.equal(QUESTION_BY_ID[id].equivalenceKey, undefined, id);
  });
});

test("食中毒条件variantを含む注釈済み21問、未設定92問となる", function () {
  var annotated = QUESTIONS.filter(function (question) {
    return typeof question.knowledgeKey === "string" && question.knowledgeKey;
  });

  assert.equal(annotated.length, 21);
  assert.equal(QUESTIONS.length - annotated.length, 92);
  assert.equal(new Set(annotated.map(function (question) {
    return question.knowledgeKey;
  })).size, 10);
});

test("視覚、コルチゾール、肺循環は両方向とも別IDの1問へ補習接続する", function () {
  Object.keys(EXPECTED_GROUPS).forEach(function (knowledgeKey) {
    var ids = Object.keys(EXPECTED_GROUPS[knowledgeKey]);

    ids.forEach(function (sourceId, index) {
      var expectedId = ids[index === 0 ? 1 : 0];
      var result = selectRelated(sourceId);

      assert.equal(result.status, "selected", sourceId);
      assert.deepEqual(result.questionIds, [expectedId], sourceId);
      assert.deepEqual(result.selectionReasons, ["knowledge_variant"], sourceId);
      assert.notEqual(
        result.questions[0].question,
        QUESTION_BY_ID[sourceId].question,
        sourceId
      );
    });
  });
});

test("同じ候補poolでは直近の元問題より非直近variantを優先できる", function () {
  Object.keys(EXPECTED_GROUPS).forEach(function (knowledgeKey) {
    var ids = Object.keys(EXPECTED_GROUPS[knowledgeKey]);
    var result = SELECTOR.selectNormalLearningQueue({
      questions: ids.map(function (id) { return QUESTION_BY_ID[id]; }),
      questionStats: Object.fromEntries(ids.map(function (id, index) {
        return [id, {
          wrongActive: true,
          lastOutcome: index === 0 ? "incorrect" : "unsure",
          lastShownOrder: index + 1
        }];
      })),
      recentQuestionIds: [ids[0]],
      excludedQuestionIds: [],
      limit: 1,
      random: function () { return 0; }
    });

    assert.deepEqual(result.questionIds, [ids[1]], knowledgeKey);
    assert.deepEqual(result.details.reusedCooldownQuestionIds, [], knowledgeKey);
  });
});

test("近見調節と他ホルモンは関連テーマでも別の核知識として接続しない", function () {
  [
    "hm2-physiology-v01-08",
    "hm2-physiology-v02-03",
    "hm2-physiology-v02-09"
  ].forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].knowledgeKey, undefined, id);
  });
});

test("食中毒群は感染型対食物内毒素型以外を同じknowledgeKeyへまとめない", function () {
  [
    "hm2-hygiene-v01-02",
    "hm2-hygiene-v02-06",
    "hm2-hygiene-v02-07"
  ].forEach(function (id) {
    assert.equal(QUESTION_BY_ID[id].knowledgeKey, undefined, id);
  });
  assert.equal(
    QUESTION_BY_ID["hm2-stage5-013"].knowledgeKey,
    "food-poisoning-infection-vs-preformed-toxin-type"
  );
});

test("HTMLは新しい問題JSONだけを第2段階キャッシュ識別子で読む", function () {
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260830-staphylococcus-toxin-01/
  );
  assert.match(
    HTML,
    /hygiene-os-v2-knowledge-review-selector\.js\?v=20260823-question-cooldown-01/
  );
});
