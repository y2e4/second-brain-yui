"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");
var REVIEW = require("./hygiene-os-v2-review-context.js");

var NOW = "2026-08-02T12:00:00+09:00";
var KNOWLEDGE_KEY = "overtime-agreement-limits";
var GENERAL_ID = "hm2-law-v02-07";
var SPECIAL_ID = "hm2-law-v02-08";
var GENERAL_SCOPE = "1年単位の変形労働時間制、労働時間に関する適用猶予・適用除外又は業務別特例が適用されない一般の労働者について";
var data = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var publicQuestions = data.questions;
var questionById = Object.fromEntries(publicQuestions.map(function (question) {
  return [question.id, question];
}));
var general = questionById[GENERAL_ID];
var special = questionById[SPECIAL_ID];

function trigger(question, outcome, fluctuationReason) {
  return {
    questionId: question.id,
    knowledgeKey: question.knowledgeKey,
    outcome: outcome,
    fluctuationReason: fluctuationReason,
    triggeredAt: NOW
  };
}

function sourceSession(sourceQuestionId) {
  return {
    stage: 3,
    mode: "today",
    queue: [sourceQuestionId],
    index: 0,
    correct: 0,
    recorded: false
  };
}

function selectVariant(sourceQuestion, outcome) {
  return SELECTOR.selectKnowledgeReviewVariant({
    questions: publicQuestions,
    reviewTrigger: trigger(sourceQuestion, outcome, outcome),
    currentQuestionId: sourceQuestion.id,
    currentSession: sourceSession(sourceQuestion.id),
    allowedStageIds: [3],
    reviewStagePolicy: "same",
    targetReasoningLevel: sourceQuestion.reasoningLevel,
    selectedAt: NOW
  });
}

function recordReview(currentSession, question, outcome) {
  return REVIEW.recordReviewOutcome({
    currentSession: currentSession,
    questions: publicQuestions,
    allowedStageIds: [3],
    question: question,
    outcome: outcome,
    manualWeakQuestionIdsForKnowledgeKey: []
  });
}

test("36協定の初回knowledgeKeyは既存公開81問中の指定2問だけを注釈する", function () {
  var ids = publicQuestions.map(function (question) { return question.id; });
  var annotatedIds = publicQuestions.filter(function (question) {
    return typeof question.knowledgeKey === "string" && question.knowledgeKey;
  }).map(function (question) {
    return question.id;
  }).sort();

  assert.equal(publicQuestions.length, 81);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    [1, 2, 3, 4].map(function (stage) {
      return publicQuestions.filter(function (question) {
        return question.stage === stage;
      }).length;
    }),
    [30, 19, 14, 18]
  );
  assert.deepEqual(annotatedIds, [GENERAL_ID, SPECIAL_ID]);
  assert.equal(publicQuestions.filter(function (question) {
    return !question.knowledgeKey;
  }).length, 79);
});

test("原則上限と特別条項のmetadata、Stage、出典、正答を固定する", function () {
  [general, special].forEach(function (question) {
    assert.ok(question);
    assert.equal(question.knowledgeKey, KNOWLEDGE_KEY);
    assert.equal(question.stage, 3);
    assert.equal(question.sourceType, "official_public_question_based");
    assert.match(question.sourceTitle, /第二種衛生管理者 公表問題 2026年4月/);
    assert.equal(question.sourceQuestion, "問10");
    assert.match(question.sourceUrl, /^https:\/\/www\.exam\.or\.jp\//);
    assert.equal(question.verifiedAt, "2026-08-02");
    assert.equal(typeof question.answer, "boolean");
  });
  assert.equal(general.variantType, "rephrase");
  assert.equal(general.reasoningLevel, 2);
  assert.deepEqual(general.variantOfQuestionIds, []);
  assert.equal(general.equivalenceKey, "overtime-agreement-limits-general-rule");
  assert.equal(special.variantType, "exception");
  assert.equal(special.reasoningLevel, 3);
  assert.deepEqual(special.variantOfQuestionIds, [GENERAL_ID]);
  assert.equal(special.equivalenceKey, "overtime-agreement-limits-special-clause");
  assert.notEqual(general.equivalenceKey, special.equivalenceKey);
  assert.notEqual(general.question, special.question);
  assert.equal(general.answer, true);
  assert.equal(special.answer, true);
  assert.equal(
    general.question,
    GENERAL_SCOPE + "、36協定による時間外労働の原則的な上限は、月45時間かつ年360時間である。"
  );
  assert.equal(
    general.explanation,
    "臨時的な特別の事情がない通常の場合、時間外労働は月45時間、年360時間が原則的な上限です。"
  );
  assert.match(special.question, /特別条項付き36協定/);
  assert.ok(general.question.indexOf(GENERAL_SCOPE) === 0);
  assert.ok(special.question.indexOf(GENERAL_SCOPE) === 0);
  assert.match(special.question, /年720時間以内/);
  assert.match(special.question, /単月100時間未満/);
  assert.match(special.explanation, /年720時間以内/);
  assert.match(special.explanation, /時間外労働と休日労働の合計は、単月100時間未満/);
  assert.match(special.explanation, /時間外労働と休日労働の合計は、単月100時間未満であり、2〜6か月平均80時間以内/);
  assert.match(special.explanation, /月45時間を超える時間外労働は年6か月まで/);
  assert.doesNotMatch(special.question + special.explanation, /建設業|自動車運転|医師/);
});

test("原則上限の揺らぎは特別条項問題へ、特別条項の揺らぎは原則問題へつながる", function () {
  var fromGeneral = selectVariant(general, "incorrect");
  var fromSpecial = selectVariant(special, "incorrect");

  assert.equal(fromGeneral.questionId, SPECIAL_ID);
  assert.equal(fromGeneral.selectionReason, "direct_variant");
  assert.equal(fromSpecial.questionId, GENERAL_ID);
  assert.equal(fromSpecial.selectionReason, "knowledge_variant_type");
  assert.equal(fromGeneral.question.knowledgeKey, KNOWLEDGE_KEY);
  assert.equal(fromSpecial.question.knowledgeKey, KNOWLEDGE_KEY);
});

test("実問題2問だけで補習開始から再挑戦、完了、finalizeまで到達できる", function () {
  var started = REVIEW.selectAndApplyReviewVariant({
    currentSession: sourceSession(GENERAL_ID),
    questions: publicQuestions,
    allowedStageIds: [3],
    sourceQuestion: general,
    reviewTrigger: trigger(general, "incorrect", "incorrect"),
    reviewStagePolicy: "same",
    targetReasoningLevel: general.reasoningLevel,
    recentQuestionIds: []
  });
  var retried;
  var afterVariantWrong;
  var afterVariantUnderstood;
  var completion;
  var finalized;

  assert.equal(started.status, "started");
  assert.equal(started.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);

  afterVariantWrong = recordReview(started.currentSession, special, "incorrect");
  assert.equal(afterVariantWrong.status, "recorded");
  assert.equal(afterVariantWrong.currentSession.reviewContext.phase, "unresolved_variant_pending");
  assert.equal(afterVariantWrong.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);

  retried = REVIEW.selectAndApplyReviewVariant({
    currentSession: afterVariantWrong.currentSession,
    questions: publicQuestions,
    allowedStageIds: [3],
    reviewStagePolicy: "same",
    targetReasoningLevel: special.reasoningLevel,
    recentQuestionIds: []
  });
  assert.equal(retried.status, "selection_applied");
  assert.equal(retried.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);

  afterVariantUnderstood = recordReview(retried.currentSession, special, "understood");
  assert.equal(afterVariantUnderstood.status, "recorded");
  assert.equal(afterVariantUnderstood.currentSession.reviewContext.phase, "source_retry_pending");
  assert.equal(afterVariantUnderstood.currentSession.reviewContext.pendingQuestionId, GENERAL_ID);

  completion = recordReview(afterVariantUnderstood.currentSession, general, "understood");
  assert.equal(completion.status, "recorded");
  assert.equal(completion.currentSession.reviewContext.phase, "completion_candidate");

  finalized = REVIEW.finalizeCompletedReview({
    currentSession: completion.currentSession,
    questions: publicQuestions,
    allowedStageIds: [3],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.currentSession.reviewContext, undefined);
  assert.equal(finalized.currentSession.index, 1);
  assert.equal(finalized.currentSession.recorded, false);
});

test("metadata未設定の他79問は補習候補外の通常問題として残る", function () {
  var unannotated = publicQuestions.filter(function (question) {
    return !question.knowledgeKey;
  });
  var result = selectVariant(general, "incorrect");

  assert.equal(unannotated.length, 79);
  assert.equal(result.questionId, SPECIAL_ID);
  assert.ok(unannotated.every(function (question) {
    return question.id !== result.questionId && !question.knowledgeKey;
  }));
});
