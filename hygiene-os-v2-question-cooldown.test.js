"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var SELECTOR = require("./hygiene-os-v2-knowledge-review-selector.js");

var HTML = fs.readFileSync(path.join(__dirname, "hygiene-os-v2.html"), "utf8");

function question(id, knowledgeKey) {
  return {
    id: id,
    stage: 5,
    category: "合成カテゴリ",
    theme: "合成テーマ",
    question: id + "の問題文",
    choices: ["A", "B"],
    answer: "A",
    knowledgeKey: knowledgeKey || ""
  };
}

function stats(extra) {
  return Object.assign({
    attempts: 1,
    wrong: 0,
    unsure: 0,
    guess: 0,
    understoodStreak: 0,
    lastOutcome: "understood",
    lastShownOrder: 0,
    wrongActive: false,
    reviewActive: false,
    manualWeak: false
  }, extra || {});
}

function select(questions, questionStats, extra) {
  return SELECTOR.selectNormalLearningQueue(Object.assign({
    questions: questions,
    questionStats: questionStats || {},
    recentQuestionIds: [],
    excludedQuestionIds: [],
    limit: 3
  }, extra || {}));
}

test("直近questionIdは十分な非直近候補がある間は再利用しない", function () {
  var questions = [question("recent"), question("fresh-a"), question("fresh-b")];
  var result = select(questions, {
    recent: stats({ wrongActive: true, lastOutcome: "incorrect", lastShownOrder: 1 }),
    "fresh-a": stats({ lastShownOrder: 2 }),
    "fresh-b": stats({ understoodStreak: 2, lastShownOrder: 3 })
  }, {
    recentQuestionIds: ["recent"],
    limit: 2
  });

  assert.deepEqual(result.questionIds, ["fresh-a", "fresh-b"]);
  assert.deepEqual(result.details.reusedCooldownQuestionIds, []);
});

test("候補不足時だけ直近questionIdを安全に再利用する", function () {
  var questions = [question("recent-weak"), question("fresh")];
  var result = select(questions, {
    "recent-weak": stats({ wrongActive: true, lastOutcome: "incorrect", lastShownOrder: 1 }),
    fresh: stats({ lastShownOrder: 2 })
  }, {
    recentQuestionIds: ["recent-weak"],
    limit: 2
  });

  assert.deepEqual(result.questionIds, ["fresh", "recent-weak"]);
  assert.deepEqual(result.details.reusedCooldownQuestionIds, ["recent-weak"]);
});

test("クールダウンはrecentQuestionIdsの末尾20問だけを対象にする", function () {
  var recentIds = ["expired"];
  var index;
  for (index = 1; index <= 20; index += 1) {
    recentIds.push("recent-" + index);
  }
  var result = select([question("expired"), question("recent-20")], {
    expired: stats({ lastShownOrder: 1 }),
    "recent-20": stats({ wrongActive: true, lastShownOrder: 2 })
  }, {
    recentQuestionIds: recentIds,
    limit: 1
  });

  assert.deepEqual(result.questionIds, ["expired"]);
  assert.deepEqual(result.details.reusedCooldownQuestionIds, []);
});

test("非直近候補では揺らぎを未出題・育成中・安定問題より優先する", function () {
  var questions = [
    question("stable"),
    question("developing"),
    question("unseen"),
    question("weak")
  ];
  var result = select(questions, {
    stable: stats({ understoodStreak: 2, lastShownOrder: 1 }),
    developing: stats({ understoodStreak: 1, lastShownOrder: 1 }),
    unseen: stats({ attempts: 0, lastShownOrder: 1 }),
    weak: stats({ reviewActive: true, lastOutcome: "unsure", lastShownOrder: 99 })
  });

  assert.deepEqual(result.questionIds, ["weak", "unseen", "developing"]);
  assert.deepEqual(result.selectionReasons, ["weak", "unseen", "developing"]);
});

[
  ["incorrect", { wrongActive: true, lastOutcome: "incorrect" }],
  ["manualWeak", { manualWeak: true, understoodStreak: 2 }],
  ["unsure", { lastOutcome: "unsure" }],
  ["guess", { lastOutcome: "guess" }],
  ["ambiguous", { lastOutcome: "ambiguous" }]
].forEach(function (entry) {
  test(entry[0] + "は安定問題より優先する", function () {
    var result = select([question("fluctuation"), question("stable")], {
      fluctuation: stats(entry[1]),
      stable: stats({ understoodStreak: 2, lastShownOrder: 0 })
    }, { limit: 1 });

    assert.deepEqual(result.questionIds, ["fluctuation"]);
  });
});

test("understoodStreakが2以上の安定問題は育成中問題より後になる", function () {
  var result = select([question("stable"), question("developing")], {
    stable: stats({ understoodStreak: 2, lastShownOrder: 1 }),
    developing: stats({ understoodStreak: 1, lastShownOrder: 9 })
  }, { limit: 1 });

  assert.deepEqual(result.questionIds, ["developing"]);
});

test("別候補がある間は同一knowledgeKeyを同じ3問へ重ねない", function () {
  var questions = [
    question("key-a-1", "key-a"),
    question("key-a-2", "key-a"),
    question("key-b", "key-b")
  ];
  var result = select(questions, {
    "key-a-1": stats({ wrongActive: true, lastShownOrder: 1 }),
    "key-a-2": stats({ wrongActive: true, lastShownOrder: 2 }),
    "key-b": stats({ understoodStreak: 2, lastShownOrder: 3 })
  }, { limit: 2 });

  assert.deepEqual(result.questionIds, ["key-a-1", "key-b"]);
});

test("直近の弱点questionIdより同一Stage・同一knowledgeKeyの別variantを優先する", function () {
  var questions = [
    question("recent-source", "weak-key"),
    question("fresh-variant", "weak-key"),
    question("other", "other-key")
  ];
  var result = select(questions, {
    "recent-source": stats({ wrongActive: true, lastOutcome: "incorrect", lastShownOrder: 1 }),
    "fresh-variant": stats({ reviewActive: true, lastOutcome: "unsure", lastShownOrder: 2 }),
    other: stats({ understoodStreak: 2, lastShownOrder: 3 })
  }, {
    recentQuestionIds: ["recent-source"],
    limit: 2
  });

  assert.deepEqual(result.questionIds, ["fresh-variant", "other"]);
  assert.equal(result.questionIds.includes("recent-source"), false);
});

test("同一knowledgeKeyしかない候補不足時は重複を許して学習不能にしない", function () {
  var questions = [question("key-a-1", "key-a"), question("key-a-2", "key-a")];
  var result = select(questions, {
    "key-a-1": stats({ lastShownOrder: 1 }),
    "key-a-2": stats({ lastShownOrder: 2 })
  }, { limit: 2 });

  assert.deepEqual(result.questionIds, ["key-a-1", "key-a-2"]);
});

test("入力questions・questionStats・履歴配列を変更しない", function () {
  var input = {
    questions: [question("one"), question("two")],
    questionStats: {
      one: stats({ wrongActive: true }),
      two: stats({ understoodStreak: 2 })
    },
    recentQuestionIds: ["two"],
    excludedQuestionIds: [],
    limit: 2
  };
  var snapshot = structuredClone(input);

  SELECTOR.selectNormalLearningQueue(input);

  assert.deepEqual(input, snapshot);
});

test("HTMLは現在Stageのpoolだけを純粋selectorへ渡す", function () {
  assert.match(HTML, /var pool = getStageQuestions\(state\.currentStage\);/);
  assert.match(HTML, /selectNormalLearningQueue\(\{[\s\S]{0,500}questions: pool/);
  assert.match(HTML, /recentQuestionIds: state\.recentQuestionIds/);
  assert.match(HTML, /questionStats: state\.questionStats/);
});

test("日付変更では当日履歴だけを消し、直近20問は維持する", function () {
  assert.match(
    HTML,
    /state\.recentQuestionIds = Array\.isArray\(state\.recentQuestionIds\)[\s\S]{0,100}slice\(-20\)/
  );
  assert.match(
    HTML,
    /state\.dailyDate !== getLocalDateKey\(\)[\s\S]{0,150}state\.dailyShownIds = \[\]/
  );
});

test("selectorが利用できない場合は既存queue生成へ安全に戻る", function () {
  assert.match(
    HTML,
    /typeof KNOWLEDGE_REVIEW_SELECTOR\.selectNormalLearningQueue === "function"/
  );
  assert.match(HTML, /function appendPriorityGroups\(source\)/);
});

test("selector JSだけに専用キャッシュ識別子を付ける", function () {
  assert.match(
    HTML,
    /hygiene-os-v2-knowledge-review-selector\.js\?v=20260823-question-cooldown-01/
  );
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260823-weak-knowledge-variants-02/
  );
});
