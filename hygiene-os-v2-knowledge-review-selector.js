(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HygieneOSV2KnowledgeReviewSelector = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VARIANT_TYPES = ["rephrase", "condition", "comparison", "exception", "case"];
  var OUTCOMES = ["understood", "unsure", "guess", "ambiguous", "incorrect"];
  var FLUCTUATION_REASONS = ["incorrect", "unsure", "guess", "ambiguous", "manualWeak"];
  var RECENT_QUESTION_LIMIT = 20;
  var DEFAULT_MAX_REASONING_DISTANCE = 2;
  var SELECTION_PROOF_VERSION = 1;
  var REVIEW_STAGE_POLICIES = ["same", "allowed"];
  var REVIEW_SELECTION_MODES = ["new_variant", "retry_unresolved_variant"];
  var ELIGIBLE_SELECTION_REASONS = [
    "direct_variant", "knowledge_variant_type", "knowledge_variant_reasoning"
  ];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function toId(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function uniqueIds(values) {
    var result = [];
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var id = toId(value);
      if (id && result.indexOf(id) === -1) {
        result.push(id);
      }
    });
    return result;
  }

  function latestUniqueIds(values, limit) {
    var result = [];
    var max = Number.isInteger(limit) && limit > 0 ? limit : RECENT_QUESTION_LIMIT;

    (Array.isArray(values) ? values : []).forEach(function (value) {
      var id = toId(value);
      var previousIndex;
      if (!id) {
        return;
      }
      previousIndex = result.indexOf(id);
      if (previousIndex !== -1) {
        result.splice(previousIndex, 1);
      }
      result.push(id);
    });
    return result.slice(-max);
  }

  function toIdSet(values) {
    var result = {};
    uniqueIds(values).forEach(function (id) {
      result[id] = true;
    });
    return result;
  }

  function compareIds(left, right) {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  }

  function normalizeLevel(value, fallback) {
    var parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
      return parsed;
    }
    return fallback;
  }

  function normalizeMaxReasoningDistance(value) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      return DEFAULT_MAX_REASONING_DISTANCE;
    }
    return Math.min(value, 4);
  }

  function normalizeStageIds(values) {
    var result = {};
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var stage = Number(value);
      if (Number.isInteger(stage) && stage >= 1 && stage <= 5) {
        result[String(stage)] = true;
      }
    });
    return result;
  }

  function isValidIsoTimestamp(value) {
    var text = toId(value);
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) &&
      Number.isFinite(Date.parse(text));
  }

  function hasValues(object) {
    return Object.keys(object).length > 0;
  }

  function getEquivalenceKey(question) {
    var explicit = toId(question && question.equivalenceKey);
    return explicit || toId(question && question.id);
  }

  function createProofToken(proof) {
    var fields = [
      proof.version,
      proof.questionId,
      proof.knowledgeKey,
      proof.sourceQuestionId,
      proof.stage,
      proof.variantType,
      proof.reasoningLevel,
      proof.selectionReason,
      proof.selectionMode,
      proof.selectedAt
    ];
    var text = fields.join("\u001f");
    var hash = 2166136261;
    var index;

    for (index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
    }
    return "review-proof-v1-" + (hash >>> 0).toString(16);
  }

  function createSelectionProof(input) {
    var settings = isPlainObject(input) ? input : {};
    var question = normalizeQuestion(settings.question);
    var sourceQuestionId = toId(settings.sourceQuestionId);
    var knowledgeKey = toId(settings.knowledgeKey);
    var selectionReason = toId(settings.selectionReason);
    var selectionMode = toId(settings.selectionMode) || "new_variant";
    var selectedAt = toId(settings.selectedAt);
    var proof;

    if (!question.valid || !sourceQuestionId || knowledgeKey !== question.knowledgeKey ||
        ELIGIBLE_SELECTION_REASONS.indexOf(selectionReason) === -1 ||
        REVIEW_SELECTION_MODES.indexOf(selectionMode) === -1 ||
        !isValidIsoTimestamp(selectedAt)) {
      return null;
    }
    proof = {
      version: SELECTION_PROOF_VERSION,
      questionId: question.id,
      knowledgeKey: knowledgeKey,
      sourceQuestionId: sourceQuestionId,
      stage: question.stage,
      variantType: question.variantType,
      reasoningLevel: question.reasoningLevel,
      selectionReason: selectionReason,
      selectionMode: selectionMode,
      selectedAt: selectedAt
    };
    proof.proofToken = createProofToken(proof);
    return proof;
  }

  function verifySelectionProof(input) {
    var settings = isPlainObject(input) ? input : {};
    var proof = isPlainObject(settings.proof) ? settings.proof : {};
    var questionSource = isPlainObject(settings.question)
      ? settings.question
      : {
        id: proof.questionId,
        knowledgeKey: proof.knowledgeKey,
        stage: proof.stage,
        variantType: proof.variantType,
        reasoningLevel: proof.reasoningLevel
      };
    var question = normalizeQuestion(questionSource);
    var expected = createSelectionProof({
      question: question.raw,
      knowledgeKey: settings.knowledgeKey || proof.knowledgeKey,
      sourceQuestionId: settings.sourceQuestionId || proof.sourceQuestionId,
      selectionReason: settings.selectionReason || proof.selectionReason,
      selectionMode: settings.selectionMode || proof.selectionMode,
      selectedAt: settings.selectedAt || proof.selectedAt
    });

    if (!expected || proof.version !== expected.version ||
        toId(proof.questionId) !== expected.questionId ||
        toId(proof.knowledgeKey) !== expected.knowledgeKey ||
        toId(proof.sourceQuestionId) !== expected.sourceQuestionId ||
        Number(proof.stage) !== expected.stage ||
        toId(proof.variantType) !== expected.variantType ||
        Number(proof.reasoningLevel) !== expected.reasoningLevel ||
        toId(proof.selectionReason) !== expected.selectionReason ||
        toId(proof.selectionMode) !== expected.selectionMode ||
        toId(proof.selectedAt) !== expected.selectedAt) {
      return false;
    }
    return toId(proof.proofToken) === expected.proofToken;
  }

  function normalizeQuestion(raw) {
    var question = isPlainObject(raw) ? raw : {};
    var id = toId(question.id);
    var knowledgeKey = toId(question.knowledgeKey);
    var variantType = toId(question.variantType);
    var reasoningLevel = normalizeLevel(question.reasoningLevel, 0);
    var stage = Number(question.stage);

    return {
      raw: question,
      id: id,
      knowledgeKey: knowledgeKey,
      variantOfQuestionIds: uniqueIds(question.variantOfQuestionIds),
      variantType: variantType,
      reasoningLevel: reasoningLevel,
      stage: stage,
      equivalenceKey: getEquivalenceKey(question),
      valid: Boolean(id && knowledgeKey &&
        VARIANT_TYPES.indexOf(variantType) !== -1 &&
        reasoningLevel >= 1 && reasoningLevel <= 5 &&
        Number.isInteger(stage) && stage >= 1 && stage <= 5)
    };
  }

  function normalizeSupplementQuestion(raw) {
    var question = isPlainObject(raw) ? raw : {};
    var id = toId(question.id);
    var stage = Number(question.stage);
    var questionText = toId(question.question || question.statement);
    var choices = Array.isArray(question.choices) ? question.choices : [];
    var hasAnswer = toId(question.answer) || Number.isInteger(question.correctIndex);
    var hasUsableChoices = choices.length >= 2 || typeof question.answer === "boolean";

    return {
      raw: question,
      id: id,
      stage: stage,
      category: toId(question.category),
      theme: toId(question.theme),
      questionText: questionText,
      knowledgeKey: toId(question.knowledgeKey),
      variantOfQuestionIds: uniqueIds(question.variantOfQuestionIds),
      variantType: toId(question.variantType),
      reasoningLevel: normalizeLevel(question.reasoningLevel, 0),
      equivalenceKey: getEquivalenceKey(question),
      valid: Boolean(id && Number.isInteger(stage) && stage >= 1 && stage <= 5 &&
        questionText && hasUsableChoices && hasAnswer)
    };
  }

  function hasVerifiedSupplementMetadata(question) {
    return Boolean(question && question.knowledgeKey &&
      VARIANT_TYPES.indexOf(question.variantType) !== -1);
  }

  function isRelatedSupplementTrigger(outcome, manualWeak) {
    if (outcome === "understood") {
      return manualWeak === true;
    }
    return ["incorrect", "unsure", "guess", "ambiguous"].indexOf(outcome) !== -1;
  }

  function getSupplementRelation(source, candidate) {
    var directRelation;
    var variantRank;

    if (source.knowledgeKey) {
      if (candidate.knowledgeKey !== source.knowledgeKey ||
          !hasVerifiedSupplementMetadata(source) ||
          !hasVerifiedSupplementMetadata(candidate)) {
        return null;
      }
      directRelation = candidate.variantOfQuestionIds.indexOf(source.id) !== -1 ||
        source.variantOfQuestionIds.indexOf(candidate.id) !== -1;
      return {
        rank: directRelation ? 0 : 1,
        reason: directRelation ? "direct_knowledge_variant" : "knowledge_variant",
        directRelation: directRelation
      };
    }

    if (!source.theme || source.theme === "未設定" || candidate.theme !== source.theme) {
      return null;
    }
    variantRank = {
      comparison: 2,
      condition: 3,
      exception: 3,
      case: 4,
      rephrase: 5
    }[candidate.variantType];
    return {
      rank: variantRank === undefined ? 6 : variantRank,
      reason: variantRank === undefined
        ? "same_theme"
        : "same_theme_" + candidate.variantType,
      directRelation: false
    };
  }

  function selectRelatedSupplementQuestions(input) {
    var settings = isPlainObject(input) ? input : {};
    var rawQuestions = Array.isArray(settings.questions) ? settings.questions : [];
    var idCounts = {};
    var questions = [];
    var questionById = {};
    var duplicateIds;
    var sourceQuestionId = toId(settings.sourceQuestionId ||
      (settings.sourceQuestion && settings.sourceQuestion.id));
    var source;
    var outcome = toId(settings.outcome);
    var allowedStageIds = normalizeStageIds(settings.allowedStageIds);
    var hasExplicitStages = Array.isArray(settings.allowedStageIds);
    var excludedIds = toIdSet(settings.excludedQuestionIds);
    var limit = Number.isInteger(settings.limit) && settings.limit >= 1
      ? Math.min(settings.limit, 2)
      : 2;
    var candidates;
    var selected;

    rawQuestions.forEach(function (raw) {
      var question = normalizeSupplementQuestion(raw);
      if (question.id) {
        idCounts[question.id] = Number(idCounts[question.id] || 0) + 1;
      }
      if (question.valid) {
        questions.push(question);
      }
    });
    duplicateIds = Object.keys(idCounts).filter(function (id) {
      return idCounts[id] > 1;
    }).sort(compareIds);
    if (duplicateIds.length) {
      return {
        status: "invalid_question_catalog",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: { duplicateIds: duplicateIds }
      };
    }
    questions.forEach(function (question) {
      questionById[question.id] = question;
    });
    source = questionById[sourceQuestionId];
    if (!source) {
      return {
        status: "invalid_source_question",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: {}
      };
    }
    if (!isRelatedSupplementTrigger(outcome, settings.manualWeak === true)) {
      return {
        status: "stable_understanding",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: {}
      };
    }
    if (hasExplicitStages && !hasValues(allowedStageIds)) {
      return {
        status: "invalid_allowed_stages",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: {}
      };
    }
    if (!hasExplicitStages) {
      allowedStageIds[String(source.stage)] = true;
    }
    if (!allowedStageIds[String(source.stage)]) {
      return {
        status: "source_stage_not_allowed",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: {}
      };
    }

    excludedIds[source.id] = true;
    candidates = questions.map(function (candidate) {
      var relation;
      var reasoningDistance;
      if (excludedIds[candidate.id] ||
          !allowedStageIds[String(candidate.stage)] ||
          candidate.questionText === source.questionText ||
          candidate.equivalenceKey === source.equivalenceKey) {
        return null;
      }
      relation = getSupplementRelation(source, candidate);
      if (!relation) {
        return null;
      }
      reasoningDistance = source.reasoningLevel && candidate.reasoningLevel
        ? Math.abs(source.reasoningLevel - candidate.reasoningLevel)
        : 0;
      return {
        question: candidate,
        relation: relation,
        reasoningDistance: reasoningDistance
      };
    }).filter(Boolean).sort(function (left, right) {
      if (left.relation.rank !== right.relation.rank) {
        return left.relation.rank - right.relation.rank;
      }
      if (left.reasoningDistance !== right.reasoningDistance) {
        return left.reasoningDistance - right.reasoningDistance;
      }
      return compareIds(left.question.id, right.question.id);
    });
    selected = candidates.slice(0, limit);
    if (!selected.length) {
      return {
        status: "no_related_supplement",
        questions: [],
        questionIds: [],
        selectionReasons: [],
        fallback: "continue_normal_learning",
        details: { candidateCount: 0 }
      };
    }
    return {
      status: "selected",
      questions: selected.map(function (item) {
        return copyQuestionForResult(item.question.raw);
      }),
      questionIds: selected.map(function (item) {
        return item.question.id;
      }),
      selectionReasons: selected.map(function (item) {
        return item.relation.reason;
      }),
      fallback: "",
      details: { candidateCount: candidates.length }
    };
  }

  function cloneJsonCompatible(value, ancestors) {
    var trail = Array.isArray(ancestors) ? ancestors : [];
    var nextTrail;
    var output;

    if (value === null ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean") {
      return value;
    }
    if (typeof value !== "object" || trail.indexOf(value) !== -1) {
      return null;
    }
    nextTrail = trail.concat([value]);
    if (Array.isArray(value)) {
      return value.map(function (item) {
        return cloneJsonCompatible(item, nextTrail);
      });
    }
    if (!isPlainObject(value)) {
      return null;
    }
    output = {};
    Object.keys(value).forEach(function (key) {
      output[key] = cloneJsonCompatible(value[key], nextTrail);
    });
    return output;
  }

  function copyQuestionForResult(raw) {
    return isPlainObject(raw) ? cloneJsonCompatible(raw, []) : {};
  }

  function normalizeQuestions(values) {
    var idCounts = {};
    var invalidCount = 0;
    var normalized = [];
    var duplicateIds;
    var questions;

    (Array.isArray(values) ? values : []).forEach(function (raw) {
      var question = normalizeQuestion(raw);
      if (question.id) {
        idCounts[question.id] = (idCounts[question.id] || 0) + 1;
      }
      if (!question.valid) {
        invalidCount += 1;
        return;
      }
      normalized.push(question);
    });

    duplicateIds = Object.keys(idCounts).filter(function (id) {
      return idCounts[id] > 1;
    }).sort(compareIds);
    questions = normalized.filter(function (question) {
      return idCounts[question.id] === 1;
    });

    return {
      questions: questions,
      invalidCount: invalidCount,
      duplicateIds: duplicateIds,
      hasDuplicateIds: duplicateIds.length > 0
    };
  }

  function getAnsweredSessionIds(session) {
    var safe = isPlainObject(session) ? session : {};
    var ids = [];
    var index = Number.isInteger(safe.index) ? safe.index : 0;

    if (Array.isArray(safe.queue)) {
      ids = ids.concat(safe.queue.slice(0, Math.max(0, index)));
      if (safe.recorded === true && safe.queue[index]) {
        ids.push(safe.queue[index]);
      }
    }
    if (Array.isArray(safe.answerRecords)) {
      ids = ids.concat(safe.answerRecords.map(function (record) {
        return record && (record.questionId || record.id);
      }));
    }
    return toIdSet(ids);
  }

  function getTargetReasoningLevel(input, trigger) {
    var settings = isPlainObject(input) ? input : {};
    var learningData = isPlainObject(settings.learningData) ? settings.learningData : {};
    var adaptive = isPlainObject(settings.adaptiveDifficulty)
      ? settings.adaptiveDifficulty
      : isPlainObject(learningData.adaptiveDifficulty)
        ? learningData.adaptiveDifficulty
        : {};

    return normalizeLevel(
      settings.targetReasoningLevel || adaptive.reasoningLevel,
      trigger.reasoningLevel
    );
  }

  function isCandidateDerivedFrom(candidate, trigger) {
    return candidate.variantOfQuestionIds.indexOf(trigger.id) !== -1;
  }

  function makeEmptyResult(reason, trigger, details) {
    var safeDetails = details || {};
    return {
      question: null,
      questionId: "",
      knowledgeKey: trigger ? trigger.knowledgeKey : "",
      selectionReason: reason,
      triggerQuestionId: trigger ? trigger.id : "",
      variantType: "",
      reasoningLevel: null,
      directRelation: false,
      fallback: "continue_normal_learning",
      reviewAvailability: safeDetails.reviewAvailability || "unknown",
      selectionMode: safeDetails.selectionMode || "new_variant",
      details: safeDetails
    };
  }

  function isValidFluctuationTrigger(outcome, fluctuationReason) {
    if (FLUCTUATION_REASONS.indexOf(fluctuationReason) === -1) {
      return false;
    }
    if (fluctuationReason === "manualWeak") {
      return outcome === "understood";
    }
    return outcome === fluctuationReason;
  }

  function getReviewTrigger(input, questionsById) {
    var trigger = isPlainObject(input && input.reviewTrigger) ? input.reviewTrigger : {};
    var triggerId = toId(trigger.questionId);
    var knowledgeKey = toId(trigger.knowledgeKey);
    var outcome = toId(trigger.outcome);
    var fluctuationReason = toId(trigger.fluctuationReason);
    var triggeredAt = toId(trigger.triggeredAt);
    var question = questionsById[triggerId];

    if (!triggerId || !knowledgeKey || !triggeredAt ||
        OUTCOMES.indexOf(outcome) === -1 ||
        !isValidFluctuationTrigger(outcome, fluctuationReason)) {
      return { question: null, reason: "invalid_review_trigger" };
    }
    if (!question) {
      return { question: null, reason: "trigger_question_missing" };
    }
    if (question.knowledgeKey !== knowledgeKey) {
      return { question: null, reason: "trigger_knowledge_mismatch" };
    }
    return { question: question, reason: "" };
  }

  function getStageIdsForReview(input, trigger) {
    var settings = isPlainObject(input) ? input : {};
    var reviewStagePolicy = toId(settings.reviewStagePolicy) || "same";
    var hasExplicitStages = Array.isArray(settings.allowedStageIds) &&
      settings.allowedStageIds.length > 0;
    var stageIds = normalizeStageIds(settings.allowedStageIds);

    if (REVIEW_STAGE_POLICIES.indexOf(reviewStagePolicy) === -1) {
      return { stageIds: {}, reason: "invalid_review_stage_policy" };
    }

    if (hasExplicitStages) {
      if (!hasValues(stageIds)) {
        return { stageIds: {}, reason: "invalid_allowed_stages" };
      }
      if (!stageIds[String(trigger.stage)]) {
        return { stageIds: stageIds, reason: "trigger_stage_not_allowed" };
      }
      if (reviewStagePolicy === "allowed") {
        return { stageIds: stageIds, reason: "" };
      }
      return { stageIds: (function () {
        var triggerStageOnly = {};
        triggerStageOnly[String(trigger.stage)] = true;
        return triggerStageOnly;
      }()), reason: "" };
    }
    if (reviewStagePolicy === "allowed") {
      return { stageIds: {}, reason: "missing_allowed_stages" };
    }
    stageIds[String(trigger.stage)] = true;
    return { stageIds: stageIds, reason: "" };
  }

  function getExclusions(input, trigger, source, questionsById) {
    var settings = isPlainObject(input) ? input : {};
    var fixedQueueIds = settings.excludeFixedQueueQuestionIds === true
      ? uniqueIds(settings.fixedQueueQuestionIds)
      : [];
    var hardEquivalenceKeys = toIdSet(settings.excludedEquivalenceKeys);
    var explicitCurrentQuestionId = toId(settings.currentQuestionId);
    var currentQuestionId = explicitCurrentQuestionId || trigger.id;
    var currentQuestion = questionsById[currentQuestionId];
    var stageSettings = getStageIdsForReview(settings, trigger);

    if (explicitCurrentQuestionId && !currentQuestion) {
      return {
        currentQuestionId: currentQuestionId,
        answeredSessionIds: {},
        recentIds: {},
        fixedQueueIds: {},
        hardEquivalenceKeys: {},
        currentQuestionEquivalenceKey: "",
        stageIds: {},
        stageReason: "current_question_missing"
      };
    }
    hardEquivalenceKeys[trigger.equivalenceKey] = true;
    if (source) {
      hardEquivalenceKeys[source.equivalenceKey] = true;
    }
    return {
      currentQuestionId: currentQuestionId,
      answeredSessionIds: getAnsweredSessionIds(settings.currentSession),
      recentIds: toIdSet(latestUniqueIds(settings.recentQuestionIds, RECENT_QUESTION_LIMIT)),
      fixedQueueIds: toIdSet(fixedQueueIds),
      hardEquivalenceKeys: hardEquivalenceKeys,
      currentQuestionEquivalenceKey: currentQuestion ? currentQuestion.equivalenceKey : "",
      stageIds: stageSettings.stageIds,
      stageReason: stageSettings.reason
    };
  }

  function keepNearestReasoningBand(candidates, maxDistance) {
    var allowedCandidates = candidates.filter(function (candidate) {
      return candidate.reasoningDistance <= maxDistance;
    });
    var inBaseRange = allowedCandidates.filter(function (candidate) {
      return candidate.reasoningDistance <= 1;
    });
    var closestDistance;

    if (inBaseRange.length) {
      return inBaseRange;
    }
    closestDistance = allowedCandidates.reduce(function (minimum, candidate) {
      return Math.min(minimum, candidate.reasoningDistance);
    }, Infinity);
    return allowedCandidates.filter(function (candidate) {
      return candidate.reasoningDistance === closestDistance;
    });
  }

  function selectKnowledgeReviewVariant(input) {
    var settings = isPlainObject(input) ? input : {};
    var normalized = normalizeQuestions(settings.questions);
    var questionsById = {};
    var triggerResult;
    var trigger;
    var exclusions;
    var sourceQuestionId;
    var source;
    var selectionMode;
    var retryVariantIds;
    var retryVariantIdSet;
    var verifiedVariantIds;
    var verifiedVariantIdSet;
    var staticVariants;
    var targetLevel;
    var maxReasoningDistance;
    var candidates;
    var selectionReason;
    var selectedAt;
    var selectionProof;

    normalized.questions.forEach(function (question) {
      questionsById[question.id] = question;
    });
    if (normalized.hasDuplicateIds) {
      return makeEmptyResult("duplicate_question_ids", null, {
        duplicateIds: normalized.duplicateIds.slice(),
        invalidQuestionCount: normalized.invalidCount
      });
    }
    triggerResult = getReviewTrigger(settings, questionsById);
    if (!triggerResult.question) {
      return makeEmptyResult(triggerResult.reason, null, {
        invalidQuestionCount: normalized.invalidCount
      });
    }
    trigger = triggerResult.question;
    sourceQuestionId = toId(settings.sourceQuestionId) || trigger.id;
    source = questionsById[sourceQuestionId];
    selectionMode = toId(settings.selectionMode) || "new_variant";
    retryVariantIds = latestUniqueIds(settings.retryVariantQuestionIds, RECENT_QUESTION_LIMIT);
    retryVariantIdSet = toIdSet(retryVariantIds);
    verifiedVariantIds = latestUniqueIds(settings.verifiedVariantQuestionIds, RECENT_QUESTION_LIMIT);
    verifiedVariantIdSet = toIdSet(verifiedVariantIds);
    if (!source || source.knowledgeKey !== trigger.knowledgeKey) {
      return makeEmptyResult("invalid_source_question", trigger, {
        invalidQuestionCount: normalized.invalidCount,
        reviewAvailability: "invalid",
        selectionMode: selectionMode
      });
    }
    if (REVIEW_SELECTION_MODES.indexOf(selectionMode) === -1 ||
        (selectionMode === "retry_unresolved_variant" &&
          (!retryVariantIds.length || !verifiedVariantIds.length))) {
      return makeEmptyResult("invalid_review_selection_mode", trigger, {
        invalidQuestionCount: normalized.invalidCount,
        reviewAvailability: "invalid",
        selectionMode: selectionMode
      });
    }
    exclusions = getExclusions(settings, trigger, source, questionsById);
    if (exclusions.stageReason) {
      return makeEmptyResult(exclusions.stageReason, trigger, {
        invalidQuestionCount: normalized.invalidCount,
        reviewAvailability: "invalid",
        selectionMode: selectionMode
      });
    }
    targetLevel = getTargetReasoningLevel(settings, trigger);
    maxReasoningDistance = normalizeMaxReasoningDistance(settings.maxReasoningDistance);

    staticVariants = normalized.questions.filter(function (candidate) {
      return candidate.id !== source.id && candidate.knowledgeKey === trigger.knowledgeKey;
    });
    candidates = staticVariants.filter(function (candidate) {
      if (selectionMode === "retry_unresolved_variant") {
        if (!retryVariantIdSet[candidate.id] || !verifiedVariantIdSet[candidate.id]) {
          return false;
        }
      } else if (candidate.id === exclusions.currentQuestionId || candidate.id === trigger.id) {
        return false;
      }
      var isRetryTarget = selectionMode === "retry_unresolved_variant" &&
        candidate.id === exclusions.currentQuestionId && retryVariantIdSet[candidate.id];
      if ((exclusions.answeredSessionIds[candidate.id] ||
           exclusions.recentIds[candidate.id] ||
           exclusions.fixedQueueIds[candidate.id]) && !isRetryTarget) {
        return false;
      }
      if (exclusions.hardEquivalenceKeys[candidate.equivalenceKey]) {
        return false;
      }
      if (candidate.equivalenceKey === exclusions.currentQuestionEquivalenceKey &&
          !(selectionMode === "retry_unresolved_variant" &&
            candidate.id === exclusions.currentQuestionId &&
            retryVariantIdSet[candidate.id])) {
        return false;
      }
      if (hasValues(exclusions.stageIds) && !exclusions.stageIds[String(candidate.stage)]) {
        return false;
      }
      return true;
    }).map(function (candidate) {
      return {
        question: candidate,
        directRelation: isCandidateDerivedFrom(candidate, trigger),
        differentVariantType: candidate.variantType !== trigger.variantType,
        reasoningDistance: Math.abs(candidate.reasoningLevel - targetLevel)
      };
    });

    candidates = keepNearestReasoningBand(candidates, maxReasoningDistance);

    if (!candidates.length) {
      return makeEmptyResult("no_verified_variant", trigger, {
        invalidQuestionCount: normalized.invalidCount,
        targetReasoningLevel: targetLevel,
        maxReasoningDistance: maxReasoningDistance,
        reviewAvailability: staticVariants.length
          ? "no_eligible_variant"
          : "blocked_no_verified_variant",
        selectionMode: selectionMode,
        verifiedVariantCount: staticVariants.length
      });
    }

    candidates.sort(function (left, right) {
      if (left.directRelation !== right.directRelation) {
        return left.directRelation ? -1 : 1;
      }
      if (left.differentVariantType !== right.differentVariantType) {
        return left.differentVariantType ? -1 : 1;
      }
      if (left.reasoningDistance !== right.reasoningDistance) {
        return left.reasoningDistance - right.reasoningDistance;
      }
      return compareIds(left.question.id, right.question.id);
    });

    var selected = candidates[0];
    selectionReason = selected.directRelation
      ? "direct_variant"
      : selected.differentVariantType
        ? "knowledge_variant_type"
        : "knowledge_variant_reasoning";
    selectedAt = isValidIsoTimestamp(settings.selectedAt)
      ? toId(settings.selectedAt)
      : toId(settings.reviewTrigger && settings.reviewTrigger.triggeredAt);
    selectionProof = createSelectionProof({
      question: selected.question.raw,
      knowledgeKey: selected.question.knowledgeKey,
      sourceQuestionId: source.id,
      selectionReason: selectionReason,
      selectionMode: selectionMode,
      selectedAt: selectedAt
    });
    if (!selectionProof) {
      return makeEmptyResult("invalid_selection_proof", trigger, {
        invalidQuestionCount: normalized.invalidCount,
        reviewAvailability: "invalid",
        selectionMode: selectionMode
      });
    }
    return {
      question: copyQuestionForResult(selected.question.raw),
      questionId: selected.question.id,
      knowledgeKey: selected.question.knowledgeKey,
      selectionReason: selectionReason,
      triggerQuestionId: trigger.id,
      variantType: selected.question.variantType,
      reasoningLevel: selected.question.reasoningLevel,
      directRelation: selected.directRelation,
      fallback: "",
      reviewAvailability: "eligible",
      selectionMode: selectionMode,
      selectionProof: selectionProof,
      details: {
        candidateCount: candidates.length,
        invalidQuestionCount: normalized.invalidCount,
        targetReasoningLevel: targetLevel,
        maxReasoningDistance: maxReasoningDistance,
        verifiedVariantCount: staticVariants.length
      }
    };
  }

  function selectNormalLearningQuestion(input) {
    var settings = isPlainObject(input) ? input : {};
    var normalized = normalizeQuestions(settings.questions);
    var questionById = {};
    var recentIds = latestUniqueIds(settings.recentQuestionIds, RECENT_QUESTION_LIMIT);
    var recentKnowledgeTrail = [];
    var answeredSessionIds = getAnsweredSessionIds(settings.currentSession);
    var stageIds = normalizeStageIds(
      settings.allowedStageIds || (settings.currentStage ? [settings.currentStage] : [])
    );
    var currentQuestionId = toId(settings.currentQuestionId);
    var targetLevel = normalizeLevel(settings.targetReasoningLevel, 1);
    var lastKnowledgeKey = "";
    var candidates;

    normalized.questions.forEach(function (question) {
      questionById[question.id] = question;
    });
    if (normalized.hasDuplicateIds) {
      return makeEmptyResult("duplicate_question_ids", null, {
        duplicateIds: normalized.duplicateIds.slice(),
        invalidQuestionCount: normalized.invalidCount
      });
    }
    if (!hasValues(stageIds)) {
      return makeEmptyResult("missing_allowed_stages", null, {
        invalidQuestionCount: normalized.invalidCount
      });
    }
    recentIds.forEach(function (questionId) {
      if (questionById[questionId]) {
        recentKnowledgeTrail.push(questionById[questionId].knowledgeKey);
      }
    });
    if (recentKnowledgeTrail.length) {
      lastKnowledgeKey = recentKnowledgeTrail[recentKnowledgeTrail.length - 1];
    }

    candidates = normalized.questions.filter(function (candidate) {
      if (candidate.id === currentQuestionId ||
          answeredSessionIds[candidate.id] ||
          recentIds.indexOf(candidate.id) !== -1) {
        return false;
      }
      if (hasValues(stageIds) && !stageIds[String(candidate.stage)]) {
        return false;
      }
      return candidate.knowledgeKey !== lastKnowledgeKey;
    }).sort(function (left, right) {
      var leftDistance = Math.abs(left.reasoningLevel - targetLevel);
      var rightDistance = Math.abs(right.reasoningLevel - targetLevel);
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return compareIds(left.id, right.id);
    });

    if (!candidates.length) {
      return makeEmptyResult("no_normal_learning_candidate", null, {
        invalidQuestionCount: normalized.invalidCount,
        recentKnowledgeTrail: recentKnowledgeTrail
      });
    }

    return {
      question: copyQuestionForResult(candidates[0].raw),
      questionId: candidates[0].id,
      knowledgeKey: candidates[0].knowledgeKey,
      selectionReason: "normal_learning_candidate",
      triggerQuestionId: "",
      variantType: candidates[0].variantType,
      reasoningLevel: candidates[0].reasoningLevel,
      directRelation: false,
      fallback: "",
      details: {
        invalidQuestionCount: normalized.invalidCount,
        recentKnowledgeTrail: recentKnowledgeTrail
      }
    };
  }

  return {
    VARIANT_TYPES: VARIANT_TYPES.slice(),
    SELECTION_PROOF_VERSION: SELECTION_PROOF_VERSION,
    verifySelectionProof: verifySelectionProof,
    selectKnowledgeReviewVariant: selectKnowledgeReviewVariant,
    selectRelatedSupplementQuestions: selectRelatedSupplementQuestions,
    selectNormalLearningQuestion: selectNormalLearningQuestion
  };
}));
