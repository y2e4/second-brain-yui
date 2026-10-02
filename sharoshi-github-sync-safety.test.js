"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var ROOT = __dirname;
var HTML = fs.readFileSync(path.join(ROOT, "sharoshi-intro.html"), "utf8");
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

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function option(settings, key, fallback) {
  return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
}

function makePayload(totalAnswered) {
  var total = Number(totalAnswered || 0);
  var ids = total ? ["stage5-question-001"] : [];
  return {
    app: "sharoshi-quiz-os",
    exportedAt: "2026-10-02T09:00:00.000Z",
    answeredQuestionIds: ids.slice(),
    wrongQuestionIds: [],
    reviewQuestionIds: [],
    uncertainCorrectQuestionIds: [],
    guessedCorrectQuestionIds: [],
    ambiguousQuestionIds: [],
    weakQuestionIds: [],
    totalAnswered: total,
    totalCorrect: Math.max(0, total - 1),
    stageResults: {
      "5": {
        answerCount: total,
        correctCount: Math.max(0, total - 1),
        answeredQuestionIds: ids.slice()
      }
    },
    progress: {
      totalAnswers: total,
      correctAnswers: Math.max(0, total - 1),
      wrongQuestionIds: [],
      lastManualSyncAt: "2026-10-02T08:00:00.000Z",
      lastSavedAt: "2026-10-02T08:00:00.000Z",
      recentQuestionIds: ids.slice(),
      seenQuestionIds: ids.slice(),
      wrongReview: {},
      stageProgress: {
        "5": {
          answerCount: total,
          correctCount: Math.max(0, total - 1),
          answeredQuestionIds: ids.slice()
        }
      }
    }
  };
}

function makeActionHarness(options) {
  var settings = options || {};
  var context = {
    progress: {
      lastManualSyncAt: option(settings, "lastManualSyncAt", "2026-10-02T08:00:00.000Z"),
      lastSavedAt: option(settings, "lastSavedAt", "2026-10-02T08:00:00.000Z")
    },
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: option(settings, "lastSyncedSha", "sha-base") };
    },
    isLocalProgressNewerThanLastSync: function () {
      return settings.localChanged === true;
    },
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
  };
  return loadFunctions(context, HELPER_FUNCTIONS);
}

function resolveAction(options) {
  var settings = options || {};
  var context = makeActionHarness(settings);
  var remotePayload = settings.namespaceMissing
    ? null
    : makePayload(option(settings, "remoteTotal", 10));
  var remote = {
    exists: option(settings, "remoteExists", true),
    sha: option(settings, "remoteSha", "sha-current"),
    payload: remotePayload ? { sharoshi: remotePayload, eisei: { preserved: true } } : { eisei: { preserved: true } }
  };
  return context.resolveGitHubSyncAction(
    remote,
    option(settings, "localPayload", makePayload(option(settings, "localTotal", 10))),
    remotePayload
  );
}

function makeManualSyncHarness(options) {
  var settings = options || {};
  var events = {
    writes: 0,
    pulls: 0,
    conflicts: [],
    successes: [],
    errors: [],
    statuses: [],
    sameMarks: 0
  };
  var localPayload = option(settings, "localPayload", makePayload(option(settings, "localTotal", 10)));
  var remotePayload = settings.namespaceMissing
    ? null
    : makePayload(option(settings, "remoteTotal", 10));
  var remote = {
    exists: option(settings, "remoteExists", true),
    sha: option(settings, "remoteSha", "sha-current"),
    payload: remotePayload ? { sharoshi: remotePayload, eisei: { preserved: true } } : { eisei: { preserved: true } }
  };
  var context = {
    progress: {
      lastManualSyncAt: "2026-10-02T08:00:00.000Z",
      lastSavedAt: "2026-10-02T08:00:00.000Z"
    },
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: option(settings, "lastSyncedSha", "sha-base") };
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
    normalizeStageProgress: function () {},
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
    looksLikeProgressPayload: function (value) { return Boolean(value); },
    pushProgressToSyncProvider: function () {
      events.writes += 1;
      return Promise.resolve({ payload: localPayload, sha: "sha-after-put" });
    },
    applyImportedProgressPayload: function () { events.pulls += 1; },
    markProgressSyncedNow: function () { events.sameMarks += 1; },
    markSyncSuccess: function (updatedAt, comparison, sha) {
      events.successes.push({ updatedAt: updatedAt, comparison: comparison, sha: sha });
    },
    markSyncError: function (message) { events.errors.push(message); },
    showGitHubSyncConflict: function (conflict) { events.conflicts.push(conflict); },
    updateGitHubSyncMeta: function () {},
    updateSyncInfo: function () {},
    renderDebugInfo: function () {},
    getPayloadUpdatedAt: function () { return "2026-10-02T09:00:00.000Z"; },
    cloneJson: clone
  };
  loadFunctions(context, HELPER_FUNCTIONS.concat(["syncProgressWithGitHub"]));
  return { context: context, events: events };
}

function makeAutoSyncHarness(options) {
  var settings = options || {};
  var events = { pulls: 0, writes: 0, conflicts: [], errors: [], statuses: [], successes: [], meta: [] };
  var localPayload = option(settings, "localPayload", makePayload(option(settings, "localTotal", 10)));
  var remotePayload = settings.namespaceMissing
    ? null
    : makePayload(option(settings, "remoteTotal", 10));
  var remote = {
    exists: option(settings, "remoteExists", true),
    sha: option(settings, "remoteSha", "sha-current"),
    payload: remotePayload ? { sharoshi: remotePayload, eisei: { preserved: true } } : { eisei: { preserved: true } }
  };
  var context = {
    progress: {
      lastManualSyncAt: "2026-10-02T08:00:00.000Z",
      lastSavedAt: "2026-10-02T08:00:00.000Z"
    },
    autoSyncStarted: false,
    readGitHubSyncMeta: function () {
      return { lastSyncedSha: option(settings, "lastSyncedSha", "sha-base") };
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
        read: function () { return Promise.resolve(remote); },
        write: function () { events.writes += 1; return Promise.resolve({}); }
      };
    },
    normalizeStageProgress: function () {},
    buildProgressExportPayload: function () { return localPayload; },
    extractLearningPayload: function () { return remotePayload; },
    looksLikeProgressPayload: function (value) { return Boolean(value); },
    applyImportedProgressPayload: function () { events.pulls += 1; },
    markSyncSuccess: function (updatedAt, comparison, sha) {
      events.successes.push({ comparison: comparison, sha: sha });
    },
    markSyncError: function (message) { events.errors.push(message); },
    showGitHubSyncConflict: function (conflict) { events.conflicts.push(conflict); },
    showSyncStatus: function (message, isError) {
      events.statuses.push({ message: message, isError: isError });
    },
    updateGitHubSyncMeta: function (patch) { events.meta.push(patch); },
    updateSyncInfo: function () {},
    renderDebugInfo: function () {},
    getPayloadUpdatedAt: function () { return "2026-10-02T09:00:00.000Z"; },
    cloneJson: clone
  };
  loadFunctions(context, HELPER_FUNCTIONS.concat(["autoFetchLatestFromGitHub"]));
  return { context: context, events: events };
}

function useActualLocalTimestamp(harness, offsetMs) {
  var syncedAtMs = Date.parse("2026-10-02T08:00:00.000Z");
  harness.context.progress.lastManualSyncAt = new Date(syncedAtMs).toISOString();
  harness.context.progress.lastSavedAt = new Date(syncedAtMs + offsetMs).toISOString();
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
    assert.equal(harness.context.isLocalProgressNewerThanLastSync(), entry.changed);
  });
});

test("ローカル変更なし・GitHub変更なしはPUTも置換もせず同期済み", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    lastSyncedSha: "sha-current",
    remoteSha: "sha-current"
  }), 0);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.successes[0].comparison, "same");
});

test("ローカル変更だけならPUTし、PUT応答SHAを同期成功へ渡す", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    lastSyncedSha: "sha-current",
    remoteSha: "sha-current"
  }), 1);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 1);
  assert.equal(harness.events.pulls, 0);
  assert.deepEqual(harness.events.successes[0], {
    updatedAt: "2026-10-02T09:00:00.000Z",
    comparison: "local",
    sha: "sha-after-put"
  });
});

test("GitHub変更だけなら回答数に関係なくローカルへ取り込む", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    localTotal: 100,
    remoteTotal: 3,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  }), 0);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 1);
  assert.equal(harness.events.successes[0].comparison, "remote");
});

test("両側変更はローカル回答数が多くても必ず競合停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    localTotal: 100,
    remoteTotal: 3,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.successes.length, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("両側変更はGitHub回答数が多くても必ず競合停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    localTotal: 3,
    remoteTotal: 100,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("両側変更は集計値が同じでも必ず競合停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: true,
    localTotal: 10,
    remoteTotal: 10,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("同期時刻+1msかつGitHub変更ならPUTもローカル置換もしない", async function () {
  var harness = useActualLocalTimestamp(makeManualSyncHarness({
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  }), 1);
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("起動時自動GETも両側変更ならPUTもローカル置換もしない", async function () {
  var harness = makeAutoSyncHarness({
    localChanged: true,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("起動時自動GETはGitHub変更だけなら取り込む", async function () {
  var harness = makeAutoSyncHarness({
    localChanged: false,
    lastSyncedSha: "sha-base",
    remoteSha: "sha-current"
  });
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.pulls, 1);
  assert.equal(harness.events.conflicts.length, 0);
  assert.equal(harness.events.successes[0].sha, "sha-current");
});

test("起動時自動GETはローカル変更だけならPUTせず未同期を維持", async function () {
  var harness = makeAutoSyncHarness({
    localChanged: true,
    lastSyncedSha: "sha-current",
    remoteSha: "sha-current"
  });
  await harness.context.autoFetchLatestFromGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.meta.at(-1).lastStatus, "unsynced");
});

test("SHA未保持で既存学習データがあれば時刻差なしでも安全停止", async function () {
  var harness = makeManualSyncHarness({
    localChanged: false,
    lastSyncedSha: "",
    remoteSha: "sha-current",
    localTotal: 10
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.equal(harness.events.conflicts.length, 1);
});

test("SHA未保持でも空の新端末ならGitHubデータを取り込める", function () {
  assert.equal(resolveAction({
    localChanged: true,
    lastSyncedSha: "",
    localPayload: makePayload(0),
    remoteSha: "sha-current"
  }).action, "pull");
});

test("既知SHAがある状態でremoteファイルが消失したら自動再作成しない", async function () {
  var harness = makeManualSyncHarness({
    localChanged: false,
    lastSyncedSha: "sha-base",
    remoteExists: false
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
});

test("既知SHAがある状態で社労士名前空間が消失したら自動再作成しない", async function () {
  var harness = makeManualSyncHarness({
    localChanged: false,
    lastSyncedSha: "sha-base",
    namespaceMissing: true,
    remoteSha: "sha-current"
  });
  await harness.context.syncProgressWithGitHub();
  assert.equal(harness.events.writes, 0);
  assert.equal(harness.events.pulls, 0);
  assert.match(harness.events.errors[0], /安全のため同期を停止しました/);
});

test("SHA未保持の既存学習データはremoteがなくても自動作成せず停止", function () {
  assert.equal(resolveAction({
    localChanged: true,
    lastSyncedSha: "",
    remoteExists: false,
    localPayload: makePayload(10)
  }).action, "remote_missing");
});

test("GitHub GETのfile SHAとPUT応答のcontent SHAをモック経由で取得する", async function () {
  var requests = [];
  var context = {
    encodePathForGitHub: function (value) { return value; },
    createGitHubAuthorization: function () {
      return { header: "token mock", scheme: "token" };
    },
    encodeBase64Utf8: function (value) { return value; },
    decodeBase64Utf8: function (value) { return value; },
    handleGitHubApiError: function () { throw new Error("unexpected API error"); },
    console: { info: function () {}, error: function () {} },
    fetch: function (url, options) {
      requests.push({ url: url, options: options });
      if (options.method === "GET") {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: function () {
            return Promise.resolve({
              type: "file",
              sha: "sha-from-get",
              content: JSON.stringify({ sharoshi: makePayload(8) })
            });
          }
        });
      }
      return Promise.resolve({
        status: 200,
        ok: true,
        json: function () {
          return Promise.resolve({ content: { sha: "sha-from-put" } });
        }
      });
    }
  };
  loadFunctions(context, ["createGitHubSyncProvider"]);
  var provider = context.createGitHubSyncProvider({
    owner: "owner",
    repo: "repo",
    branch: "main",
    path: "learning-data.json",
    token: "mock"
  });
  var readResult = await provider.read();
  var writeResult = await provider.write({ sharoshi: makePayload(9) }, "sha-from-get");
  var putBody = JSON.parse(requests[1].options.body);

  assert.equal(readResult.sha, "sha-from-get");
  assert.equal(readResult.payload.sharoshi.totalAnswered, 8);
  assert.equal(writeResult.content.sha, "sha-from-put");
  assert.equal(putBody.sha, "sha-from-get");
});

test("PUT成功時はGitHub応答のcontent SHAを返す", async function () {
  var saved = 0;
  var context = {
    progress: {
      lastManualSyncAt: "2026-10-02T08:00:00.000Z",
      lastSavedAt: "2026-10-02T08:00:00.000Z"
    },
    normalizeStageProgress: function () {},
    buildProgressExportPayload: function () { return makePayload(12); },
    wrapLearningPayload: function (remote, payload) { return { sharoshi: payload }; },
    saveProgress: function () { saved += 1; },
    updateStats: function () {}
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

test("同期成功メタへSHAを保存しlastSyncedScoreは表示資料として残す", function () {
  var captured;
  var context = {
    progress: { lastManualSyncAt: "2026-10-02T09:00:00.000Z" },
    hideSyncConflictPanel: function () {},
    updateGitHubSyncMeta: function (patch) { captured = patch; },
    getPayloadSyncScore: function () { return { totalAnswered: 12 }; },
    buildProgressExportPayload: function () { return makePayload(12); },
    updateSyncInfo: function () {},
    renderDebugInfo: function () {}
  };
  loadFunctions(context, ["normalizeGitHubSha", "markSyncSuccess"]);
  context.markSyncSuccess("2026-10-02T09:00:00.000Z", "remote", "  sha-current  ");
  assert.equal(captured.lastSyncedSha, "sha-current");
  assert.equal(captured.lastSyncedScore.totalAnswered, 12);
});

test("同期SHAは既存メタキーへ保存され再読み込みできる", function () {
  var storage = {};
  var context = {
    GITHUB_SYNC_META_KEY: "sharoshiGithubSyncMetaV1",
    localStorage: {
      getItem: function (key) { return storage[key] || null; },
      setItem: function (key, value) { storage[key] = value; }
    },
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
  };
  loadFunctions(context, ["normalizeGitHubSha", "readGitHubSyncMeta", "saveGitHubSyncMeta", "updateGitHubSyncMeta"]);
  context.updateGitHubSyncMeta({ lastSyncedSha: "sha-persisted", lastStatus: "synced" });
  assert.equal(context.readGitHubSyncMeta().lastSyncedSha, "sha-persisted");
  assert.deepEqual(Object.keys(storage), ["sharoshiGithubSyncMetaV1"]);
});

test("共有learning-dataへのPUT用payloadは他資格名前空間を維持する", function () {
  var context = {
    COMMON: {},
    QUALIFICATION_NAMESPACE: "sharoshi",
    isPlainObject: function (value) {
      return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    },
    looksLikeProgressPayload: function () { return false; },
    cloneJson: clone,
    getPayloadUpdatedAt: function () { return "2026-10-02T09:00:00.000Z"; }
  };
  loadFunctions(context, ["wrapLearningPayload"]);
  var wrapped = context.wrapLearningPayload(
    { schemaVersion: 1, eisei: { totalAnswered: 50 } },
    makePayload(12)
  );
  assert.deepEqual(wrapped.eisei, { totalAnswered: 50 });
  assert.equal(wrapped.sharoshi.totalAnswered, 12);
});

test("スコア比較は手動同期・自動GETの方向決定に使わない", function () {
  assert.doesNotMatch(extractFunction("syncProgressWithGitHub"), /compareSyncScores/);
  assert.doesNotMatch(extractFunction("autoFetchLatestFromGitHub"), /compareSyncScores/);
  assert.match(HTML, /function compareSyncScores\(/);
});

test("safeMergeCandidateは競合バックアップ内だけに残り自動適用されない", function () {
  assert.match(extractFunction("buildSyncConflictBackup"), /safeMergeCandidate: buildSafeMergeCandidate/);
  assert.doesNotMatch(extractFunction("syncProgressWithGitHub"), /safeMergeCandidate|buildSafeMergeCandidate/);
  assert.doesNotMatch(extractFunction("autoFetchLatestFromGitHub"), /safeMergeCandidate|buildSafeMergeCandidate/);
});

test("競合表示は既存の人間選択UIを維持しSHAを通常文言へ出さない", function () {
  assert.match(HTML, /残したい勉強記録を選んでください/);
  assert.match(HTML, /この端末とGitHubの両方に新しい変更があります。/);
  assert.match(HTML, /安全のため同期を停止しました。先にバックアップまたは統合確認をしてください。/);
  assert.doesNotMatch(HTML, /競合[^\n]{0,120}lastSyncedSha/);
});

test("同期メタは既存localStorageキーだけを使う", function () {
  assert.match(HTML, /var GITHUB_SYNC_META_KEY = "sharoshiGithubSyncMetaV1";/);
  assert.equal((HTML.match(/sharoshiGithubSyncMetaV1/g) || []).length, 1);
  assert.match(HTML, /lastSyncedSha:/);
});
