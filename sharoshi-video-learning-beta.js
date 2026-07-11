(function (global) {
  "use strict";

  var TERM_CORRECTIONS = [
    { pattern: /車労使|社労し|しゃろうし|社会保険労務し/g, replacement: "社労士" },
    { pattern: /厚生念金|公正年金|高成年金|構成年金/g, replacement: "厚生年金" },
    { pattern: /国民念金|国民年金金/g, replacement: "国民年金" },
    { pattern: /老齢念金|老令年金/g, replacement: "老齢年金" },
    { pattern: /障害念金|障がい年金/g, replacement: "障害年金" },
    { pattern: /遺族念金/g, replacement: "遺族年金" },
    { pattern: /労際|労才|老妻/g, replacement: "労災" },
    { pattern: /労災補償保険|労災保険法/g, replacement: "労災保険" },
    { pattern: /雇用方針|雇用ほけん|雇用保健/g, replacement: "雇用保険" },
    { pattern: /健康保健/g, replacement: "健康保険" },
    { pattern: /労働基準方|労基法/g, replacement: "労働基準法" },
    { pattern: /安全衛生方|安衛法/g, replacement: "労働安全衛生法" },
    { pattern: /三六協定|サブロク協定/g, replacement: "36協定" },
    { pattern: /有休|有給休暇/g, replacement: "年次有給休暇" },
    { pattern: /被保険車/g, replacement: "被保険者" },
    { pattern: /標準報酬月がく|標準報酬月額額/g, replacement: "標準報酬月額" }
  ];

  var CORE_TERMS = [
    "社労士",
    "労働基準法",
    "労働安全衛生法",
    "労災保険",
    "雇用保険",
    "健康保険",
    "国民年金",
    "厚生年金",
    "老齢年金",
    "障害年金",
    "遺族年金",
    "被保険者",
    "標準報酬月額",
    "36協定",
    "年次有給休暇",
    "基本手当",
    "傷病手当金",
    "業務災害",
    "通勤災害"
  ];

  function byId(id) {
    return document.getElementById(id);
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

  function uniqueStrings(list) {
    var seen = {};
    return (Array.isArray(list) ? list : []).filter(function (item) {
      var value = String(item || "").trim();
      if (!value || seen[value]) {
        return false;
      }
      seen[value] = true;
      return true;
    });
  }

  function normalizeTranscript(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function correctTranscript(text) {
    var corrected = normalizeTranscript(text);
    var corrections = [];

    TERM_CORRECTIONS.forEach(function (rule) {
      var before = corrected;
      corrected = corrected.replace(rule.pattern, rule.replacement);
      if (before !== corrected) {
        corrections.push(rule.replacement);
      }
    });

    return {
      text: corrected,
      corrections: uniqueStrings(corrections),
      reviewTargets: findReviewTargets(corrected)
    };
  }

  function findReviewTargets(text) {
    var targets = [];
    var patterns = [
      /聞き取り不明/g,
      /不明/g,
      /[?？]{2,}/g,
      /〇〇/g
    ];

    patterns.forEach(function (pattern) {
      var matched = text.match(pattern);
      if (matched) {
        targets = targets.concat(matched);
      }
    });

    return uniqueStrings(targets).slice(0, 5);
  }

  function splitSentences(text) {
    return normalizeTranscript(text)
      .replace(/([。！？])/g, "$1\n")
      .split(/\n+/)
      .map(function (sentence) {
        return sentence.trim();
      })
      .filter(function (sentence) {
        return sentence.length >= 12;
      });
  }

  function detectTerms(text) {
    return CORE_TERMS.filter(function (term) {
      return text.indexOf(term) !== -1;
    });
  }

  function scoreSentence(sentence, terms) {
    var score = 0;
    terms.forEach(function (term) {
      if (sentence.indexOf(term) !== -1) {
        score += 3;
      }
    });
    if (/対象|条件|加入|給付|期間|年齢|原則|例外|会社員|自営業|退職|離職|業務上|通勤/.test(sentence)) {
      score += 2;
    }
    if (/違い|比較|混同|区別|判断|確認/.test(sentence)) {
      score += 2;
    }
    if (/必ず|すべて|のみ|一切|常に/.test(sentence)) {
      score += 1;
    }
    return score;
  }

  function extractImportantPoints(text) {
    var terms = detectTerms(text);
    var sentences = splitSentences(text);
    var scored = sentences.map(function (sentence, index) {
      return {
        sentence: sentence,
        index: index,
        score: scoreSentence(sentence, terms)
      };
    }).sort(function (left, right) {
      return right.score - left.score || left.index - right.index;
    });
    var selected = uniqueStrings(scored.filter(function (item) {
      return item.score > 0;
    }).map(function (item) {
      return item.sentence;
    })).slice(0, 5);

    if (!selected.length && sentences.length) {
      selected = sentences.slice(0, 3);
    }
    if (!selected.length) {
      selected = ["この動画では、資格学習につながる用語や制度の整理が扱われています。"];
    }

    while (selected.length < 3) {
      selected.push(buildFallbackPoint(terms, selected.length));
    }

    return selected.slice(0, 5);
  }

  function buildFallbackPoint(terms, index) {
    var mainTerm = terms[index % Math.max(terms.length, 1)] || "制度";
    if (index === 0) {
      return mainTerm + "は、まず対象者と場面を分けて理解する。";
    }
    if (index === 1) {
      return "似た制度は、名前ではなく条件と給付内容で区別する。";
    }
    return "試験では、原則と例外の言い換えに注意する。";
  }

  function buildDetail(points, terms) {
    var detail = [];
    detail.push("この文字起こしでは、まず用語をそのまま暗記するより、制度ごとの「対象者」「時点」「条件」を分けることが大切です。");
    if (terms.length) {
      detail.push("出てきた主な用語: " + terms.join("、"));
    }
    detail.push("重要ポイント:");
    points.forEach(function (point, index) {
      detail.push((index + 1) + ". " + point);
    });
    detail.push("本試験では、正しい説明の一部だけを入れ替えた選択肢が出やすいので、似た制度との違いを確認してください。");
    return detail.join("\n");
  }

  function buildTeacherExplanation(points, terms) {
    var firstTerm = terms[0] || "制度";
    var lines = [];

    lines.push("要約だけで終わらせず、「なぜそうなるか」を一つ見るよ。");
    lines.push(firstTerm + "は、言葉の意味だけでなく、誰に・いつ・どんな条件で関係するかを分けると理解しやすいです。");
    lines.push("覚え方は、名前より先に「対象者」と「場面」を見ること。試験では、似た制度との違いや断定表現を狙われます。");
    if (points[0]) {
      lines.push("今日の軸: " + points[0]);
    }
    return lines.join("\n");
  }

  function buildQuiz(points, terms) {
    var hasPension = terms.some(function (term) {
      return /年金/.test(term);
    });
    var hasEmployment = terms.indexOf("雇用保険") !== -1 || terms.indexOf("基本手当") !== -1;
    var hasHealth = terms.indexOf("健康保険") !== -1 || terms.indexOf("傷病手当金") !== -1;
    var quiz = [
      {
        question: "動画を教材として使うときは、まず「誰が対象か」「どの場面の話か」を分けて確認するとよい。",
        answer: true,
        explanation: "制度名だけで判断すると混同しやすいため、対象者と場面を先に分けます。"
      },
      {
        question: "似た制度名が出てきた場合、名称が近ければ給付内容や条件も同じものとして扱ってよい。",
        answer: false,
        explanation: "名称が近くても、保険者・対象者・給付条件が違うことがあります。"
      }
    ];

    if (hasPension) {
      quiz.push({
        question: "年金の話では、国民年金・厚生年金・老齢・障害・遺族など、どの制度や給付の話かを分けて読む必要がある。",
        answer: true,
        explanation: "同じ年金でも、加入する制度と受け取る給付は分けて判断します。"
      });
    } else if (hasEmployment) {
      quiz.push({
        question: "雇用保険では、加入できる人かどうかと、離職後にどの給付を受けるかを同じ条件として判断する。",
        answer: false,
        explanation: "加入条件と給付条件は見る場面が違います。まず在職中か離職後かを分けます。"
      });
    } else if (hasHealth) {
      quiz.push({
        question: "健康保険と労災保険は、病気やけがが業務上か私傷病かで関係する制度が変わることがある。",
        answer: true,
        explanation: "業務上なら労災保険、私傷病なら健康保険という入口の違いを確認します。"
      });
    } else {
      quiz.push({
        question: "動画の重要ポイントは、用語の意味だけでなく、条件や例外と結びつけて確認する。",
        answer: true,
        explanation: "資格試験では、用語を知っているだけでなく条件判断まで問われます。"
      });
    }

    return quiz.slice(0, 3);
  }

  function setStatus(controller, message, isError) {
    if (!controller.status) {
      return;
    }
    controller.status.textContent = message || "";
    controller.status.hidden = !message;
    controller.status.classList.toggle("is-error", Boolean(isError));
    controller.status.classList.toggle("is-good", Boolean(message) && !isError);
  }

  function renderList(container, points) {
    container.textContent = "";
    points.forEach(function (point) {
      container.appendChild(createElement("li", "", point));
    });
  }

  function renderQuiz(controller) {
    var question = controller.state.quiz[controller.state.quizIndex];

    controller.quizProgress.textContent = "問題 " + (controller.state.quizIndex + 1) + " / " + controller.state.quiz.length;
    controller.quizQuestion.textContent = question.question;
    controller.quizFeedback.hidden = true;
    controller.quizFeedback.textContent = "";
    controller.quizChoices.textContent = "";
    [
      { label: "〇", value: true },
      { label: "×", value: false }
    ].forEach(function (choice) {
      var button = createElement("button", "secondary-button", choice.label);
      button.type = "button";
      button.addEventListener("click", function () {
        answerQuiz(controller, choice.value);
      });
      controller.quizChoices.appendChild(button);
    });
  }

  function answerQuiz(controller, value) {
    var question = controller.state.quiz[controller.state.quizIndex];
    var correct = value === question.answer;
    var nextButton;

    controller.state.answers.push({
      correct: correct,
      question: question.question
    });
    controller.quizChoices.querySelectorAll("button").forEach(function (button) {
      button.disabled = true;
    });
    controller.quizFeedback.hidden = false;
    controller.quizFeedback.textContent = (correct ? "正解です。\n" : "ここは先生モードで確認しよう。\n") + question.explanation;

    nextButton = createElement("button", "secondary-button", controller.state.quizIndex + 1 >= controller.state.quiz.length ? "理解度を見る" : "次の問題");
    nextButton.type = "button";
    nextButton.addEventListener("click", function () {
      controller.state.quizIndex += 1;
      if (controller.state.quizIndex >= controller.state.quiz.length) {
        renderResult(controller);
      } else {
        renderQuiz(controller);
      }
    });
    controller.quizChoices.appendChild(nextButton);
  }

  function renderResult(controller) {
    var correctCount = controller.state.answers.filter(function (answer) {
      return answer.correct;
    }).length;
    var wrongCount = controller.state.answers.length - correctCount;

    controller.quizBox.hidden = true;
    controller.understandingBox.hidden = false;
    if (wrongCount > 0) {
      controller.understandingText.textContent =
        "理解度: もう一歩\n" +
        "3問中 " + correctCount + "問正解です。間違えたところは、用語ではなく条件の分け方で揺れている可能性があります。";
      renderTeacherMode(controller, wrongCount);
      return;
    }
    controller.understandingText.textContent =
      "理解度: いい感じです\n" +
      "3問中3問正解です。動画の内容を、資格OSの判断軸に変換できています。";
    controller.teacherModeCard.hidden = true;
  }

  function renderTeacherMode(controller) {
    controller.teacherModeCard.hidden = false;
    controller.teacherModeText.textContent =
      "今回つまずいたのは、制度名と条件が少し混ざったからかもしれないね。\n" +
      "全部覚え直さなくて大丈夫。まず、対象者と場面を分けよう。";
    controller.teacherStepText.textContent = "『動画で聞いた用語は、誰に・いつ・どんな条件で関係するかを見る。』";
  }

  function scrollBack(controller) {
    var target = document.getElementById("homeView");
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function build(controller) {
    var raw = normalizeTranscript(controller.input.value);
    var correction;
    var terms;
    var points;

    if (raw.length < 30) {
      setStatus(controller, "文字起こしをもう少し貼り付けてください。30文字以上あると教材化しやすいです。", true);
      return;
    }

    correction = correctTranscript(raw);
    terms = detectTerms(correction.text);
    points = extractImportantPoints(correction.text);

    controller.state = {
      correctedText: correction.text,
      terms: terms,
      points: points,
      quiz: buildQuiz(points, terms),
      quizIndex: 0,
      answers: []
    };

    controller.output.hidden = false;
    controller.quizBox.hidden = false;
    controller.understandingBox.hidden = true;
    controller.teacherModeCard.hidden = true;
    controller.correctionSummary.textContent =
      "補正した用語: " + (correction.corrections.length ? correction.corrections.join("、") : "なし") +
      " / 確認が必要な候補: " + (correction.reviewTargets.length ? correction.reviewTargets.join("、") : "なし");
    controller.correctedText.textContent = correction.text;
    renderList(controller.pointList, points);
    controller.detailText.textContent = buildDetail(points, terms);
    controller.teacherText.textContent = buildTeacherExplanation(points, terms);
    renderQuiz(controller);
    setStatus(controller, "教材化しました。重要ポイントを確認して、3問だけ解いてみましょう。", false);
  }

  function clear(controller) {
    controller.input.value = "";
    controller.output.hidden = true;
    controller.teacherModeCard.hidden = true;
    controller.understandingBox.hidden = true;
    controller.quizChoices.textContent = "";
    setStatus(controller, "", false);
  }

  function create() {
    var controller = {
      input: byId("videoTranscriptInput"),
      buildButton: byId("videoBuildButton"),
      clearButton: byId("videoClearButton"),
      status: byId("videoLearningStatus"),
      output: byId("videoLearningOutput"),
      correctionSummary: byId("videoCorrectionSummary"),
      correctedText: byId("videoCorrectedText"),
      pointList: byId("videoPointList"),
      detailText: byId("videoDetailText"),
      teacherText: byId("videoTeacherText"),
      quizBox: byId("videoQuizBox"),
      quizProgress: byId("videoQuizProgress"),
      quizQuestion: byId("videoQuizQuestion"),
      quizChoices: byId("videoQuizChoices"),
      quizFeedback: byId("videoQuizFeedback"),
      teacherModeCard: byId("videoTeacherModeCard"),
      teacherModeText: byId("videoTeacherModeText"),
      teacherStepText: byId("videoTeacherStepText"),
      understandingBox: byId("videoUnderstandingBox"),
      understandingText: byId("videoUnderstandingText"),
      returnButton: byId("videoReturnButton"),
      returnAfterQuizButton: byId("videoReturnAfterQuizButton"),
      state: null
    };

    if (!controller.input || !controller.buildButton) {
      return null;
    }

    controller.buildButton.addEventListener("click", function () {
      build(controller);
    });
    controller.clearButton.addEventListener("click", function () {
      clear(controller);
    });
    controller.returnButton.addEventListener("click", function () {
      scrollBack(controller);
    });
    controller.returnAfterQuizButton.addEventListener("click", function () {
      scrollBack(controller);
    });

    return controller;
  }

  global.SharoshiVideoLearningBeta = {
    create: create
  };
}(window));
