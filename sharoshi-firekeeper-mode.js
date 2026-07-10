(function (global) {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;
  var REASONS = [
    "忙しかった",
    "体調が悪かった",
    "忘れていた",
    "気分が乗らなかった",
    "その他"
  ];

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

  function dateKeyFromValue(value) {
    if (!value) {
      return "";
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      return String(value);
    }
    try {
      var date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return "";
      }
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
    } catch (error) {
      return "";
    }
  }

  function dayNumberFromKey(key) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) {
      return 0;
    }
    return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
  }

  function getDaysAway(context) {
    var todayKey = context.todayKey || dateKeyFromValue(new Date().toISOString());
    var lastKey = dateKeyFromValue(context.lastStudyAt) || dateKeyFromValue(context.lastStudyDate);
    var todayNumber = dayNumberFromKey(todayKey);
    var lastNumber = dayNumberFromKey(lastKey);

    if (!todayNumber || !lastNumber) {
      return 0;
    }
    return Math.max(0, todayNumber - lastNumber);
  }

  function getMessage(daysAway) {
    if (daysAway >= 7) {
      return "しばらく火を休ませていたね。\n体調や事情があるなら、今は守る方を選んでいい。\n動けそうなら、今日は1問だけ。";
    }
    if (daysAway >= 4) {
      return "先生ではなく、相棒として来たよ。\n理由があるなら休もう。\n理由がないなら、1問だけ戻ろう。";
    }
    return "少し間が空いたね。忙しかった？\n今日は1問だけ、一緒に戻ろう。";
  }

  function shouldShow(context) {
    var daysAway = getDaysAway(context);
    var todayKey = context.todayKey || dateKeyFromValue(new Date().toISOString());

    if (daysAway < 2) {
      return false;
    }
    if (context.dismissedDate === todayKey) {
      return false;
    }
    if (context.lastShownDate === todayKey && !context.alreadyVisible) {
      return false;
    }
    return true;
  }

  function renderReasons(controller, status) {
    var reasons = createElement("div", "firekeeper-reasons");
    reasons.appendChild(createElement("p", "firekeeper-status", "理由を残すなら、近いものを一つだけ選んでね。"));
    REASONS.forEach(function (reason) {
      var button = createElement("button", "secondary-button", reason);
      button.type = "button";
      button.addEventListener("click", function () {
        if (typeof controller.onReason === "function") {
          controller.onReason(reason);
        }
        status.textContent = "記録しました。今日は休む方を選んでも大丈夫。";
      });
      reasons.appendChild(button);
    });
    return reasons;
  }

  function render(context) {
    var controller = this;
    var daysAway = getDaysAway(context);
    var title;
    var message;
    var actions;
    var status;
    var oneButton;
    var restButton;
    var reasonButton;
    var reasonsBox = null;

    if (!controller.container) {
      return;
    }
    if (!shouldShow(context)) {
      controller.hide();
      return;
    }

    controller.container.hidden = false;
    controller.container.textContent = "";
    title = createElement("h2", "firekeeper-title", "🔥 火守モード");
    message = createElement("p", "firekeeper-message", getMessage(daysAway));
    actions = createElement("div", "firekeeper-actions");
    status = createElement("p", "firekeeper-status", "");

    oneButton = createElement("button", "primary-button", "1問だけやる");
    oneButton.type = "button";
    oneButton.addEventListener("click", function () {
      controller.hide();
      if (typeof controller.onStartOneQuestion === "function") {
        controller.onStartOneQuestion();
      }
    });

    restButton = createElement("button", "secondary-button", "今日は休む");
    restButton.type = "button";
    restButton.addEventListener("click", function () {
      if (typeof controller.onRest === "function") {
        controller.onRest();
      }
      status.textContent = "休む選択も、火を守る選択です。今日はゆっくりで大丈夫。";
    });

    reasonButton = createElement("button", "secondary-button", "理由を記録する");
    reasonButton.type = "button";
    reasonButton.addEventListener("click", function () {
      if (reasonsBox && reasonsBox.parentNode) {
        reasonsBox.parentNode.removeChild(reasonsBox);
        reasonsBox = null;
        return;
      }
      reasonsBox = renderReasons(controller, status);
      controller.container.appendChild(reasonsBox);
    });

    actions.appendChild(oneButton);
    actions.appendChild(restButton);
    actions.appendChild(reasonButton);
    controller.container.appendChild(title);
    controller.container.appendChild(message);
    controller.container.appendChild(actions);
    controller.container.appendChild(status);

    if (typeof controller.onShown === "function") {
      controller.onShown({
        daysAway: daysAway,
        todayKey: context.todayKey || ""
      });
    }
  }

  function create(options) {
    return {
      container: options && options.container,
      onStartOneQuestion: options && options.onStartOneQuestion,
      onRest: options && options.onRest,
      onReason: options && options.onReason,
      onShown: options && options.onShown,
      hide: function () {
        if (!this.container) {
          return;
        }
        this.container.hidden = true;
        this.container.textContent = "";
      },
      render: render
    };
  }

  global.SharoshiFirekeeperModeBeta = {
    create: create
  };
}(window));
