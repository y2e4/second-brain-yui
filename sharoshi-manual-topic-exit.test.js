"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var MODULE_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-teacher-mode.js"), "utf8");
var HTML_SOURCE = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");

function FakeElement(tagName) {
  this.tagName = String(tagName || "").toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.hidden = false;
  this.disabled = false;
  this.className = "";
  this._textContent = "";
  this.listeners = {};
  this.classList = {
    add: function () {}
  };
}

Object.defineProperty(FakeElement.prototype, "textContent", {
  get: function () {
    return this._textContent;
  },
  set: function (value) {
    this._textContent = String(value || "");
    this.children.forEach(function (child) {
      child.parentNode = null;
    });
    this.children = [];
  }
});

FakeElement.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};

FakeElement.prototype.removeChild = function (child) {
  this.children = this.children.filter(function (item) {
    return item !== child;
  });
  child.parentNode = null;
  return child;
};

FakeElement.prototype.addEventListener = function (type, listener) {
  this.listeners[type] = listener;
};

FakeElement.prototype.click = function () {
  if (!this.disabled && typeof this.listeners.click === "function") {
    this.listeners.click({ target: this });
  }
};

FakeElement.prototype.querySelectorAll = function (selector) {
  var matches = [];
  this.children.forEach(function visit(child) {
    if (selector === "button" && child.tagName === "BUTTON") {
      matches.push(child);
    }
    child.children.forEach(visit);
  });
  return matches;
};

function findButton(root, text) {
  return root.querySelectorAll("button").find(function (button) {
    return button.textContent === text;
  }) || null;
}

function loadModule() {
  var context = {
    document: {
      createElement: function (tagName) {
        return new FakeElement(tagName);
      }
    },
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(MODULE_SOURCE, context);
  return context.window.SharoshiTeacherModeBeta;
}

function question(id, category, answer) {
  return {
    id: id,
    category: category,
    question: id + "の確認問題",
    answer: answer
  };
}

function startChallenge(module, callbacks) {
  var container = new FakeElement("section");
  var controller = module.create({
    container: container,
    onSupplementAnswer: callbacks.onSupplementAnswer,
    onChallengeComplete: callbacks.onChallengeComplete
  });

  controller.render({
    question: question("source", "雇用保険", false),
    topicKey: "category:雇用保険",
    trigger: "wrong",
    isCorrect: false,
    repeatedWrong: true,
    lowUnderstanding: true,
    isEmploymentQuestion: true,
    relatedQuestions: [
      question("related-1", "雇用保険", true),
      question("related-2", "雇用保険", false)
    ]
  });
  findButton(container, "挑戦する").click();
  return { container: container, controller: controller };
}

test("補習1/2中の手動出口は回答や弱点を偽装せず同論点を一時停止する", function () {
  var module = loadModule();
  var completions = [];
  var supplementAnswers = 0;
  var setup = startChallenge(module, {
    onSupplementAnswer: function () {
      supplementAnswers += 1;
    },
    onChallengeComplete: function (result) {
      completions.push(result);
    }
  });
  var exitButton = findButton(setup.container, "別の論点へ進む");

  assert.ok(exitButton);
  exitButton.click();

  assert.equal(supplementAnswers, 0);
  assert.equal(setup.controller.challenge, null);
  assert.equal(setup.controller.isRemediationBlocked("category:雇用保険"), true);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].reason, "manual_topic_exit");
  assert.equal(completions[0].correct, 0);
  assert.equal(completions[0].total, 2);
});

test("補習2/2前の手動出口も完了通知を一度だけ送り、即時再起動を防ぐ", function () {
  var module = loadModule();
  var completions = [];
  var supplementAnswers = 0;
  var setup = startChallenge(module, {
    onSupplementAnswer: function () {
      supplementAnswers += 1;
    },
    onChallengeComplete: function (result) {
      completions.push(result);
    }
  });

  setup.container.querySelectorAll("button").find(function (button) {
    return /^〇$/.test(button.textContent);
  }).click();
  findButton(setup.container, "次へ").click();
  findButton(setup.container, "別の論点へ進む").click();

  assert.equal(supplementAnswers, 1);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].reason, "manual_topic_exit");
  assert.equal(setup.controller.isRemediationBlocked("category:雇用保険"), true);

  setup.controller.noteMainQuestion("category:雇用保険");
  assert.equal(setup.controller.isRemediationBlocked("category:雇用保険"), true);
  setup.controller.noteMainQuestion("category:健康保険");
  assert.equal(setup.controller.isRemediationBlocked("category:雇用保険"), false);
});

test("HTMLは手動出口だけを通常の次問処理へ接続し、学習集計を直接変更しない", function () {
  var callbackStart = HTML_SOURCE.indexOf("onChallengeComplete: function (result)");
  var callbackSource = HTML_SOURCE.slice(callbackStart, callbackStart + 1200);

  assert.match(HTML_SOURCE, /sharoshi-teacher-mode\.js\?v=20260823-manual-topic-exit-01/);
  assert.match(HTML_SOURCE, /result\.reason === "manual_topic_exit"/);
  assert.match(HTML_SOURCE, /function advanceSessionQuestion\(\)/);
  assert.ok(callbackStart >= 0);
  assert.match(callbackSource, /advanceSessionQuestion\(\)/);
  assert.doesNotMatch(
    callbackSource,
    /recordAnswer|recordWrong|recordCorrectReview|wrongQuestionIds|wrongReview|totalAnswers|correctAnswers|saveProgress/
  );
});

test("通常の次ボタンも共通進行関数を使い、3問・10問・Stage導線を分岐させない", function () {
  assert.match(
    HTML_SOURCE,
    /nextButton\.addEventListener\("click", function \(\) \{\s*advanceSessionQuestion\(\);\s*\}\)/
  );
  assert.doesNotMatch(MODULE_SOURCE, /localStorage|wrongQuestionIds|wrongReview|totalAnswers|correctAnswers/);
});
