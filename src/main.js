import { createInitialState, loadSave, clearSave } from "./state.js?v=2.3.4";
import { GameEngine } from "./engine.js?v=2.3.4";
import { GameUI } from "./ui.js?v=2.3.4";
import { GameAudio } from "./audio.js?v=2.3.4";

const root = document.querySelector("#app");
let data = null;
let engine = null;
let ui = null;
const audio = new GameAudio();
let lastEventCue = "";

async function loadJSON(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} 載入失敗：${response.status}`);
  return response.json();
}

async function loadData() {
  const [events, actions, staff, scene, fortunes, achievements, endings] = await Promise.all([
    loadJSON("./data/events.json"),
    loadJSON("./data/actions.json"),
    loadJSON("./data/staff.json"),
    loadJSON("./data/scene.json"),
    loadJSON("./data/fortune.json"),
    loadJSON("./data/achievements.json"),
    loadJSON("./data/endings.json")
  ]);
  return { events, actions, staff, scene, fortunes, achievements, endings };
}

function renderCurrentGame(resetScroll = false) {
  ui.renderGame(engine);
  if (resetScroll) requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  const event = engine.currentEvent();
  const cueKey = event ? `${engine.state.day}:${event.id}` : "";
  if (cueKey && cueKey !== lastEventCue) audio.playEvent(event);
  lastEventCue = cueKey;
}

function createUI() {
  return new GameUI(root, data, {
    onNewGame: startNewGame,
    onContinue: continueGame,
    onChoice: handleChoice,
    onAction: handleAction,
    onSettle: settleDay,
    onHome: showHome,
    onSceneAction: handleSceneAction,
    onNpcInteraction: handleNpcInteraction,
    onUiCue: cue => audio.play(cue),
    onSoundToggle: toggleSound,
    isSoundEnabled: () => audio.isEnabled()
  });
}

function toggleSound() {
  audio.toggle();
  if (engine && engine.state.phase !== "ended") renderCurrentGame();
  else showHome();
}

function showHome() {
  ui.renderHome(Boolean(loadSave()));
}

function startNewGame() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  clearSave();
  lastEventCue = "";
  engine = new GameEngine(createInitialState(data.staff), data);
  const { quitters, ending } = engine.beginDay();
  audio.play("dawn");
  ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : renderCurrentGame(true));
}

function continueGame() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  const saved = loadSave();
  if (!saved) return startNewGame();
  engine = new GameEngine(saved, data);
  if (engine.state.phase === "ended") {
    ui.renderEnding(engine);
    return;
  }
  if (engine.state.phase === "dawn") {
    const { quitters, ending } = engine.beginDay();
    audio.play("dawn");
    ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : renderCurrentGame(true));
    return;
  }
  renderCurrentGame(true);
}

function handleChoice(index) {
  const outcome = engine.choose(index);
  if (!outcome || outcome.error) return;
  audio.play("result");
  ui.showResult(outcome.result, outcome.changes, () => {
    if (outcome.ending) ui.renderEnding(engine);
    else renderCurrentGame();
  }, { state: engine.state, npc: outcome.npc, followUp: outcome.followUp });
}

function handleAction(actionId, sound = "click") {
  audio.play(sound);
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
  renderCurrentGame();
}

function handleSceneAction(actionId, sound) {
  handleAction(actionId, sound || "click");
}

function handleNpcInteraction(npcId, interactionId) {
  const outcome = engine.interactWithNpc(npcId, interactionId);
  if (!outcome || outcome.error) return;
  audio.play(outcome.sound || "result");
  if (outcome.ending) {
    ui.renderEnding(engine);
    return;
  }
  renderCurrentGame();
  ui.showToast(outcome.changes);
  ui.showSceneReaction(npcId, outcome.bubble || outcome.result, outcome.reaction);
}

function settleDay() {
  const result = engine.endDay();
  if (result.ending) {
    ui.renderEnding(engine);
    return;
  }
  const { quitters, ending } = engine.beginDay();
  audio.play("dawn");
  ui.showDawn(engine.state, quitters, () => ending ? ui.renderEnding(engine) : renderCurrentGame(true));
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
