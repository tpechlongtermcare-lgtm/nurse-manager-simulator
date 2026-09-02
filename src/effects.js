export const METER_KEYS = ["quality", "morale", "family", "compliance", "budget", "stress"];

export function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function applyEffects(state, effects = {}) {
  const changes = {};
  for (const [key, delta] of Object.entries(effects)) {
    if (!METER_KEYS.includes(key) || typeof delta !== "number") continue;
    const before = state.meters[key];
    state.meters[key] = clamp(before + delta);
    changes[key] = state.meters[key] - before;
  }
  state.stats.minFamily = Math.min(state.stats.minFamily ?? 100, state.meters.family);
  return changes;
}

export function applyStatDelta(state, delta = {}) {
  for (const [key, amount] of Object.entries(delta)) {
    if (typeof amount !== "number") continue;
    state.stats[key] = (state.stats[key] ?? 0) + amount;
  }
}

export function getPath(object, path) {
  return String(path).split(".").reduce((acc, key) => acc?.[key], object);
}

export function compare(actual, op, expected) {
  if (actual === undefined || actual === null) return false;
  switch (op) {
    case ">": return actual > expected;
    case ">=": return actual >= expected;
    case "<": return actual < expected;
    case "<=": return actual <= expected;
    case "=":
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    default: return false;
  }
}

export function evaluateRule(rule, state) {
  if (!rule) return true;
  if (Array.isArray(rule.all)) return rule.all.every(item => evaluateRule(item, state));
  if (Array.isArray(rule.any)) return rule.any.some(item => evaluateRule(item, state));
  if (rule.path && rule.op) return compare(getPath(state, rule.path), rule.op, rule.value);
  return false;
}

export function parseComparator(expression) {
  if (typeof expression === "number") return { op: "=", value: expression };
  const match = String(expression).trim().match(/^(<=|>=|!=|=|<|>)\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  return { op: match[1], value: Number(match[2]) };
}
