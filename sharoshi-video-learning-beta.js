(function (global) {
  "use strict";

  var SOURCE_NOTICE = "この内容は動画の文字起こしをもとに再構成しています。";
  var VIDEO_DRAFT_STORAGE_KEY = "sharoshiVideoLearningDraftsV1";
  var DRAFT_STATUSES = {
    draft: "下書き",
    waiting: "確認待ち",
    confirmed: "確認済み",
    registered: "正式登録"
  };

  var SUBJECT_TEMPLATES = {
    auto: {
      label: "自動判定",
      fields: ["講師の説明", "試験で覚えること", "要確認"],
      examGuides: [
        "まず、動画で扱っている制度と対象者を分けて確認する。",
        "数字・期間・例外・断定表現は、正式登録前に公式情報で確認する。"
      ]
    },
    labor_standards: {
      label: "労働基準法",
      fields: ["条文", "主体", "語尾", "原則", "例外", "罰則"],
      examGuides: [
        "誰に義務があるか、語尾が「できる」か「しなければならない」かを確認する。",
        "原則・例外・罰則が出た箇所は、条文とセットで確認する。"
      ]
    },
    workers_comp: {
      label: "労災保険",
      fields: ["制度の目的", "対象災害", "保険給付", "適用", "保険料負担", "他制度との比較"],
      examGuides: [
        "業務災害・通勤災害・私傷病を分け、健康保険との入口を混同しない。",
        "保険給付と保険料負担の話を分けて確認する。"
      ]
    },
    employment: {
      label: "雇用保険",
      fields: ["適用事業", "被保険者要件", "適用除外", "被保険者区分", "数字", "労災との比較"],
      examGuides: [
        "加入できる人の条件と、離職後に受ける給付条件を分けて確認する。",
        "適用除外・被保険者区分・数字は要確認として扱う。"
      ]
    }
  };

  var TERM_CORRECTIONS = [
    { pattern: /車労使|社労し|しゃろうし|社会保険労務し/g, replacement: "社労士", confidence: "確信あり", reason: "社労士学習の文脈で頻出する誤変換です。" },
    { pattern: /厚生念金|公正年金|高成年金|構成年金/g, replacement: "厚生年金", confidence: "確信あり", reason: "年金分野の制度名として自然です。" },
    { pattern: /国民念金|国民年金金/g, replacement: "国民年金", confidence: "確信あり", reason: "公的年金制度の正式な用語に補正します。" },
    { pattern: /老齢念金|老令年金/g, replacement: "老齢年金", confidence: "推定", reason: "年金給付の文脈では老齢年金を指す可能性が高いです。" },
    { pattern: /障害念金|障がい年金/g, replacement: "障害年金", confidence: "推定", reason: "年金給付名としての表記へそろえます。" },
    { pattern: /遺族念金/g, replacement: "遺族年金", confidence: "推定", reason: "遺族給付の文脈で使われる年金用語です。" },
    { pattern: /労際|労才|老妻/g, replacement: "労災", confidence: "推定", reason: "労働保険の文脈では労災の誤変換と考えられます。" },
    { pattern: /労災補償保険|労災保険法/g, replacement: "労災保険", confidence: "推定", reason: "教材上の制度名として読みやすくそろえます。" },
    { pattern: /雇用方針|雇用ほけん|雇用保健/g, replacement: "雇用保険", confidence: "確信あり", reason: "社労士科目の制度名として自然です。" },
    { pattern: /健康保健/g, replacement: "健康保険", confidence: "確信あり", reason: "社会保険の制度名としての正式表記です。" },
    { pattern: /労働基準方|労基法/g, replacement: "労働基準法", confidence: "確信あり", reason: "労基法は労働基準法の略称です。" },
    { pattern: /安全衛生方|安衛法/g, replacement: "労働安全衛生法", confidence: "確信あり", reason: "安衛法は労働安全衛生法の略称です。" },
    { pattern: /三六協定|サブロク協定/g, replacement: "36協定", confidence: "確信あり", reason: "時間外・休日労働の文脈で使う基本用語です。" },
    { pattern: /有休|有給休暇/g, replacement: "年次有給休暇", confidence: "推定", reason: "試験学習では制度名として年次有給休暇へそろえます。" },
    { pattern: /被保険車/g, replacement: "被保険者", confidence: "確信あり", reason: "保険制度の対象者を表す基本用語です。" },
    { pattern: /標準報酬月がく|標準報酬月額額/g, replacement: "標準報酬月額", confidence: "確信あり", reason: "社会保険料・給付の計算で使う基本用語です。" }
  ];

  var DANGER_PATTERNS = [
    { label: "数字", pattern: /[0-9０-９]+/g, reason: "数字は1桁違いで結論が変わるため、正式登録前に確認します。" },
    { label: "期間", pattern: /[0-9０-９]+(?:日|週間|か月|ヶ月|月|年|時間|分)(?:以内|以上|以下|未満|超)?/g, reason: "期間は試験で問われやすい条件です。" },
    { label: "年齢", pattern: /[0-9０-９]+歳(?:以上|以下|未満|超)?/g, reason: "年齢要件は制度ごとに異なるため確認が必要です。" },
    { label: "割合", pattern: /[0-9０-９]+(?:割|%|％)/g, reason: "割合は支給要件や算定で判断を左右します。" },
    { label: "罰則", pattern: /罰則|懲役|罰金|過料|科料/g, reason: "罰則は条文確認が必要な危険項目です。" },
    { label: "適用除外", pattern: /適用除外|除外|適用されない/g, reason: "適用除外は例外判断につながるため要確認です。" },
    { label: "例外", pattern: /例外|ただし|原則として|特例/g, reason: "原則と例外が混ざると誤答しやすいため確認します。" },
    { label: "法改正", pattern: /法改正|改正|施行|公布/g, reason: "法改正は最新公式情報で確認する必要があります。" },
    { label: "条文番号", pattern: /第[0-9０-９一二三四五六七八九十百]+条/g, reason: "条文番号は正確性確認が必要です。" },
    { label: "給付要件", pattern: /給付要件|支給要件|受給要件|被保険者要件/g, reason: "給付要件は制度ごとに条件が異なります。" }
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

  function makeId() {
    return "video-draft-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function getMatches(text, pattern) {
    var results = [];
    var match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text)) !== null) {
      results.push(match[0]);
      if (!pattern.global) {
        break;
      }
    }
    pattern.lastIndex = 0;
    return uniqueStrings(results);
  }

  function correctTranscript(text) {
    var corrected = normalizeTranscript(text);
    var corrections = [];

    TERM_CORRECTIONS.forEach(function (rule) {
      var originals = getMatches(corrected, rule.pattern);
      if (!originals.length) {
        return;
      }
      originals.forEach(function (original) {
        corrections.push({
          original: original,
          candidate: rule.replacement,
          reason: rule.reason,
          confidence: rule.confidence,
          category: "専門用語補正",
          autoApplied: rule.confidence !== "要確認"
        });
      });
      if (rule.confidence !== "要確認") {
        corrected = corrected.replace(rule.pattern, rule.replacement);
      }
    });

    return {
      text: corrected,
      corrections: corrections,
      dangerItems: detectDangerItems(corrected),
      reviewTargets: findReviewTargets(corrected)
    };
  }

  function detectDangerItems(text) {
    var items = [];
    var seen = {};

    DANGER_PATTERNS.forEach(function (rule) {
      getMatches(text, rule.pattern).forEach(function (value) {
        var key = rule.label + ":" + value;
        if (seen[key]) {
          return;
        }
        seen[key] = true;
        items.push({
          original: value,
          candidate: "自動補正しない（確認対象）",
          reason: rule.reason,
          confidence: "要確認",
          category: rule.label,
          autoApplied: false
        });
      });
    });

    return items.slice(0, 12);
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

    return uniqueStrings(targets).slice(0, 5).map(function (value) {
      return {
        original: value,
        candidate: "利用者確認",
        reason: "文字起こし上の不明箇所です。",
        confidence: "要確認",
        category: "聞き取り不明",
        autoApplied: false
      };
    });
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
    if (/必ず|すべて|のみ|一切|常に|しなければならない|できる/.test(sentence)) {
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

  function chooseSubject(text, selected) {
    if (selected && selected !== "auto" && SUBJECT_TEMPLATES[selected]) {
      return selected;
    }
    if (/労働基準法|労基|36協定|年次有給休暇|法定労働時間|休憩|休日|割増賃金/.test(text)) {
      return "labor_standards";
    }
    if (/労災|業務災害|通勤災害|療養補償|休業補償|保険給付/.test(text)) {
      return "workers_comp";
    }
    if (/雇用保険|基本手当|離職|被保険者区分|適用除外|失業/.test(text)) {
      return "employment";
    }
    return "auto";
  }

  function buildDetail(points, terms, subjectTemplate) {
    var detail = [];
    detail.push(SOURCE_NOTICE);
    detail.push("この文字起こしでは、まず用語をそのまま暗記するより、制度ごとの「対象者」「時点」「条件」を分けることが大切です。");
    detail.push("科目テンプレート: " + subjectTemplate.label);
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

  function buildLayeredContent(points, terms, subjectTemplate, reviewItems) {
    var firstTerm = terms[0] || subjectTemplate.label || "制度";
    var instructor = [
      firstTerm + "は、用語だけでなく「誰に・どの場面で・どんな条件で」使うかを分けると理解しやすくなります。",
      points[0] || "動画の中心テーマを一つに絞って、制度の入口から確認します。",
      "覚え方は、制度名より先に対象者と場面を見ることです。"
    ];
    var exam = subjectTemplate.examGuides.slice();

    subjectTemplate.fields.forEach(function (field) {
      if (exam.length >= 6) {
        return;
      }
      exam.push(field + ": 動画内の該当箇所を公式情報と照合して整理する。");
    });

    if (points[1]) {
      exam.push("主体・語尾・数字が出た文: " + points[1]);
    }

    return {
      instructor: instructor.slice(0, 5),
      exam: exam.slice(0, 6),
      review: buildReviewLayer(reviewItems)
    };
  }

  function buildReviewLayer(reviewItems) {
    if (!reviewItems.length) {
      return ["数字・例外・法改正などの危険項目は検出されませんでした。正式登録前には念のため公式情報を確認してください。"];
    }
    return reviewItems.slice(0, 8).map(function (item) {
      return item.category + "「" + item.original + "」: " + item.reason;
    });
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
        question: "数字・期間・例外が含まれる説明は、補正候補が自然ならそのまま正式問題データへ登録してよい。",
        answer: false,
        explanation: "数字・期間・例外は危険項目です。正式登録前に公式情報で確認します。"
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

  function setRegistrationStatus(controller, message, isError) {
    if (!controller.registrationStatus) {
      return;
    }
    controller.registrationStatus.textContent = message || "";
    controller.registrationStatus.hidden = !message;
    controller.registrationStatus.classList.toggle("is-error", Boolean(isError));
    controller.registrationStatus.classList.toggle("is-good", Boolean(message) && !isError);
  }

  function renderList(container, points) {
    if (!container) {
      return;
    }
    container.textContent = "";
    points.forEach(function (point) {
      container.appendChild(createElement("li", "", point));
    });
  }

  function confidenceClass(confidence) {
    if (confidence === "確信あり") {
      return "is-certain";
    }
    if (confidence === "推定") {
      return "is-estimated";
    }
    return "is-review";
  }

  function renderCorrectionReview(controller, reviewItems) {
    controller.correctionReviewList.textContent = "";
    if (!reviewItems.length) {
      controller.correctionReviewList.appendChild(createElement("p", "video-learning-small", "補正候補・要確認項目は検出されませんでした。"));
      return;
    }

    reviewItems.forEach(function (item) {
      var row = createElement("div", "video-correction-item");
      var confidence = createElement("span", "video-confidence " + confidenceClass(item.confidence), item.confidence);
      row.appendChild(createElement("p", "", "元の文字: " + item.original));
      row.appendChild(createElement("p", "", "補正候補: " + item.candidate));
      row.appendChild(createElement("p", "", "補正理由: " + item.reason));
      row.appendChild(confidence);
      controller.correctionReviewList.appendChild(row);
    });
  }

  function renderDraftStatus(controller) {
    if (!controller.draftStatus || !controller.state) {
      return;
    }
    controller.draftStatus.textContent = "状態：" + (DRAFT_STATUSES[controller.state.status] || DRAFT_STATUSES.draft);
  }

  function getSourceMeta(controller) {
    return {
      videoUrl: controller.videoUrl ? controller.videoUrl.value.trim() : "",
      videoTitle: controller.videoTitle ? controller.videoTitle.value.trim() : "",
      studiedAt: new Date().toISOString()
    };
  }

  function buildSourceText(source) {
    var lines = [SOURCE_NOTICE];
    if (source.videoTitle) {
      lines.push("動画タイトル: " + source.videoTitle);
    }
    if (source.videoUrl) {
      lines.push("動画URL: " + source.videoUrl);
    }
    lines.push("学習日時: " + new Date(source.studiedAt).toLocaleString("ja-JP"));
    return lines.join("\n");
  }

  function renderGeneratedContent(controller) {
    var state = controller.state;
    var correction = state.correction;
    var terms = state.terms;
    var corrections = correction.corrections.filter(function (item) {
      return item.autoApplied;
    }).map(function (item) {
      return item.candidate;
    });
    var reviewItems = state.reviewItems;

    controller.output.hidden = false;
    controller.quizBox.hidden = false;
    controller.understandingBox.hidden = true;
    controller.teacherModeCard.hidden = true;
    controller.correctionSummary.textContent =
      "補正した用語: " + (uniqueStrings(corrections).length ? uniqueStrings(corrections).join("、") : "なし") +
      " / 要確認: " + (reviewItems.length ? reviewItems.map(function (item) { return item.category + "「" + item.original + "」"; }).join("、") : "なし");
    controller.correctedText.textContent = correction.text;
    if (controller.sourceNotice) {
      controller.sourceNotice.textContent = buildSourceText(state.source);
    }
    renderDraftStatus(controller);
    renderList(controller.instructorLayer, state.layers.instructor);
    renderList(controller.examLayer, state.layers.exam);
    renderList(controller.reviewLayer, state.layers.review);
    renderList(controller.pointList, state.points);
    controller.detailText.textContent = buildDetail(state.points, terms, state.subjectTemplate);
    controller.teacherText.textContent = buildTeacherExplanation(state.points, terms);
    setRegistrationStatus(controller, "", false);
    renderQuiz(controller);
    saveDraft(controller);
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
    saveDraft(controller);
    if (wrongCount > 0) {
      controller.understandingText.textContent =
        "理解度: もう一歩\n" +
        "3問中 " + correctCount + "問正解です。間違えたところは、用語ではなく条件の分け方で揺れている可能性があります。";
      renderTeacherMode(controller);
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

  function saveDraft(controller) {
    var state = controller.state;
    var drafts;
    if (!state) {
      return;
    }
    try {
      drafts = JSON.parse(localStorage.getItem(VIDEO_DRAFT_STORAGE_KEY) || "[]");
      if (!Array.isArray(drafts)) {
        drafts = [];
      }
      drafts = drafts.filter(function (draft) {
        return draft && draft.id !== state.id;
      });
      drafts.unshift({
        id: state.id,
        status: state.status,
        source: state.source,
        subject: state.subject,
        subjectLabel: state.subjectTemplate.label,
        rawTranscript: state.rawTranscript,
        correctedTranscript: state.correction.text,
        corrections: state.correction.corrections,
        dangerItems: state.correction.dangerItems,
        reviewTargets: state.correction.reviewTargets,
        points: state.points,
        layers: state.layers,
        quiz: state.quiz,
        answers: state.answers,
        updatedAt: new Date().toISOString()
      });
      localStorage.setItem(VIDEO_DRAFT_STORAGE_KEY, JSON.stringify(drafts.slice(0, 10)));
    } catch (error) {
      setStatus(controller, "動画教材の下書き保存に失敗しました。学習履歴には影響しません。", true);
    }
  }

  function scrollBack() {
    var target = document.getElementById("homeView");
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function build(controller) {
    var raw = normalizeTranscript(controller.input.value);
    var correction;
    var reviewItems;
    var subjectKey;
    var subjectTemplate;
    var source;

    if (raw.length < 30) {
      setStatus(controller, "文字起こしをもう少し貼り付けてください。30文字以上あると教材化しやすいです。", true);
      return;
    }

    correction = correctTranscript(raw);
    reviewItems = correction.corrections.concat(correction.dangerItems, correction.reviewTargets);
    subjectKey = chooseSubject(correction.text, controller.subjectSelect ? controller.subjectSelect.value : "auto");
    subjectTemplate = SUBJECT_TEMPLATES[subjectKey] || SUBJECT_TEMPLATES.auto;
    source = getSourceMeta(controller);

    controller.state = {
      id: makeId(),
      status: "draft",
      source: source,
      rawTranscript: raw,
      correction: correction,
      reviewItems: reviewItems,
      subject: subjectKey,
      subjectTemplate: subjectTemplate,
      terms: detectTerms(correction.text),
      points: [],
      layers: { instructor: [], exam: [], review: [] },
      quiz: [],
      quizIndex: 0,
      answers: []
    };

    controller.output.hidden = true;
    controller.correctionReviewBox.hidden = false;
    renderCorrectionReview(controller, reviewItems);
    setStatus(controller, "補正候補を確認してください。要確認の項目は自動確定せず、教材化後も確認待ちとして扱います。", false);
  }

  function confirmCorrections(controller) {
    var state = controller.state;
    if (!state) {
      setStatus(controller, "先に文字起こしを貼り付けて、教材化を開始してください。", true);
      return;
    }

    state.status = state.reviewItems.some(function (item) {
      return item.confidence === "要確認";
    }) ? "waiting" : "confirmed";
    state.points = extractImportantPoints(state.correction.text);
    state.layers = buildLayeredContent(state.points, state.terms, state.subjectTemplate, state.reviewItems.filter(function (item) {
      return item.confidence === "要確認";
    }));
    state.quiz = buildQuiz(state.points, state.terms);
    state.quizIndex = 0;
    state.answers = [];

    controller.correctionReviewBox.hidden = true;
    renderGeneratedContent(controller);
    setStatus(controller, "教材化しました。要確認項目は、確認済みにするまで正式登録扱いにしません。", false);
  }

  function markConfirmed(controller) {
    if (!controller.state) {
      return;
    }
    controller.state.status = "confirmed";
    renderDraftStatus(controller);
    saveDraft(controller);
    setRegistrationStatus(controller, "確認済みにしました。正式登録は次のボタンを押した場合だけ記録します。", false);
  }

  function markRegistered(controller) {
    if (!controller.state) {
      return;
    }
    if (controller.state.status !== "confirmed") {
      setRegistrationStatus(controller, "正式登録の前に「確認済みにする」を押してください。要確認項目を残したまま正式登録しない設計です。", true);
      return;
    }
    controller.state.status = "registered";
    renderDraftStatus(controller);
    saveDraft(controller);
    setRegistrationStatus(controller, "正式登録として記録しました。β版では正式問題JSONへは書き込まず、明示操作の記録だけ保存します。", false);
  }

  function clear(controller) {
    if (controller.videoUrl) {
      controller.videoUrl.value = "";
    }
    if (controller.videoTitle) {
      controller.videoTitle.value = "";
    }
    if (controller.subjectSelect) {
      controller.subjectSelect.value = "auto";
    }
    controller.input.value = "";
    controller.output.hidden = true;
    controller.correctionReviewBox.hidden = true;
    controller.teacherModeCard.hidden = true;
    controller.understandingBox.hidden = true;
    controller.quizChoices.textContent = "";
    if (controller.correctionReviewList) {
      controller.correctionReviewList.textContent = "";
    }
    if (controller.registrationStatus) {
      controller.registrationStatus.hidden = true;
      controller.registrationStatus.textContent = "";
    }
    controller.state = null;
    setStatus(controller, "", false);
  }

  function create() {
    var controller = {
      videoUrl: byId("videoUrlInput"),
      videoTitle: byId("videoTitleInput"),
      subjectSelect: byId("videoSubjectSelect"),
      input: byId("videoTranscriptInput"),
      buildButton: byId("videoBuildButton"),
      clearButton: byId("videoClearButton"),
      status: byId("videoLearningStatus"),
      correctionReviewBox: byId("videoCorrectionReviewBox"),
      correctionReviewList: byId("videoCorrectionReviewList"),
      confirmCorrectionsButton: byId("videoConfirmCorrectionsButton"),
      output: byId("videoLearningOutput"),
      draftStatus: byId("videoDraftStatus"),
      sourceNotice: byId("videoSourceNotice"),
      correctionSummary: byId("videoCorrectionSummary"),
      correctedText: byId("videoCorrectedText"),
      instructorLayer: byId("videoInstructorLayer"),
      examLayer: byId("videoExamLayer"),
      reviewLayer: byId("videoReviewLayer"),
      markConfirmedButton: byId("videoMarkConfirmedButton"),
      formalRegisterButton: byId("videoFormalRegisterButton"),
      registrationStatus: byId("videoRegistrationStatus"),
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
    controller.confirmCorrectionsButton.addEventListener("click", function () {
      confirmCorrections(controller);
    });
    controller.markConfirmedButton.addEventListener("click", function () {
      markConfirmed(controller);
    });
    controller.formalRegisterButton.addEventListener("click", function () {
      markRegistered(controller);
    });
    controller.returnButton.addEventListener("click", scrollBack);
    controller.returnAfterQuizButton.addEventListener("click", scrollBack);

    return controller;
  }

  global.SharoshiVideoLearningBeta = {
    create: create
  };
}(window));
