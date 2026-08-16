"use strict";

var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var DATA = JSON.parse(fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2-questions.json"),
  "utf8"
));
var HTML = fs.readFileSync(
  path.join(__dirname, "hygiene-os-v2.html"),
  "utf8"
);
var BASE_QUESTIONS = DATA.questions || [];
var STAGE5_QUESTIONS = DATA.stage5 && Array.isArray(DATA.stage5.questions)
  ? DATA.stage5.questions
  : [];
var ALL_QUESTIONS = BASE_QUESTIONS.concat(STAGE5_QUESTIONS);
var GENERIC_MEMORY_PATTERN = /正解の理由を短く言い直して覚えます|短く言い直して覚え|理由を短く覚え/;
var STAGE5_KNOWLEDGE_KEY_IDS = new Set([
  "hm2-physiology-v01-02", "hm2-physiology-v01-05",
  "hm2-hygiene-v02-03", "hm2-physiology-v02-05",
  "hm2-physiology-v02-10", "hm2-stage5-018",
  "hm2-stage5-022", "hm2-stage5-023",
  "hm2-stage5-025", "hm2-stage5-029"
]);

var EXPECTED_HOOKS = {
  "hm2-stage5-001": "1,000人超〜2,000人以下は「4人」。1,200人を見たら、50人基準ではなく人数表の4人区分へ切り替える。",
  "hm2-stage5-002": "「深夜業100人」だけでは専任確定にしない。専任は事業場規模と法定の有害業務条件を組み合わせて判定する。",
  "hm2-stage5-003": "林業・鉱業・建設業・運送業・清掃業は100人から。総括安全衛生管理者は、まず業種で入口を決める。",
  "hm2-stage5-004": "産業医の入口は50人以上。「2人以上は3,000人超」「選任は14日以内」を別の数字として切り分ける。",
  "hm2-stage5-005": "巡視は原則「月1回」、条件がそろえば「2か月に1回」。2か月が原則ではない。",
  "hm2-stage5-006": "省略可否は「業務歴は残す」を軸にする。腹囲・貧血・心電図などとは扱いが違う。",
  "hm2-stage5-007": "通常の面接指導は「80時間超・疲労蓄積・本人申出」の3点。100時間超・申出不要は研究開発業務等の特例側。",
  "hm2-stage5-008": "監督官の文書指導でも、健康障害防止に関する事項なら衛生委員会で審議する。「誰から」より「健康障害防止か」で判定する。",
  "hm2-stage5-009": "原則は「月45・年360」。特別条項の「時間外＋休日が単月100未満・時間外が年720以内」と箱を分ける。",
  "hm2-stage5-010": "設備ごとに周期を分ける。機械換気は2か月、照明は6か月、換気の点検記録は3年。",
  "hm2-stage5-011": "偽陽性は「病気なしなのに陽性」。分母を疾病なし800人にして、120÷800＝15%。",
  "hm2-stage5-012": "偽陰性は「病気ありなのに陰性」。分母を疾病あり50人にして、5÷50＝10%。",
  "hm2-stage5-013": "カンピロバクターは感染型。食品中でできた毒素が主因の毒素型とは分ける。",
  "hm2-stage5-014": "胸骨圧迫は「下半分・約5cm・100〜120回/分」。位置・深さ・速さを3点セットで呼び戻す。",
  "hm2-stage5-015": "WBGTは高いほど危険側。「基準値未満でリスク上昇」は向きが逆。",
  "hm2-stage5-016": "50人未満は「今は努力義務、令和10年4月1日から義務」。現行と施行後を時系列で分ける。",
  "hm2-stage5-017": "腰痛対策はベルト一択ではない。重量・姿勢・作業方法・健康管理を組み合わせる。",
  "hm2-stage5-018": "換気人数は「換気量×濃度差÷100万÷1人の呼出量」。ppmは100万分率へ直してから計算する。",
  "hm2-stage5-019": "高齢者の照明は「明るさを上げる＋まぶしさを抑える」の両立。高照度だけで終わらせない。",
  "hm2-stage5-020": "健康づくりは感覚ではなく数値で把握し、個人と集団の両方で進める。「客観値・個人・集団」の3軸。",
  "hm2-stage5-021": "錐状体は色、杆状体は明暗。「色の錐、明暗の杆」で役割を分ける。",
  "hm2-stage5-022": "胆汁は「アルカリ性・酵素なし・脂肪を乳化」。酸性や消化酵素と結びつけない。",
  "hm2-stage5-023": "ペプシン＝タンパク質、リパーゼ＝脂肪、アミラーゼ＝デンプン。胆汁は酵素ではない。",
  "hm2-stage5-024": "細胞体の集まりは「中枢＝核、末梢＝節」。神経核と神経節を逆にしない。",
  "hm2-stage5-025": "ヘモグロビンは骨髄の赤血球系細胞、尿素・解毒・グリコーゲンは肝臓。血液関連という印象だけで肝臓に寄せない。",
  "hm2-stage5-026": "腎臓は「糸球体で濾過、尿細管で再吸収」。原尿の水分・電解質の多くは血中へ戻る。",
  "hm2-stage5-027": "血漿55、血球45。赤血球が血球内で最多でも、全血液の60%ではない。",
  "hm2-stage5-028": "コルチゾールは「副腎皮質→血糖を上げる」。インスリンの「膵臓→下げる」と対比する。",
  "hm2-stage5-029": "抗体で働くBリンパ球は体液性、直接作用するTリンパ球は細胞性。「B＝抗体、T＝直接」で分ける。",
  "hm2-stage5-030": "動脈・静脈は酸素量ではなく、心臓から出るか戻るか。右心室→肺動脈→肺→肺静脈→左心房。"
};

var A_IDS = [
  "hm2-stage5-011", "hm2-stage5-012", "hm2-stage5-018",
  "hm2-stage5-021", "hm2-stage5-022", "hm2-stage5-023",
  "hm2-stage5-024", "hm2-stage5-025", "hm2-stage5-026",
  "hm2-stage5-027", "hm2-stage5-028", "hm2-stage5-029",
  "hm2-stage5-030"
];
var B_IDS = [
  "hm2-stage5-001", "hm2-stage5-002", "hm2-stage5-003",
  "hm2-stage5-004", "hm2-stage5-005", "hm2-stage5-006",
  "hm2-stage5-007", "hm2-stage5-008", "hm2-stage5-009",
  "hm2-stage5-010", "hm2-stage5-013", "hm2-stage5-014",
  "hm2-stage5-015", "hm2-stage5-016", "hm2-stage5-017",
  "hm2-stage5-019", "hm2-stage5-020"
];

function sha256(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function withoutMemories(value) {
  var copy = JSON.parse(JSON.stringify(value));
  var questions = (copy.questions || []).concat(
    copy.stage5 && Array.isArray(copy.stage5.questions)
      ? copy.stage5.questions
      : []
  );
  questions.forEach(function (question) {
    delete question.memory;
    if (STAGE5_KNOWLEDGE_KEY_IDS.has(question.id)) {
      delete question.knowledgeKey;
      delete question.variantType;
    }
  });
  return copy;
}

test("覚え方改善でも111問の問題本体と構造を変更しない", function () {
  assert.equal(BASE_QUESTIONS.length, 81);
  assert.equal(STAGE5_QUESTIONS.length, 30);
  assert.equal(ALL_QUESTIONS.length, 111);
  assert.equal(new Set(ALL_QUESTIONS.map(function (question) {
    return question.id;
  })).size, 111);
  assert.equal(
    sha256(withoutMemories(DATA)),
    "7661aa8a08dfeb8f8c13848bd86e4023f901b6c8758eb06ce82cbf501ba29cb4"
  );
});

test("既存81問の覚え方は変更しない", function () {
  assert.equal(
    sha256(BASE_QUESTIONS.map(function (question) {
      return { id: question.id, memory: question.memory };
    })),
    "894281699aa50ae07c1c505fbae23fa7c7a2b2ae5bd7b9609132fb57da224d8d"
  );
});

test("Stage 5の30問すべてに監査済みの固有フックを設定する", function () {
  assert.equal(Object.keys(EXPECTED_HOOKS).length, 30);
  STAGE5_QUESTIONS.forEach(function (question) {
    assert.equal(question.memory, EXPECTED_HOOKS[question.id], question.id);
  });
});

test("A 13問と根拠確認済みB 17問だけでStage 5の30問を網羅する", function () {
  var classifiedIds = A_IDS.concat(B_IDS);
  assert.equal(A_IDS.length, 13);
  assert.equal(B_IDS.length, 17);
  assert.equal(new Set(classifiedIds).size, 30);
  assert.deepEqual(
    classifiedIds.slice().sort(),
    STAGE5_QUESTIONS.map(function (question) {
      return question.id;
    }).sort()
  );
});

test("全111問に表示可能な覚え方があり汎用文は残らない", function () {
  ALL_QUESTIONS.forEach(function (question) {
    assert.equal(typeof question.memory, "string", question.id);
    assert.ok(question.memory.trim(), question.id);
    assert.doesNotMatch(question.memory, GENERIC_MEMORY_PATTERN, question.id);
  });
});

test("新しい覚え方は1〜2文で解説やひっかけポイントの複製ではない", function () {
  STAGE5_QUESTIONS.forEach(function (question) {
    var sentenceCount = (question.memory.match(/。/g) || []).length;
    assert.ok(sentenceCount >= 1 && sentenceCount <= 2, question.id);
    assert.notEqual(question.memory, question.explanation, question.id);
    assert.notEqual(question.memory, question.trap, question.id);
  });
});

test("問題JSONキャッシュ識別子を覚え方改善版へ更新する", function () {
  assert.match(
    HTML,
    /hygiene-os-v2-questions\.json\?v=20260816-stage5-knowledge-keys-01/
  );
  assert.doesNotMatch(HTML, /20260816-memory-hooks-01/);
});
