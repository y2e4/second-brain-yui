(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HygieneOSV2ChoiceShuffle = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DISPLAY_LABELS = ["A", "B", "C", "D", "E"];
  var AUDITED_STAGE5_QUESTION_IDS = [
    "hm2-stage5-001", "hm2-stage5-002", "hm2-stage5-003",
    "hm2-stage5-004", "hm2-stage5-005", "hm2-stage5-006",
    "hm2-stage5-007", "hm2-stage5-008", "hm2-stage5-009",
    "hm2-stage5-010", "hm2-stage5-011", "hm2-stage5-012",
    "hm2-stage5-013", "hm2-stage5-014", "hm2-stage5-015",
    "hm2-stage5-016", "hm2-stage5-017", "hm2-stage5-018",
    "hm2-stage5-019", "hm2-stage5-020", "hm2-stage5-021",
    "hm2-stage5-022", "hm2-stage5-023", "hm2-stage5-024",
    "hm2-stage5-025", "hm2-stage5-026", "hm2-stage5-027",
    "hm2-stage5-028", "hm2-stage5-029", "hm2-stage5-030"
  ];
  var AUDITED_STAGE5_QUESTION_ID_SET = {};

  AUDITED_STAGE5_QUESTION_IDS.forEach(function (id) {
    AUDITED_STAGE5_QUESTION_ID_SET[id] = true;
  });

  function toId(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function normalizeRandomValue(value) {
    var number = Number(value);
    return Number.isFinite(number) && number >= 0 && number < 1 ? number : 0;
  }

  function hasStableChoiceContract(question) {
    var ids = {};
    var choices = question && Array.isArray(question.choices) ? question.choices : [];
    var answer = toId(question && question.answer);

    if (choices.length < 2 || choices.length > DISPLAY_LABELS.length || !answer) {
      return false;
    }
    if (choices.some(function (choice) {
      var id = toId(choice && choice.id);
      if (!id || ids[id]) {
        return true;
      }
      ids[id] = true;
      return false;
    })) {
      return false;
    }
    return Boolean(ids[answer]);
  }

  function isShuffleAllowed(question) {
    return Boolean(
      question &&
      Number(question.stage) === 5 &&
      AUDITED_STAGE5_QUESTION_ID_SET[toId(question.id)] &&
      question.shuffleChoicesAllowed !== false &&
      hasStableChoiceContract(question)
    );
  }

  function shuffledCopy(choices, random) {
    var output = choices.slice();
    var randomValue = typeof random === "function" ? random : Math.random;
    var index;
    var target;
    var temporary;

    for (index = output.length - 1; index > 0; index -= 1) {
      target = Math.floor(normalizeRandomValue(randomValue()) * (index + 1));
      temporary = output[index];
      output[index] = output[target];
      output[target] = temporary;
    }
    return output;
  }

  function getDisplayChoices(question, random) {
    var source = question && Array.isArray(question.choices) ? question.choices : [];
    var shuffleAllowed = isShuffleAllowed(question);
    var ordered = shuffleAllowed ? shuffledCopy(source, random) : source.slice();

    return ordered.map(function (choice, index) {
      return {
        id: toId(choice && choice.id),
        text: toId(choice && choice.text),
        displayLabel: shuffleAllowed ? DISPLAY_LABELS[index] : toId(choice && choice.id)
      };
    });
  }

  return {
    AUDITED_STAGE5_QUESTION_IDS: AUDITED_STAGE5_QUESTION_IDS.slice(),
    isShuffleAllowed: isShuffleAllowed,
    getDisplayChoices: getDisplayChoices
  };
}));
