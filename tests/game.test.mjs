import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const memoryStorage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return memoryStorage.has(key) ? memoryStorage.get(key) : null;
  },
  setItem(key, value) {
    memoryStorage.set(key, String(value));
  },
  removeItem(key) {
    memoryStorage.delete(key);
  },
  clear() {
    memoryStorage.clear();
  }
};

const { GameEngine } = await import("../src/engine.js");
const { createInitialState, loadAchievements, loadSave } = await import("../src/state.js");
const { drawDailyEvents, weightedDraw } = await import("../src/deck.js");
const { markPendingQuits, processMorningQuits } = await import("../src/staff.js");
const { managerMood, npcMood, moveScenePosition, findNearestSceneTarget } = await import("../src/ui.js");
const { GameAudio } = await import("../src/audio.js");

async function readJSON(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
}

const data = {
  events: await readJSON("../data/events.json"),
  actions: await readJSON("../data/actions.json"),
  staff: await readJSON("../data/staff.json"),
  scene: await readJSON("../data/scene.json"),
  fortunes: await readJSON("../data/fortune.json"),
  achievements: await readJSON("../data/achievements.json"),
  endings: await readJSON("../data/endings.json")
};

let passed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, callback) {
  memoryStorage.clear();
  try {
    callback();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function makeEngine() {
  return new GameEngine(createInitialState(data.staff), data);
}

function withSeed(seed, callback) {
  const originalRandom = Math.random;
  let value = seed >>> 0;
  Math.random = () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
  try {
    return callback();
  } finally {
    Math.random = originalRandom;
  }
}

function bestChoiceIndex(engine) {
  const event = engine.getEvent(engine.state.currentEventId);
  if (event.sceneObjective) {
    const objective = engine.completeSceneObjective(event.sceneObjective.targetId);
    assert(objective.completed || objective.alreadyComplete, `事件 ${event.id} 場景目標無法完成`);
  }
  const meters = engine.state.meters;
  const weights = {
    quality: meters.quality < 35 ? 10 : 3,
    morale: meters.morale < 35 ? 12 : 3,
    family: meters.family < 35 ? 10 : 2,
    compliance: meters.compliance < 35 ? 12 : 3,
    budget: meters.budget < 45 ? 20 : 6,
    stress: meters.stress > 65 ? -12 : -5
  };
  let best = null;
  event.choices.forEach((choice, index) => {
    if (!engine.choiceAvailability(choice).ok) return;
    let score = Object.entries(choice.effect || {}).reduce(
      (sum, [key, delta]) => sum + (weights[key] || 0) * delta,
      0
    );
    if (choice.followUp) score -= 12;
    if (choice.npcEffect?.loyalty < 0) score += choice.npcEffect.loyalty * 2;
    if (choice.npcEffect?.stamina < 0) score += choice.npcEffect.stamina;
    if (!best || score > best.score) best = { index, score };
  });
  assert(best, `事件 ${event.id} 沒有可選選項`);
  return best.index;
}

function playThirtyDays(seed) {
  return withSeed(seed, () => {
    const engine = makeEngine();
    engine.beginDay();
    let guard = 0;
    while (engine.state.phase !== "ended" && guard < 1000) {
      guard += 1;
      while (engine.state.phase === "events") {
        const result = engine.choose(bestChoiceIndex(engine));
        assert(!result?.error, result?.error || "事件選擇失敗");
        if (result.ending) break;
      }
      if (engine.state.phase === "ended") break;
      if (engine.state.ap > 0) {
        const result = engine.performAction("go_home");
        assert(!result?.error, result?.error || "準時下班失敗");
        if (result.ending) break;
      }
      if (engine.state.phase === "ended") break;
      const result = engine.endDay();
      if (result.ending) break;
      engine.beginDay();
    }
    assert(guard < 1000, "遊戲流程卡在無限迴圈");
    return engine.state;
  });
}

test("data files have valid references and supported fields", () => {
  const meterKeys = new Set(["quality", "morale", "family", "compliance", "budget", "stress"]);
  const eventIds = new Set();
  const staffIds = new Set(data.staff.staff.map(item => item.id));
  const roles = new Set(data.staff.staff.map(item => item.role));
  const actionIds = new Set(data.actions.map(item => item.id));
  const visitorIds = new Set(data.scene.visitors.map(item => item.id));
  const sceneTargetIds = new Set([
    ...data.scene.hotspots.map(item => item.id),
    ...data.scene.visitors.map(item => item.id),
    ...data.staff.staff.map(item => item.id)
  ]);

  assert(data.staff.staff.length === 6, `預期 6 位 NPC，實際 ${data.staff.staff.length}`);
  assert(data.staff.interactions.length >= 3, "NPC 至少需要三種可執行互動");
  for (const interaction of data.staff.interactions) {
    assert(interaction.id && interaction.label && interaction.result && interaction.bubble, "NPC 互動資料不完整");
    assert(Number.isInteger(interaction.ap) && interaction.ap > 0, `${interaction.id} AP 無效`);
  }
  assert(data.staff.manager?.name && data.staff.manager?.role, "護理長顯示資料不完整");
  for (const mood of ["happy", "normal", "tired", "burning"]) {
    assert(data.staff.manager.thoughts?.[mood], `護理長缺少 ${mood} 心聲`);
  }
  for (const [key, assetPath] of Object.entries(data.staff.visuals || {})) {
    assert(assetPath.startsWith("./assets/"), `${key} 必須使用 assets/ 相對路徑`);
    assert(existsSync(new URL(`../${assetPath.slice(2)}`, import.meta.url)), `${key} 素材不存在：${assetPath}`);
  }
  assert(Object.keys(data.staff.visuals || {}).length >= 5, "場景、護理長與同仁的原版及像素素材路徑必須齊全");
  assert(existsSync(new URL(`../${data.scene.visuals.visitorSprite.slice(2)}`, import.meta.url)), "訪客人物素材不存在");
  assert(existsSync(new URL(`../${data.scene.visuals.floorMap.slice(2)}`, import.meta.url)), "大型像素樓層素材不存在");
  assert(data.scene.visitors.length === 3, "應有主任、督導與衛生局稽查員三位訪客");
  assert(data.scene.hotspots.length >= 6, "護理站至少需要六個可互動物件");
  assert(Number.isFinite(data.scene.controls?.speed) && data.scene.controls.speed > 0, "街機移動速度無效");
  assert(Number.isFinite(data.scene.controls?.interactionRadius) && data.scene.controls.interactionRadius > 0, "街機互動距離無效");
  assert(Number.isFinite(data.scene.controls?.worldScale) && data.scene.controls.worldScale > 1, "大型地圖縮放比例無效");
  assert(Array.isArray(data.scene.controls?.obstacles) && data.scene.controls.obstacles.length > 0, "場景碰撞區未設定");
  assert(Number.isFinite(data.scene.controls?.start?.x) && Number.isFinite(data.scene.controls?.start?.y), "護理長起始位置無效");
  for (const hotspot of data.scene.hotspots) {
    assert(actionIds.has(hotspot.actionId), `${hotspot.id} 指向不存在的行動 ${hotspot.actionId}`);
    assert(Number.isFinite(hotspot.x) && Number.isFinite(hotspot.y), `${hotspot.id} 缺少場景座標`);
  }

  const spriteRows = new Set();
  for (const npc of data.staff.staff) {
    assert(Number.isInteger(npc.spriteRow) && npc.spriteRow >= 0, `${npc.id} spriteRow 無效`);
    spriteRows.add(npc.spriteRow);
    assert(Number.isFinite(npc.scene?.x) && npc.scene.x >= 0 && npc.scene.x <= 100, `${npc.id} 場景 x 無效`);
    assert(Number.isFinite(npc.scene?.y) && npc.scene.y >= 0 && npc.scene.y <= 100, `${npc.id} 場景 y 無效`);
    assert(Number.isFinite(npc.scene?.scale) && npc.scene.scale > 0, `${npc.id} 場景 scale 無效`);
    assert(Number.isFinite(npc.scene?.motionX) && Number.isFinite(npc.scene?.motionY), `${npc.id} 缺少移動路徑`);
    for (const mood of ["happy", "worried", "tired", "quit"]) {
      assert(npc.thoughts?.[mood], `${npc.id} 缺少 ${mood} 心聲`);
    }
  }
  assert(spriteRows.size === data.staff.staff.length, "NPC spriteRow 不可重複");

  assert(data.events.length >= 27, `預期至少 27 張事件，實際 ${data.events.length}`);
  for (const requiredId of ["director_rounding", "supervisor_record_review", "director_budget_meeting", "meeting_marathon", "audit_visit"]) {
    assert(data.events.some(event => event.id === requiredId), `缺少擬真管理事件 ${requiredId}`);
  }
  for (const event of data.events) {
    assert(event.id && !eventIds.has(event.id), `事件 id 重複或空白：${event.id}`);
    eventIds.add(event.id);
    assert(["daily", "crisis", "followup"].includes(event.type), `${event.id} type 不支援`);
    assert(event.title && event.text, `${event.id} 缺標題或內文`);
    if (event.actor) assert(visitorIds.has(event.actor), `${event.id} 指向不存在訪客 ${event.actor}`);
    if (event.sceneObjective) {
      assert(sceneTargetIds.has(event.sceneObjective.targetId), `${event.id} 場景目標不存在：${event.sceneObjective.targetId}`);
      assert(event.sceneObjective.label && event.sceneObjective.completeText, `${event.id} 場景目標文字不完整`);
    }
    assert(Array.isArray(event.choices) && event.choices.length >= 2, `${event.id} 至少需要兩個選項`);
    for (const choice of event.choices) {
      assert(choice.label && choice.result, `${event.id} 有選項缺 label/result`);
      for (const [key, value] of Object.entries(choice.effect || {})) {
        assert(meterKeys.has(key) && Number.isFinite(value), `${event.id} 的效果 ${key} 無效`);
      }
      if (choice.requireAP != null) {
        assert(Number.isInteger(choice.requireAP) && choice.requireAP > 0, `${event.id} requireAP 無效`);
      }
      if (choice.npcEffect?.npcId) assert(staffIds.has(choice.npcEffect.npcId), `${event.id} 指向不存在 NPC`);
      if (choice.npcEffect?.role) assert(roles.has(choice.npcEffect.role), `${event.id} 指向不存在角色類型`);
    }
  }

  for (const event of data.events) {
    for (const choice of event.choices) {
      if (!choice.followUp) continue;
      const target = data.events.find(item => item.id === choice.followUp.id);
      assert(target, `${event.id} follow-up ${choice.followUp.id} 不存在`);
      assert(target.type === "followup", `${event.id} follow-up 指向非 followup 事件`);
      assert(Number.isInteger(choice.followUp.delay) && choice.followUp.delay > 0, `${event.id} follow-up delay 無效`);
    }
  }

  const quitFollowUp = data.staff.settings.quitFollowUp;
  assert(eventIds.has(quitFollowUp.id), "離職 follow-up 不存在");
  assert(data.events.find(item => item.id === quitFollowUp.id)?.type === "followup", "離職 follow-up 類型錯誤");

  for (const fortune of data.fortunes) {
    if (fortune.modifier?.action) assert(actionIds.has(fortune.modifier.action), `運勢指向不存在行動 ${fortune.modifier.action}`);
  }
});

test("sound preference toggles and persists without requiring audio support", () => {
  const audio = new GameAudio();
  assert(audio.isEnabled(), "音效預設應開啟");
  assert(audio.toggle() === false, "第一次切換應關閉音效");
  assert(localStorage.getItem("nurseSim.sound.v1") === "off", "關閉音效設定未保存");
  assert(audio.toggle() === true, "第二次切換應開啟音效");
  assert(localStorage.getItem("nurseSim.sound.v1") === "on", "開啟音效設定未保存");
});

test("manager and NPC visual moods follow meter thresholds", () => {
  assert(managerMood(0) === "happy" && managerMood(29) === "happy", "壓力 0–29 應為開心");
  assert(managerMood(30) === "normal" && managerMood(49) === "normal", "壓力 30–49 應為普通");
  assert(managerMood(50) === "tired" && managerMood(79) === "tired", "壓力 50–79 應為疲累");
  assert(managerMood(80) === "burning" && managerMood(99) === "burning", "壓力 80–99 應為燃燒中");

  assert(npcMood({ stamina: 70, loyalty: 70 }) === "happy", "體力與忠誠正常應為開心");
  assert(npcMood({ stamina: 39, loyalty: 70 }) === "tired", "體力低於 40 應為疲累");
  assert(npcMood({ stamina: 70, loyalty: 54 }) === "worried", "忠誠低於 55 應為動搖");
  assert(npcMood({ stamina: 90, loyalty: 90, quit: true }) === "quit", "離職狀態應優先顯示");
});

test("arcade movement normalizes diagonals, respects bounds, and finds nearby targets", () => {
  const controls = data.scene.controls;
  const straight = moveScenePosition({ x: 60, y: 82 }, { x: 1, y: 0 }, 1, controls);
  const diagonal = moveScenePosition({ x: 60, y: 82 }, { x: 1, y: 1 }, 0.25, controls);
  assert(straight.x === 80 && straight.y === 82, "水平移動速度錯誤");
  assert(diagonal.x < 65 && diagonal.y > 82, "斜向移動應正規化且同時改變兩軸");
  const bounded = moveScenePosition({ x: 91, y: 83 }, { x: 1, y: 1 }, 1, controls);
  assert(bounded.x === controls.bounds.xMax && bounded.y === controls.bounds.yMax, "人物未限制在場景邊界內");
  const blocked = moveScenePosition({ x: 29, y: 50 }, { x: 1, y: 0 }, 1, controls);
  assert(blocked.x === 29, "人物應被護理站碰撞區擋住");
  const nearby = findNearestSceneTarget(
    { x: 50, y: 50 },
    [{ id: "far", x: 80, y: 80 }, { id: "near", x: 55, y: 52 }],
    controls.interactionRadius
  );
  assert(nearby?.id === "near", "沒有選到最近的互動目標");
  assert(findNearestSceneTarget({ x: 5, y: 5 }, [{ id: "far", x: 80, y: 80 }], 3) === null, "距離外目標不應可互動");
});

test("NPC interactions spend AP, change relationship, and cannot repeat on the same day", () => {
  const engine = makeEngine();
  engine.beginDay();
  const before = engine.state.staff.find(npc => npc.id === "npc_meimei");
  const outcome = engine.interactWithNpc("npc_meimei", "check_in");
  assert(!outcome.error, outcome.error || "NPC 互動失敗");
  assert(engine.state.ap === 4, "NPC 互動應扣除 1 AP");
  assert(before.loyalty === 71 && before.stamina === 73, "NPC 忠誠或體力變化錯誤");
  assert(engine.state.meters.morale === 63 && engine.state.meters.stress === 32, "NPC 互動指標變化錯誤");
  assert(outcome.bubble === "謝謝你先問我。", "NPC 場景反應文字錯誤");
  assert(engine.interactWithNpc("npc_meimei", "check_in").error === "今天已經做過了", "同日重複互動未被阻止");
  assert(engine.state.log.some(item => item.type === "npcInteraction"), "NPC 互動未寫入日誌");
});

test("scene objectives block choices until the player reaches the data-driven target", () => {
  const engine = makeEngine();
  engine.state.day = 4;
  engine.state.phase = "events";
  engine.state.currentEventId = "boss_report";
  const choice = engine.getEvent("boss_report").choices[0];
  assert(engine.choiceAvailability(choice).reason === "先完成場景探索", "尚未探索時事件選項未鎖定");
  assert(!engine.completeSceneObjective("phone").completed, "錯誤場景目標不應完成任務");
  const outcome = engine.completeSceneObjective("computer");
  assert(outcome.completed, "正確場景目標未完成任務");
  assert(engine.sceneObjectiveStatus().complete, "場景目標完成狀態未保存");
  assert(engine.choiceAvailability(choice).ok, "完成探索後事件選項仍被鎖定");
  assert(engine.state.log.some(item => item.type === "sceneObjective" && item.targetId === "computer"), "場景探索未寫入日誌");

  engine.state.day = 5;
  assert(!engine.sceneObjectiveStatus().complete, "場景目標應依天數重新執行");
});

test("days 1-5 draw one event and stress 80 reduces AP to 3", () => {
  const engine = makeEngine();
  engine.state.meters.stress = 80;
  const result = withSeed(1, () => engine.beginDay());
  assert(!result.ending, "不應在壓力 80 直接結束");
  assert(engine.state.maxAp === 3 && engine.state.ap === 3, "燃燒中 AP 應為 3");
  assert(engine.state.currentEventId && engine.state.eventQueue.length === 0, "第 1 天應抽一張事件");
});

test("deck respects daily counts, crisis timing, recent history, and oneShot", () => {
  const engine = makeEngine();
  const state = engine.state;
  state.day = 6;
  assert(withSeed(1, () => drawDailyEvents(data.events, state)).length === 2, "第 6 天後低點數應抽兩張事件");
  assert(withSeed(1000, () => drawDailyEvents(data.events, state)).length === 1, "第 6 天後高點數應抽一張事件");

  state.day = 7;
  for (let seed = 1; seed <= 200; seed += 1) {
    const event = withSeed(seed, () => weightedDraw(data.events, state));
    assert(event?.type !== "crisis", "第 8 天前抽到 crisis");
  }
  state.day = 8;
  const crisisSeen = withSeed(1, () =>
    Array.from({ length: 300 }, () => weightedDraw(data.events, state))
      .some(event => event?.type === "crisis")
  );
  assert(crisisSeen, "第 8 天後 crisis 未進入牌池");

  const repeatable = data.events.find(event => event.id === "boss_report");
  state.day = 14;
  state.seenEvents = [{ id: repeatable.id, day: 10 }];
  assert(weightedDraw([repeatable], state) === null, "5 天內仍可抽到同事件");
  state.day = 15;
  assert(weightedDraw([repeatable], state)?.id === repeatable.id, "滿 5 天後事件未回牌池");

  const oneShot = data.events.find(event => event.id === "washer_broken");
  state.day = 20;
  state.seenEvents = [{ id: oneShot.id, day: 1 }];
  assert(weightedDraw([oneShot], state) === null, "oneShot 事件重複出現");
});

test("event requireAP and action AP rules work", () => {
  const engine = makeEngine();
  engine.state.day = 10;
  engine.state.phase = "events";
  engine.state.currentEventId = "new_admission";
  engine.state.ap = 0;
  assert(!engine.choiceAvailability(engine.getEvent("new_admission").choices[2]).ok, "0 AP 不可選 requireAP 選項");
  engine.state.ap = 1;
  const result = engine.choose(2);
  assert(!result.error && engine.state.ap === 0, "requireAP 應正確扣除 1 AP");

  engine.state.phase = "actions";
  engine.state.ap = 5;
  const first = engine.performAction("schedule_loose");
  assert(!first.error && engine.state.ap === 3, "2 AP 行動扣點錯誤");
  assert(!engine.actionAvailability(engine.getAction("schedule_tight")).ok, "互斥排班仍可執行");
});

test("repeat action multiplier only reduces the configured effect", () => {
  const engine = makeEngine();
  engine.state.phase = "actions";
  engine.state.ap = 5;
  engine.state.meters.morale = 50;
  engine.state.meters.budget = 60;
  engine.performAction("order_drinks");
  engine.performAction("order_drinks");
  assert(engine.state.meters.morale === 68, `第二杯後士氣應為 68，實際 ${engine.state.meters.morale}`);
  assert(engine.state.meters.budget === 44, "兩次飲料都應各扣 8 預算");
  assert(engine.state.stats.drinkCount === 2, "飲料次數統計錯誤");
});

test("follow-up is queued for the correct future day", () => {
  const engine = makeEngine();
  engine.state.day = 5;
  engine.state.phase = "events";
  engine.state.currentEventId = "staff_sick_01";
  engine.choose(2);
  assert(engine.state.pendingEvents.some(item => item.eventId === "fall_after_shortstaff" && item.triggerDay === 8), "延遲事件日期錯誤");
  assert(engine.state.stats.bombsPlanted === 1, "延遲事件統計錯誤");
});

test("due follow-ups have priority and do not replace the random daily draw", () => {
  const engine = makeEngine();
  engine.state.day = 10;
  engine.state.pendingEvents = [{ eventId: "audit_deficiency", triggerDay: 10 }];
  withSeed(2, () => engine.beginDay());
  assert(engine.state.currentEventId === "audit_deficiency", "到期 follow-up 未優先顯示");
  assert(engine.state.eventQueue.length >= 1, "follow-up 錯誤占用了隨機事件名額");
});

test("due follow-ups re-check their NPC conditions", () => {
  const conditionalEvent = {
    id: "conditional_followup_test",
    title: "條件式後續事件",
    text: "只用於測試到期事件條件。",
    tags: ["測試"],
    type: "followup",
    weight: 0,
    oneShot: false,
    condition: { hasNpcRole: "照服員" },
    choices: [
      { label: "選項一", result: "完成。", effect: {} },
      { label: "選項二", result: "完成。", effect: {} }
    ]
  };
  const engine = new GameEngine(createInitialState(data.staff), {
    ...data,
    events: [...data.events, conditionalEvent]
  });
  engine.state.day = 6;
  engine.state.staff.forEach(npc => {
    if (npc.role === "照服員") npc.quit = true;
  });
  engine.state.pendingEvents = [{ eventId: conditionalEvent.id, triggerDay: 6 }];
  withSeed(2, () => engine.beginDay());
  const queued = [engine.state.currentEventId, ...engine.state.eventQueue];
  assert(!queued.includes(conditionalEvent.id), "條件不符的到期 follow-up 仍然出現");
});

test("recruitment can clear shortage after every caregiver has left", () => {
  const engine = makeEngine();
  engine.state.staffShortage = true;
  engine.state.staff.forEach(npc => {
    if (npc.role === "照服員") npc.quit = true;
  });
  engine.state.phase = "events";
  engine.state.currentEventId = "quit_chain";
  assert(!engine.choiceAvailability(engine.getEvent("quit_chain").choices[0]).ok, "無照服員時仍可選照服員對談");
  assert(engine.choiceAvailability(engine.getEvent("quit_chain").choices[2]).ok, "無照服員時招募選項不可用");
  const result = engine.choose(2);
  assert(!result.error && !engine.state.staffShortage, "招募後未清除人力缺口");
});

test("low loyalty causes next-morning resignation and shortage penalty", () => {
  const engine = makeEngine();
  const npc = engine.state.staff[0];
  npc.loyalty = 10;
  markPendingQuits(engine.state, data.staff.settings);
  assert(engine.state.pendingQuits.includes(npc.id), "低忠誠 NPC 未排入離職");
  engine.state.day = 2;
  const quitters = processMorningQuits(engine.state, data.staff.settings);
  assert(quitters.length === 1 && npc.quit, "隔日離職未執行");
  assert(engine.state.staffShortage, "離職後未標記人力缺口");
  assert(engine.state.stats.quitCount === 1, "離職人數統計錯誤");
  assert(engine.state.pendingEvents.some(item => item.eventId === "quit_chain" && item.triggerDay === 6), "離職後續事件日期錯誤");

  const before = engine.state.meters.quality;
  engine.state.phase = "actions";
  engine.state.ap = 0;
  engine.endDay();
  assert(engine.state.meters.quality === before - 2, "人力缺口每日品質 -2 未生效");
});

test("low stamina is recorded before end-of-day recovery", () => {
  const engine = makeEngine();
  const npc = engine.state.staff[0];
  npc.stamina = 14;
  engine.state.phase = "actions";
  engine.state.ap = 0;
  engine.endDay();
  assert(engine.state.pendingQuits.includes(npc.id), "低體力 NPC 被每日恢復錯誤地救回離職門檻外");
  assert(npc.stamina === 19, "每日體力恢復仍應正常執行");
});

test("general and game-end achievements unlock and persist", () => {
  const engine = makeEngine();
  engine.state.stats.drinkCount = 10;
  engine.updateAchievements("any");
  assert(loadAchievements().includes("budget_killer"), "一般成就未解鎖");
  engine.state.stats.chatCount = 0;
  engine.updateAchievements("gameEnd");
  assert(loadAchievements().includes("who_are_you"), "結局成就未解鎖");
});

test("all 12 achievement rules can be evaluated", () => {
  const setters = {
    iron_nurse: state => { state.stats.noGoHomeStreak = 7; },
    budget_killer: state => { state.stats.drinkCount = 10; },
    paper_master: state => { state.meters.compliance = 95; },
    who_are_you: state => { state.stats.chatCount = 0; },
    empty_nest: state => { state.stats.quitCount = 3; },
    firefighter: state => { state.stats.crisisHandledToday = 2; },
    procrastinator: state => { state.stats.bombsPlanted = 5; },
    still_here: state => { state.day = 30; state.meters.stress = 39; },
    one_thousand_nine: state => { state.stats.minFamily = 29; },
    perfect_paper: state => { state.evaluationScore = 90; state.meters.morale = 29; },
    human: state => { state.stats.chatCount = 10; },
    all_ap_spent: state => { state.stats.allAPSpentStreak = 10; }
  };
  for (const achievement of data.achievements) {
    memoryStorage.clear();
    const engine = makeEngine();
    assert(setters[achievement.id], `缺少成就測試資料：${achievement.id}`);
    setters[achievement.id](engine.state);
    engine.updateAchievements(achievement.when || "any");
    assert(loadAchievements().includes(achievement.id), `成就規則無法解鎖：${achievement.id}`);
  }
});

test("save data round-trips through localStorage", () => {
  const engine = makeEngine();
  engine.state.day = 12;
  engine.state.phase = "actions";
  engine.state.ap = 3;
  engine.persist();
  const saved = loadSave();
  assert(saved.day === 12 && saved.phase === "actions" && saved.ap === 3, "存檔讀回內容不一致");
});

test("all immediate endings and day-30 evaluation resolve", () => {
  const cases = [
    ["burnout", "stress", 100],
    ["bankrupt", "budget", 0],
    ["mutiny", "morale", 14]
  ];
  for (const [endingId, meter, value] of cases) {
    const engine = makeEngine();
    engine.state.meters[meter] = value;
    const ending = engine.checkEnding(false);
    assert(ending?.id === endingId, `${endingId} 即死結局未觸發`);
  }

  const engine = makeEngine();
  engine.state.day = 30;
  engine.state.phase = "actions";
  engine.state.ap = 0;
  engine.state.meters = { quality: 90, morale: 90, family: 90, compliance: 90, budget: 90, stress: 20 };
  const result = engine.endDay();
  assert(result.ending?.id === "true_ending", `第 30 天預期優等，實際 ${result.ending?.id}`);
  assert(engine.state.evaluationScore === 90, `評鑑分數預期 90，實際 ${engine.state.evaluationScore}`);
  assert(engine.state.phase === "ended" && engine.state.day === 30, "第 30 天結局狀態錯誤");

  const day30Cases = [
    ["paper_excellence", 90, 70],
    ["true_ending", 90, 69],
    ["pass", 75, 30],
    ["improve", 69, 30]
  ];
  for (const [endingId, score, stress] of day30Cases) {
    const endingEngine = makeEngine();
    endingEngine.state.evaluationScore = score;
    endingEngine.state.meters.stress = stress;
    const ending = endingEngine.checkEnding(true);
    assert(ending?.id === endingId, `${endingId} 第 30 天結局未觸發`);
  }
});

test("seeded normal-play simulations can complete all 30 days", () => {
  const results = Array.from({ length: 100 }, (_, index) => playThirtyDays(index + 1));
  const completed = results.filter(state => state.day === 30 && state.phase === "ended");
  const summary = results.reduce((counts, state) => {
    const key = `${state.endingId || "unfinished"}@${state.day}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  assert(
    completed.length === results.length,
    `${results.length} 局中只有 ${completed.length} 局完成 30 天；${JSON.stringify(summary)}`
  );
  assert(completed.every(state => state.evaluationScore != null), "完成 30 天後缺少評鑑分數");
});

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}.`);
