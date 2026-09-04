export const SAVE_KEY = "nurseSim.save.v1";
export const ACHIEVEMENT_KEY = "nurseSim.achievements.v1";

export function createInitialState(staffData) {
  return {
    version: 1,
    day: 1,
    phase: "dawn",
    ap: 5,
    maxAp: 5,
    meters: { quality: 60, morale: 60, family: 60, compliance: 60, budget: 60, stress: 30 },
    staff: structuredClone(staffData.staff),
    staffShortage: false,
    pendingQuits: [],
    pendingEvents: [],
    seenEvents: [],
    eventQueue: [],
    currentEventId: null,
    actionsToday: [],
    actionCountsToday: {},
    npcInteractionsToday: {},
    endedByGoHome: false,
    abandonedAP: 0,
    fortune: null,
    evaluationScore: null,
    endingId: null,
    stats: {
      chatCount: 0,
      drinkCount: 0,
      goHomeCount: 0,
      noGoHomeStreak: 0,
      bombsPlanted: 0,
      quitCount: 0,
      crisisHandledToday: 0,
      allAPSpentStreak: 0,
      minFamily: 60,
      maxPending: 0,
      daysCompleted: 0
    },
    unlockedThisRun: [],
    log: []
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveGame(state) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}

export function loadAchievements() {
  try {
    return JSON.parse(localStorage.getItem(ACHIEVEMENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveAchievements(ids) {
  localStorage.setItem(ACHIEVEMENT_KEY, JSON.stringify([...new Set(ids)]));
}
