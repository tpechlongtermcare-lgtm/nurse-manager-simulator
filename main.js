import { createInitialState, loadSave, clearSave } from "./state.js";
import { GameEngine } from "./engine.js";
import { GameUI } from "./ui.js";

const root = document.querySelector("#app");
let data = null;
let engine = null;
let ui = null;

async function loadJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} 載入失敗：${response.status}`);
  return response.json();
}

async function loadData() {
  const [events, actions, staff, fortunes, achievements, endings] = await Promise.all([
    loadJSON("./data/events.json"),
    loadJSON("./data/actions.json"),
    loadJSON("./data/staff.json"),
    loadJSON("./data/fortune.json"),
    loadJSON("./data/achievements.json"),
    loadJSON("./data/endings.json")
  ]);
  return { events, actions, staff, fortunes, achievements, endings };
}

function createUI() {
  return new GameUI(root, data, {
    onNewGame: startNewGame,
    onContinue: continueGame,
    onChoice: handleChoice,
    onAction: handleAction,
    onSettle: settleDay,
    onHome: showHome
  });
}

function showHome() {
  ui.renderHome(Boolean(loadSave()));
}

function startNewGame() {
  clearSave();
  engine = new GameEngine(createInitialState(data.staff), data);
  const { quitters, ending } = engine.beginDay();
  ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : ui.renderGame(engine));
}

function continueGame() {
  const saved = loadSave();
  if (!saved) return startNewGame();
  engine = new GameEngine(saved, data);
  if (engine.state.phase === "ended") {
    ui.renderEnding(engine);
    return;
  }
  if (engine.state.phase === "dawn") {
    const { quitters, ending } = engine.beginDay();
    ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : ui.renderGame(engine));
    return;
  }
  ui.renderGame(engine);
}

function handleChoice(index) {
  const outcome = engine.choose(index);
  if (!outcome || outcome.error) return;
  ui.showResult(outcome.result, outcome.changes, () => {
    if (outcome.ending) ui.renderEnding(engine);
    else ui.renderGame(engine);
  });
}

function handleAction(actionId) {
  const outcome = engine.performAction(actionId);
  if (!outcome || outcome.error) return;
  ui.showToast(outcome.changes);

  if (outcome.ending) {
    ui.renderEnding(engine);
    return;
  }
  if (outcome.endDay) {
    settleDay();
    return;
  }
  ui.renderGame(engine);
}

function settleDay() {
  const result = engine.endDay();
  if (result.ending) {
    ui.renderEnding(engine);
    return;
  }
  const { quitters, ending } = engine.beginDay();
  ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : ui.renderGame(engine));
}

try {
  data = await loadData();
  ui = createUI();
  showHome();
} catch (error) {
  console.error(error);
  ui = new GameUI(root, { achievements: [] }, {});
  ui.renderLoadError(error);
}
