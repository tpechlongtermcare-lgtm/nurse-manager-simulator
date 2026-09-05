import { compare, parseComparator } from "./effects.js?v=3.0.0";

const RESERVED = new Set(["minDay", "maxDay", "hasNpcRole", "hasNpcId", "notSeen"]);

export function activeStaff(state, role = null) {
  const pool = state.staff.filter(npc => !npc.quit);
  return role ? pool.filter(npc => npc.role === role) : pool;
}

export function passesCondition(condition = {}, state) {
  if (!condition) return true;
  if (condition.minDay != null && state.day < condition.minDay) return false;
  if (condition.maxDay != null && state.day > condition.maxDay) return false;
  if (condition.hasNpcRole && activeStaff(state, condition.hasNpcRole).length === 0) return false;
  if (condition.hasNpcId && !activeStaff(state).some(npc => npc.id === condition.hasNpcId)) return false;
  if (condition.notSeen && state.seenEvents.some(item => item.id === condition.notSeen)) return false;

  for (const [key, expression] of Object.entries(condition)) {
    if (RESERVED.has(key)) continue;
    if (!(key in state.meters)) continue;
    const parsed = parseComparator(expression);
    if (!parsed || !compare(state.meters[key], parsed.op, parsed.value)) return false;
  }
  return true;
}

export function passesChoiceCondition(choice, state) {
  return passesCondition(choice.condition || {}, state);
}

function seenRecently(state, id, withinDays = 5) {
  return state.seenEvents.some(item => item.id === id && state.day - item.day < withinDays);
}

function eligibleRandomEvents(events, state, { requiredTag = null, excludedIds = [] } = {}) {
  return events.filter(event => {
    if (event.type === "followup") return false;
    if (event.type === "crisis" && state.day < 8) return false;
    if (event.oneShot && state.seenEvents.some(item => item.id === event.id)) return false;
    if (seenRecently(state, event.id, 5)) return false;
    if (excludedIds.includes(event.id)) return false;
    if (requiredTag && !event.tags?.includes(requiredTag)) return false;
    return passesCondition(event.condition, state);
  });
}

export function weightedDraw(events, state, options = {}) {
  const pool = eligibleRandomEvents(events, state, options);
  if (!pool.length) return null;
  const total = pool.reduce((sum, event) => sum + Math.max(0, event.weight ?? 10), 0);
  if (total <= 0) return pool[Math.floor(Math.random() * pool.length)];
  let roll = Math.random() * total;
  for (const event of pool) {
    roll -= Math.max(0, event.weight ?? 10);
    if (roll <= 0) return event;
  }
  return pool.at(-1);
}

export function drawDailyEvents(events, state) {
  const count = state.day <= 5 ? 1 : (Math.random() < 0.6 ? 2 : 1);
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    const event = weightedDraw(events, state, { excludedIds: chosen.map(item => item.id) });
    if (event) chosen.push(event);
  }
  return chosen;
}

function replaceNpcPlaceholders(value, state, memo) {
  if (typeof value !== "string") return value;
  return value.replace(/\{\{npc:([^}]+)\}\}/g, (_, role) => {
    if (!memo[role]) {
      const pool = activeStaff(state, role);
      memo[role] = pool.length ? pool[Math.floor(Math.random() * pool.length)].name : role;
    }
    return memo[role];
  });
}

export function resolveEvent(event, state) {
  const clone = structuredClone(event);
  const memo = {};
  clone.title = replaceNpcPlaceholders(clone.title, state, memo);
  clone.subtitle = replaceNpcPlaceholders(clone.subtitle, state, memo);
  clone.text = replaceNpcPlaceholders(clone.text, state, memo);
  clone.choices = clone.choices.map(choice => ({
    ...choice,
    label: replaceNpcPlaceholders(choice.label, state, memo),
    result: replaceNpcPlaceholders(choice.result, state, memo)
  }));
  return clone;
}
