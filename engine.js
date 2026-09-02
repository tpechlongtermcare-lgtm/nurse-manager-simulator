import { applyEffects, applyStatDelta, evaluateRule, clamp } from "./effects.js";
import { drawDailyEvents, passesChoiceCondition, resolveEvent, weightedDraw } from "./deck.js";
import { applyNpcEffect, markPendingQuits, processMorningQuits, recoverStaff } from "./staff.js";
import { saveGame, loadAchievements, saveAchievements } from "./state.js";

export class GameEngine {
  constructor(state, data) {
    this.state = state;
    this.data = data;
    this.staffSettings = data.staff.settings;
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

  choiceAvailability(choice) {
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
    return { result: resultText, changes: meterChanges, npc, ending };
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

  endDay() {
    const s = this.state;
    s.phase = "settlement";

    applyEffects(s, { stress: 3 });
    if (s.endedByGoHome && s.abandonedAP > 0) applyEffects(s, { stress: -8 });

    recoverStaff(s, this.staffSettings);
    markPendingQuits(s, this.staffSettings);

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
