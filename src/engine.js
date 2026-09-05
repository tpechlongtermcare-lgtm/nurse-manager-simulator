import { applyEffects, applyStatDelta, evaluateRule, clamp } from "./effects.js?v=3.0.0";
import { drawDailyEvents, passesChoiceCondition, passesCondition, resolveEvent, weightedDraw } from "./deck.js?v=3.0.0";
import { applyNpcEffect, markPendingQuits, processMorningQuits, recoverStaff } from "./staff.js?v=3.0.0";
import { saveGame, loadAchievements, saveAchievements } from "./state.js?v=3.0.0";

export class GameEngine {
  constructor(state, data) {
    this.state = state;
    this.data = data;
    this.staffSettings = data.staff.settings;
    this.state.npcInteractionsToday ||= {};
    this.state.sceneObjectives ||= {};
  }

  getEvent(id) {
    return this.data.events.find(event => event.id === id) || null;
  }

  getAction(id) {
    return this.data.actions.find(action => action.id === id) || null;
  }

  maxAPForStress() {
    return this.state.meters.stress >= 80 ? 3 : 5;
  }

  beginDay() {
    const s = this.state;
    s.phase = "dawn";
    s.maxAp = this.maxAPForStress();
    s.ap = s.maxAp;
    s.actionsToday = [];
    s.actionCountsToday = {};
    s.npcInteractionsToday = {};
    s.endedByGoHome = false;
    s.abandonedAP = 0;
    s.stats.crisisHandledToday = 0;
    s.fortune = structuredClone(this.data.fortunes[Math.floor(Math.random() * this.data.fortunes.length)]);

    const quitters = processMorningQuits(s, this.staffSettings);
    if (quitters.length) {
      s.log.push({ day: s.day, type: "staffQuit", names: quitters.map(npc => npc.name) });
    }

    const morningEnding = this.checkEnding(false);
    if (morningEnding) {
      this.persist();
      return { quitters, ending: morningEnding };
    }

    const due = s.pendingEvents
      .filter(item => item.triggerDay <= s.day)
      .sort((a, b) => a.triggerDay - b.triggerDay);
    s.pendingEvents = s.pendingEvents.filter(item => item.triggerDay > s.day);

    const dueIds = [];
    for (const item of due) {
      const event = this.getEvent(item.eventId);
      if (!event) continue;
      if (event.oneShot && s.seenEvents.some(seen => seen.id === event.id)) continue;
      if (!passesCondition(event.condition, s)) continue;
      dueIds.push(event.id);
    }

    const randomEvents = drawDailyEvents(this.data.events, s);
    s.eventQueue = [...dueIds, ...randomEvents.map(event => event.id)];
    s.currentEventId = s.eventQueue.shift() || null;
    s.phase = s.currentEventId ? "events" : "actions";
    this.updateAchievements("any");
    this.persist();
    return { quitters, ending: null };
  }

  currentEvent() {
    const event = this.getEvent(this.state.currentEventId);
    return event ? resolveEvent(event, this.state) : null;
  }

  sceneObjectiveStatus(eventId = this.state.currentEventId) {
    const event = this.getEvent(eventId);
    const objective = event?.sceneObjective;
    if (!objective) return { required: false, complete: true, objective: null };
    const key = `${this.state.day}:${event.id}`;
    return { required: true, complete: Boolean(this.state.sceneObjectives[key]), objective, key };
  }

  completeSceneObjective(targetId) {
    const event = this.getEvent(this.state.currentEventId);
    if (!event?.sceneObjective || event.sceneObjective.targetId !== targetId) return { completed: false };
    const status = this.sceneObjectiveStatus(event.id);
    if (status.complete) return { completed: false, alreadyComplete: true };
    this.state.sceneObjectives[status.key] = true;
    this.state.log.push({
      day: this.state.day,
      type: "sceneObjective",
      eventId: event.id,
      targetId,
      result: event.sceneObjective.completeText
    });
    this.persist();
    return {
      completed: true,
      eventId: event.id,
      targetId,
      message: event.sceneObjective.completeText || "現場資訊已確認。"
    };
  }

  choiceAvailability(choice) {
    const objective = this.sceneObjectiveStatus();
    if (objective.required && !objective.complete) return { ok: false, reason: "先完成場景探索" };
    if (!passesChoiceCondition(choice, this.state)) return { ok: false, reason: "目前條件不符" };
    if (choice.requireAP && this.state.ap < choice.requireAP) return { ok: false, reason: `需要 ${choice.requireAP} AP` };
    return { ok: true, reason: "" };
  }

  choose(choiceIndex) {
    const rawEvent = this.getEvent(this.state.currentEventId);
    if (!rawEvent) return null;
    const choice = rawEvent.choices[choiceIndex];
    if (!choice) return null;
    const availability = this.choiceAvailability(choice);
    if (!availability.ok) return { error: availability.reason };

    if (choice.requireAP) this.state.ap = Math.max(0, this.state.ap - choice.requireAP);
    const meterChanges = applyEffects(this.state, choice.effect);
    const npc = choice.npcEffect ? applyNpcEffect(this.state, choice.npcEffect) : null;

    if (choice.followUp?.id) {
      this.state.pendingEvents.push({
        eventId: choice.followUp.id,
        triggerDay: this.state.day + (choice.followUp.delay ?? 1)
      });
      this.state.stats.bombsPlanted += 1;
      this.state.stats.maxPending = Math.max(this.state.stats.maxPending, this.state.pendingEvents.length);
    }

    if (choice.clearShortage) this.state.staffShortage = false;
    if (choice.achievement) this.unlockAchievement(choice.achievement);
    if (rawEvent.type === "crisis") this.state.stats.crisisHandledToday += 1;

    if (!this.state.seenEvents.some(item => item.id === rawEvent.id && item.day === this.state.day)) {
      this.state.seenEvents.push({ id: rawEvent.id, day: this.state.day });
    }

    this.state.log.push({
      day: this.state.day,
      type: "event",
      eventId: rawEvent.id,
      title: rawEvent.title,
      choice: choice.label,
      result: choice.result,
      changes: meterChanges,
      npc: npc?.name || null
    });

    const resultText = resolveEvent({ ...rawEvent, choices: [choice] }, this.state).choices[0].result;
    this.state.currentEventId = this.state.eventQueue.shift() || null;
    if (!this.state.currentEventId) this.state.phase = "actions";

    this.updateAchievements("any");
    const ending = this.checkEnding(false);
    this.persist();
    return { result: resultText, changes: meterChanges, npc, followUp: choice.followUp || null, ending };
  }

  actionAvailability(action) {
    const count = this.state.actionCountsToday[action.id] || 0;
    if (action.oncePerDay && count > 0) return { ok: false, reason: "今天做過了" };
    if (action.exclusiveGroup) {
      const conflict = this.data.actions.find(other =>
        other.id !== action.id &&
        other.exclusiveGroup === action.exclusiveGroup &&
        (this.state.actionCountsToday[other.id] || 0) > 0
      );
      if (conflict) return { ok: false, reason: `與「${conflict.name}」互斥` };
    }
    if (action.ap !== "all" && this.state.ap < action.ap) return { ok: false, reason: `需要 ${action.ap} AP` };
    if (action.ap === "all" && this.state.ap <= 0) return { ok: false, reason: "今天已沒有 AP" };
    return { ok: true, reason: "" };
  }

  performAction(actionId) {
    const action = this.getAction(actionId);
    if (!action) return null;
    const availability = this.actionAvailability(action);
    if (!availability.ok) return { error: availability.reason };

    const countBefore = this.state.actionCountsToday[action.id] || 0;
    const applied = structuredClone(action.effect || {});
    if (countBefore > 0 && action.repeatEffectMultiplier) {
      for (const [meter, multiplier] of Object.entries(action.repeatEffectMultiplier)) {
        if (typeof applied[meter] === "number") applied[meter] *= multiplier;
      }
    }

    if (this.state.fortune?.modifier?.action === action.id && this.state.fortune.modifier.bonus) {
      const positiveKeys = Object.keys(applied).filter(key => key !== "stress" && applied[key] > 0);
      if (positiveKeys.length) {
        const target = positiveKeys.sort((a, b) => applied[b] - applied[a])[0];
        applied[target] += this.state.fortune.modifier.bonus;
      } else if (applied.stress < 0) {
        applied.stress -= this.state.fortune.modifier.bonus;
      }
    }

    let spent = 0;
    if (action.ap === "all") {
      this.state.abandonedAP = action.abandonRemainingAP ? this.state.ap : 0;
      spent = this.state.ap;
      this.state.ap = 0;
    } else {
      spent = action.ap;
      this.state.ap -= action.ap;
    }

    const changes = applyEffects(this.state, applied);
    applyStatDelta(this.state, action.statDelta);
    this.state.actionCountsToday[action.id] = countBefore + 1;
    this.state.actionsToday.push(action.id);
    if (action.endDay) {
      this.state.endedByGoHome = true;
      this.state.stats.goHomeCount += 1;
    }

    this.state.log.push({ day: this.state.day, type: "action", actionId, name: action.name, changes, ap: spent });

    let hiddenEvent = null;
    if (action.hiddenDraw && Math.random() < action.hiddenDraw.chance) {
      const drawn = weightedDraw(this.data.events, this.state, { requiredTag: action.hiddenDraw.tag });
      if (drawn) {
        this.state.eventQueue.unshift(...(this.state.currentEventId ? [this.state.currentEventId] : []));
        this.state.currentEventId = drawn.id;
        this.state.phase = "events";
        hiddenEvent = drawn.id;
      }
    }

    this.updateAchievements("any");
    const ending = this.checkEnding(false);
    this.persist();
    return { changes, hiddenEvent, ending, endDay: Boolean(action.endDay) };
  }

  npcInteractionAvailability(npcId, interaction) {
    const npc = this.state.staff.find(item => item.id === npcId);
    if (!npc || npc.quit) return { ok: false, reason: "這位同仁已不在班上" };
    if (!interaction) return { ok: false, reason: "互動不存在" };
    const key = `${npcId}:${interaction.id}`;
    if (interaction.oncePerNpcPerDay && this.state.npcInteractionsToday[key]) {
      return { ok: false, reason: "今天已經做過了" };
    }
    if (this.state.ap < interaction.ap) return { ok: false, reason: `需要 ${interaction.ap} AP` };
    return { ok: true, reason: "" };
  }

  interactWithNpc(npcId, interactionId) {
    const interaction = (this.data.staff.interactions || []).find(item => item.id === interactionId);
    const availability = this.npcInteractionAvailability(npcId, interaction);
    if (!availability.ok) return { error: availability.reason };
    const npcBefore = this.state.staff.find(item => item.id === npcId);
    this.state.ap -= interaction.ap;
    const changes = applyEffects(this.state, interaction.effect);
    const npc = applyNpcEffect(this.state, { npcId, ...(interaction.npcEffect || {}) });
    const key = `${npcId}:${interaction.id}`;
    this.state.npcInteractionsToday[key] = true;
    this.state.actionsToday.push(`npc:${interaction.id}:${npcId}`);
    const result = String(interaction.result || "").replaceAll("{{name}}", npcBefore?.name || "同仁");
    this.state.log.push({
      day: this.state.day,
      type: "npcInteraction",
      npcId,
      interactionId,
      result,
      changes,
      npcChanges: interaction.npcEffect || {},
      ap: interaction.ap
    });
    this.updateAchievements("any");
    const ending = this.checkEnding(false);
    this.persist();
    const bubble = String(interaction.bubble || "").replaceAll("{{name}}", npcBefore?.name || "同仁");
    return { result, bubble, changes, npc, npcChanges: interaction.npcEffect || {}, reaction: interaction.reaction, sound: interaction.sound, ending };
  }

  endDay() {
    const s = this.state;
    s.phase = "settlement";

    applyEffects(s, { stress: 3 });
    if (s.endedByGoHome && s.abandonedAP > 0) applyEffects(s, { stress: -8 });

    markPendingQuits(s, this.staffSettings);
    recoverStaff(s, this.staffSettings);

    if (s.staffShortage) {
      applyEffects(s, { quality: this.staffSettings.shortageQualityDailyEffect ?? -2 });
    }

    if ([7, 14, 21, 28].includes(s.day)) {
      applyEffects(s, { morale: -5, budget: -10 });
      s.log.push({ day: s.day, type: "weekly", text: "週結算" });
    }

    s.stats.daysCompleted += 1;
    if (s.endedByGoHome) s.stats.noGoHomeStreak = 0;
    else s.stats.noGoHomeStreak += 1;

    if (s.ap === 0 && !s.endedByGoHome) s.stats.allAPSpentStreak += 1;
    else s.stats.allAPSpentStreak = 0;

    this.updateAchievements("any");
    let ending = this.checkEnding(false);

    if (!ending && s.day >= 30) {
      s.evaluationScore = Math.round((
        s.meters.quality * 0.35 +
        s.meters.compliance * 0.35 +
        s.meters.family * 0.20 +
        s.meters.morale * 0.10
      ) * 10) / 10;
      this.updateAchievements("gameEnd");
      ending = this.checkEnding(true);
    }

    if (!ending) {
      s.day += 1;
      s.phase = "dawn";
      s.currentEventId = null;
      s.eventQueue = [];
    }

    this.persist();
    return { ending };
  }

  checkEnding(isDay30) {
    if (!isDay30) {
      const immediateIds = new Set(["burnout", "bankrupt", "mutiny"]);
      const ending = this.data.endings.find(item => immediateIds.has(item.id) && evaluateRule(item.condition, this.state));
      if (ending) return this.finish(ending.id);
      return null;
    }
    const ending = this.data.endings.find(item => evaluateRule(item.condition, this.state));
    return ending ? this.finish(ending.id) : null;
  }

  finish(id) {
    this.state.endingId = id;
    this.state.phase = "ended";
    this.updateAchievements("gameEnd");
    this.persist();
    return this.data.endings.find(item => item.id === id) || null;
  }

  unlockAchievement(id) {
    const allUnlocked = loadAchievements();
    if (!allUnlocked.includes(id)) {
      allUnlocked.push(id);
      saveAchievements(allUnlocked);
      if (!this.state.unlockedThisRun.includes(id)) this.state.unlockedThisRun.push(id);
      return true;
    }
    return false;
  }

  updateAchievements(when = "any") {
    for (const achievement of this.data.achievements) {
      if (achievement.when && achievement.when !== when) continue;
      if (!achievement.when && when === "gameEnd") {
        // also re-check general achievements at game end
      }
      const rule = achievement.all ? { all: achievement.all } : achievement.condition;
      if (evaluateRule(rule, this.state)) this.unlockAchievement(achievement.id);
    }
  }

  persist() {
    saveGame(this.state);
  }
}
