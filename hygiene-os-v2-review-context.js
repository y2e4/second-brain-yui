(function (root, factory) {
  "use strict";

  var selectorApi = typeof module === "object" && module.exports
    ? require("./hygiene-os-v2-knowledge-review-selector.js")
    : root && root.HygieneOSV2KnowledgeReviewSelector;
  var api = factory(selectorApi);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HygieneOSV2ReviewContext = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function (selectorApi) {
  "use strict";

  var REVIEW_CONTEXT_VERSION = 1;
  var SELECTION_PROOF_VERSION = 1;
  var REVIEW_OUTCOMES = [
    "understood", "incorrect", "unsure", "guess", "ambiguous", "manualWeak"
  ];
  var TRIGGER_OUTCOMES = ["understood", "incorrect", "unsure", "guess", "ambiguous"];
  var FLUCTUATION_REASONS = ["incorrect", "unsure", "guess", "ambiguous", "manualWeak"];
  var REVIEW_PHASES = [
    "variant_pending",
    "source_retry_pending",
    "unresolved_variant_pending",
    "completion_candidate",
    "blocked_no_verified_variant",
    "no_eligible_variant"
  ];
  var CLEAR_REASONS = [
    "user_left_review",
    "session_discarded",
    "stage_changed",
    "new_session_started",
    "blocked_route_selected"
  ];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function toId(value) {
    return value === undefined || value === null ? "" : String(value).trim();
  }

  function latestUniqueIds(values) {
    var result = [];

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
    return result;
  }

  function compareIds(left, right) {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
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

  function cloneSession(session) {
    return isPlainObject(session) ? cloneJsonCompatible(session, []) : null;
  }

  function isValidIsoTimestamp(value) {
    var text = toId(value);
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(text);
    var year;
    var month;
    var day;
    var hour;
    var minute;
    var second;
    var timezoneHour;
    var timezoneMinute;
    var daysInMonth;

    if (!match || !Number.isFinite(Date.parse(text))) {
      return false;
    }
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
    second = Number(match[6]);
    daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth ||
        hour > 23 || minute > 59 || second > 59) {
      return false;
    }
    if (match[7] !== "Z") {
      timezoneHour = Number(match[7].slice(1, 3));
      timezoneMinute = Number(match[7].slice(4, 6));
      if (timezoneHour > 23 || timezoneMinute > 59) {
        return false;
      }
    }
    return true;
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

  function hasValues(object) {
    return Object.keys(object).length > 0;
  }

  function isReviewOutcome(value) {
    return REVIEW_OUTCOMES.indexOf(toId(value)) !== -1;
  }

  function normalizeQuestion(raw) {
    var question = isPlainObject(raw) ? raw : {};
    var id = toId(question.id);
    var knowledgeKey = toId(question.knowledgeKey);
    var variantType = toId(question.variantType);
    var reasoningLevel = Number(question.reasoningLevel);
    var stage = Number(question.stage);

    return {
      raw: question,
      id: id,
      knowledgeKey: knowledgeKey,
      variantOfQuestionIds: latestUniqueIds(question.variantOfQuestionIds),
      variantType: variantType,
      reasoningLevel: reasoningLevel,
      stage: stage,
      equivalenceKey: toId(question.equivalenceKey) || id,
      valid: Boolean(id && knowledgeKey &&
        ["rephrase", "condition", "comparison", "exception", "case"].indexOf(variantType) !== -1 &&
        Number.isInteger(reasoningLevel) && reasoningLevel >= 1 && reasoningLevel <= 5 &&
        Number.isInteger(stage) && stage >= 1 && stage <= 5)
    };
  }

  function makeCatalog(questions, allowedStageIds, targetKnowledgeKey) {
    var counts = {};
    var questionById = {};
    var allowedStages = normalizeStageIds(allowedStageIds);
    var invalidKnowledgeKeys = {};
    var duplicate = false;
    var targetKey = toId(targetKnowledgeKey);

    if (!Array.isArray(questions) || !hasValues(allowedStages)) {
      return null;
    }
    questions.forEach(function (raw) {
      var question = normalizeQuestion(raw);
      var rawId = toId(raw && raw.id);
      var rawKnowledgeKey = toId(raw && raw.knowledgeKey);

      if (rawId) {
        counts[rawId] = (counts[rawId] || 0) + 1;
      }
      if (!rawKnowledgeKey) {
        return;
      }
      if (!question.valid) {
        invalidKnowledgeKeys[rawKnowledgeKey] = true;
        return;
      }
      questionById[question.id] = question;
    });
    Object.keys(counts).forEach(function (id) {
      if (counts[id] > 1) {
        duplicate = true;
      }
    });
    if (duplicate || (targetKey && invalidKnowledgeKeys[targetKey])) {
      return null;
    }
    return {
      questionById: questionById,
      allowedStages: allowedStages,
      invalidKnowledgeKeys: invalidKnowledgeKeys
    };
  }

  function isAllowedQuestion(question, catalog, knowledgeKey) {
    return Boolean(question && catalog && question.knowledgeKey === knowledgeKey &&
      catalog.allowedStages[String(question.stage)]);
  }

  function isValidTrigger(trigger, source) {
    var safe = isPlainObject(trigger) ? trigger : {};
    var outcome = toId(safe.outcome);
    var reason = toId(safe.fluctuationReason);

    if (!source || toId(safe.questionId) !== source.id ||
        toId(safe.knowledgeKey) !== source.knowledgeKey ||
        !isValidIsoTimestamp(safe.triggeredAt) ||
        TRIGGER_OUTCOMES.indexOf(outcome) === -1 ||
        FLUCTUATION_REASONS.indexOf(reason) === -1) {
      return false;
    }
    return reason === "manualWeak"
      ? outcome === "understood"
      : outcome === reason;
  }

  function expectedRoleForPhase(phase) {
    if (phase === "variant_pending" || phase === "unresolved_variant_pending") {
      return "variant";
    }
    if (phase === "source_retry_pending") {
      return "source";
    }
    return "";
  }

  function copySelectionProof(proof) {
    return {
      version: proof.version,
      questionId: toId(proof.questionId),
      knowledgeKey: toId(proof.knowledgeKey),
      sourceQuestionId: toId(proof.sourceQuestionId),
      stage: Number(proof.stage),
      variantType: toId(proof.variantType),
      reasoningLevel: Number(proof.reasoningLevel),
      selectionReason: toId(proof.selectionReason),
      selectionMode: toId(proof.selectionMode),
      selectedAt: toId(proof.selectedAt),
      proofToken: toId(proof.proofToken)
    };
  }

  function verifySelectionProof(proof, question, knowledgeKey, sourceQuestionId, selectionReason, selectionMode) {
    if (!selectorApi || typeof selectorApi.verifySelectionProof !== "function") {
      return false;
    }
    return selectorApi.verifySelectionProof({
      proof: proof,
      question: question ? question.raw : null,
      knowledgeKey: knowledgeKey,
      sourceQuestionId: sourceQuestionId,
      selectionReason: selectionReason || (proof && proof.selectionReason),
      selectionMode: selectionMode || (proof && proof.selectionMode),
      selectedAt: proof && proof.selectedAt
    });
  }

  function normalizeProofMap(rawProofs, verifiedVariantIds, catalog, knowledgeKey, sourceQuestionId) {
    var safeProofs = isPlainObject(rawProofs) ? rawProofs : null;
    var verifiedSet = {};
    var normalized = {};

    if (!safeProofs) {
      return verifiedVariantIds.length ? null : {};
    }
    verifiedVariantIds.forEach(function (id) {
      verifiedSet[id] = true;
    });
    if (Object.keys(safeProofs).some(function (rawId) {
      return !verifiedSet[toId(rawId)];
    })) {
      return null;
    }
    for (var index = 0; index < verifiedVariantIds.length; index += 1) {
      var id = verifiedVariantIds[index];
      var proof = safeProofs[id];
      var question = catalog && catalog.questionById[id];

      if (!isPlainObject(proof) || toId(proof.questionId) !== id ||
          toId(proof.knowledgeKey) !== knowledgeKey ||
          toId(proof.sourceQuestionId) !== sourceQuestionId ||
          proof.version !== SELECTION_PROOF_VERSION ||
          !verifySelectionProof(proof, question, knowledgeKey, sourceQuestionId)) {
        return null;
      }
      normalized[id] = copySelectionProof(proof);
    }
    return normalized;
  }

  function getContextRaw(input) {
    if (isPlainObject(input) && hasOwn(input, "reviewContext")) {
      return input.reviewContext;
    }
    return input;
  }

  function normalizeReviewContext(input) {
    var settings = isPlainObject(input) && hasOwn(input, "reviewContext") ? input : {};
    var raw = isPlainObject(getContextRaw(input)) ? getContextRaw(input) : {};
    var knowledgeKey = toId(raw.knowledgeKey);
    var sourceQuestionId = toId(raw.sourceQuestionId);
    var phase = toId(raw.phase);
    var triggerOutcome = toId(raw.triggerOutcome);
    var fluctuationReason = toId(raw.fluctuationReason);
    var pendingQuestionId = toId(raw.pendingQuestionId);
    var pendingQuestionRole = toId(raw.pendingQuestionRole);
    var attemptedVariantIds;
    var verifiedVariantIds;
    var verifiedSelectionProofsByQuestionId;
    var attemptedSet = {};
    var verifiedSet = {};
    var latestOutcomeByQuestionId = {};
    var expectedRole;
    var catalog;
    var source;

    if (raw.version !== REVIEW_CONTEXT_VERSION || !knowledgeKey || !sourceQuestionId ||
        !isValidIsoTimestamp(raw.startedAt) || REVIEW_PHASES.indexOf(phase) === -1) {
      return null;
    }
    if (!isValidTrigger({
      questionId: sourceQuestionId,
      knowledgeKey: knowledgeKey,
      outcome: triggerOutcome,
      fluctuationReason: fluctuationReason,
      triggeredAt: raw.startedAt
    }, { id: sourceQuestionId, knowledgeKey: knowledgeKey })) {
      return null;
    }
    expectedRole = expectedRoleForPhase(phase);
    if (expectedRole) {
      if (!pendingQuestionId || pendingQuestionRole !== expectedRole) {
        return null;
      }
    } else if (pendingQuestionId || pendingQuestionRole) {
      return null;
    }

    verifiedVariantIds = latestUniqueIds(raw.verifiedVariantIds).filter(function (id) {
      return id !== sourceQuestionId;
    });
    verifiedVariantIds.forEach(function (id) {
      verifiedSet[id] = true;
    });
    attemptedVariantIds = latestUniqueIds(raw.attemptedVariantIds).filter(function (id) {
      return id !== sourceQuestionId && verifiedSet[id];
    });
    attemptedVariantIds.forEach(function (id) {
      attemptedSet[id] = true;
    });

    if (Array.isArray(raw.attemptedVariantIds) &&
        latestUniqueIds(raw.attemptedVariantIds).some(function (id) {
          return id === sourceQuestionId || !verifiedSet[id];
        })) {
      return null;
    }
    if (phase === "unresolved_variant_pending" &&
        (!attemptedSet[pendingQuestionId] ||
         toId(raw.latestOutcomeByQuestionId && raw.latestOutcomeByQuestionId[pendingQuestionId]) === "understood")) {
      return null;
    }
    if (phase === "variant_pending" && !verifiedSet[pendingQuestionId]) {
      return null;
    }
    if (phase === "source_retry_pending" && pendingQuestionId !== sourceQuestionId) {
      return null;
    }

    catalog = Array.isArray(settings.questions) || settings.allowedStageIds !== undefined
      ? makeCatalog(settings.questions, settings.allowedStageIds, knowledgeKey)
      : null;
    if (verifiedVariantIds.length && !catalog) {
      return null;
    }
    source = catalog && catalog.questionById[sourceQuestionId];
    verifiedSelectionProofsByQuestionId = normalizeProofMap(
      raw.verifiedSelectionProofsByQuestionId,
      verifiedVariantIds,
      catalog,
      knowledgeKey,
      sourceQuestionId
    );
    if (!verifiedSelectionProofsByQuestionId) {
      return null;
    }

    if (isPlainObject(raw.latestOutcomeByQuestionId)) {
      Object.keys(raw.latestOutcomeByQuestionId).forEach(function (rawId) {
        var id = toId(rawId);
        var outcome = toId(raw.latestOutcomeByQuestionId[rawId]);
        if ((id === sourceQuestionId || attemptedSet[id]) && isReviewOutcome(outcome)) {
          latestOutcomeByQuestionId[id] = outcome;
        }
      });
    }

    if (!Array.isArray(settings.questions) && settings.allowedStageIds === undefined) {
      return {
        version: REVIEW_CONTEXT_VERSION,
        knowledgeKey: knowledgeKey,
        sourceQuestionId: sourceQuestionId,
        startedAt: toId(raw.startedAt),
        triggerOutcome: triggerOutcome,
        fluctuationReason: fluctuationReason,
        phase: phase,
        pendingQuestionId: pendingQuestionId,
        pendingQuestionRole: pendingQuestionRole,
        attemptedVariantIds: attemptedVariantIds,
        verifiedVariantIds: verifiedVariantIds,
        verifiedSelectionProofsByQuestionId: verifiedSelectionProofsByQuestionId,
        latestOutcomeByQuestionId: latestOutcomeByQuestionId
      };
    }

    if (!catalog || !isAllowedQuestion(source, catalog, knowledgeKey)) {
      return null;
    }
    if (!verifiedVariantIds.every(function (id) {
      return isAllowedQuestion(catalog.questionById[id], catalog, knowledgeKey);
    })) {
      return null;
    }
    if (pendingQuestionRole === "variant" &&
        !isAllowedQuestion(catalog.questionById[pendingQuestionId], catalog, knowledgeKey)) {
      return null;
    }
    return {
      version: REVIEW_CONTEXT_VERSION,
      knowledgeKey: knowledgeKey,
      sourceQuestionId: sourceQuestionId,
      startedAt: toId(raw.startedAt),
      triggerOutcome: triggerOutcome,
      fluctuationReason: fluctuationReason,
      phase: phase,
      pendingQuestionId: pendingQuestionId,
      pendingQuestionRole: pendingQuestionRole,
      attemptedVariantIds: attemptedVariantIds,
      verifiedVariantIds: verifiedVariantIds,
      verifiedSelectionProofsByQuestionId: verifiedSelectionProofsByQuestionId,
      latestOutcomeByQuestionId: latestOutcomeByQuestionId
    };
  }

  function makeSessionResult(status, currentSession, details) {
    return {
      status: status,
      currentSession: currentSession,
      reviewContext: currentSession && isPlainObject(currentSession.reviewContext)
        ? cloneJsonCompatible(currentSession.reviewContext, [])
        : null,
      details: details || {}
    };
  }

  function validateSelectionResult(selectionResult, context, catalog, mode) {
    var result = isPlainObject(selectionResult) ? selectionResult : {};
    var question = isPlainObject(result.question) ? normalizeQuestion(result.question) : null;
    var catalogQuestion = question && catalog.questionById[question.id];
    var availability = toId(result.reviewAvailability);
    var selectionMode = toId(result.selectionMode) || "new_variant";
    var expectedMode = mode || selectionMode;
    var source = catalog.questionById[context.sourceQuestionId];
    var expectedReason;

    if (availability === "blocked_no_verified_variant" || availability === "no_eligible_variant") {
      if (question || toId(result.questionId)) {
        return null;
      }
      if (selectionMode !== expectedMode) {
        return null;
      }
      return { availability: availability, question: null, selectionMode: selectionMode };
    }
    if (availability !== "eligible" || !question || !question.valid ||
        question.id !== toId(result.questionId) ||
        question.knowledgeKey !== context.knowledgeKey ||
        !catalogQuestion || !isAllowedQuestion(catalogQuestion, catalog, context.knowledgeKey) ||
        catalogQuestion.stage !== question.stage ||
        catalogQuestion.variantType !== question.variantType ||
        catalogQuestion.reasoningLevel !== question.reasoningLevel ||
        catalogQuestion.equivalenceKey !== question.equivalenceKey ||
        toId(result.triggerQuestionId) !== context.sourceQuestionId ||
        selectionMode !== expectedMode ||
        !verifySelectionProof(
          result.selectionProof,
          catalogQuestion,
          context.knowledgeKey,
          context.sourceQuestionId,
          toId(result.selectionReason),
          selectionMode
        ) ||
        (expectedMode !== "new_variant" && expectedMode !== "retry_unresolved_variant")) {
      return null;
    }
    if (expectedMode === "retry_unresolved_variant" &&
        (context.verifiedVariantIds.indexOf(question.id) === -1 ||
         context.attemptedVariantIds.indexOf(question.id) === -1 ||
         context.latestOutcomeByQuestionId[question.id] === "understood")) {
      return null;
    }
    if (expectedMode === "new_variant" && question.id === context.sourceQuestionId) {
      return null;
    }
    expectedReason = catalogQuestion.variantOfQuestionIds.indexOf(context.sourceQuestionId) !== -1
      ? "direct_variant"
      : catalogQuestion.variantType !== source.variantType
        ? "knowledge_variant_type"
        : "knowledge_variant_reasoning";
    if (toId(result.selectionReason) !== expectedReason) {
      return null;
    }
    return {
      availability: "eligible",
      question: catalogQuestion,
      selectionMode: expectedMode,
      selectionProof: copySelectionProof(result.selectionProof)
    };
  }

  function createInitialReviewContext(currentSession, settings) {
    var sourceQuestion = normalizeQuestion(settings.sourceQuestion);
    var catalog = makeCatalog(
      settings.questions,
      settings.allowedStageIds,
      sourceQuestion.knowledgeKey
    );
    var source = catalog && catalog.questionById[sourceQuestion.id];
    var reviewTrigger = isPlainObject(settings.reviewTrigger) ? settings.reviewTrigger : {};
    var context;

    if (!catalog || !sourceQuestion.valid || !source ||
        source.knowledgeKey !== sourceQuestion.knowledgeKey || source.stage !== sourceQuestion.stage ||
        !isAllowedQuestion(source, catalog, sourceQuestion.knowledgeKey) ||
        !isValidTrigger(reviewTrigger, source)) {
      return null;
    }
    context = {
      version: REVIEW_CONTEXT_VERSION,
      knowledgeKey: source.knowledgeKey,
      sourceQuestionId: source.id,
      startedAt: toId(reviewTrigger.triggeredAt),
      triggerOutcome: toId(reviewTrigger.outcome),
      fluctuationReason: toId(reviewTrigger.fluctuationReason),
      phase: "no_eligible_variant",
      pendingQuestionId: "",
      pendingQuestionRole: "",
      attemptedVariantIds: [],
      verifiedVariantIds: [],
      verifiedSelectionProofsByQuestionId: {},
      latestOutcomeByQuestionId: {}
    };
    context.latestOutcomeByQuestionId[source.id] = context.triggerOutcome;
    return { context: context, catalog: catalog };
  }

  function getStaticVariantCount(catalog, context) {
    return Object.keys(catalog.questionById).filter(function (id) {
      var question = catalog.questionById[id];
      return question.id !== context.sourceQuestionId &&
        question.knowledgeKey === context.knowledgeKey;
    }).length;
  }

  function buildSelectorInput(settings, currentSession, context, mode) {
    var retryId = mode === "retry_unresolved_variant" ? context.pendingQuestionId : "";

    return {
      questions: settings.questions,
      reviewTrigger: {
        questionId: context.sourceQuestionId,
        knowledgeKey: context.knowledgeKey,
        outcome: context.triggerOutcome,
        fluctuationReason: context.fluctuationReason,
        triggeredAt: context.startedAt
      },
      sourceQuestionId: context.sourceQuestionId,
      selectionMode: mode,
      retryVariantQuestionIds: retryId ? [retryId] : [],
      verifiedVariantQuestionIds: retryId ? [retryId] : context.verifiedVariantIds.slice(),
      allowedStageIds: settings.allowedStageIds,
      reviewStagePolicy: settings.reviewStagePolicy,
      targetReasoningLevel: settings.targetReasoningLevel,
      maxReasoningDistance: settings.maxReasoningDistance,
      currentQuestionId: retryId || context.sourceQuestionId,
      currentSession: currentSession,
      recentQuestionIds: settings.recentQuestionIds,
      fixedQueueQuestionIds: settings.fixedQueueQuestionIds,
      excludeFixedQueueQuestionIds: settings.excludeFixedQueueQuestionIds,
      excludedEquivalenceKeys: settings.excludedEquivalenceKeys,
      selectedAt: context.startedAt
    };
  }

  /*
   * This is the only public entry point that may create or update review
   * pending state. The caller supplies review conditions, never a chosen ID or
   * proof; the selector result is validated and persisted as one pure step.
   */
  function selectAndApplyReviewVariant(input) {
    var settings = isPlainObject(input) ? input : {};
    var currentSession = cloneSession(settings.currentSession);
    var rawContext;
    var initial;
    var context;
    var catalog;
    var mode;
    var selectionResult;
    var selection;
    var staticVariantCount;
    var started = false;
    var anchor;

    if (!currentSession) {
      return makeSessionResult("invalid_current_session", null);
    }
    if (currentSession.reviewContext === undefined || currentSession.reviewContext === null) {
      initial = createInitialReviewContext(currentSession, settings);
      if (!initial) {
        return makeSessionResult("invalid_review_start", currentSession);
      }
      context = initial.context;
      catalog = initial.catalog;
      mode = "new_variant";
      started = true;
    } else {
      rawContext = isPlainObject(currentSession.reviewContext) ? currentSession.reviewContext : {};
      catalog = makeCatalog(settings.questions, settings.allowedStageIds, rawContext.knowledgeKey);
      context = catalog && normalizeReviewContext({
        reviewContext: currentSession.reviewContext,
        questions: settings.questions,
        allowedStageIds: settings.allowedStageIds
      });
      if (!catalog || !context) {
        return makeSessionResult("invalid_review_context", currentSession);
      }
      if (context.phase === "no_eligible_variant") {
        mode = "new_variant";
      } else if (context.phase === "unresolved_variant_pending") {
        mode = "retry_unresolved_variant";
      } else {
        return makeSessionResult("invalid_review_phase", currentSession);
      }
    }

    anchor = validateFixedQueueAnchor(currentSession, context.sourceQuestionId);
    if (!anchor.valid) {
      return makeSessionResult(anchor.status, currentSession, anchor.details);
    }

    selectionResult = selectorApi && typeof selectorApi.selectKnowledgeReviewVariant === "function"
      ? selectorApi.selectKnowledgeReviewVariant(buildSelectorInput(settings, currentSession, context, mode))
      : null;
    selection = validateSelectionResult(selectionResult, context, catalog, mode);
    staticVariantCount = getStaticVariantCount(catalog, context);
    if (!selection) {
      return makeSessionResult("invalid_selector_result", currentSession);
    }
    if (selection.availability === "eligible") {
      if (mode === "new_variant") {
        context.verifiedVariantIds = latestUniqueIds(
          context.verifiedVariantIds.concat([selection.question.id])
        );
        context.verifiedSelectionProofsByQuestionId[selection.question.id] = selection.selectionProof;
      }
      context.phase = mode === "new_variant" ? "variant_pending" : "unresolved_variant_pending";
      context.pendingQuestionId = selection.question.id;
      context.pendingQuestionRole = "variant";
    } else {
      if ((selection.availability === "blocked_no_verified_variant" && staticVariantCount !== 0) ||
          (selection.availability === "no_eligible_variant" && staticVariantCount === 0)) {
        return makeSessionResult("invalid_selector_availability", currentSession);
      }
      context.phase = selection.availability;
      context.pendingQuestionId = "";
      context.pendingQuestionRole = "";
    }
    currentSession.reviewContext = normalizeReviewContext({
      reviewContext: context,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    if (!currentSession.reviewContext) {
      return makeSessionResult("invalid_review_context", cloneSession(settings.currentSession));
    }
    return makeSessionResult(started ? "started" : "selection_applied", currentSession, {
      selectionMode: mode,
      reviewAvailability: selection.availability
    });
  }

  function normalizeManualWeakIds(values, catalog, knowledgeKey) {
    var ids;
    if (!Array.isArray(values)) {
      return null;
    }
    ids = latestUniqueIds(values);
    if (!ids.every(function (id) {
      var question = catalog.questionById[id];
      return Boolean(question && question.knowledgeKey === knowledgeKey);
    })) {
      return null;
    }
    return ids;
  }

  function getUnresolvedVariantIds(context) {
    return context.attemptedVariantIds.filter(function (id) {
      return context.latestOutcomeByQuestionId[id] !== "understood";
    });
  }

  function evaluateFacts(context, manualWeakQuestionIds) {
    var sourceOutcome = context.latestOutcomeByQuestionId[context.sourceQuestionId];
    var unresolvedVariantIds = getUnresolvedVariantIds(context);
    var reasons = [];

    if (sourceOutcome !== "understood") {
      reasons.push("source_not_understood");
    }
    if (!context.attemptedVariantIds.length) {
      reasons.push("no_attempted_variant");
    }
    if (unresolvedVariantIds.length) {
      reasons.push("unresolved_variant_outcomes");
    }
    if (manualWeakQuestionIds.length) {
      reasons.push("manual_weak_active");
    }
    return {
      sourceOutcome: sourceOutcome || "",
      unresolvedVariantIds: unresolvedVariantIds,
      reasons: reasons
    };
  }

  function evaluateReviewCompletion(input) {
    var settings = isPlainObject(input) ? input : {};
    var rawContext = isPlainObject(settings.reviewContext) ? settings.reviewContext : {};
    var catalog = makeCatalog(settings.questions, settings.allowedStageIds, rawContext.knowledgeKey);
    var context = catalog && normalizeReviewContext({
      reviewContext: settings.reviewContext,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    var manualWeakQuestionIds;
    var facts;

    if (!catalog || !context) {
      return {
        status: "invalid_review_context",
        completionCandidate: false,
        reviewContext: null,
        unresolvedQuestionIds: [],
        manualWeakQuestionIds: [],
        reasons: ["invalid_review_context"]
      };
    }
    manualWeakQuestionIds = normalizeManualWeakIds(
      settings.manualWeakQuestionIdsForKnowledgeKey,
      catalog,
      context.knowledgeKey
    );
    if (!manualWeakQuestionIds) {
      return {
        status: "invalid_manual_weak_input",
        completionCandidate: false,
        reviewContext: context,
        unresolvedQuestionIds: [],
        manualWeakQuestionIds: [],
        reasons: ["manual_weak_unconfirmed"]
      };
    }
    if (context.phase === "blocked_no_verified_variant" || context.phase === "no_eligible_variant") {
      return {
        status: context.phase,
        completionCandidate: false,
        reviewContext: context,
        unresolvedQuestionIds: [],
        manualWeakQuestionIds: manualWeakQuestionIds,
        reasons: [context.phase]
      };
    }
    facts = evaluateFacts(context, manualWeakQuestionIds);
    if (!facts.reasons.length && context.phase === "completion_candidate") {
      return {
        status: "completion_candidate",
        completionCandidate: true,
        reviewContext: context,
        unresolvedQuestionIds: [],
        manualWeakQuestionIds: [],
        reasons: []
      };
    }
    if (!facts.reasons.length) {
      facts.reasons.push("pending_review_answer");
    }
    return {
      status: "continue_review",
      completionCandidate: false,
      reviewContext: context,
      unresolvedQuestionIds: latestUniqueIds(
        (facts.sourceOutcome === "understood" ? [] : [context.sourceQuestionId])
          .concat(facts.unresolvedVariantIds)
      ),
      manualWeakQuestionIds: manualWeakQuestionIds,
      reasons: facts.reasons
    };
  }

  function recordReviewOutcome(input) {
    var settings = isPlainObject(input) ? input : {};
    var currentSession = cloneSession(settings.currentSession);
    var rawContext = currentSession && isPlainObject(currentSession.reviewContext)
      ? currentSession.reviewContext
      : {};
    var catalog = makeCatalog(settings.questions, settings.allowedStageIds, rawContext.knowledgeKey);
    var context = currentSession && catalog && normalizeReviewContext({
      reviewContext: currentSession.reviewContext,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    var answeredQuestion = normalizeQuestion(settings.question);
    var knownQuestion;
    var manualWeakQuestionIds;
    var outcome = toId(settings.outcome);
    var evaluation;
    var unresolved;
    var anchor;

    if (!currentSession) {
      return makeSessionResult("invalid_current_session", null);
    }
    if (!catalog || !context) {
      return makeSessionResult("invalid_review_context", currentSession);
    }
    anchor = validateFixedQueueAnchor(currentSession, context.sourceQuestionId);
    if (!anchor.valid) {
      return makeSessionResult(anchor.status, currentSession, anchor.details);
    }
    manualWeakQuestionIds = normalizeManualWeakIds(
      settings.manualWeakQuestionIdsForKnowledgeKey,
      catalog,
      context.knowledgeKey
    );
    if (!manualWeakQuestionIds) {
      return makeSessionResult("invalid_manual_weak_input", currentSession);
    }
    if (!expectedRoleForPhase(context.phase) || !context.pendingQuestionId) {
      return makeSessionResult("no_pending_review_question", currentSession);
    }
    knownQuestion = catalog.questionById[answeredQuestion.id];
    if (!answeredQuestion.valid || !knownQuestion ||
        knownQuestion.knowledgeKey !== answeredQuestion.knowledgeKey ||
        knownQuestion.stage !== answeredQuestion.stage ||
        answeredQuestion.id !== context.pendingQuestionId ||
        answeredQuestion.knowledgeKey !== context.knowledgeKey ||
        !isReviewOutcome(outcome)) {
      return makeSessionResult("ignored_unverified_answer", currentSession);
    }
    if (context.pendingQuestionRole === "variant" &&
        context.verifiedVariantIds.indexOf(answeredQuestion.id) === -1) {
      return makeSessionResult("ignored_unverified_answer", currentSession);
    }
    if (context.pendingQuestionRole === "source" &&
        answeredQuestion.id !== context.sourceQuestionId) {
      return makeSessionResult("ignored_unverified_answer", currentSession);
    }

    if (context.pendingQuestionRole === "variant") {
      context.attemptedVariantIds = latestUniqueIds(
        context.attemptedVariantIds.concat([answeredQuestion.id])
      );
    }
    context.latestOutcomeByQuestionId[answeredQuestion.id] = outcome;
    context.pendingQuestionId = "";
    context.pendingQuestionRole = "";

    if (answeredQuestion.id !== context.sourceQuestionId) {
      if (outcome === "understood") {
        context.phase = "source_retry_pending";
        context.pendingQuestionId = context.sourceQuestionId;
        context.pendingQuestionRole = "source";
      } else {
        context.phase = "unresolved_variant_pending";
        context.pendingQuestionId = answeredQuestion.id;
        context.pendingQuestionRole = "variant";
      }
    } else if (outcome !== "understood") {
      context.phase = "source_retry_pending";
      context.pendingQuestionId = context.sourceQuestionId;
      context.pendingQuestionRole = "source";
    } else {
      evaluation = evaluateFacts(context, manualWeakQuestionIds);
      unresolved = evaluation.unresolvedVariantIds;
      if (!evaluation.reasons.length) {
        context.phase = "completion_candidate";
      } else if (unresolved.length) {
        context.phase = "unresolved_variant_pending";
        context.pendingQuestionId = unresolved.slice().sort(compareIds)[0];
        context.pendingQuestionRole = "variant";
      } else {
        context.phase = "source_retry_pending";
        context.pendingQuestionId = context.sourceQuestionId;
        context.pendingQuestionRole = "source";
      }
    }
    currentSession.reviewContext = normalizeReviewContext({
      reviewContext: context,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    return currentSession.reviewContext
      ? makeSessionResult("recorded", currentSession)
      : makeSessionResult("invalid_review_context", cloneSession(settings.currentSession));
  }

  function buildQuestionIndex(questions) {
    var counts = {};
    var questionById = {};
    var duplicate = false;

    if (!Array.isArray(questions)) {
      return null;
    }
    questions.forEach(function (raw) {
      var id = toId(raw && raw.id);
      if (!id) {
        return;
      }
      counts[id] = (counts[id] || 0) + 1;
      questionById[id] = raw;
    });
    Object.keys(counts).forEach(function (id) {
      if (counts[id] > 1) {
        duplicate = true;
      }
    });
    return duplicate ? null : questionById;
  }

  function getQueueQuestionId(currentSession) {
    var queue = currentSession && Array.isArray(currentSession.queue)
      ? currentSession.queue
      : null;
    var index = currentSession && currentSession.index;
    var questionId;

    if (!queue || !Number.isInteger(index) || index < 0 || index >= queue.length) {
      return "";
    }
    questionId = toId(queue[index]);
    return questionId;
  }

  /*
   * Review state overlays a fixed queue but never owns its progression. Every
   * mutating review transition must confirm that the queue remains anchored to
   * the source question before it can return a changed reviewContext.
   */
  function validateFixedQueueAnchor(currentSession, sourceQuestionId) {
    var sourceId = toId(sourceQuestionId);
    var index;
    var queueQuestionId;

    if (!isPlainObject(currentSession)) {
      return { valid: false, status: "invalid_current_session", details: {} };
    }
    if (!Array.isArray(currentSession.queue)) {
      return { valid: false, status: "fixed_queue_missing", details: {} };
    }
    index = currentSession.index;
    if (!Number.isInteger(index) || index < 0 || index >= currentSession.queue.length) {
      return { valid: false, status: "fixed_queue_index_invalid", details: { index: currentSession.index } };
    }
    if (!sourceId) {
      return { valid: false, status: "invalid_source_question", details: {} };
    }
    queueQuestionId = toId(currentSession.queue[index]);
    if (!queueQuestionId) {
      return { valid: false, status: "queue_question_missing", details: { index: index } };
    }
    if (queueQuestionId !== sourceId) {
      return {
        valid: false,
        status: "source_queue_mismatch",
        details: { queueQuestionId: queueQuestionId, sourceQuestionId: sourceId, index: index }
      };
    }
    return { valid: true, status: "fixed_queue_anchor_valid", details: { index: index } };
  }

  function makeOverlayResult(status, questionId, role, details) {
    return {
      status: status,
      questionId: toId(questionId),
      questionRole: toId(role),
      shouldAdvanceQueue: false,
      reviewContext: null,
      details: details || {}
    };
  }

  /*
   * The review overlay is intentionally read-only. HTML may render the pending
   * question before its fixed queue entry, but queue/index only move after an
   * explicit clear action outside this pure contract.
   */
  function validateReviewSessionOverlay(input) {
    var settings = isPlainObject(input) ? input : {};
    var currentSession = isPlainObject(settings.currentSession) ? settings.currentSession : null;
    var questionIndex = buildQuestionIndex(settings.questions);
    var queueQuestionId;
    var rawContext;
    var catalog;
    var context;
    var pending;

    if (!currentSession) {
      return makeOverlayResult("invalid_current_session", "", "");
    }
    if (!questionIndex) {
      return makeOverlayResult("invalid_question_catalog", "", "");
    }
    queueQuestionId = getQueueQuestionId(currentSession);
    if (!queueQuestionId || !questionIndex[queueQuestionId]) {
      return makeOverlayResult("queue_question_missing", "", "");
    }
    if (currentSession.reviewContext === undefined || currentSession.reviewContext === null) {
      return makeOverlayResult("normal_queue", queueQuestionId, "normal");
    }

    rawContext = isPlainObject(currentSession.reviewContext) ? currentSession.reviewContext : {};
    catalog = makeCatalog(settings.questions, settings.allowedStageIds, rawContext.knowledgeKey);
    context = catalog && normalizeReviewContext({
      reviewContext: currentSession.reviewContext,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    if (!catalog || !context) {
      return makeOverlayResult("invalid_review_context", "", "");
    }
    if (queueQuestionId !== context.sourceQuestionId) {
      return makeOverlayResult("source_queue_mismatch", "", "", {
        queueQuestionId: queueQuestionId,
        sourceQuestionId: context.sourceQuestionId
      });
    }
    if (context.phase === "completion_candidate") {
      return makeOverlayResult("completion_candidate", "", "", {
        completionAction: "finalizeCompletedReview"
      });
    }
    if (context.phase === "blocked_no_verified_variant" || context.phase === "no_eligible_variant") {
      return makeOverlayResult(context.phase, "", "", {
        clearReason: "blocked_route_selected"
      });
    }
    pending = catalog.questionById[context.pendingQuestionId];
    if (!pending || !isAllowedQuestion(pending, catalog, context.knowledgeKey) ||
        expectedRoleForPhase(context.phase) !== context.pendingQuestionRole) {
      return makeOverlayResult("invalid_review_pending", "", "");
    }
    return makeOverlayResult(
      "review_pending",
      pending.id,
      context.pendingQuestionRole,
      { phase: context.phase, sourceQuestionId: context.sourceQuestionId }
    );
  }

  function resolveDisplayedQuestion(input) {
    var settings = isPlainObject(input) ? input : {};
    var overlay = validateReviewSessionOverlay(settings);
    var questionIndex = buildQuestionIndex(settings.questions);
    var question = overlay.questionId && questionIndex && questionIndex[overlay.questionId];

    return {
      status: overlay.status,
      questionId: overlay.questionId,
      questionRole: overlay.questionRole,
      shouldAdvanceQueue: overlay.shouldAdvanceQueue,
      reviewContext: overlay.reviewContext,
      details: cloneJsonCompatible(overlay.details, []),
      question: question ? cloneJsonCompatible(question, []) : null
    };
  }

  function isPendingReviewPhase(phase) {
    return phase === "variant_pending" || phase === "source_retry_pending" ||
      phase === "unresolved_variant_pending";
  }

  function isClearAllowedForPhase(reason, phase) {
    if (reason === "blocked_route_selected") {
      return phase === "blocked_no_verified_variant" || phase === "no_eligible_variant";
    }
    if (reason === "user_left_review") {
      return isPendingReviewPhase(phase);
    }
    if (reason === "stage_changed") {
      return isPendingReviewPhase(phase) || phase === "blocked_no_verified_variant" ||
        phase === "no_eligible_variant";
    }
    return reason === "new_session_started" || reason === "session_discarded";
  }

  function clearReviewContext(input) {
    var settings = isPlainObject(input) ? input : {};
    var currentSession = cloneSession(settings.currentSession);
    var reason = toId(settings.reason);
    var rawContext;

    if (!currentSession) {
      return makeSessionResult("invalid_current_session", null);
    }
    if (reason === "user_completed_review") {
      return makeSessionResult("completion_requires_finalize", currentSession);
    }
    if (CLEAR_REASONS.indexOf(reason) === -1) {
      return makeSessionResult("invalid_clear_reason", currentSession);
    }
    if (!hasOwn(currentSession, "reviewContext")) {
      return makeSessionResult("no_review_context", currentSession);
    }
    rawContext = isPlainObject(currentSession.reviewContext) ? currentSession.reviewContext : {};
    if (!isClearAllowedForPhase(reason, toId(rawContext.phase))) {
      return makeSessionResult("invalid_clear_phase", currentSession);
    }
    delete currentSession.reviewContext;
    return makeSessionResult("cleared", currentSession, { reason: reason });
  }

  /*
   * Completion is intentionally a one-shot transaction: re-evaluate the
   * review, clear only its overlay, then advance the fixed queue exactly once.
   */
  function finalizeCompletedReview(input) {
    var settings = isPlainObject(input) ? input : {};
    var currentSession = cloneSession(settings.currentSession);
    var overlay;
    var evaluation;
    var rawContext;
    var anchor;

    if (!currentSession) {
      return makeSessionResult("invalid_current_session", null);
    }
    if (!hasOwn(currentSession, "reviewContext")) {
      return makeSessionResult("no_review_context", currentSession);
    }
    rawContext = isPlainObject(currentSession.reviewContext) ? currentSession.reviewContext : {};
    anchor = validateFixedQueueAnchor(currentSession, rawContext.sourceQuestionId);
    if (!anchor.valid) {
      return makeSessionResult(anchor.status, currentSession, anchor.details);
    }
    overlay = validateReviewSessionOverlay({
      currentSession: currentSession,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds
    });
    if (overlay.status !== "completion_candidate") {
      return makeSessionResult(
        overlay.status === "invalid_review_context" || overlay.status === "source_queue_mismatch"
          ? overlay.status
          : "completion_not_confirmed",
        currentSession
      );
    }
    evaluation = evaluateReviewCompletion({
      reviewContext: currentSession.reviewContext,
      questions: settings.questions,
      allowedStageIds: settings.allowedStageIds,
      manualWeakQuestionIdsForKnowledgeKey: settings.manualWeakQuestionIdsForKnowledgeKey
    });
    if (!evaluation.completionCandidate) {
      return makeSessionResult("completion_not_confirmed", currentSession, {
        reasons: evaluation.reasons.slice()
      });
    }
    delete currentSession.reviewContext;
    currentSession.index = currentSession.index + 1;
    currentSession.recorded = false;
    return makeSessionResult("finalized", currentSession);
  }

  return {
    REVIEW_CONTEXT_VERSION: REVIEW_CONTEXT_VERSION,
    REVIEW_OUTCOMES: REVIEW_OUTCOMES.slice(),
    REVIEW_PHASES: REVIEW_PHASES.slice(),
    CLEAR_REASONS: CLEAR_REASONS.slice(),
    selectAndApplyReviewVariant: selectAndApplyReviewVariant,
    recordReviewOutcome: recordReviewOutcome,
    evaluateReviewCompletion: evaluateReviewCompletion,
    normalizeReviewContext: normalizeReviewContext,
    validateReviewSessionOverlay: validateReviewSessionOverlay,
    resolveDisplayedQuestion: resolveDisplayedQuestion,
    clearReviewContext: clearReviewContext,
    finalizeCompletedReview: finalizeCompletedReview
  };
}));
