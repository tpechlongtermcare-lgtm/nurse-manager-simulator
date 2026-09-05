import { clamp } from "./effects.js?v=2.3.4";

function pickNpc(state, effect) {
  const active = state.staff.filter(npc => !npc.quit);
  if (effect.npcId) return active.find(npc => npc.id === effect.npcId) || null;
  const pool = effect.role ? active.filter(npc => npc.role === effect.role) : active;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

export function applyNpcEffect(state, npcEffect = {}) {
  const npc = pickNpc(state, npcEffect);
  if (!npc) return null;
  if (typeof npcEffect.loyalty === "number") npc.loyalty = clamp(npc.loyalty + npcEffect.loyalty);
  if (typeof npcEffect.stamina === "number") npc.stamina = clamp(npc.stamina + npcEffect.stamina);
  return npc;
}

export function recoverStaff(state, settings) {
  for (const npc of state.staff) {
    if (npc.quit) continue;
    npc.stamina = clamp(npc.stamina + (settings.dailyStaminaRecovery ?? 5));
  }
}

export function markPendingQuits(state, settings) {
  const loyaltyBelow = settings.quitThresholds?.loyaltyBelow ?? 20;
  const staminaBelow = settings.quitThresholds?.staminaBelow ?? 15;
  for (const npc of state.staff) {
    if (npc.quit || state.pendingQuits.includes(npc.id)) continue;
    if (npc.loyalty < loyaltyBelow || npc.stamina < staminaBelow) {
      state.pendingQuits.push(npc.id);
    }
  }
}

export function processMorningQuits(state, settings) {
  const quitters = [];
  for (const npcId of state.pendingQuits) {
    const npc = state.staff.find(item => item.id === npcId);
    if (!npc || npc.quit) continue;
    npc.quit = true;
    npc.quitDay = state.day;
    quitters.push(npc);
    state.stats.quitCount += 1;
  }
  state.pendingQuits = [];

  if (quitters.length) {
    state.staffShortage = true;
    state.meters.morale = clamp(state.meters.morale + (settings.quitMoraleEffect ?? -12) * quitters.length);
    const followUp = settings.quitFollowUp;
    if (followUp?.id) {
      state.pendingEvents.push({ eventId: followUp.id, triggerDay: state.day + (followUp.delay ?? 4) });
      state.stats.bombsPlanted += 1;
    }
  }
  return quitters;
}
