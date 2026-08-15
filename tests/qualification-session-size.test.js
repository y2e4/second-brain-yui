"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = path.resolve(__dirname, "..");
var COMMON_SOURCE = fs.readFileSync(
  path.join(ROOT, "qualification-os-common.js"),
  "utf8"
);
var HYGIENE_HTML = fs.readFileSync(path.join(ROOT, "hygiene-os-v2.html"), "utf8");
var SHAROSHI_HTML = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
var COMMON_CACHE_ID = "20260816-common-session-01";

function loadCommon() {
  var context = { window: {} };
  vm.createContext(context);
  vm.runInContext(COMMON_SOURCE, context);
  return context.window.QualificationOSCommon;
}

test("資格OS共通の基本セッション問数は3問", function () {
  var common = loadCommon();
  assert.equal(common.DEFAULT_SESSION_QUESTION_LIMIT, 3);
});

test("衛生管理者OSと社労士OSは同じ共通セッション問数を参照する", function () {
  var delegation = /var SESSION_QUESTION_LIMIT = Number\(COMMON\.DEFAULT_SESSION_QUESTION_LIMIT\) \|\| 3;/;
  assert.match(HYGIENE_HTML, delegation);
  assert.match(SHAROSHI_HTML, delegation);
});

test("両OSの共通JSキャッシュ識別子は一致する", function () {
  var reference = "qualification-os-common.js?v=" + COMMON_CACHE_ID;
  assert.ok(HYGIENE_HTML.includes(reference));
  assert.ok(SHAROSHI_HTML.includes(reference));
});

test("資格固有の例外セッション問数は変更しない", function () {
  assert.match(HYGIENE_HTML, /challenge10: 10/);
  assert.match(HYGIENE_HTML, /firekeeper: 1/);
  assert.match(SHAROSHI_HTML, /mode === "challenge" \? 10 : SESSION_QUESTION_LIMIT/);
  assert.match(SHAROSHI_HTML, /limit = 1;/);
  assert.match(
    SHAROSHI_HTML,
    /limit = sessionStageFullMode \? STAGE_FIVE_FULL_LIMIT : STAGE_FIVE_SPLIT_LIMIT;/
  );
});
