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

  global.QualificationOSCommon = {
    STAGES: STAGES,
    DEFAULT_EMBERS: DEFAULT_EMBERS,
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
    upsertLearningPayload: upsertLearningPayload
  };
}(window));
