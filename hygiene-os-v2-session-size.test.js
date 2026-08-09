"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var ROOT = __dirname;
var HTML = fs.readFileSync(path.join(ROOT, "hygiene-os-v2.html"), "utf8");
var DATA = JSON.parse(fs.readFileSync(
  path.join(ROOT, "hygiene-os-v2-questions.json"),
  "utf8"
));
var INLINE_START = HTML.lastIndexOf("<script>");
var INLINE_END = HTML.lastIndexOf("</script>");

test("HTML内JavaScriptは構文として解釈できる", function () {
  assert.ok(INLINE_START >= 0 && INLINE_END > INLINE_START);
  assert.doesNotThrow(function () {
    new Function(HTML.slice(INLINE_START + 8, INLINE_END));
  });
});

test("ステージ5の新規学習は3問単位で開始する", function () {
  assert.match(
    HTML,
    /data-mode="final30">今日の3問<\/button>/
  );
  assert.match(HTML, /var SESSION_QUESTION_LIMIT = 3;/);
  assert.match(HTML, /final30: SESSION_QUESTION_LIMIT/);
  assert.match(HTML, /final30: "ステージ5・3問"/);
});

test("ステージ5も優先度付きqueueを使い30問を一括投入しない", function () {
  assert.match(HTML, /var queue = buildPriorityQueue\(pool, limit, excluded\);/);
  assert.doesNotMatch(
    HTML,
    /mode === "final30"[\s\S]{0,120}pool\.map/
  );
});

test("ステージ5の3問終了後は次の3問へ続けられる", function () {
  assert.match(
    HTML,
    /data-result-mode="more3">続けて次の3問へ<\/button>/
  );
  assert.match(
    HTML,
    /button\.hidden = session\.stage === 5 &&[\s\S]{0,100}data-result-mode[\s\S]{0,50}!== "more3"/
  );
  assert.match(
    HTML,
    /mode === "more3"[\s\S]{0,120}lastQueueByStage/
  );
});

test("今日の3問とステージ5は当日表示済み問題を優先候補から外す", function () {
  assert.match(
    HTML,
    /mode === "today" \|\| mode === "final30"[\s\S]{0,100}dailyShownIds\.slice\(\)/
  );
});

test("問題総数とステージ5の進捗条件は30問のまま維持する", function () {
  assert.equal(DATA.stage5.questions.length, 30);
  assert.match(HTML, /overall\.total === 30/);
  assert.match(HTML, /stage5\.questions\.length !== 30/);
});

test("同期データはcurrentSessionを長さに依存せず保持する", function () {
  assert.match(HTML, /currentSession: compatibilityFields\.currentSession/);
  assert.match(HTML, /progress: cloneJson\(state\)/);
  assert.doesNotMatch(HTML, /currentSession\.queue\.length === 30/);
});

test("既存セッションの復元はqueue長を3問へ強制変換しない", function () {
  assert.match(HTML, /function restoreCurrentSessionView\(\)/);
  assert.match(HTML, /Array\.isArray\(session\.queue\)/);
  assert.doesNotMatch(HTML, /session\.queue\s*=\s*session\.queue\.slice\([^)]*3/);
});
