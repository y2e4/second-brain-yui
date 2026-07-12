(function (global) {
  "use strict";

  var SOURCE_NOTICE = "この内容は動画の文字起こしをもとに再構成しています。";
  var VIDEO_DRAFT_STORAGE_KEY = "sharoshiVideoLearningDraftsV1";
  var VIDEO_MATERIAL_STORAGE_KEY = "sharoshiVideoTeachingMaterialsV1";
  var MATERIAL_SCHEMA_VERSION = 1;
  var OFFICIAL_SOURCE_HOSTS = [
    "mhlw.go.jp",
    "jsite.mhlw.go.jp",
    "nenkin.go.jp",
    "e-gov.go.jp",
    "shiken.or.jp",
    "kyoukaikenpo.or.jp"
  ];
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
    { label: "数字・条件", pattern: /(?:1日|１日)[0-9０-９]+時間(?:以内|以上|以下|未満|超|を超える)?/g, reason: "労働時間などの条件は、単位と文脈をセットで確認します。" },
    { label: "数字・条件", pattern: /週[0-9０-９]+時間(?:以内|以上|以下|未満|超|を超える)?/g, reason: "週単位の時間条件は制度上の判断に直結します。" },
    { label: "人数", pattern: /[0-9０-９]+人(?:以内|以上|以下|未満|超|を超える)?/g, reason: "人数要件は適用や手続きの判断に関係します。" },
    { label: "期間", pattern: /[0-9０-９]+(?:日|週間|か月|ヶ月|月|年|時間|分)(?:以内|以上|以下|未満|超|を超える)?/g, reason: "期間は試験で問われやすい条件です。" },
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

  function removeTranscriptTimestamps(text) {
    return String(text || "")
      .replace(/(^|\s|\[|\(|。|！|？|、)(?:[0-9０-９]{1,2}:)?[0-9０-９]{1,2}:[0-9０-９]{2}(?=\s|\]|\)|。|！|？|、|$)/g, "$1")
      .replace(/^\s*(?:[0-9０-９]{1,2}:)?[0-9０-９]{1,2}:[0-9０-９]{2}\s*/gm, "");
  }

  function isNoiseSentence(sentence) {
    return /こんにちは|こんばんは|おはようございます|ご視聴|チャンネル登録|高評価|コメント|概要欄|最後まで|ありがとうございました|また次回|よろしくお願いします|はいどうも|今回の動画では|この動画では/.test(sentence)
      && !/労働基準法|労災|雇用保険|健康保険|年金|被保険者|労働者|使用者|事業主|制度|法律|要件|義務|例外|適用|給付|保険料/.test(sentence);
  }

  function isLegalLearningSentence(sentence) {
    return /労働基準法|労働安全衛生法|労災|雇用保険|健康保険|国民年金|厚生年金|被保険者|労働者|使用者|事業主|制度|法律|条文|対象|要件|義務|権利|禁止|適用|除外|例外|原則|罰則|給付|保険料|労働時間|休憩|休日|賃金|契約|就業規則|36協定|第[0-9０-９一二三四五六七八九十百]+条/.test(sentence);
  }

  function normalizeTranscript(text) {
    return removeTranscriptTimestamps(text)
      .replace(/\r\n?/g, "\n")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function makeId() {
    return "video-draft-" + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
  }

  function makeMaterialId(draftId) {
    return "video-material-" + String(draftId || makeId()).replace(/^video-draft-/, "");
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value || null));
  }

  function splitLines(text) {
    return uniqueStrings(String(text || "")
      .split(/\n+/)
      .map(function (line) {
        return line.trim();
      }));
  }

  function getOfficialHost(url) {
    var parsed;
    try {
      parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, "").toLowerCase();
    } catch (error) {
      return "";
    }
  }

  function isOfficialSourceUrl(url) {
    var host = getOfficialHost(url);
    if (!host) {
      return false;
    }
    return OFFICIAL_SOURCE_HOSTS.some(function (officialHost) {
      return host === officialHost || host.endsWith("." + officialHost);
    });
  }

  function parseVerifiedSources(text, verifiedAt) {
    return splitLines(text).map(function (line) {
      var parts = line.split("|").map(function (part) {
        return part.trim();
      });
      var urlMatch = line.match(/https?:\/\/[^\s|]+/);
      var url = parts[1] || (urlMatch ? urlMatch[0] : "");
      var title = parts[0] && parts[0] !== url ? parts[0] : "";
      var memo = parts[2] || "";
      var host = getOfficialHost(url);

      if (!title && host) {
        title = host;
      }

      return {
        title: title,
        url: url,
        memo: memo,
        host: host,
        official: isOfficialSourceUrl(url),
        verifiedAt: verifiedAt
      };
    });
  }

  function readMaterialStore() {
    var stored;
    try {
      stored = JSON.parse(localStorage.getItem(VIDEO_MATERIAL_STORAGE_KEY) || "null");
    } catch (error) {
      stored = null;
    }
    if (!stored || typeof stored !== "object" || !Array.isArray(stored.materials)) {
      return {
        schemaVersion: MATERIAL_SCHEMA_VERSION,
        type: "sharoshi-video-teaching-materials",
        updatedAt: "",
        materials: []
      };
    }
    return {
      schemaVersion: Number(stored.schemaVersion) || MATERIAL_SCHEMA_VERSION,
      type: stored.type || "sharoshi-video-teaching-materials",
      updatedAt: stored.updatedAt || "",
      materials: stored.materials
    };
  }

  function exportRegisteredMaterials() {
    return cloneJson(readMaterialStore());
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
        var rawContext = getRawSentenceContext(text, value);
        var context = getSentenceContext(text, value);
        if (seen[key]) {
          return;
        }
        if (isNoiseSentence(rawContext) || isNoiseSentence(context)) {
          return;
        }
        seen[key] = true;
        items.push({
          original: value,
          candidate: "自動補正しない（確認対象）",
          reason: rule.reason,
          context: context,
          confidence: "要確認",
          category: rule.label,
          autoApplied: false
        });
      });
    });

    return items.slice(0, 12);
  }

  function basicSplitSentences(text) {
    return String(text || "")
      .replace(/([。！？])/g, "$1\n")
      .split(/\n+/)
      .map(function (sentence) {
        return sentence.trim();
      })
      .filter(function (sentence) {
        return sentence.length >= 12 && !isNoiseSentence(sentence);
      });
  }

  function getSentenceContext(text, value) {
    var sentences = basicSplitSentences(text);
    var index = -1;
    sentences.some(function (sentence, sentenceIndex) {
      if (sentence.indexOf(value) !== -1) {
        index = sentenceIndex;
        return true;
      }
      return false;
    });
    if (index === -1) {
      return value;
    }
    return sentences.slice(Math.max(0, index - 1), Math.min(sentences.length, index + 2)).join(" ");
  }

  function getRawSentenceContext(text, value) {
    var sentences = String(text || "")
      .replace(/([。！？])/g, "$1\n")
      .split(/\n+/)
      .map(function (sentence) {
        return sentence.trim();
      })
      .filter(Boolean);
    var found = sentences.filter(function (sentence) {
      return sentence.indexOf(value) !== -1;
    })[0];
    return found || value;
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
    return basicSplitSentences(normalizeTranscript(text));
  }

  function detectTerms(text) {
    return CORE_TERMS.filter(function (term) {
      return text.indexOf(term) !== -1;
    });
  }

  function scoreSentence(sentence, terms) {
    var score = 0;
    if (!isLegalLearningSentence(sentence)) {
      return -1;
    }
    terms.forEach(function (term) {
      if (sentence.indexOf(term) !== -1) {
        score += 3;
      }
    });
    if (/法律|制度|対象|条件|要件|義務|加入|給付|期間|年齢|原則|例外|会社員|自営業|退職|離職|業務上|通勤|使用者|労働者|事業主/.test(sentence)) {
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
      return item.score >= 3;
    }).map(function (item) {
      return item.sentence;
    })).slice(0, 5);

    if (selected.length < 2) {
      return [];
    }

    return selected.slice(0, 5);
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
    if (!points.length) {
      detail.push("要レビュー: 法律知識として十分な内容を抽出できませんでした。");
    } else {
      points.forEach(function (point, index) {
        detail.push((index + 1) + ". " + point);
      });
    }
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

  function buildLayeredContent(points, terms, subjectTemplate, reviewItems, reviewRequired) {
    var firstTerm = terms[0] || subjectTemplate.label || "制度";
    var instructor = reviewRequired ? [
      "要レビュー: 法律・制度・要件に関する十分な内容を抽出できませんでした。",
      "文字起こしの前後を確認し、教材登録前に人の目で整理してください。"
    ] : [
      firstTerm + "は、用語だけでなく「誰に・どの場面で・どんな条件で」使うかを分けると理解しやすくなります。",
      points[0] || "動画の中心テーマを一つに絞って、制度の入口から確認します。",
      "覚え方は、制度名より先に対象者と場面を見ることです。"
    ];
    var exam = reviewRequired ? [
      "要レビュー: 試験で覚えるポイントを自動確定できません。",
      "法律、制度、対象者、要件、義務、例外に関する説明を確認してください。"
    ] : subjectTemplate.examGuides.slice();

    if (!reviewRequired) {
      subjectTemplate.fields.forEach(function (field) {
        if (exam.length >= 6) {
          return;
        }
        exam.push(field + ": 動画内の該当箇所を公式情報と照合して整理する。");
      });

      if (points[1]) {
        exam.push("主体・語尾・数字が出た文: " + points[1]);
      }
    }

    return {
      instructor: instructor.slice(0, 5),
      exam: exam.slice(0, 6),
      review: buildReviewLayer(reviewItems, reviewRequired)
    };
  }

  function buildReviewLayer(reviewItems, reviewRequired) {
    var reviewLines = [];
    if (reviewRequired) {
      reviewLines.push("要レビュー: 法律知識として確定できる説明が不足しています。正式登録前に内容を確認してください。");
    }
    if (!reviewItems.length) {
      reviewLines.push("数字・例外・法改正などの危険項目は検出されませんでした。正式登録前には念のため公式情報を確認してください。");
      return reviewLines;
    }
    return reviewLines.concat(reviewItems.slice(0, 8).map(function (item) {
      var line = item.category + "「" + item.original + "」: " + item.reason;
      if (item.context && item.context !== item.original) {
        line += " / 文脈: " + item.context;
      }
      return line;
    }));
  }

  function hasReviewRequiredContent(state) {
    return Boolean(state && state.reviewRequired);
  }

  function hasUnresolvedReviewItems(state) {
    if (!state || state.status !== "waiting") {
      return false;
    }
    return state.reviewItems.some(function (item) {
      return item.confidence === "要確認";
    });
  }

  function inferSystemName(state) {
    var text = state.correction.text;
    if (/労働基準法/.test(text) && /全体像|概要|基本|はじめに|入門|ポイント|どんな法律|労働条件|最低基準/.test(text)) {
      return "労働基準法の全体像";
    }
    if (/雇用保険/.test(text) && /被保険者|週20時間|31日|適用除外/.test(text)) {
      return "雇用保険の被保険者要件";
    }
    if (/労災保険|労災/.test(text) && /業務災害|通勤災害/.test(text)) {
      return "労災保険の対象災害";
    }
    if (/労働基準法|36協定|時間外/.test(text)) {
      return "労働基準法の労働時間規制";
    }
    if (state.terms.length) {
      return state.terms[0] + "の基本論点";
    }
    return state.subjectTemplate.label + "の基本論点";
  }

  function defaultProtectsWhom(subjectKey) {
    if (subjectKey === "employment") {
      return "失業や雇用継続の不安がある労働者";
    }
    if (subjectKey === "workers_comp") {
      return "業務上または通勤によるけが・病気で困る労働者やその家族";
    }
    if (subjectKey === "labor_standards") {
      return "労働条件の最低基準によって守られる労働者";
    }
    return "その制度の対象になる人";
  }

  function defaultWorkplaceScene(subjectKey, systemName) {
    if (subjectKey === "employment") {
      return "短時間勤務者や新しく雇い入れる人について、雇用保険の加入対象か確認する場面";
    }
    if (subjectKey === "workers_comp") {
      return "仕事中や通勤中のけがについて、健康保険ではなく労災保険の対象か確認する場面";
    }
    if (subjectKey === "labor_standards") {
      return "労働時間、休憩、休日、時間外労働の扱いを会社で確認する場面";
    }
    return systemName + "が会社の手続きや説明に関係する場面";
  }

  function defaultNewsScene(subjectKey, systemName) {
    if (subjectKey === "employment") {
      return "雇用保険、失業給付、育児休業給付、雇用調整に関するニュースを見る場面";
    }
    if (subjectKey === "workers_comp") {
      return "労働災害、通勤災害、安全配慮、労災認定に関するニュースを見る場面";
    }
    if (subjectKey === "labor_standards") {
      return "長時間労働、残業、36協定、賃金未払いに関するニュースを見る場面";
    }
    return systemName + "に関する制度改正や社会保険のニュースを見る場面";
  }

  function buildOneLineSummary(systemName) {
    if (systemName === "雇用保険の被保険者要件") {
      return "雇用保険の被保険者は、原則として週20時間以上かつ31日以上の雇用見込みで判断する。";
    }
    return systemName + "は、対象者・条件・例外を分けて判断する論点です。";
  }

  function setFieldValue(field, value) {
    if (field) {
      field.value = value || "";
    }
  }

  function populateMaterialForm(controller) {
    var state = controller.state;
    var systemName;
    if (!state) {
      return;
    }
    systemName = inferSystemName(state);
    setFieldValue(controller.materialSubject, state.subjectTemplate.label);
    setFieldValue(controller.materialSystemName, systemName);
    setFieldValue(controller.materialSummary, buildOneLineSummary(systemName));
    setFieldValue(controller.materialProtectsWhom, defaultProtectsWhom(state.subject));
    setFieldValue(controller.materialWorkplaceScene, defaultWorkplaceScene(state.subject, systemName));
    setFieldValue(controller.materialNewsScene, defaultNewsScene(state.subject, systemName));
    setFieldValue(controller.materialExamPoints, state.layers.exam.join("\n"));
    setFieldValue(controller.materialNumbers, state.layers.review.join("\n"));
    setFieldValue(controller.materialVerifiedSources, "");
  }

  function readMaterialForm(controller, now) {
    return {
      subjectLabel: controller.materialSubject ? controller.materialSubject.value.trim() : "",
      systemName: controller.materialSystemName ? controller.materialSystemName.value.trim() : "",
      oneLineSummary: controller.materialSummary ? controller.materialSummary.value.trim() : "",
      protectsWhom: controller.materialProtectsWhom ? controller.materialProtectsWhom.value.trim() : "",
      workplaceScene: controller.materialWorkplaceScene ? controller.materialWorkplaceScene.value.trim() : "",
      newsScene: controller.materialNewsScene ? controller.materialNewsScene.value.trim() : "",
      examPoints: splitLines(controller.materialExamPoints ? controller.materialExamPoints.value : ""),
      numbersPeriodsExceptions: splitLines(controller.materialNumbers ? controller.materialNumbers.value : ""),
      verifiedSources: parseVerifiedSources(controller.materialVerifiedSources ? controller.materialVerifiedSources.value : "", now)
    };
  }

  function validateMaterialInput(input, state) {
    var requiredLabels = [
      ["科目", input.subjectLabel],
      ["制度名", input.systemName],
      ["一言要約", input.oneLineSummary],
      ["誰を守る制度か", input.protectsWhom],
      ["会社で使う場面", input.workplaceScene],
      ["ニュースで使う場面", input.newsScene]
    ];
    var missing = requiredLabels.filter(function (item) {
      return !item[1];
    }).map(function (item) {
      return item[0];
    });
    var invalidSources = input.verifiedSources.filter(function (source) {
      return !source.url || !source.official;
    });

    if (missing.length) {
      return "正式登録に必要な項目が未入力です: " + missing.join("、");
    }
    if (hasUnresolvedReviewItems(state)) {
      return "未解決の要確認項目があります。「確認済みにする」で内容確認を完了してから正式登録してください。";
    }
    if (hasReviewRequiredContent(state)) {
      return "教材内容が要レビューです。法律知識・重要ポイント・クイズを確認できる内容に整理してから正式登録してください。";
    }
    if (!input.examPoints.length) {
      return "「試験で覚えること」を1つ以上入力してください。";
    }
    if (!input.verifiedSources.length) {
      return "確認済み公式情報を1件以上入力してください。厚生労働省・日本年金機構・e-GovなどのURLが必要です。";
    }
    if (invalidSources.length) {
      return "公式情報として確認できないURLがあります。厚生労働省・日本年金機構・e-Govなどの公式URLだけを入力してください。";
    }
    return "";
  }

  function buildRegisteredMaterial(controller, now) {
    var state = controller.state;
    var input = readMaterialForm(controller, now);
    var validationError = validateMaterialInput(input, state);
    var materialId = state.registeredMaterialId || makeMaterialId(state.id);

    if (validationError) {
      return {
        error: validationError,
        material: null
      };
    }

    return {
      error: "",
      material: {
        id: materialId,
        sourceDraftId: state.id,
        status: DRAFT_STATUSES.registered,
        subject: {
          id: state.subject,
          label: input.subjectLabel
        },
        systemName: input.systemName,
        oneLineSummary: input.oneLineSummary,
        protectsWhom: input.protectsWhom,
        workplaceScene: input.workplaceScene,
        newsScene: input.newsScene,
        examPoints: input.examPoints,
        numbersPeriodsExceptions: input.numbersPeriodsExceptions,
        verifiedSources: input.verifiedSources,
        registeredAt: state.registeredAt || now,
        sourceVideo: {
          title: state.source.videoTitle,
          url: state.source.videoUrl,
          studiedAt: state.source.studiedAt
        },
        correctionReview: {
          corrections: state.correction.corrections,
          dangerItems: state.correction.dangerItems,
          reviewTargets: state.correction.reviewTargets
        },
        reviewRequired: Boolean(state.reviewRequired),
        generatedLayers: state.layers,
        sourceTranscript: {
          raw: state.rawTranscript,
          corrected: state.correction.text
        },
        updatedAt: now
      }
    };
  }

  function saveRegisteredMaterial(material) {
    var store = readMaterialStore();
    store.materials = store.materials.filter(function (item) {
      return item && item.id !== material.id && item.sourceDraftId !== material.sourceDraftId;
    });
    store.materials.unshift(material);
    store.updatedAt = material.updatedAt;
    localStorage.setItem(VIDEO_MATERIAL_STORAGE_KEY, JSON.stringify(store));
  }

  function buildQuiz(points, terms, subjectKey, text) {
    var hasLegalContent = points.length >= 2 || isLegalLearningSentence(text);
    var hasPension = terms.some(function (term) {
      return /年金/.test(term);
    });
    var hasEmployment = terms.indexOf("雇用保険") !== -1 || terms.indexOf("基本手当") !== -1;
    var hasHealth = terms.indexOf("健康保険") !== -1 || terms.indexOf("傷病手当金") !== -1;
    var quiz = [];

    if (!hasLegalContent) {
      return [];
    }

    if (subjectKey === "labor_standards" || /労働基準法/.test(text)) {
      quiz.push({
        question: "労働基準法は、労働条件について会社が自由に決められる上限だけを定めた法律である。",
        answer: false,
        explanation: "労働基準法は、労働条件の最低基準を定める法律として理解します。"
      });
      quiz.push({
        question: "労働基準法を学ぶときは、労働者・使用者・労働条件・義務の関係を分けて確認する必要がある。",
        answer: true,
        explanation: "誰に義務があり、誰を守る制度かを分けることが判断の入口です。"
      });
      quiz.push({
        question: "労働基準法の説明に数字や例外が出た場合は、公式情報で確認してから教材として確定する。",
        answer: true,
        explanation: "労働時間、休憩、休日、罰則などは数字や例外で結論が変わるため確認が必要です。"
      });
      return quiz.slice(0, 3);
    }

    if (hasPension) {
      quiz.push({
        question: "年金の話では、国民年金・厚生年金・老齢・障害・遺族など、どの制度や給付の話かを分けて読む必要がある。",
        answer: true,
        explanation: "同じ年金でも、加入する制度と受け取る給付は分けて判断します。"
      });
      quiz.push({
        question: "厚生年金と国民年金は、対象者や上乗せ関係を区別して確認する必要がある。",
        answer: true,
        explanation: "会社員等が関係する厚生年金と、基礎部分の国民年金は役割を分けます。"
      });
    } else if (hasEmployment) {
      quiz.push({
        question: "雇用保険では、加入できる人かどうかと、離職後にどの給付を受けるかを同じ条件として判断する。",
        answer: false,
        explanation: "加入条件と給付条件は見る場面が違います。まず在職中か離職後かを分けます。"
      });
      quiz.push({
        question: "雇用保険の説明で週の所定労働時間や雇用見込みが出た場合は、被保険者要件として確認する。",
        answer: true,
        explanation: "雇用保険では、誰が被保険者になるかを数字や適用除外と合わせて確認します。"
      });
    } else if (hasHealth) {
      quiz.push({
        question: "健康保険と労災保険は、病気やけがが業務上か私傷病かで関係する制度が変わることがある。",
        answer: true,
        explanation: "業務上なら労災保険、私傷病なら健康保険という入口の違いを確認します。"
      });
      quiz.push({
        question: "健康保険は、業務上の災害も常に健康保険で処理する制度である。",
        answer: false,
        explanation: "業務上の災害は労災保険との関係を確認します。"
      });
    } else if (subjectKey === "workers_comp" || /労災|業務災害|通勤災害/.test(text)) {
      quiz.push({
        question: "労災保険では、業務災害と通勤災害を分けて確認する必要がある。",
        answer: true,
        explanation: "労災保険は、どの災害にあたるかが制度判断の入口になります。"
      });
      quiz.push({
        question: "仕事中のけがであっても、必ず健康保険だけで処理する。",
        answer: false,
        explanation: "業務上のけがは労災保険の対象になる可能性があります。"
      });
    }

    if (!quiz.length) {
      return [];
    }
    while (quiz.length < 3) {
      quiz.push({
        question: "法律や制度の説明では、対象者・要件・例外を分けて確認する必要がある。",
        answer: true,
        explanation: "資格試験では、用語だけでなく条件や例外の判断が問われます。"
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
      if (item.context && item.context !== item.original) {
        row.appendChild(createElement("p", "", "前後の文脈: " + item.context));
      }
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
    populateMaterialForm(controller);
    renderList(controller.pointList, state.points.length ? state.points : ["要レビュー: 法律・制度・対象者・要件・義務・例外に関する十分な内容を抽出できませんでした。"]);
    controller.detailText.textContent = buildDetail(state.points, terms, state.subjectTemplate);
    controller.teacherText.textContent = buildTeacherExplanation(state.points, terms);
    setRegistrationStatus(controller, "", false);
    renderQuiz(controller);
    saveDraft(controller);
  }

  function renderQuiz(controller) {
    var question = controller.state.quiz[controller.state.quizIndex];

    if (!controller.state.quiz.length) {
      controller.quizProgress.textContent = "3問クイズ: 要レビュー";
      controller.quizQuestion.textContent = "法律知識として十分な内容を抽出できなかったため、クイズは自動生成しません。文字起こしと公式情報を確認してください。";
      controller.quizFeedback.hidden = true;
      controller.quizFeedback.textContent = "";
      controller.quizChoices.textContent = "";
      return;
    }

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
        reviewRequired: Boolean(state.reviewRequired),
        quiz: state.quiz,
        answers: state.answers,
        registeredMaterialId: state.registeredMaterialId || "",
        registeredAt: state.registeredAt || "",
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
      reviewRequired: false,
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
    state.reviewRequired = state.points.length < 2;
    state.quiz = buildQuiz(state.points, state.terms, state.subject, state.correction.text);
    if (!state.quiz.length) {
      state.reviewRequired = true;
    }
    state.layers = buildLayeredContent(state.points, state.terms, state.subjectTemplate, state.reviewItems.filter(function (item) {
      return item.confidence === "要確認";
    }), state.reviewRequired);
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
    var now;
    var result;
    if (!controller.state) {
      return;
    }
    if (controller.state.status !== "confirmed" && controller.state.status !== "registered") {
      setRegistrationStatus(controller, "正式登録の前に「確認済みにする」を押してください。要確認項目を残したまま正式登録しない設計です。", true);
      return;
    }
    now = new Date().toISOString();
    result = buildRegisteredMaterial(controller, now);
    if (result.error) {
      setRegistrationStatus(controller, result.error, true);
      return;
    }
    saveRegisteredMaterial(result.material);
    controller.state.registeredMaterialId = result.material.id;
    controller.state.registeredAt = result.material.registeredAt;
    controller.state.status = "registered";
    renderDraftStatus(controller);
    saveDraft(controller);
    setRegistrationStatus(controller, "正式登録済み教材JSONへ保存しました。正式問題JSONへは書き込んでいません。", false);
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
    [
      controller.materialSubject,
      controller.materialSystemName,
      controller.materialSummary,
      controller.materialProtectsWhom,
      controller.materialWorkplaceScene,
      controller.materialNewsScene,
      controller.materialExamPoints,
      controller.materialNumbers,
      controller.materialVerifiedSources
    ].forEach(function (field) {
      if (field) {
        field.value = "";
      }
    });
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
      materialSubject: byId("videoMaterialSubjectInput"),
      materialSystemName: byId("videoMaterialSystemNameInput"),
      materialSummary: byId("videoMaterialSummaryInput"),
      materialProtectsWhom: byId("videoMaterialProtectsWhomInput"),
      materialWorkplaceScene: byId("videoMaterialWorkplaceSceneInput"),
      materialNewsScene: byId("videoMaterialNewsSceneInput"),
      materialExamPoints: byId("videoMaterialExamPointsInput"),
      materialNumbers: byId("videoMaterialNumbersInput"),
      materialVerifiedSources: byId("videoMaterialVerifiedSourcesInput"),
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
    create: create,
    exportRegisteredMaterials: exportRegisteredMaterials
  };
}(window));
