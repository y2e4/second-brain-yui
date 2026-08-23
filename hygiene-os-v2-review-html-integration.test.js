"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var REVIEW = require("./hygiene-os-v2-review-context.js");

var ROOT = __dirname;
var HTML = fs.readFileSync(path.join(ROOT, "hygiene-os-v2.html"), "utf8");
var DATA = JSON.parse(fs.readFileSync(
  path.join(ROOT, "hygiene-os-v2-questions.json"),
  "utf8"
));
var CORE_QUESTIONS = DATA.questions;
var QUESTIONS = CORE_QUESTIONS.concat(DATA.stage5.questions);
var GENERAL_ID = "hm2-law-v02-07";
var SPECIAL_ID = "hm2-law-v02-08";
var KEY = "overtime-agreement-limits";
var NOW = "2026-08-02T12:00:00+09:00";
var INLINE_START = HTML.lastIndexOf("<script>");
var INLINE_END = HTML.lastIndexOf("</script>");

function question(id) {
  return QUESTIONS.find(function (item) {
    return item.id === id;
  });
}

function session(sourceId, extra) {
  return Object.assign({
    stage: 3,
    mode: "today",
    queue: [sourceId, "hm2-law-v01-01"],
    index: 0,
    correct: 0,
    recorded: true
  }, extra || {});
}

function trigger(source, outcome, reason) {
  return {
    questionId: source.id,
    knowledgeKey: source.knowledgeKey,
    outcome: outcome,
    fluctuationReason: reason,
    triggeredAt: NOW
  };
}

function start(source, outcome, reason, extra) {
  return REVIEW.selectAndApplyReviewVariant(Object.assign({
    currentSession: session(source.id),
    questions: QUESTIONS,
    allowedStageIds: [3],
    sourceQuestion: source,
    reviewTrigger: trigger(source, outcome, reason),
    reviewStagePolicy: "same",
    targetReasoningLevel: source.reasoningLevel,
    recentQuestionIds: [],
    fixedQueueQuestionIds: [source.id],
    excludeFixedQueueQuestionIds: true
  }, extra || {}));
}

function record(currentSession, answeredQuestion, outcome) {
  return REVIEW.recordReviewOutcome({
    currentSession: currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3],
    question: answeredQuestion,
    outcome: outcome,
    manualWeakQuestionIdsForKnowledgeKey: []
  });
}

function completedSession() {
  var source = question(GENERAL_ID);
  var variant = question(SPECIAL_ID);
  var started = start(source, "incorrect", "incorrect");
  var afterVariant = record(started.currentSession, variant, "understood");
  var completion = record(afterVariant.currentSession, source, "understood");
  return completion.currentSession;
}

test("HTMLは共通JS、移行アダプター、selector、選択肢表示、reviewContextの順に読み込む", function () {
  var common = HTML.indexOf("qualification-os-common.js?v=");
  var migration = HTML.indexOf("hygiene-os-v2-learning-data-migration.js?v=");
  var selector = HTML.indexOf("hygiene-os-v2-knowledge-review-selector.js?v=");
  var choiceShuffle = HTML.indexOf("hygiene-os-v2-choice-shuffle.js?v=");
  var context = HTML.indexOf("hygiene-os-v2-review-context.js?v=");
  var inline = HTML.indexOf("<script>", context);

  assert.ok(common >= 0 && common < migration && migration < selector &&
    selector < choiceShuffle && choiceShuffle < context);
  assert.ok(context < inline);
});

test("専用モジュールは個別のキャッシュ識別子を持つ", function () {
  assert.match(HTML, /knowledge-review-selector\.js\?v=20260823-question-cooldown-01/);
  assert.match(HTML, /choice-shuffle\.js\?v=20260823-stage5-choice-shuffle-01/);
  assert.match(HTML, /review-context\.js\?v=20260802-review-context-01/);
});

test("HTML内JavaScriptは構文として解釈できる", function () {
  assert.ok(INLINE_START >= 0 && INLINE_END > INLINE_START);
  assert.doesNotThrow(function () {
    new Function(HTML.slice(INLINE_START + 8, INLINE_END));
  });
});

test("片方のモジュールが欠けた場合の補習限定フォールバックを持つ", function () {
  assert.match(HTML, /function isKnowledgeReviewApiAvailable\(\)/);
  assert.match(HTML, /review_unavailable/);
  assert.match(HTML, /通常学習は続けられます/);
});

test("normalizeQuestionは派生メタデータと出典確認日を保持する", function () {
  ["knowledgeKey", "variantOfQuestionIds", "variantType", "reasoningLevel", "equivalenceKey", "verifiedAt"]
    .forEach(function (field) {
      assert.match(HTML, new RegExp(field + ":"));
    });
});

test("07のincorrectは08をpendingにする", function () {
  var result = start(question(GENERAL_ID), "incorrect", "incorrect");
  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);
});

test("08のincorrectは07をpendingにする", function () {
  var result = start(question(SPECIAL_ID), "incorrect", "incorrect");
  assert.equal(result.status, "started");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, GENERAL_ID);
});

test("安定したunderstood単独では補習を開始しない", function () {
  var result = start(question(GENERAL_ID), "understood", "understood");
  assert.equal(result.status, "invalid_review_start");
});

test("unsureは補習を開始できる", function () {
  assert.equal(start(question(GENERAL_ID), "unsure", "unsure").status, "started");
});

test("guessは補習を開始できる", function () {
  assert.equal(start(question(GENERAL_ID), "guess", "guess").status, "started");
});

test("manualWeak中のunderstoodは補習を開始できる", function () {
  assert.equal(start(question(GENERAL_ID), "understood", "manualWeak").status, "started");
});

test("reviewContextはJSON往復後もpendingを復元できる", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var restored = JSON.parse(JSON.stringify(started.currentSession));
  var display = REVIEW.resolveDisplayedQuestion({
    currentSession: restored,
    questions: QUESTIONS,
    allowedStageIds: [3]
  });
  assert.equal(display.status, "review_pending");
  assert.equal(display.questionId, SPECIAL_ID);
  assert.equal(restored.index, 0);
});

test("pending中のoverlayは固定キューindexを進めない", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var display = REVIEW.resolveDisplayedQuestion({
    currentSession: started.currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3]
  });
  assert.equal(display.shouldAdvanceQueue, false);
  assert.equal(started.currentSession.index, 0);
});

test("補習回答の拒否はreviewContextを変更しない", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var before = JSON.stringify(started.currentSession);
  var rejected = record(started.currentSession, question(GENERAL_ID), "understood");
  assert.equal(rejected.status, "ignored_unverified_answer");
  assert.equal(JSON.stringify(started.currentSession), before);
});

test("派生問題のincorrect後は同じ派生を再挑戦する", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var result = record(started.currentSession, question(SPECIAL_ID), "incorrect");
  assert.equal(result.currentSession.reviewContext.phase, "unresolved_variant_pending");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);
});

test("派生問題のunderstood後は元問題を再提示する", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var result = record(started.currentSession, question(SPECIAL_ID), "understood");
  assert.equal(result.currentSession.reviewContext.phase, "source_retry_pending");
  assert.equal(result.currentSession.reviewContext.pendingQuestionId, GENERAL_ID);
});

test("元問題のunderstoodでcompletion_candidateになる", function () {
  var afterVariant = record(
    start(question(GENERAL_ID), "incorrect", "incorrect").currentSession,
    question(SPECIAL_ID),
    "understood"
  );
  var result = record(afterVariant.currentSession, question(GENERAL_ID), "understood");
  assert.equal(result.currentSession.reviewContext.phase, "completion_candidate");
});

test("completion_candidateはfinalizeまで自動で進行しない", function () {
  var currentSession = completedSession();
  var display = REVIEW.resolveDisplayedQuestion({
    currentSession: currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3]
  });
  assert.equal(display.status, "completion_candidate");
  assert.equal(currentSession.index, 0);
});

test("finalizeはqueueを一度だけ進める", function () {
  var currentSession = completedSession();
  var first = REVIEW.finalizeCompletedReview({
    currentSession: currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  var second = REVIEW.finalizeCompletedReview({
    currentSession: first.currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  assert.equal(first.status, "finalized");
  assert.equal(first.currentSession.index, 1);
  assert.equal(first.currentSession.recorded, false);
  assert.equal(second.status, "no_review_context");
  assert.equal(second.currentSession.index, 1);
});

test("最終キュー問題のfinalizeは終了位置を返す", function () {
  var source = question(GENERAL_ID);
  var started = start(source, "incorrect", "incorrect", {
    currentSession: session(source.id, { queue: [source.id], index: 0 })
  });
  var variant = record(started.currentSession, question(SPECIAL_ID), "understood");
  var completion = record(variant.currentSession, source, "understood");
  var finalized = REVIEW.finalizeCompletedReview({
    currentSession: completion.currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3],
    manualWeakQuestionIdsForKnowledgeKey: []
  });
  assert.equal(finalized.currentSession.index, finalized.currentSession.queue.length);
});

test("blocked状態は通常学習へ戻るclearだけを許可する", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect", {
    recentQuestionIds: [SPECIAL_ID]
  });
  var cleared = REVIEW.clearReviewContext({
    currentSession: started.currentSession,
    reason: "blocked_route_selected"
  });
  assert.equal(started.currentSession.reviewContext.phase, "no_eligible_variant");
  assert.equal(cleared.status, "cleared");
  assert.equal(cleared.currentSession.reviewContext, undefined);
});

test("no_eligibleは直近除外解除後に再選択できる", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect", {
    recentQuestionIds: [SPECIAL_ID]
  });
  var retried = REVIEW.selectAndApplyReviewVariant({
    currentSession: started.currentSession,
    questions: QUESTIONS,
    allowedStageIds: [3],
    reviewStagePolicy: "same",
    targetReasoningLevel: 2,
    recentQuestionIds: [],
    fixedQueueQuestionIds: [GENERAL_ID],
    excludeFixedQueueQuestionIds: true
  });
  assert.equal(retried.status, "selection_applied");
  assert.equal(retried.currentSession.reviewContext.pendingQuestionId, SPECIAL_ID);
});

test("stage_changedはpending補習をclearできる", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  var cleared = REVIEW.clearReviewContext({
    currentSession: started.currentSession,
    reason: "stage_changed"
  });
  assert.equal(cleared.status, "cleared");
});

test("new_session_startedはpending補習をclearできる", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  assert.equal(REVIEW.clearReviewContext({
    currentSession: started.currentSession,
    reason: "new_session_started"
  }).status, "cleared");
});

test("session_discardedはpending補習をclearできる", function () {
  var started = start(question(GENERAL_ID), "incorrect", "incorrect");
  assert.equal(REVIEW.clearReviewContext({
    currentSession: started.currentSession,
    reason: "session_discarded"
  }).status, "cleared");
});

test("正式reviewContext対象は36協定2問のままで未注釈71問も通常問題として残る", function () {
  var unannotated = CORE_QUESTIONS.filter(function (item) { return !item.knowledgeKey; });
  var formalReviewTargets = CORE_QUESTIONS.filter(function (item) {
    return item.knowledgeKey === KEY;
  });

  assert.equal(unannotated.length, 71);
  assert.deepEqual(formalReviewTargets.map(function (item) {
    return item.id;
  }).sort(), [GENERAL_ID, SPECIAL_ID]);
  assert.ok(unannotated.every(function (item) { return item.id !== GENERAL_ID && item.id !== SPECIAL_ID; }));
});

test("補習統計は候補stateで更新してからreviewContextを記録する", function () {
  var statsUpdate = HTML.indexOf("function applyOutcomeToCandidate");
  var reviewUpdate = HTML.indexOf("recordReviewOutcome({", statsUpdate);
  var commit = HTML.indexOf("commitCandidateState(candidateState)", reviewUpdate);
  assert.ok(statsUpdate >= 0 && statsUpdate < reviewUpdate && reviewUpdate < commit);
});

test("補習回答はsession.correctへ加算しない分岐を持つ", function () {
  assert.match(HTML, /countSessionCorrect: !reviewWasActive/);
  assert.match(HTML, /if \(settings\.countSessionCorrect !== false\)/);
});

test("保存失敗時は同じ問題の回答UIだけを再操作可能な状態へ戻す", function () {
  var helperStart = HTML.indexOf("function restoreAnswerUiAfterSaveFailure()");
  var helperEnd = HTML.indexOf("function chooseAnswer", helperStart);
  var helper = HTML.slice(helperStart, helperEnd);

  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  assert.match(helper, /pendingAnswer = ""/);
  assert.match(helper, /confidencePanel\.hidden = true/);
  assert.match(helper, /button\.disabled = false/);
  assert.match(helper, /button\.classList\.remove\("is-correct", "is-wrong"\)/);
  assert.doesNotMatch(helper, /state\.|saveState\(|commitCandidateState\(/);
});

test("通常・補習共通の保存失敗分岐はUI復帰後にstateを保存しない", function () {
  var functionStart = HTML.indexOf("function recordOutcome(outcome, selectedAnswer)");
  var failureStart = HTML.indexOf("if (!committed.saved)", functionStart);
  var failureEnd = HTML.indexOf("pendingAnswer = \"\";", failureStart);
  var failure = HTML.slice(failureStart, failureEnd);

  assert.ok(functionStart >= 0 && failureStart > functionStart && failureEnd > failureStart);
  assert.match(failure, /restoreAnswerUiAfterSaveFailure\(\)/);
  assert.doesNotMatch(failure, /saveState\(|commitCandidateState\(/);
});

test("保存失敗後の再試行成功は古いエラー表示だけを解除する", function () {
  var functionStart = HTML.indexOf("function recordOutcome(outcome, selectedAnswer)");
  var failureStart = HTML.indexOf("if (!committed.saved)", functionStart);
  var successStart = HTML.indexOf("modeStatus.textContent = \"\";", failureStart);
  var feedbackStart = HTML.indexOf("showFeedback(question, outcome, selectedAnswer);", successStart);
  var success = HTML.slice(successStart, feedbackStart);

  assert.ok(successStart > failureStart && feedbackStart > successStart);
  assert.match(success, /modeStatus\.textContent = ""/);
  assert.doesNotMatch(success, /state\.|questionStats|learningData|reviewContext/);
});

test("保存・エクスポート・インポートはcurrentSessionを保持する既存経路を維持する", function () {
  assert.match(HTML, /currentSession: cloneJson\(state\.currentSession\)/);
  assert.match(HTML, /next\.currentSession = cloneJson\(source\.currentSession\)/);
  assert.match(HTML, /restoreCurrentSessionView\(\)/);
});

test("再読み込みではreviewContextを通常recorded進行より先に確認する", function () {
  var functionStart = HTML.indexOf("function restoreCurrentSessionView()");
  var reviewCheck = HTML.indexOf("if (hasReviewContext(session))", functionStart);
  var recordedCheck = HTML.indexOf("if (session.recorded)", functionStart);
  assert.ok(functionStart >= 0 && reviewCheck > functionStart && reviewCheck < recordedCheck);
});

test("最終問題のfinalize済み状態は再読み込み後も結果画面へ復元する", function () {
  var functionStart = HTML.indexOf("function restoreCurrentSessionView()");
  var reviewCheck = HTML.indexOf("if (hasReviewContext(session))", functionStart);
  var completionCheck = HTML.indexOf("if (session.index === session.queue.length)", reviewCheck);
  var completionEnd = HTML.indexOf("if (session.recorded)", completionCheck);
  var completion = HTML.slice(completionCheck, completionEnd);

  assert.ok(completionCheck > reviewCheck && completionEnd > completionCheck);
  assert.match(completion, /showResult\(\{ skipSave: true \}\)/);
  assert.match(completion, /return true/);
  assert.doesNotMatch(completion, /renderQuestion\(/);
});

test("補習中nextQuestionは固定キューindexを進めない分岐を持つ", function () {
  var startIndex = HTML.indexOf("function nextQuestion()");
  var reviewBranch = HTML.indexOf("if (hasReviewContext(session))", startIndex);
  var increment = HTML.indexOf("session.index += 1", startIndex);
  assert.ok(reviewBranch > startIndex && reviewBranch < increment);
});

test("completionはfinalizeKnowledgeReviewだけを接続する", function () {
  assert.match(HTML, /reviewFinalizeButton\.addEventListener\("click", finalizeKnowledgeReview\)/);
  assert.match(HTML, /finalizeCompletedReview\(/);
  assert.doesNotMatch(HTML, /user_completed_review/);
});

test("通常キューの終了画面はfinalize後のindex === queue.lengthを扱える", function () {
  assert.match(HTML, /state\.currentSession\.index >= state\.currentSession\.queue\.length/);
  assert.match(HTML, /showResult\(\{ skipSave: true \}\)/);
});

test("既存81問と追加事例1問、Stage5追加30問の配分を維持する", function () {
  var counts = [1, 2, 3, 4, 5].map(function (stage) {
    return QUESTIONS.filter(function (item) { return item.stage === stage; }).length;
  });
  assert.equal(CORE_QUESTIONS.length, 82);
  assert.equal(QUESTIONS.length, 112);
  assert.deepEqual(counts, [30, 19, 14, 19, 30]);
});

test("初回対象はovertime-agreement-limitsの2問に限定される", function () {
  assert.match(HTML, /KNOWLEDGE_REVIEW_KEY = "overtime-agreement-limits"/);
  assert.match(HTML, /KNOWLEDGE_REVIEW_QUESTION_IDS = \["hm2-law-v02-07", "hm2-law-v02-08"\]/);
});
