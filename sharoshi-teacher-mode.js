(function (global) {
  "use strict";

  var CHOICE_LABELS = ["A", "B", "C", "D", "E"];
  var MAX_REMEDIATION_QUESTIONS = 2;

  function normalizeTopicValue(value) {
    return String(value || "").trim();
  }

  function getQuestionTopicKey(question) {
    var categories;
    var knowledgeKey = normalizeTopicValue(question && question.knowledgeKey);
    var theme = normalizeTopicValue(question && question.theme);
    var adaptiveTopic = normalizeTopicValue(question && question.adaptiveTopic);

    if (knowledgeKey) {
      return "knowledge:" + knowledgeKey;
    }
    if (theme) {
      return "theme:" + theme;
    }
    if (adaptiveTopic) {
      return "adaptive:" + adaptiveTopic;
    }

    categories = Array.isArray(question && question.category)
      ? question.category.map(normalizeTopicValue).filter(Boolean)
      : normalizeTopicValue(question && question.category).split(",").map(function (item) {
        return item.trim();
      }).filter(Boolean);
    if (categories.indexOf("雇用保険") !== -1) {
      return "category:雇用保険";
    }
    if (categories.length) {
      return "category:" + categories[0];
    }
    return "question:" + normalizeTopicValue(question && question.id);
  }

  function getChallengeQuestions(relatedQuestions) {
    var usedIds = {};
    return (Array.isArray(relatedQuestions) ? relatedQuestions : []).filter(function (question) {
      var id = normalizeTopicValue(question && question.id);
      if (!id || usedIds[id]) {
        return false;
      }
      usedIds[id] = true;
      return true;
    }).slice(0, MAX_REMEDIATION_QUESTIONS);
  }

  function prioritizeNextDifferentTopic(questions, currentIndex, topicKey) {
    var output = Array.isArray(questions) ? questions.slice() : [];
    var nextIndex = Number(currentIndex) + 1;
    var replacementIndex;
    var temporary;

    if (!topicKey || nextIndex < 0 || nextIndex >= output.length ||
        getQuestionTopicKey(output[nextIndex]) !== topicKey) {
      return output;
    }
    replacementIndex = output.findIndex(function (question, index) {
      return index > nextIndex && getQuestionTopicKey(question) !== topicKey;
    });
    if (replacementIndex === -1) {
      return output;
    }
    temporary = output[nextIndex];
    output[nextIndex] = output[replacementIndex];
    output[replacementIndex] = temporary;
    return output;
  }

  function createRemediationGate() {
    var blockedTopicKey = "";
    return {
      noteMainQuestion: function (topicKey) {
        var normalized = normalizeTopicValue(topicKey);
        if (blockedTopicKey && normalized && normalized !== blockedTopicKey) {
          blockedTopicKey = "";
        }
      },
      markCompleted: function (topicKey) {
        blockedTopicKey = normalizeTopicValue(topicKey);
      },
      isBlocked: function (topicKey) {
        return Boolean(blockedTopicKey) && blockedTopicKey === normalizeTopicValue(topicKey);
      },
      getBlockedTopicKey: function () {
        return blockedTopicKey;
      }
    };
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

  function shuffled(list) {
    var copy = list.slice();
    var i;
    var j;
    var temporary;

    for (i = copy.length - 1; i > 0; i -= 1) {
      j = Math.floor(Math.random() * (i + 1));
      temporary = copy[i];
      copy[i] = copy[j];
      copy[j] = temporary;
    }
    return copy;
  }

  function isSingleChoiceQuestion(question) {
    return question && question.type === "single_choice" && Array.isArray(question.choices);
  }

  function getChoiceId(choice, index) {
    if (choice && typeof choice === "object" && !Array.isArray(choice) && choice.id) {
      return String(choice.id);
    }
    return ["a", "b", "c", "d", "e"][index] || String(index);
  }

  function getChoiceText(choice) {
    if (choice && typeof choice === "object" && !Array.isArray(choice) &&
        Object.prototype.hasOwnProperty.call(choice, "text")) {
      return String(choice.text);
    }
    return String(choice);
  }

  function getCorrectChoiceId(question) {
    var answerIndex;

    if (!isSingleChoiceQuestion(question)) {
      return "";
    }
    if (question.correctAnswerId) {
      return String(question.correctAnswerId);
    }
    answerIndex = Number(question.answer);
    if (Number.isInteger(answerIndex) && question.choices[answerIndex]) {
      return getChoiceId(question.choices[answerIndex], answerIndex);
    }
    return "";
  }

  function isAnswerCorrect(question, selectedAnswer) {
    if (isSingleChoiceQuestion(question)) {
      return String(selectedAnswer) === getCorrectChoiceId(question);
    }
    return selectedAnswer === question.answer;
  }

  function getQuestionText(question) {
    return String(question.reviewPrompt || question.statement || question.question || question.term || "確認問題");
  }

  function getTeacherMessage(context) {
    if (context.trigger === "unsure") {
      return "今回迷ったのは、\n雇用保険の加入条件と給付条件が\n少し混ざったからかもしれないね😊";
    }
    if (context.trigger === "guessed") {
      return "勘で当たった問題は、\n次に似た条件で聞かれると揺れやすいところ。\n今日は分け方だけ押さえよう。";
    }
    if (context.trigger === "weak") {
      return "ここは苦手登録したくなる場所だね。\n雇用保険は、時点と対象者を分けると\n少し見通しがよくなるよ。";
    }
    if (context.repeatedWrong) {
      return "同じ問題で止まったのは、\n条件が混ざっているサインかもしれない。\nまず入口だけ一緒にほどこう。";
    }
    return "この問題は、\n雇用保険の入口と給付の出口を\n分ける練習に向いているよ。";
  }

  function getTodayStep(context) {
    if (context.trigger === "guessed") {
      return "『雇用保険は、在職中の話か離職後の話かを先に分ける。』";
    }
    if (context.trigger === "weak" || context.repeatedWrong) {
      return "『雇用保険は、まず「加入できる人か」を考える。』";
    }
    return "『雇用保険は、「加入できる人か」と「どの給付か」を分ける。』";
  }

  function shouldShowTeacher(context) {
    if (!context || !context.question || !context.isEmploymentQuestion) {
      return false;
    }
    if (context.mastered || context.trigger === "understood") {
      return true;
    }
    return context.repeatedWrong ||
      context.lowUnderstanding ||
      context.trigger === "unsure" ||
      context.trigger === "guessed" ||
      context.trigger === "weak";
  }

  function renderMastered(container) {
    container.className = "teacher-mode-card is-mastered";
    container.hidden = false;
    container.textContent = "";
    container.appendChild(createElement("p", "teacher-mode-text", "💡 よし、この考え方は定着してきたね😊"));
  }

  function renderTeacherCard(controller, context) {
    var title = createElement("p", "teacher-mode-title", "🎓 ユイ先生");
    var text = createElement("p", "teacher-mode-text", getTeacherMessage(context));
    var step = createElement("div", "teacher-step");
    var monster = createElement("div", "teacher-monster");
    var challengeButton = createElement("button", "secondary-button", "挑戦する");

    controller.container.className = "teacher-mode-card";
    controller.container.hidden = false;
    controller.container.textContent = "";

    step.appendChild(createElement("p", "teacher-step-title", "今日の一歩"));
    step.appendChild(createElement("p", "teacher-step-text", getTodayStep(context)));

    monster.appendChild(createElement("p", "teacher-monster-title", "👾 苦手モンスター出現"));
    monster.appendChild(createElement("strong", "teacher-monster-name", "条件まぜまぜスライム"));
    monster.appendChild(createElement("p", "teacher-monster-text", "条件を混ぜて判断を迷わせる。"));
    challengeButton.type = "button";
    challengeButton.addEventListener("click", function () {
      startMonsterChallenge(controller, context);
    });
    controller.challengeButton = challengeButton;
    monster.appendChild(challengeButton);

    controller.container.appendChild(title);
    controller.container.appendChild(text);
    controller.container.appendChild(step);
    controller.container.appendChild(monster);
  }

  function renderCooldownCard(controller) {
    controller.container.className = "teacher-mode-card";
    controller.container.hidden = false;
    controller.container.textContent = "";
    controller.container.appendChild(createElement("p", "teacher-mode-title", "🎓 ユイ先生"));
    controller.container.appendChild(createElement(
      "p",
      "teacher-mode-text",
      "この論点は関連2問まで確認しました。\n苦手は残したまま、いったん別の論点へ進みます。"
    ));
  }

  function createAnswerButton(question, choice, index, onAnswer) {
    var button = createElement("button", "teacher-mini-button");
    var label = CHOICE_LABELS[index] || String(index + 1);

    button.type = "button";
    if (isSingleChoiceQuestion(question)) {
      button.textContent = label + ". " + getChoiceText(choice);
      button.addEventListener("click", function () {
        onAnswer(button, getChoiceId(choice, index));
      });
    } else {
      button.textContent = choice.label;
      button.addEventListener("click", function () {
        onAnswer(button, choice.value);
      });
    }
    return button;
  }

  function renderChallengeQuestion(controller) {
    var challenge = controller.challenge;
    var question = challenge.questions[challenge.index];
    var box = challenge.box;
    var status;
    var choices;
    var choicesBox;
    var exitButton;

    box.textContent = "";
    box.appendChild(createElement(
      "p",
      "teacher-challenge-status",
      "ミニ挑戦 " + (challenge.index + 1) + " / " + challenge.questions.length
    ));
    box.appendChild(createElement("p", "teacher-challenge-question", getQuestionText(question)));

    choicesBox = createElement("div", "teacher-challenge-choices");
    choices = isSingleChoiceQuestion(question)
      ? shuffled(question.choices)
      : [
        { label: "〇", value: true },
        { label: "×", value: false }
      ];
    choices.forEach(function (choice, index) {
      choicesBox.appendChild(createAnswerButton(question, choice, index, function (button, answer) {
        var correct = isAnswerCorrect(question, answer);
        var buttons = choicesBox.querySelectorAll("button");

        buttons.forEach(function (item) {
          item.disabled = true;
        });
        button.classList.add(correct ? "is-correct" : "is-wrong");
        if (correct) {
          challenge.correct += 1;
        }
        if (typeof controller.onSupplementAnswer === "function") {
          controller.onSupplementAnswer({
            question: question,
            correct: correct
          });
        }
        status.textContent = correct
          ? "いいね。条件を分けられているよ。"
          : "惜しい。ここは条件をもう一度分けてみよう。";
        challenge.nextButton.hidden = false;
      }));
    });
    box.appendChild(choicesBox);

    status = createElement("p", "teacher-challenge-status", "");
    challenge.nextButton = createElement("button", "secondary-button", "次へ");
    challenge.nextButton.type = "button";
    challenge.nextButton.hidden = true;
    challenge.nextButton.addEventListener("click", function () {
      challenge.index += 1;
      if (challenge.index >= challenge.questions.length) {
        renderChallengeResult(controller);
      } else {
        renderChallengeQuestion(controller);
      }
    });
    box.appendChild(status);
    box.appendChild(challenge.nextButton);

    exitButton = createElement(
      "button",
      "secondary-button teacher-topic-exit-button",
      "別の論点へ進む"
    );
    exitButton.type = "button";
    exitButton.addEventListener("click", function () {
      controller.exitToDifferentTopic();
    });
    box.appendChild(exitButton);
    box.appendChild(createElement(
      "p",
      "teacher-topic-exit-note",
      "苦手は残したまま、いったん別の問題へ進みます。"
    ));
  }

  function markChallengeCompleted(controller, challenge, reason) {
    if (!challenge || challenge.completed) {
      return null;
    }
    challenge.completed = true;
    controller.remediationGate.markCompleted(challenge.topicKey);
    return {
      topicKey: challenge.topicKey,
      questionIds: challenge.questions.map(function (question) {
        return question.id;
      }),
      correct: challenge.correct,
      total: challenge.questions.length,
      reason: reason || "completed"
    };
  }

  function notifyChallengeComplete(controller, result) {
    if (result && typeof controller.onChallengeComplete === "function") {
      controller.onChallengeComplete(result);
    }
  }

  function exitChallengeToDifferentTopic(controller) {
    var challenge = controller.challenge;
    var result = markChallengeCompleted(controller, challenge, "manual_topic_exit");

    if (!result) {
      return false;
    }
    if (challenge.box && challenge.box.parentNode) {
      challenge.box.parentNode.removeChild(challenge.box);
    }
    controller.challenge = null;
    renderCooldownCard(controller);
    notifyChallengeComplete(controller, result);
    return true;
  }

  function renderChallengeResult(controller) {
    var challenge = controller.challenge;
    var defeated = challenge.correct === challenge.questions.length;
    var closeButton = createElement("button", "secondary-button", "通常の問題へ戻る");
    var result = markChallengeCompleted(controller, challenge, "completed");

    notifyChallengeComplete(controller, result);

    challenge.box.textContent = "";
    challenge.box.appendChild(createElement(
      "p",
      "teacher-challenge-status",
      defeated
        ? "🎉 撃破！\n条件まぜまぜスライムを倒した！"
        : "今日はここまでで十分。\n条件を分ける練習を一つ積めたよ。"
    ));
    closeButton.type = "button";
    closeButton.addEventListener("click", function () {
      if (challenge.box && challenge.box.parentNode) {
        challenge.box.parentNode.removeChild(challenge.box);
      }
      controller.challenge = null;
      renderCooldownCard(controller);
    });
    challenge.box.appendChild(closeButton);
  }

  function startMonsterChallenge(controller, context) {
    var questions = getChallengeQuestions(context.relatedQuestions);

    if (controller.remediationGate.isBlocked(context.topicKey) ||
        questions.length < MAX_REMEDIATION_QUESTIONS) {
      return;
    }
    if (controller.challengeButton) {
      controller.challengeButton.hidden = true;
    }

    controller.challenge = {
      questions: questions,
      index: 0,
      correct: 0,
      topicKey: normalizeTopicValue(context.topicKey),
      completed: false,
      box: createElement("div", "teacher-challenge-box"),
      nextButton: null
    };
    controller.container.appendChild(controller.challenge.box);
    renderChallengeQuestion(controller);
  }

  function create(options) {
    var controller = {
      container: options && options.container,
      onSupplementAnswer: options && options.onSupplementAnswer,
      onChallengeComplete: options && options.onChallengeComplete,
      remediationGate: createRemediationGate(),
      challenge: null,
      challengeButton: null,
      noteMainQuestion: function (topicKey) {
        controller.remediationGate.noteMainQuestion(topicKey);
      },
      isRemediationBlocked: function (topicKey) {
        return controller.remediationGate.isBlocked(topicKey);
      },
      exitToDifferentTopic: function () {
        return exitChallengeToDifferentTopic(controller);
      },
      reset: function () {
        if (!controller.container) {
          return;
        }
        controller.container.hidden = true;
        controller.container.textContent = "";
        controller.container.className = "teacher-mode-card";
        controller.challenge = null;
        controller.challengeButton = null;
      },
      render: function (context) {
        if (!controller.container) {
          return;
        }
        controller.reset();
        if (!shouldShowTeacher(context)) {
          return;
        }
        if (context.mastered || context.trigger === "understood") {
          renderMastered(controller.container);
          return;
        }
        if (controller.remediationGate.isBlocked(context.topicKey)) {
          renderCooldownCard(controller);
          return;
        }
        renderTeacherCard(controller, context);
      }
    };

    return controller;
  }

  global.SharoshiTeacherModeBeta = {
    MAX_REMEDIATION_QUESTIONS: MAX_REMEDIATION_QUESTIONS,
    create: create,
    createRemediationGate: createRemediationGate,
    getChallengeQuestions: getChallengeQuestions,
    getQuestionTopicKey: getQuestionTopicKey,
    prioritizeNextDifferentTopic: prioritizeNextDifferentTopic
  };
}(window));
