(function (global) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;
  var DEFAULT_EMBERS = [
    "今日の3問が、未来の判断力をつくる。",
    "迷った一問は、理解を深める入口になる。",
    "正解を増やすより、曖昧さを一つ減らそう。",
    "知識は、判断できるまで育てて初めて力になる。",
    "一度に全部覚えなくていい。今日は一つ確かにする。",
    "勉強は、自分の未来の選択肢を増やす行動である。",
    "間違いは失敗ではなく、次の問題を作る材料になる。",
    "続けるとは、毎日完璧にやることではなく、また戻ること。",
    "今日の一問を雑にしない。それが本番の一問を支える。",
    "昨日の火を受け取り、今日の一歩へつなげる。"
  ];

  var STAGES = [
    { id: 1, name: "基礎", difficulty: "知識問題" },
    { id: 2, name: "理解", difficulty: "比較問題" },
    { id: 3, name: "比較", difficulty: "事例問題" },
    { id: 4, name: "判断", difficulty: "判断問題" },
    { id: 5, name: "実戦", difficulty: "本試験レベル" }
  ];
  var REASONING_DIFFICULTY_LEVELS = [
    {
      id: 1,
      level: 1,
      name: "知識",
      label: "知識",
      description: "用語・数字・単一条件を直接確認します。"
    },
    {
      id: 2,
      level: 2,
      name: "比較",
      label: "比較",
      description: "似た制度や対象者、期間の違いを比べます。"
    },
    {
      id: 3,
      level: 3,
      name: "判断",
      label: "判断",
      description: "複数条件と原則・例外から適用を判断します。"
    },
    {
      id: 4,
      level: 4,
      name: "事例",
      label: "事例",
      description: "具体的な事例で3つ以上の条件と制度を整理します。"
    },
    {
      id: 5,
      level: 5,
      name: "複合",
      label: "複合",
      description: "複数制度・例外・時系列を2段階以上で判断します。"
    }
  ];
  var DEFAULT_SESSION_QUESTION_LIMIT = 3;
  var ADAPTIVE_SET_SIZE = 3;
  var ADAPTIVE_STREAK_REQUIRED = 2;
  var ADAPTIVE_HISTORY_LIMIT = 10;
  var ADAPTIVE_THINKING_RANKS = {
    recall: 1,
    comparison: 2,
    multi_condition: 3,
    case_judgment: 4,
    composite_judgment: 5
  };
  var ADAPTIVE_SELECTION_PATTERNS = {
    1: ["recall", "recall", "recall"],
    2: ["recall", "comparison", "comparison"],
    3: ["comparison", "multi_condition", "case_judgment"],
    4: ["multi_condition", "case_judgment", "composite_judgment"],
    5: ["case_judgment", "composite_judgment", "explanation"]
  };

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function uniqueStrings(list) {
    var seen = {};
    var output = [];
    (Array.isArray(list) ? list : []).forEach(function (value) {
      var key = String(value || "");
      if (key && !seen[key]) {
        seen[key] = true;
        output.push(key);
      }
    });
    return output;
  }

  function dateKeyFromValue(value) {
    if (!value) {
      return "";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return String(value);
    }
    try {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date(value));
    } catch (error) {
      return "";
    }
  }

  function todayKey() {
    return dateKeyFromValue(new Date().toISOString());
  }

  function dayNumber(key) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) {
      return 0;
    }
    return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
  }

  function daysSince(lastDate, nowDate) {
    var last = dayNumber(dateKeyFromValue(lastDate));
    var now = dayNumber(dateKeyFromValue(nowDate) || todayKey());
    return last && now ? Math.max(0, now - last) : 0;
  }

  function seedFromDate(key) {
    var total = 0;
    var text = String(key || todayKey());
    for (var i = 0; i < text.length; i += 1) {
      total += text.charCodeAt(i) * (i + 1);
    }
    return total;
  }

  function createDailyEmber(options) {
    var list = Array.isArray(options && options.quotes) && options.quotes.length
      ? options.quotes
      : DEFAULT_EMBERS;
    var textElement = options && options.textElement;
    var button = options && options.button;
    var index = seedFromDate(todayKey()) % list.length;

    function render() {
      if (textElement) {
        textElement.textContent = list[index];
      }
    }

    if (button) {
      button.addEventListener("click", function () {
        index = (index + 1) % list.length;
        render();
      });
    }

    render();
    return { render: render };
  }

  function createElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (typeof text === "string") {
      element.textContent = text;
    }
    return element;
  }

  function createFirekeeper(options) {
    var container = options && options.container;

    function hide() {
      if (container) {
        container.hidden = true;
        container.textContent = "";
      }
    }

    function render(context) {
      var daysAway = daysSince(context.lastStudyAt || context.lastStudyDate, context.todayKey);
      var today = context.todayKey || todayKey();
      var message;
      var actions;
      var status;
      var oneButton;
      var restButton;
      var reasonButton;
      var reasons;

      if (!container) {
        return;
      }
      if (daysAway < 2 || context.dismissedDate === today ||
          (context.lastShownDate === today && !context.alreadyVisible)) {
        hide();
        return;
      }

      message = daysAway >= 7
        ? "しばらく火を休ませていたね。\n今日は1問だけで戻ろう。"
        : "少し間が空いたね。\n今日は1問だけ、一緒に戻ろう。";
      actions = createElement("div", "firekeeper-actions");
      status = createElement("p", "firekeeper-status", "");
      oneButton = createElement("button", "primary-button", "1問だけやる");
      restButton = createElement("button", "secondary-button", "今日は休む");
      reasonButton = createElement("button", "secondary-button", "理由を記録する");

      container.hidden = false;
      container.textContent = "";
      container.appendChild(createElement("h2", "firekeeper-title", "火守モード"));
      container.appendChild(createElement("p", "firekeeper-message", message));

      oneButton.type = "button";
      oneButton.addEventListener("click", function () {
        hide();
        if (typeof options.onStartOneQuestion === "function") {
          options.onStartOneQuestion();
        }
      });
      restButton.type = "button";
      restButton.addEventListener("click", function () {
        if (typeof options.onRest === "function") {
          options.onRest();
        }
        status.textContent = "休む選択も、火を守る選択です。";
      });
      reasonButton.type = "button";
      reasonButton.addEventListener("click", function () {
        if (reasons && reasons.parentNode) {
          reasons.parentNode.removeChild(reasons);
          reasons = null;
          return;
        }
        reasons = createElement("div", "firekeeper-reasons");
        ["忙しかった", "体調が悪かった", "忘れていた", "気分が乗らなかった", "その他"].forEach(function (reason) {
          var button = createElement("button", "secondary-button", reason);
          button.type = "button";
          button.addEventListener("click", function () {
            if (typeof options.onReason === "function") {
              options.onReason(reason);
            }
            status.textContent = "記録しました。今日はここまででも大丈夫。";
          });
          reasons.appendChild(button);
        });
        container.appendChild(reasons);
      });

      actions.appendChild(oneButton);
      actions.appendChild(restButton);
      actions.appendChild(reasonButton);
      container.appendChild(actions);
      container.appendChild(status);

      if (typeof options.onShown === "function") {
        options.onShown({ daysAway: daysAway, todayKey: today });
      }
    }

    return { render: render, hide: hide };
  }

  function getMonsterName(question) {
    var text = [question.category, question.theme, question.question].join(" ");
    if (/有害|物質|食中毒|ノロ|ヒスタミン|粉じん/.test(text)) {
      return "有害物質ゴブリン";
    }
    if (/法令|衛生管理者|産業医|委員会|労働時間|休憩|選任/.test(text)) {
      return "法令ごっちゃドラゴン";
    }
    return "数字まぜまぜスライム";
  }

  function createTeacherMode(options) {
    var container = options && options.container;

    function hide() {
      if (container) {
        container.hidden = true;
        container.textContent = "";
      }
    }

    function renderChallenge(box, questions) {
      var index = 0;
      var correct = 0;

      function renderOne() {
        var question = questions[index];
        var choices = Array.isArray(question.choices) && question.choices.length
          ? question.choices
          : [
            { id: "O", text: "〇" },
            { id: "X", text: "×" }
          ];
        var status = createElement("p", "teacher-challenge-status", "");
        var nextButton = createElement("button", "secondary-button", "次へ");
        var choicesBox = createElement("div", "teacher-challenge-choices");

        box.textContent = "";
        box.appendChild(createElement("p", "teacher-challenge-status", "ミニ挑戦 " + (index + 1) + " / " + questions.length));
        box.appendChild(createElement("p", "teacher-challenge-question", question.question || question.statement || "確認問題"));
        choices.forEach(function (choice, choiceIndex) {
          var choiceId = choice.id || String(choiceIndex);
          var button = createElement("button", "teacher-mini-button", (choice.text || choice));
          button.type = "button";
          button.addEventListener("click", function () {
            choicesBox.querySelectorAll("button").forEach(function (item) {
              item.disabled = true;
            });
            if (String(choiceId) === String(question.answer)) {
              correct += 1;
              button.classList.add("is-correct");
              status.textContent = "いいね。条件を分けられています。";
            } else {
              button.classList.add("is-wrong");
              status.textContent = "惜しい。解説を短く読み直そう。";
            }
            nextButton.hidden = false;
          });
          choicesBox.appendChild(button);
        });
        nextButton.type = "button";
        nextButton.hidden = true;
        nextButton.addEventListener("click", function () {
          index += 1;
          if (index >= questions.length) {
            box.textContent = "";
            box.appendChild(createElement("p", "teacher-challenge-status",
              correct === questions.length
                ? "撃破。苦手モンスターを一つ弱らせました。"
                : "今日はここまでで十分。次はここをもう一度。"
            ));
            return;
          }
          renderOne();
        });
        box.appendChild(choicesBox);
        box.appendChild(status);
        box.appendChild(nextButton);
      }

      renderOne();
    }

    function render(context) {
      var title;
      var text;
      var monster;
      var challengeBox;
      var challengeButton;
      var monsterName;

      if (!container) {
        return;
      }
      if (!context || !context.shouldShow) {
        hide();
        return;
      }

      monsterName = context.monsterName || getMonsterName(context.question || {});
      container.className = "teacher-mode-card";
      container.hidden = false;
      container.textContent = "";
      title = createElement("p", "teacher-mode-title", "衛生管理者先生 β");
      text = createElement("p", "teacher-mode-text", context.message || "ここは理解度が下がりやすいところ。数字・対象・時期だけ分けよう。");
      monster = createElement("div", "teacher-monster");
      challengeBox = createElement("div", "teacher-challenge-box");
      challengeButton = createElement("button", "secondary-button", "2問だけ挑戦");

      monster.appendChild(createElement("p", "teacher-monster-title", "苦手モンスター β"));
      monster.appendChild(createElement("strong", "teacher-monster-name", monsterName));
      monster.appendChild(createElement("p", "teacher-monster-text", "似た数字や条件を混ぜてくる相手。今日は2問だけ。"));
      challengeButton.type = "button";
      challengeButton.addEventListener("click", function () {
        renderChallenge(challengeBox, (context.challengeQuestions || []).slice(0, 2));
      });
      monster.appendChild(challengeButton);
      monster.appendChild(challengeBox);
      container.appendChild(title);
      container.appendChild(text);
      container.appendChild(monster);
    }

    return { render: render, hide: hide };
  }

  function looksLikeLearningPayload(value) {
    return isPlainObject(value) && (
      isPlainObject(value.progress) ||
      isPlainObject(value.stageProgress) ||
      isPlainObject(value.stageResults) ||
      Array.isArray(value.answeredQuestionIds) ||
      Object.prototype.hasOwnProperty.call(value, "totalAnswered") ||
      Object.prototype.hasOwnProperty.call(value, "totalAnswers")
    );
  }

  function getPayloadIdentity(value) {
    if (!isPlainObject(value)) {
      return "";
    }
    return [
      value.app,
      value.title,
      value.storageKey,
      isPlainObject(value.progress) ? value.progress.app : "",
      isPlainObject(value.progress) ? value.progress.title : "",
      isPlainObject(value.progress) ? value.progress.storageKey : ""
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function payloadMatchesNamespace(value, namespace) {
    var identity = getPayloadIdentity(value);
    if (!looksLikeLearningPayload(value)) {
      return false;
    }
    if (!identity) {
      return true;
    }
    if (namespace === "sharoshi") {
      return identity.indexOf("sharoshi") !== -1 ||
        identity.indexOf("社労士") !== -1;
    }
    if (namespace === "eisei") {
      return identity.indexOf("eisei") !== -1 ||
        identity.indexOf("hygiene") !== -1 ||
        identity.indexOf("衛生") !== -1;
    }
    return identity.indexOf(namespace) !== -1;
  }

  function inferLegacyNamespace(value) {
    var identity = getPayloadIdentity(value);
    if (!looksLikeLearningPayload(value)) {
      return "";
    }
    if (identity.indexOf("sharoshi") !== -1 || identity.indexOf("社労士") !== -1) {
      return "sharoshi";
    }
    if (identity.indexOf("eisei") !== -1 || identity.indexOf("hygiene") !== -1 || identity.indexOf("衛生") !== -1) {
      return "eisei";
    }
    return "";
  }

  function extractLearningPayload(payload, namespace) {
    if (isPlainObject(payload) && isPlainObject(payload[namespace])) {
      return payload[namespace];
    }
    if (payloadMatchesNamespace(payload, namespace)) {
      return payload;
    }
    return null;
  }

  function getPayloadUpdatedAt(payload) {
    var source = isPlainObject(payload) && isPlainObject(payload.progress) ? payload.progress : payload;
    if (!isPlainObject(payload)) {
      return "";
    }
    return String(payload.exportedAt || source.lastManualSyncAt || source.lastSavedAt || "");
  }

  function upsertLearningPayload(existing, namespace, payload) {
    var legacyNamespace = inferLegacyNamespace(existing);
    var envelope = isPlainObject(existing) && !looksLikeLearningPayload(existing)
      ? cloneJson(existing)
      : {};

    if (legacyNamespace && legacyNamespace !== namespace && !isPlainObject(envelope[legacyNamespace])) {
      envelope[legacyNamespace] = cloneJson(existing);
    }

    envelope.schemaVersion = Math.max(1, Number(envelope.schemaVersion) || 1);
    envelope.updatedAt = getPayloadUpdatedAt(payload) || new Date().toISOString();
    envelope.namespaces = uniqueStrings([].concat(envelope.namespaces || [], legacyNamespace ? [legacyNamespace] : [], [namespace]));
    envelope[namespace] = payload;
    return envelope;
  }

  function clampNumber(value, minimum, maximum, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) {
      number = Number(fallback);
    }
    return Math.max(minimum, Math.min(maximum, number));
  }

  function getReasoningLevelDefinition(level) {
    return REASONING_DIFFICULTY_LEVELS[
      clampNumber(level, 1, REASONING_DIFFICULTY_LEVELS.length, 1) - 1
    ];
  }

  function normalizeAdaptiveAnswer(raw) {
    var safe = isPlainObject(raw) ? raw : {};
    return {
      questionId: typeof safe.questionId === "string" ? safe.questionId : "",
      correct: safe.correct === true,
      understanding: typeof safe.understanding === "string" ? safe.understanding : "",
      unsure: safe.unsure === true,
      guessed: safe.guessed === true,
      ambiguous: safe.ambiguous === true,
      weak: safe.weak === true,
      reasoningLevel: clampNumber(safe.reasoningLevel, 1, 5, 1)
    };
  }

  function normalizeAdaptiveSet(raw) {
    var safe = isPlainObject(raw) ? raw : {};
    var answers = (Array.isArray(safe.answers) ? safe.answers : []).map(normalizeAdaptiveAnswer);
    return {
      mode: typeof safe.mode === "string" ? safe.mode : "daily",
      stageLevel: clampNumber(safe.stageLevel, 1, 5, 1),
      reasoningLevel: clampNumber(safe.reasoningLevel, 1, 5, 1),
      answers: answers,
      perfect: safe.perfect === true,
      completedAt: typeof safe.completedAt === "string" ? safe.completedAt : ""
    };
  }

  function normalizeAdaptiveDifficulty(raw, options) {
    var safe = isPlainObject(raw) ? raw : {};
    var settings = isPlainObject(options) ? options : {};
    var initialLevel = clampNumber(settings.initialReasoningLevel, 1, 5, 1);
    var recentSets = (Array.isArray(safe.recentSets) ? safe.recentSets : [])
      .map(normalizeAdaptiveSet)
      .slice(-ADAPTIVE_HISTORY_LIMIT);

    return {
      version: 2,
      reasoningLevel: clampNumber(safe.reasoningLevel, 1, 5, initialLevel),
      perfectSetStreak: clampNumber(safe.perfectSetStreak, 0, ADAPTIVE_STREAK_REQUIRED, 0),
      recentSets: recentSets,
      lastSet: isPlainObject(safe.lastSet) ? normalizeAdaptiveSet(safe.lastSet) : null,
      lastIncreasedAt: typeof safe.lastIncreasedAt === "string" ? safe.lastIncreasedAt : "",
      lastEvaluatedAt: typeof safe.lastEvaluatedAt === "string" ? safe.lastEvaluatedAt : "",
      lastAdjustment: typeof safe.lastAdjustment === "string" ? safe.lastAdjustment : ""
    };
  }

  function isPerfectUnderstandingSet(answers) {
    var normalized = (Array.isArray(answers) ? answers : []).map(normalizeAdaptiveAnswer);
    return normalized.length === ADAPTIVE_SET_SIZE && normalized.every(function (answer) {
      return answer.correct &&
        answer.understanding === "understood" &&
        !answer.unsure &&
        !answer.guessed &&
        !answer.ambiguous &&
        !answer.weak;
    });
  }

  function getImperfectSetReasons(answers) {
    var normalized = (Array.isArray(answers) ? answers : []).map(normalizeAdaptiveAnswer);
    var reasons = [];

    if (normalized.length !== ADAPTIVE_SET_SIZE) {
      reasons.push("3問の回答記録がそろっていません");
    }
    if (normalized.some(function (answer) { return !answer.correct; })) {
      reasons.push("不正解がありました");
    }
    if (normalized.some(function (answer) { return answer.unsure; })) {
      reasons.push("迷って正解がありました");
    }
    if (normalized.some(function (answer) { return answer.guessed; })) {
      reasons.push("勘で正解がありました");
    }
    if (normalized.some(function (answer) { return answer.ambiguous; })) {
      reasons.push("曖昧だった問題がありました");
    }
    if (normalized.some(function (answer) { return answer.weak; })) {
      reasons.push("苦手登録がありました");
    }
    if (normalized.some(function (answer) {
      return answer.correct && answer.understanding !== "understood";
    }) && !reasons.some(function (reason) {
      return /迷って|勘で|曖昧|苦手/.test(reason);
    })) {
      reasons.push("理解状態を確認できない正解がありました");
    }
    return reasons;
  }

  function recordAdaptiveDifficultySet(rawState, rawSet) {
    var state = normalizeAdaptiveDifficulty(rawState);
    var safeSet = isPlainObject(rawSet) ? rawSet : {};
    var completedAt = typeof safeSet.completedAt === "string" && safeSet.completedAt
      ? safeSet.completedAt
      : new Date().toISOString();
    var answers = (Array.isArray(safeSet.answers) ? safeSet.answers : [])
      .map(normalizeAdaptiveAnswer);
    var previousLevel = state.reasoningLevel;
    var perfect = isPerfectUnderstandingSet(answers);
    var changed = false;
    var snapshot;

    if (perfect) {
      state.perfectSetStreak += 1;
      if (state.perfectSetStreak >= ADAPTIVE_STREAK_REQUIRED && state.reasoningLevel < 5) {
        state.reasoningLevel += 1;
        state.perfectSetStreak = 0;
        state.lastIncreasedAt = completedAt;
        changed = true;
      }
    } else {
      state.perfectSetStreak = 0;
    }

    snapshot = {
      mode: typeof safeSet.mode === "string" ? safeSet.mode : "daily",
      stageLevel: clampNumber(safeSet.stageLevel, 1, 5, 1),
      reasoningLevel: previousLevel,
      answers: answers,
      perfect: perfect,
      completedAt: completedAt
    };
    state.lastSet = snapshot;
    state.recentSets = state.recentSets.concat([snapshot]).slice(-ADAPTIVE_HISTORY_LIMIT);
    state.lastEvaluatedAt = completedAt;
    state.lastAdjustment = changed ? "increase" : perfect ? "perfect-set" : "not-perfect";

    return {
      state: state,
      result: {
        perfect: perfect,
        changed: changed,
        previousLevel: previousLevel,
        currentLevel: state.reasoningLevel,
        perfectSetStreak: state.perfectSetStreak,
        remainingSets: state.reasoningLevel >= 5
          ? 0
          : Math.max(0, ADAPTIVE_STREAK_REQUIRED - state.perfectSetStreak),
        reasons: perfect ? [] : getImperfectSetReasons(answers),
        completedAt: completedAt
      }
    };
  }

  function selectAdaptiveReasoningQuestions(pool, options) {
    var settings = isPlainObject(options) ? options : {};
    var requestedLevel = clampNumber(settings.reasoningLevel, 1, 5, 1);
    var requestedCount = Math.max(1, Number(settings.count) || ADAPTIVE_SET_SIZE);
    var recentIds = uniqueStrings(settings.recentQuestionIds);
    var recentEquivalenceKeys = uniqueStrings(settings.recentEquivalenceKeys);
    var seenIds = uniqueStrings(settings.seenQuestionIds);
    var exactLevel = (Array.isArray(pool) ? pool : []).filter(function (question) {
      return Number(question && (
        question.adaptiveReasoningLevel ||
        question.reasoningLevel ||
        question.reasoningProfile && question.reasoningProfile.level
      )) === requestedLevel;
    });

    function getRequiredConditionCount(question) {
      var listedCount = Array.isArray(question && question.requiredConditions)
        ? question.requiredConditions.length
        : 0;
      var profileCount = Number(question && question.reasoningProfile &&
        question.reasoningProfile.conditionCount) || 0;
      return Math.max(listedCount, profileCount);
    }

    var eligible = exactLevel.filter(function (question) {
      var choices = Array.isArray(question && question.choices) ? question.choices : [];
      var requiredConditions = getRequiredConditionCount(question);
      var reasoningSteps = Number(question && question.estimatedReasoningSteps) ||
        Number(question && question.reasoningProfile &&
          question.reasoningProfile.judgmentSteps) || 0;
      var thinkingLevel = String(question && question.thinkingLevel || "");
      var thinkingRank = ADAPTIVE_THINKING_RANKS[thinkingLevel] || requestedLevel;

      if (requestedLevel < 3) {
        return true;
      }
      return choices.length >= 4 &&
        String(question.questionType || question.type || "") !== "true_false" &&
        thinkingRank >= requestedLevel - 1 &&
        requiredConditions >= (requestedLevel === 3 ? 2 : 3) &&
        reasoningSteps >= (requestedLevel === 3 ? 2 : 3);
    });
    var preferred = eligible.filter(function (question) {
      return recentIds.indexOf(question.id) === -1 &&
        recentEquivalenceKeys.indexOf(question.equivalenceKey || question.id) === -1;
    });
    var deferred = eligible.filter(function (question) {
      return preferred.indexOf(question) === -1;
    });
    var selectionPattern = ADAPTIVE_SELECTION_PATTERNS[requestedLevel] || [];

    function sortQuestions(list) {
      return list.slice().sort(function (left, right) {
        var leftSeen = seenIds.indexOf(left.id) !== -1;
        var rightSeen = seenIds.indexOf(right.id) !== -1;
        if (leftSeen !== rightSeen) {
          return leftSeen ? 1 : -1;
        }
        return String(left.adaptiveOrder || left.id || "").localeCompare(
          String(right.adaptiveOrder || right.id || "")
        );
      });
    }

    function getBucket(question) {
      return String(question && (
        question.selectionBucket ||
        question.questionType ||
        question.thinkingLevel
      ) || "");
    }

    function takeQuestion(available, bucket, selected) {
      var index = available.findIndex(function (question) {
        return getBucket(question) === bucket;
      });
      var question;

      if (index === -1) {
        return false;
      }
      question = available.splice(index, 1)[0];
      selected.push(Object.assign({}, question, {
        adaptiveSelectionReason: "適応難易度" + requestedLevel + "の" +
          bucket + "枠。必要な判断条件" +
          getRequiredConditionCount(question) + "件。"
      }));
      return true;
    }

    function selectFrom(available, selected) {
      selectionPattern.slice(0, requestedCount).forEach(function (bucket) {
        if (selected.length < requestedCount) {
          takeQuestion(available, bucket, selected);
        }
      });
      while (selected.length < requestedCount && available.length) {
        var question = available.shift();
        selected.push(Object.assign({}, question, {
          adaptiveSelectionReason: "適応難易度" + requestedLevel +
            "の思考条件を満たす補完枠。必要な判断条件" +
            getRequiredConditionCount(question) + "件。"
        }));
      }
    }

    if (eligible.length < requestedCount) {
      return {
        questions: [],
        shortage: {
          requestedLevel: requestedLevel,
          requestedCount: requestedCount,
          availableCount: eligible.length,
          missingCount: requestedCount - eligible.length,
          excludedCount: exactLevel.length - eligible.length
        }
      };
    }

    var selected = [];
    selectFrom(sortQuestions(preferred), selected);
    if (selected.length < requestedCount) {
      selectFrom(sortQuestions(deferred).filter(function (question) {
        return !selected.some(function (item) {
          return item.id === question.id;
        });
      }), selected);
    }

    return {
      questions: selected.slice(0, requestedCount),
      shortage: null,
      requestedLevel: requestedLevel,
      eligibleCount: eligible.length,
      excludedCount: exactLevel.length - eligible.length,
      selectionPattern: selectionPattern.slice(0, requestedCount)
    };
  }

  global.QualificationOSCommon = {
    STAGES: STAGES,
    DEFAULT_EMBERS: DEFAULT_EMBERS,
    REASONING_DIFFICULTY_LEVELS: REASONING_DIFFICULTY_LEVELS,
    DEFAULT_SESSION_QUESTION_LIMIT: DEFAULT_SESSION_QUESTION_LIMIT,
    ADAPTIVE_SET_SIZE: ADAPTIVE_SET_SIZE,
    ADAPTIVE_STREAK_REQUIRED: ADAPTIVE_STREAK_REQUIRED,
    cloneJson: cloneJson,
    uniqueStrings: uniqueStrings,
    todayKey: todayKey,
    dateKeyFromValue: dateKeyFromValue,
    daysSince: daysSince,
    createDailyEmber: createDailyEmber,
    createFirekeeper: createFirekeeper,
    createTeacherMode: createTeacherMode,
    looksLikeLearningPayload: looksLikeLearningPayload,
    extractLearningPayload: extractLearningPayload,
    getPayloadUpdatedAt: getPayloadUpdatedAt,
    upsertLearningPayload: upsertLearningPayload,
    getReasoningLevelDefinition: getReasoningLevelDefinition,
    normalizeAdaptiveDifficulty: normalizeAdaptiveDifficulty,
    isPerfectUnderstandingSet: isPerfectUnderstandingSet,
    getImperfectSetReasons: getImperfectSetReasons,
    recordAdaptiveDifficultySet: recordAdaptiveDifficultySet,
    selectAdaptiveReasoningQuestions: selectAdaptiveReasoningQuestions
  };
}(window));
