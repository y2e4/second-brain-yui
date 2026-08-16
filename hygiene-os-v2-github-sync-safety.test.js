"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var HTML = fs.readFileSync(path.join(ROOT, "hygiene-os-v2.html"), "utf8");
var INLINE_START = HTML.lastIndexOf("<script>");
var INLINE_END = HTML.lastIndexOf("</script>");
var INLINE = HTML.slice(INLINE_START + 8, INLINE_END);
var HELPER_FUNCTIONS = [
  "normalizeGitHubSha",
  "hasMeaningfulLocalSyncData",
  "getGitHubSyncChangeState",
  "resolveGitHubSyncAction"
];

function extractFunction(name) {
  var marker = "function " + name + "(";
  var start = INLINE.indexOf(marker);
  var open;
  var depth = 0;
  var quote = "";
  var escaped = false;
  var index;

  assert.ok(start >= 0, name + "がHTML内に存在すること");
  open = INLINE.indexOf("{", start);
  for (index = open; index < INLINE.length; index += 1) {
    var character = INLINE.charAt(index);
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return INLINE.slice(start, index + 1);
      }
    }
  }
  throw new Error(name + "の終端を確認できません。");
}

function loadFunctions(context, names) {
  vm.createContext(context);
  names.forEach(function (name) {
    context[name] = vm.runInContext("(" + extractFunction(name) + ")", context);
  });
  return context;
}

function makePayload(totalAnswered) {
  var total = Number(totalAnswered || 0);
  return {
    totalAnswered: total,
    totalCorrect: Math.max(0, total - 1),
    currentStage: total ? 5 : 1,
    highestUnlockedStage: total ? 5 : 1,
    answeredQuestionIds: total ? ["q-1"] : [],
    wrongQuestionIds: [],
    uncertainQuestionIds: [],
    weakQuestionIds: [],
    progress: {
      totalAnswered: total,
      currentStage: total ? 5 : 1,
      unlockedStages: total ? [1, 2, 3, 4, 5] : [1],
      currentSession: null,
      learningData: { answerHistory: total ? [{ questionId: "q-1" }] : [] }
    }
  };
}

function makeActionHarness(options) {
  var settings = options || {};
  var context = {
    state: {
      lastManualSyncAt: settings.hadPreviousSync === false
        ? ""
        : "2026-08-16T08:00:00+09:00"
    },
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: settings.lastSyncedSha || "" };
    },
    isLocalProgressNewerThanLastSync: function () {
      return settings.localChanged === true;
    },
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
  };
  loadFunctions(context, HELPER_FUNCTIONS);
  return context;
}

function resolveAction(options) {
  var settings = options || {};
  var context = makeActionHarness(settings);
  var remotePayload = settings.hasRemotePayload === false
    ? null
    : makePayload(settings.remoteTotal === undefined ? 10 : settings.remoteTotal);
  var remote = {
    exists: settings.remoteExists !== false,
    sha: settings.remoteSha || "sha-current",
    payload: remotePayload ? { eisei: remotePayload } : {}
  };
  return context.resolveGitHubSyncAction(
    remote,
    settings.localPayload || makePayload(settings.localTotal === undefined ? 10 : settings.localTotal),
    remotePayload
  );
}

function makeManualSyncHarness(options) {
  var settings = options || {};
  var events = { writes: 0, pulls: 0, successes: [], errors: [], statuses: [] };
  var localPayload = makePayload(settings.localTotal === undefined ? 10 : settings.localTotal);
  var remotePayload = makePayload(settings.remoteTotal === undefined ? 10 : settings.remoteTotal);
  var remote = {
    exists: true,
    sha: settings.remoteSha || "sha-current",
    payload: { eisei: remotePayload }
  };
  var context = {
    state: {
      lastManualSyncAt: "2026-08-16T08:00:00+09:00",
      lastSavedAt: "2026-08-16T08:00:00+09:00"
    },
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: settings.lastSyncedSha || "sha-base" };
    },
    isLocalProgressNewerThanLastSync: function () {
      return settings.localChanged === true;
    },
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    },
    readGitHubSyncInputs: function () { return {}; },
    validateGitHubSyncConfig: function () {},
    saveGitHubSyncConfig: function () {},
    buildProgressExportPayload: function () { return localPayload; },
    createGitHubSyncProvider: function () {
      return { read: function () { return Promise.resolve(remote); } };
    },
    githubSyncButton: { disabled: false },
    githubSyncSettings: { open: false },
    showSyncStatus: function (message, isError) {
      events.statuses.push({ message: message, isError: isError });
    },
    extractLearningPayload: function () { return remotePayload; },
    looksLikeLearningPayload: function () { return true; },
    pushProgressToSyncProvider: function () {
      events.writes += 1;
      return Promise.resolve({ payload: localPayload, sha: "sha-written" });
    },
    applyGitHubProgressPayload: function () { events.pulls += 1; },
    markSyncSuccess: function (updatedAt, comparison, sha) {
      events.successes.push({ comparison: comparison, sha: sha });
    },
    markSyncError: function (message) { events.errors.push(message); },
    updateSyncInfo: function () {},
    getPayloadUpdatedAt: function () { return "2026-08-16T09:00:00+09:00"; },
    saveState: function () {}
  };
  loadFunctions(context, HELPER_FUNCTIONS.concat(["syncProgressWithGitHub"]));
  return { context: context, events: events };
}

function makeAutoSyncHarness(options) {
  var settings = options || {};
  var events = { pulls: 0, errors: [], statuses: [] };
  var localPayload = makePayload(settings.localTotal === undefined ? 10 : settings.localTotal);
  var remotePayload = makePayload(settings.remoteTotal === undefined ? 10 : settings.remoteTotal);
  var context = {
    state: { lastManualSyncAt: "2026-08-16T08:00:00+09:00" },
    autoSyncStarted: false,
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: settings.lastSyncedSha || "sha-base" };
    },
    isLocalProgressNewerThanLastSync: function () {
      return settings.localChanged === true;
    },
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    },
    readGitHubSyncConfig: function () { return {}; },
    hasCompleteGitHubSyncConfig: function () { return true; },
    createGitHubSyncProvider: function () {
      return {
        read: function () {
          return Promise.resolve({
            exists: true,
            sha: settings.remoteSha || "sha-current",
            payload: { eisei: remotePayload }
          });
        }
      };
    },
    buildProgressExportPayload: function () { return localPayload; },
    extractLearningPayload: function () { return remotePayload; },
    looksLikeLearningPayload: function () { return true; },
    applyGitHubProgressPayload: function () { events.pulls += 1; },
    markSyncSuccess: function () {},
    markSyncError: function (message) { events.errors.push(message); },
    showSyncStatus: function (message, isError) {
      events.statuses.push({ message: message, isError: isError });
    },
    updateSyncInfo: function () {},
    getPayloadUpdatedAt: function () { return "2026-08-16T09:00:00+09:00"; }
  };
  loadFunctions(context, HELPER_FUNCTIONS.concat(["autoFetchLatestFromGitHub"]));
  return { context: context, events: events };
}

function useActualLocalTimestamp(harness, offsetMs) {
  var syncedAtMs = Date.parse("2026-08-16T08:00:00.000Z");
  harness.context.state.lastManualSyncAt = new Date(syncedAtMs).toISOString();
  harness.context.state.lastSavedAt = new Date(syncedAtMs + offsetMs).toISOString();
  loadFunctions(harness.context, ["getTimeValue", "isLocalProgressNewerThanLastSync"]);
  return harness;
}

test("同期時刻と同一なら変更なし、1ms以上新しければローカル変更あり", function () {
  [
    { offsetMs: 0, changed: false },
    { offsetMs: 1, changed: true },
    { offsetMs: 10, changed: true },
    { offsetMs: 999, changed: true },
    { offsetMs: 1000, changed: true },
    { offsetMs: 1001, changed: true }
  ].forEach(function (entry) {
    var harness = useActualLocalTimestamp(makeManualSyncHarness({}), entry.offsetMs);
    assert.equal(
      harness.context.isLocalProgressNewerThanLastSync(),
      entry.changed,
      "+" + entry.offsetMs + "msの判定"
    );
  });
});

test("同期後1ms以上の各境界でGitHub SHAも変われば必ず競合停止する", async function () {
  for (var offsetMs of [1, 10, 999, 1000, 1001]) {
    var harness = useActualLocalTimestamp(makeManualSyncHarness({
      lastSyncedSha: "sha-base",
      remoteSha: "sha-current"
    }), offsetMs);
    await harness.context.syncProgressWithGitHub();
    assert.equal(harness.events.writes, 0, "+" + offsetMs + "msでPUTしない");
    assert.equal(harness.events.pulls, 0, "+" + offsetMs + "msでローカルを置換しない");
    assert.equal(harness.events.successes.length, 0, "+" + offsetMs + "msで同期成功にしない");
    assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
  }
});

test("起動時自動GETも同期後1msのローカル変更とGitHub変更があれば置換しない", async function () {
  var harness = useActualLocalTimestamp(makeAutoSyncHarness({
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  }), 1);
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.pulls, 0);
  assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
});

test("ローカル変更なし・GitHub変更なしはPUTも置換もせず同期済み扱い", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    lastSyncedSha: "sha-current",
    remoteSha: "sha-current"
  }), 0);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.successes[0].comparison, "same");
});

test("ローカル変更だけならPUT可能", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    lastSyncedSha: "sha-current",
    remoteSha: "sha-current"
  }), 1);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 1);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.successes[0].comparison, "local");
});

test("GitHub変更だけならローカルへ取り込む", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    localTotal: 290,
    remoteTotal: 284,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  }), 0);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 1);
  assert.equal(harness.events.successes[0].comparison, "remote");
});

test("両方変更時はPUTもローカル置換もしない", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.successes.length, 0);
  assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
});

test("ローカルの回答数が多くても両方変更なら停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    localTotal: 290,
    remoteTotal: 284,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
});

test("GitHubの回答数が多くても両方変更なら停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    localTotal: 284,
    remoteTotal: 290,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
});

test("起動時自動GETも両方変更ならローカルを置換しない", async function () {
  var harness = makeAutoSyncHarness({
    localChanged: true,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.pulls, 0);
  assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
});

test("起動時自動GETはGitHub変更だけならローカルへ取り込む", async function () {
  var harness = makeAutoSyncHarness({
    localChanged: false,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.pulls, 1);
  assert.equal(harness.events.errors.length, 0);
});

test("SHA未保存の既存端末は両側変更の可能性を安全側で停止", function () {
  assert.equal(resolveAction({
    localChanged: true,
    hadPreviousSync: true,
    lastSyncedSha: "",
    remoteSha: "sha-current"
  }).action, "conflict");
});

test("SHA未保存でも空の新端末はGitHubデータを取り込める", function () {
  assert.equal(resolveAction({
    localChanged: true,
    hadPreviousSync: false,
    lastSyncedSha: "",
    remoteSha: "sha-current",
    localPayload: makePayload(0)
  }).action, "pull");
});

test("初回同期で衛生管理者名前空間がなければ既存共有JSONへ追加可能", function () {
  assert.equal(resolveAction({
    localChanged: true,
    hadPreviousSync: false,
    lastSyncedSha: "",
    hasRemotePayload: false,
    localPayload: makePayload(11)
  }).action, "push");
});

test("同期成功メタへGitHub SHAを保存する", function () {
  var captured;
  var context = {
    state: { lastManualSyncAt: "2026-08-16T09:00:00+09:00" },
    updateGitHubSyncMeta: function (patch) { captured = patch; },
    updateSyncInfo: function () {}
  };
  loadFunctions(context, ["normalizeGitHubSha", "markSyncSuccess"]);
  context.markSyncSuccess("2026-08-16T09:00:00+09:00", "remote", "  sha-current  ");
  assert.equal(captured.lastSyncedSha, "sha-current");
});

test("同期SHAはJSON保存・再読み込み後も同じ基点として使える", function () {
  var storedMeta = JSON.stringify({
    lastSyncedSha: "sha-current",
    lastSyncedAt: "2026-08-16T09:00:00+09:00"
  });
  var result = resolveAction({
    localChanged: false,
    lastSyncedSha: JSON.parse(storedMeta).lastSyncedSha,
    remoteSha: "sha-current"
  });
  assert.equal(result.action, "same");
  assert.equal(result.changes.baselineKnown, true);
});

test("PUT成功時はGitHub応答の新しいcontent SHAを返す", async function () {
  var saved = 0;
  var context = {
    state: {
      lastManualSyncAt: "2026-08-16T08:00:00+09:00",
      lastSavedAt: "2026-08-16T08:00:00+09:00"
    },
    buildProgressExportPayload: function () { return makePayload(12); },
    wrapLearningPayload: function (remote, payload) { return { eisei: payload }; },
    saveState: function () { saved += 1; }
  };
  var provider = {
    write: function () {
      return Promise.resolve({ content: { sha: "sha-after-put" } });
    }
  };
  loadFunctions(context, ["normalizeGitHubSha", "pushProgressToSyncProvider"]);
  var result = await context.pushProgressToSyncProvider(provider, "sha-before-put", {});
  assert.equal(saved, 1);
  assert.equal(result.sha, "sha-after-put");
  assert.equal(result.payload.totalAnswered, 12);
});

test("競合メッセージはSHAを画面へ表示しない", function () {
  assert.match(HTML, /この端末とGitHubの両方に新しい変更があります。/);
  assert.match(HTML, /安全のため同期を停止しました。先にバックアップまたは統合確認をしてください。/);
  assert.doesNotMatch(HTML, /compareSyncScores/);
  assert.doesNotMatch(HTML, /競合[^\n]{0,120}lastSyncedSha/);
});

test("同期メタは既存キーを使い新しいlocalStorageキーを追加しない", function () {
  assert.match(HTML, /var GITHUB_SYNC_META_KEY = "eiseiGithubSyncMetaV1";/);
  assert.match(HTML, /lastSyncedSha:/);
  assert.equal((HTML.match(/eiseiGithubSyncMetaV1/g) || []).length, 1);
});
