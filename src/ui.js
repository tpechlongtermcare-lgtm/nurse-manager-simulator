import { loadAchievements } from "./state.js?v=3.0.0";

const METER_LABELS = {
  quality: "品質",
  morale: "士氣",
  family: "家屬",
  compliance: "法規",
  budget: "預算",
  stress: "壓力"
};

function esc(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDelta(changes = {}) {
  return Object.entries(changes)
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => ({ key, label: METER_LABELS[key] || key, value }));
}

const NPC_MOOD_LABELS = {
  happy: "狀態不錯",
  worried: "有點動搖",
  tired: "體力見底",
  quit: "已經離職"
};

export function managerMood(stress) {
  if (stress < 30) return "happy";
  if (stress < 50) return "normal";
  if (stress < 80) return "tired";
  return "burning";
}

export function npcMood(npc) {
  if (npc.quit) return "quit";
  if (npc.stamina < 40) return "tired";
  if (npc.loyalty < 55) return "worried";
  return "happy";
}

export function moveScenePosition(position, input, elapsedSeconds, controls = {}) {
  const bounds = controls.bounds || {};
  const xMin = Number.isFinite(bounds.xMin) ? bounds.xMin : 6;
  const xMax = Number.isFinite(bounds.xMax) ? bounds.xMax : 94;
  const yMin = Number.isFinite(bounds.yMin) ? bounds.yMin : 12;
  const yMax = Number.isFinite(bounds.yMax) ? bounds.yMax : 88;
  const speed = Number.isFinite(controls.speed) ? controls.speed : 27;
  const verticalSpeed = Number.isFinite(controls.verticalSpeed) ? controls.verticalSpeed : 1.3;
  const length = Math.hypot(input.x || 0, input.y || 0);
  if (!length || elapsedSeconds <= 0) return { ...position };
  const unitX = input.x / Math.max(1, length);
  const unitY = input.y / Math.max(1, length);
  const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
  const target = {
    x: clampValue(position.x + unitX * speed * elapsedSeconds, xMin, xMax),
    y: clampValue(position.y + unitY * speed * verticalSpeed * elapsedSeconds, yMin, yMax)
  };
  const radius = Number.isFinite(controls.collisionRadius) ? controls.collisionRadius : 0;
  const blocked = point => (controls.obstacles || []).some(obstacle => (
    point.x + radius > obstacle.x
      && point.x - radius < obstacle.x + obstacle.width
      && point.y + radius > obstacle.y
      && point.y - radius < obstacle.y + obstacle.height
  ));
  if (!blocked(target)) return target;
  const horizontal = { x: target.x, y: position.y };
  if (!blocked(horizontal)) return horizontal;
  const vertical = { x: position.x, y: target.y };
  if (!blocked(vertical)) return vertical;
  return { ...position };
}

export function findNearestSceneTarget(position, targets, radius = 14) {
  let nearest = null;
  for (const target of targets) {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
    const distance = Math.hypot(target.x - position.x, (target.y - position.y) * 2 / 3);
    if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { ...target, distance };
  }
  return nearest;
}

export class GameUI {
  constructor(root, data, callbacks) {
    this.root = root;
    this.data = data;
    this.callbacks = callbacks;
    this.previousMeters = null;
    this.sceneControllerCleanup = null;
    this.controlledEngine = null;
    this.playerPosition = null;
  }

  renderHome(hasSave = false) {
    this.stopSceneController();
    const unlocked = loadAchievements();
    const soundOn = this.callbacks.isSoundEnabled?.() !== false;
    this.root.className = "app-shell";
    this.root.innerHTML = `
      <main class="home">
        <section class="home-paper page-flip">
          <div class="home-mark-row">
            <div class="life-mark" aria-hidden="true"></div>
            <div class="home-folio">交班紀錄・第 01 冊</div>
          </div>
          <div class="eyebrow">台灣長照護理長人生模擬器</div>
          <div class="home-context">46 床住宿長照機構・30 天生存紀錄</div>
          <h1>護理長模擬器<br>今天也沒有標準答案</h1>
          <p class="lead">你有 30 天、每天 5 個行動點，和永遠不夠用的人。品質、士氣、家屬、法規、預算都有人在看。最後那條壓力，通常只有你自己知道。</p>
          <div class="home-stats" aria-label="遊戲概要">
            <span><strong>30</strong> 天</span>
            <span><strong>5</strong> AP</span>
            <span><strong>6</strong> 位同仁</span>
          </div>
          <div class="premise">事情做不完不是 bug。<br>那是核心玩法。</div>
          <div class="home-actions">
            ${hasSave ? `<button class="primary-btn" id="continueGame">繼續翻昨天那本交班本</button>` : ""}
            <button class="${hasSave ? "secondary-btn" : "primary-btn"}" id="newGame">${hasSave ? "重新開始一個月" : "第一天，先去交班"}</button>
            <button class="secondary-btn" id="showAchievements">成就總覽　${unlocked.length} / ${this.data.achievements.length}</button>
            <button class="secondary-btn sound-home-btn" id="soundToggleHome" aria-pressed="${soundOn}">聲音：${soundOn ? "開" : "關"}</button>
          </div>
          <p class="disclaimer">本作品為虛構情境，所有人物、事件與機構均非真實。</p>
          <p class="copyright">© 鄭瑞賢 製作・版權所有</p>
        </section>
      </main>`;

    this.root.querySelector("#continueGame")?.addEventListener("click", this.callbacks.onContinue);
    this.root.querySelector("#newGame")?.addEventListener("click", this.callbacks.onNewGame);
    this.root.querySelector("#showAchievements")?.addEventListener("click", () => this.showAchievements());
    this.root.querySelector("#soundToggleHome")?.addEventListener("click", this.callbacks.onSoundToggle);
  }

  renderGame(engine) {
    this.stopSceneController();
    const state = engine.state;
    const burning = state.meters.stress >= 80;
    this.root.className = `app-shell ${burning ? "burning" : ""}`;
    const activeCount = state.staff.filter(npc => !npc.quit).length;
    const meterOrder = ["quality", "morale", "family", "compliance", "budget"];
    const event = engine.currentEvent();
    const staffViews = this.getStaffViews(state);
    const soundOn = this.callbacks.isSoundEnabled?.() !== false;

    this.root.innerHTML = `
      <main class="game">
        <section class="top-sheet">
          <div class="day-line">
            <div class="day-block">
              <div class="day-label">第 ${state.day} 天 <span>/ 30</span></div>
              <div class="day-progress" role="progressbar" aria-label="30 天進度" aria-valuemin="1" aria-valuemax="30" aria-valuenow="${state.day}">
                <span style="width:${state.day / 30 * 100}%"></span>
              </div>
            </div>
            <div class="ap-panel">
              <span class="ap-caption">今日 AP</span>
              <div class="ap-dots" aria-label="剩餘 ${state.ap} 行動點">${this.renderAP(state)}</div>
            </div>
          </div>
          <div class="fortune">宜：${esc(state.fortune?.good || "平安")}　　忌：${esc(state.fortune?.bad || "多事")}</div>
          <div class="meters">
            ${meterOrder.map(key => this.renderMeter(key, state.meters[key])).join("")}
          </div>
        </section>

        <div class="game-main">
          <div class="world-layout">
            ${this.renderScene(engine, staffViews, event)}
            <div class="play-column">
              <div class="status-strip">
                <span class="team-status ${state.staffShortage ? "shortage" : ""}"><i aria-hidden="true"></i>在職 ${activeCount} / ${state.staff.length}${state.staffShortage ? "・人力缺口中" : ""}</span>
                <nav aria-label="遊戲選單">
                  <button id="staffBtn">名冊</button>
                  <button id="achievementBtn">成就</button>
                  <button id="soundBtn" class="sound-btn" aria-label="${soundOn ? "關閉聲音" : "開啟聲音"}" aria-pressed="${soundOn}"><span aria-hidden="true">音</span></button>
                  <button id="homeBtn">首頁</button>
                </nav>
              </div>
              ${this.renderBurden(state)}
              ${state.phase === "events" && event ? this.renderEvent(engine, event) : this.renderActions(engine)}
            </div>
          </div>
        </div>

        <section class="stress-dock" aria-label="你的壓力">
          <div class="stress-inner">
            <div class="stress-label">你的壓力</div>
            <div class="stress-track"><div class="stress-fill" data-meter="stress" style="width:${state.meters.stress}%"></div></div>
            <div class="stress-value" data-meter-value="stress">${state.meters.stress}</div>
            <div class="stress-status">${state.meters.stress < 40 ? "尚可呼吸" : state.meters.stress < 80 ? "開始透支" : "燃燒中"}</div>
          </div>
        </section>
      </main>
      <div class="rotate-device" role="status">
        <span aria-hidden="true">↻</span><strong>請將手機轉為橫向</strong><small>橫向才能探索完整機構樓層</small>
      </div>`;

    this.bindGameEvents(engine);
    this.applySceneAssets();
    this.startSceneController(engine);
    this.animateMeterChanges(state.meters);
    this.previousMeters = structuredClone(state.meters);
  }

  renderAP(state) {
    return Array.from({ length: 5 }, (_, index) => {
      const slot = index + 1;
      const locked = slot > state.maxAp;
      const active = slot <= state.ap;
      return `<span class="ap-dot ${active ? "used" : ""}" style="${locked ? "opacity:.25" : ""}" aria-hidden="true"></span>`;
    }).join("");
  }

  getStaffViews(state) {
    const definitions = new Map((this.data.staff?.staff || []).map(npc => [npc.id, npc]));
    return state.staff.map((npc, index) => {
      const definition = definitions.get(npc.id) || {};
      return {
        ...definition,
        ...npc,
        spriteRow: definition.spriteRow ?? npc.spriteRow ?? index,
        scene: { ...(definition.scene || {}), ...(npc.scene || {}) },
        thoughts: { ...(definition.thoughts || {}), ...(npc.thoughts || {}) }
      };
    });
  }

  getEventVisitor(event) {
    if (!event?.actor) return null;
    return (this.data.scene?.visitors || []).find(visitor => visitor.id === event.actor) || null;
  }

  renderScene(engine, staffViews, event) {
    const state = engine.state;
    const visuals = this.data.staff?.visuals || {};
    const manager = this.data.staff?.manager || { name: "你", role: "護理長", thoughts: {} };
    const mood = managerMood(state.meters.stress);
    const managerThought = manager.thoughts?.[mood] || "先處理眼前這件。";
    const visitor = this.getEventVisitor(event);
    const floorMap = this.data.scene?.visuals?.floorMap || visuals.sceneImage || "";

    return `
      <section class="sim-scene" aria-label="護理站人物場景">
        <div class="world-layer" data-world>
        <img class="scene-background" src="${esc(floorMap)}" alt="可自由探索的台灣長照機構像素樓層，包含護理站、住民房、會議室、辦公室與餐廳">
        <div class="scene-shade" aria-hidden="true"></div>
        ${(this.data.scene?.hotspots || []).map(hotspot => {
          const action = engine.getAction(hotspot.actionId);
          const availability = action ? engine.actionAvailability(action) : { ok: false, reason: "目前無法使用" };
          return `<button class="scene-hotspot ${availability.ok ? "" : "unavailable"}" data-hotspot="${esc(hotspot.id)}" data-scene-target="hotspot" data-target-x="${Number(hotspot.x) || 50}" data-target-y="${Number(hotspot.y) || 50}" data-target-label="${esc(hotspot.label)}" style="--hotspot-x:${Number(hotspot.x) || 50}%;--hotspot-y:${Number(hotspot.y) || 50}%" aria-label="操作${esc(hotspot.label)}${availability.ok ? "" : `，${esc(availability.reason)}`}">
            <span aria-hidden="true">${esc(hotspot.glyph || "＋")}</span><em>${esc(hotspot.label)}</em>
          </button>`;
        }).join("")}
        <button class="manager-figure manager-${mood} player-controlled" data-manager aria-label="你正在控制${esc(manager.role)}；點擊查看狀態">
          ${visitor ? "" : `<div class="manager-thought">${esc(managerThought)}</div>`}
          <div class="manager-sprite" aria-hidden="true"></div>
          <div class="manager-label"><strong>${esc(manager.name)}</strong><span>${esc(manager.role)}</span></div>
        </button>
        ${staffViews.map((npc, index) => {
          const moodName = npcMood(npc);
          const x = Number.isFinite(Number(npc.scene?.x)) ? Number(npc.scene.x) : 12 + index * 14;
          const y = Number.isFinite(Number(npc.scene?.y)) ? Number(npc.scene.y) : 25 + index % 2 * 40;
          const scale = Number.isFinite(Number(npc.scene?.scale)) ? Number(npc.scene.scale) : 1;
          const motionX = Number.isFinite(Number(npc.scene?.motionX)) ? Number(npc.scene.motionX) : 0;
          const motionY = Number.isFinite(Number(npc.scene?.motionY)) ? Number(npc.scene.motionY) : -2;
          const spriteRow = Math.max(0, Math.min(5, Number(npc.spriteRow) || 0));
          return `<button class="npc-figure mood-${moodName}" data-npc="${esc(npc.id)}" data-scene-target="npc" data-target-x="${x}" data-target-y="${y}" data-target-label="${esc(npc.name)}" style="--scene-x:${x}%;--scene-y:${y}%;--scene-scale:${scale};--sprite-y:${spriteRow * 20}%;--idle-delay:${index * -0.73}s;--idle-duration:${3.2 + index * .27}s;--roam-x:${motionX}px;--roam-y:${motionY}px" aria-label="${esc(npc.name)}，${esc(npc.role)}，${esc(NPC_MOOD_LABELS[moodName])}">
            <span class="npc-sprite" aria-hidden="true"></span>
            <span class="npc-name">${esc(npc.name)}</span>
            <span class="npc-state-dot" aria-hidden="true"></span>
          </button>`;
        }).join("")}
        ${visitor ? `<button class="visitor-figure" data-visitor="${esc(visitor.id)}" data-scene-target="visitor" data-target-x="${Number(visitor.scene?.x) || 84}" data-target-y="${Number(visitor.scene?.y) || 45}" data-target-label="${esc(visitor.name)}" style="--visitor-x:${Number(visitor.scene?.x) || 84}%;--visitor-y:${Number(visitor.scene?.y) || 45}%;--visitor-scale:${Number(visitor.scene?.scale) || 1};--visitor-sprite-x:${Math.max(0, Math.min(2, Number(visitor.spriteColumn) || 0)) * 50}%" aria-label="${esc(visitor.name)}，${esc(visitor.role)}">
          <span class="visitor-line">${esc(event.actorLine || visitor.defaultLine)}</span>
          <span class="visitor-sprite" aria-hidden="true"></span>
          <span class="visitor-name">${esc(visitor.name)}</span>
        </button>` : ""}
        </div>
        <div class="arcade-key-hint"><strong>你正在控制護理長</strong><span>${esc(this.data.scene?.controls?.keyboard || "方向鍵／WASD")} 移動</span></div>
        <div class="scene-proximity" data-proximity aria-live="polite">靠近同仁或物件</div>
        <div class="arcade-controls" aria-label="人物移動控制器">
          <div class="virtual-stick" data-joystick role="application" tabindex="0" aria-label="拖曳虛擬搖桿移動護理長"><span data-joystick-knob></span></div>
          <button class="arcade-interact" data-arcade-interact disabled aria-label="尚未靠近可互動目標"><b>互動</b><kbd>${esc(this.data.scene?.controls?.interactKey || "E")}</kbd></button>
        </div>
      </section>`;
  }

  applySceneAssets() {
    const visuals = this.data.staff?.visuals || {};
    const managerSprite = this.root.querySelector(".manager-figure .manager-sprite");
    if (managerSprite && (visuals.managerWalkSprite || visuals.managerSprite)) {
      managerSprite.style.backgroundImage = `url("${visuals.managerWalkSprite || visuals.managerSprite}")`;
      managerSprite.classList.toggle("pixel-walk-sprite", Boolean(visuals.managerWalkSprite));
    }
    this.root.querySelectorAll(".npc-sprite").forEach(sprite => {
      if (visuals.staffWalkSprite || visuals.staffSprite) {
        sprite.style.backgroundImage = `url("${visuals.staffWalkSprite || visuals.staffSprite}")`;
        sprite.classList.toggle("pixel-npc-sprite", Boolean(visuals.staffWalkSprite));
      }
    });
    this.root.querySelectorAll(".visitor-sprite").forEach(sprite => {
      const visitorSprite = this.data.scene?.visuals?.visitorSprite;
      if (visitorSprite) sprite.style.backgroundImage = `url("${visitorSprite}")`;
    });
  }

  renderMeter(key, value) {
    return `
      <div class="meter-row" data-meter-row="${key}">
        <span>${METER_LABELS[key]}</span>
        <div class="meter-track" role="progressbar" aria-label="${METER_LABELS[key]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><div class="meter-fill" data-meter="${key}" style="width:${value}%"></div></div>
        <span class="meter-value" data-meter-value="${key}">${value}</span>
      </div>`;
  }

  renderBurden(state) {
    const unresolved = state.phase === "events" ? state.eventQueue.length + 1 : 0;
    const riskyStaff = state.staff.filter(npc => !npc.quit && (npc.stamina < 40 || npc.loyalty < 55)).length;
    const pending = state.pendingEvents.length;
    const reality = state.staffShortage
      ? "缺一個人，工作不會跟著少一份。"
      : state.meters.stress >= 80
        ? "你只剩 3 AP，但每個人仍把你當最後一道防線。"
        : pending > 0
          ? "今天處理完，不代表事情已經結束。"
          : "每花 1 AP 救一件事，就等於讓另一件事再等一下。";
    return `<aside class="burden-strip" aria-label="護理長同時承受的工作">
      <div class="burden-head"><strong>護理長腦內待辦</strong><span>${esc(reality)}</span></div>
      <div class="burden-counts">
        <span class="${unresolved ? "hot" : ""}">眼前事件 <b>${unresolved}</b></span>
        <span class="${pending ? "bomb" : ""}">延遲炸彈 <b>${pending}</b></span>
        <span class="${riskyStaff ? "risk" : ""}">人力風險 <b>${riskyStaff}</b></span>
      </div>
    </aside>`;
  }

  renderChoiceImpact(choice) {
    const impacts = formatDelta(choice.effect).map(item => {
      const risky = item.key === "stress" ? item.value > 0 : item.value < 0;
      return `<span class="choice-impact ${risky ? "risky" : "helpful"}">${esc(item.label)} ${item.value > 0 ? "↑" : "↓"}</span>`;
    });
    if (choice.requireAP) impacts.push(`<span class="choice-impact ap-cost">消耗 ${choice.requireAP} AP</span>`);
    if (choice.npcEffect) impacts.push(`<span class="choice-impact people">影響同仁</span>`);
    if (choice.followUp) impacts.push(`<span class="choice-impact bomb">可能留下後續</span>`);
    return impacts.join("");
  }

  renderEvent(engine, event) {
    const state = engine.state;
    const burning = state.meters.stress >= 80;
    const fatigue = state.meters.stress >= 50 && state.meters.stress < 80 && state.fortune?.fatigueAside;
    const visitor = this.getEventVisitor(event);
    const sceneObjective = engine.sceneObjectiveStatus(event.id);
    return `
      <article class="event-paper event-slip">
        <span class="paper-clip" aria-hidden="true"></span>
        <div class="event-meta">
          <div class="event-tags">
            ${(event.tags || []).map(tag => `<span class="event-tag ${event.type === "crisis" ? "crisis" : ""}">${esc(tag)}</span>`).join("")}
          </div>
          <span class="event-count">待處理 ${state.eventQueue.length + 1}</span>
        </div>
        ${visitor ? `<div class="event-visitor-card">
          <div class="event-visitor-portrait" style="--visitor-sprite-x:${Math.max(0, Math.min(2, Number(visitor.spriteColumn) || 0)) * 50}%"><span class="visitor-sprite" aria-hidden="true"></span></div>
          <div><strong>${esc(visitor.name)}</strong><span>${esc(visitor.role)}・${esc(visitor.trait)}</span></div>
        </div>` : ""}
        <h2>${esc(event.title)}</h2>
        ${event.subtitle ? `<p class="event-subtitle">${esc(event.subtitle)}</p>` : ""}
        <p class="event-text">${esc(event.text)}</p>
        ${fatigue ? `<p class="fatigue-aside">${esc(state.fortune.fatigueAside)}</p>` : ""}
        ${sceneObjective.required ? `<div class="scene-mission ${sceneObjective.complete ? "complete" : ""}" role="status">
          <span>${sceneObjective.complete ? "線索取得" : "場景探索"}</span>
          <strong>${esc(sceneObjective.complete ? sceneObjective.objective.completeText : sceneObjective.objective.label)}</strong>
          <small>${sceneObjective.complete ? "現在可以做決定了。" : "請控制護理長靠近目標，按互動鍵。"}</small>
        </div>` : ""}
        <div class="choice-list">
          ${event.choices.map((choice, index) => {
            const available = engine.choiceAvailability(choice);
            return `<button class="choice-btn" data-choice="${index}" ${available.ok ? "" : "disabled"}>
              <span class="choice-arrow" aria-hidden="true">↳</span>
              <span class="choice-copy">${esc(choice.label)}${burning ? "……" : ""}
                ${available.ok ? "" : `<span class="reason">${esc(available.reason)}</span>`}
                <span class="choice-impact-row">${this.renderChoiceImpact(choice)}</span>
              </span>
            </button>`;
          }).join("")}
        </div>
      </article>`;
  }

  renderActions(engine) {
    const state = engine.state;
    return `
      <section class="action-paper page-flip">
        <div class="action-head">
          <div>
            <h2>今天還能做什麼</h2>
            <small>剩餘 ${state.ap} AP。不要對這個數字有感情。</small>
          </div>
        </div>
        <div class="action-list">
          ${this.data.actions.filter(action => !action.sceneOnly).map(action => {
            const available = engine.actionAvailability(action);
            const cost = action.ap === "all" ? "全棄" : `${action.ap} AP`;
            return `<button class="action-btn ${action.endDay ? "go-home" : ""}" data-action="${esc(action.id)}" ${available.ok ? "" : "disabled"}>
              <span><strong>${esc(action.name)}</strong><span>${esc(action.desc)}${available.ok ? "" : ` ・ ${esc(available.reason)}`}</span></span>
              <span class="action-cost">${cost}</span>
            </button>`;
          }).join("")}
        </div>
        ${state.ap === 0 ? `<button class="primary-btn settle-btn" id="settleDay">收班結算</button>` : ""}
      </section>`;
  }

  bindGameEvents(engine) {
    const trySceneObjective = targetId => {
      const outcome = engine.completeSceneObjective(targetId);
      if (!outcome.completed) return false;
      this.callbacks.onSceneObjective?.(outcome);
      return true;
    };
    const activateSceneTarget = (button, fallback) => {
      if (!button.classList.contains("nearby")) {
        this.showProximityToast(button.dataset.targetLabel || "目標");
        return;
      }
      if (!trySceneObjective(button.dataset.npc || button.dataset.hotspot || button.dataset.visitor)) fallback();
    };

    this.root.querySelectorAll("[data-choice]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled || button.classList.contains("choice-committed")) return;
        this.callbacks.onUiCue?.("click");
        button.classList.add("choice-committed");
        button.closest(".choice-list")?.classList.add("choices-lock");
        this.root.querySelectorAll("[data-choice]").forEach(choice => { choice.disabled = true; });
        setTimeout(() => this.callbacks.onChoice(Number(button.dataset.choice)), 260);
      });
    });
    this.root.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", () => this.callbacks.onAction(button.dataset.action));
    });
    this.root.querySelector("#settleDay")?.addEventListener("click", this.callbacks.onSettle);
    this.root.querySelector("#staffBtn")?.addEventListener("click", () => this.showStaff(engine.state));
    this.root.querySelector("#achievementBtn")?.addEventListener("click", () => this.showAchievements());
    this.root.querySelector("#soundBtn")?.addEventListener("click", this.callbacks.onSoundToggle);
    this.root.querySelector("#homeBtn")?.addEventListener("click", this.callbacks.onHome);
    this.root.querySelectorAll("[data-npc]").forEach(button => {
      button.addEventListener("click", () => activateSceneTarget(button, () => this.showNpc(engine, button.dataset.npc)));
    });
    this.root.querySelector("[data-manager]")?.addEventListener("click", () => this.showManager(engine.state));
    this.root.querySelectorAll("[data-hotspot]").forEach(button => {
      button.addEventListener("click", () => activateSceneTarget(button, () => this.showSceneAction(engine, button.dataset.hotspot)));
    });
    this.root.querySelectorAll("[data-visitor]").forEach(button => {
      button.addEventListener("click", () => activateSceneTarget(button, () => this.showVisitor(engine.currentEvent(), button.dataset.visitor)));
    });
  }

  stopSceneController() {
    this.sceneControllerCleanup?.();
    this.sceneControllerCleanup = null;
  }

  startSceneController(engine) {
    const scene = this.root.querySelector(".sim-scene");
    const world = scene?.querySelector("[data-world]");
    const manager = scene?.querySelector("[data-manager]");
    const managerSprite = manager?.querySelector(".manager-sprite");
    const joystick = scene?.querySelector("[data-joystick]");
    const joystickKnob = scene?.querySelector("[data-joystick-knob]");
    const interactButton = scene?.querySelector("[data-arcade-interact]");
    const proximity = scene?.querySelector("[data-proximity]");
    if (!scene || !world || !manager || !joystick || !joystickKnob || !interactButton || !proximity) return;

    const controls = this.data.scene?.controls || {};
    const worldScale = Number.isFinite(controls.worldScale) ? controls.worldScale : 1;
    world.style.width = `${worldScale * 100}%`;
    world.style.height = `${worldScale * 100}%`;
    const start = controls.start || { x: 50, y: 50 };
    if (this.controlledEngine !== engine || !this.playerPosition) {
      this.controlledEngine = engine;
      this.playerPosition = {
        x: Number.isFinite(start.x) ? start.x : 50,
        y: Number.isFinite(start.y) ? start.y : 50
      };
    }

    const abortController = new AbortController();
    const signal = abortController.signal;
    const keys = new Set();
    const targets = [...scene.querySelectorAll("[data-scene-target]")].map(element => ({
      element,
      x: Number(element.dataset.targetX),
      y: Number(element.dataset.targetY),
      label: element.dataset.targetLabel || "現場目標",
      type: element.dataset.sceneTarget
    }));
    let joystickInput = { x: 0, y: 0 };
    let activePointer = null;
    let nearestTarget = null;
    let animationFrame = 0;
    let previousTime = performance.now();
    let lastStepAt = 0;
    let facingRow = 0;

    const updateCamera = () => {
      const worldWidth = world.offsetWidth;
      const worldHeight = world.offsetHeight;
      const desiredX = scene.clientWidth / 2 - this.playerPosition.x / 100 * worldWidth;
      const desiredY = scene.clientHeight / 2 - this.playerPosition.y / 100 * worldHeight;
      const cameraX = Math.max(scene.clientWidth - worldWidth, Math.min(0, desiredX));
      const cameraY = Math.max(scene.clientHeight - worldHeight, Math.min(0, desiredY));
      world.style.transform = `translate3d(${cameraX}px, ${cameraY}px, 0)`;
    };

    const setManagerPosition = () => {
      manager.style.left = `${this.playerPosition.x}%`;
      manager.style.top = `${this.playerPosition.y}%`;
      manager.style.zIndex = String(5 + Math.round(this.playerPosition.y / 25));
      updateCamera();
    };

    const updateWalkSprite = (input, moving, now) => {
      if (!managerSprite?.classList.contains("pixel-walk-sprite")) return;
      if (moving) {
        if (Math.abs(input.x) > Math.abs(input.y)) facingRow = input.x < 0 ? 1 : 2;
        else facingRow = input.y < 0 ? 3 : 0;
      }
      const frame = moving ? Math.floor(now / 135) % 4 : 0;
      managerSprite.style.backgroundPosition = `${frame * 100 / 3}% ${facingRow * 100 / 3}%`;
    };

    const updateProximity = () => {
      nearestTarget = findNearestSceneTarget(
        this.playerPosition,
        targets,
        Number.isFinite(controls.interactionRadius) ? controls.interactionRadius : 14
      );
      targets.forEach(target => target.element.classList.toggle("nearby", target.element === nearestTarget?.element));
      interactButton.disabled = !nearestTarget;
      if (nearestTarget) {
        proximity.textContent = `可以互動：${nearestTarget.label}`;
        proximity.classList.add("ready");
        interactButton.setAttribute("aria-label", `與${nearestTarget.label}互動`);
      } else {
        proximity.textContent = "靠近同仁或物件";
        proximity.classList.remove("ready", "need-near");
        interactButton.setAttribute("aria-label", "尚未靠近可互動目標");
      }
    };

    const activateNearest = () => {
      if (document.querySelector(".overlay")) return;
      if (!nearestTarget) {
        proximity.textContent = "再靠近一點才能互動";
        proximity.classList.add("need-near");
        this.callbacks.onUiCue?.("click");
        setTimeout(() => updateProximity(), 650);
        return;
      }
      this.callbacks.onUiCue?.("click");
      nearestTarget.element.click();
    };

    const movementInput = () => {
      let x = joystickInput.x;
      let y = joystickInput.y;
      if (keys.has("arrowleft") || keys.has("a")) x -= 1;
      if (keys.has("arrowright") || keys.has("d")) x += 1;
      if (keys.has("arrowup") || keys.has("w")) y -= 1;
      if (keys.has("arrowdown") || keys.has("s")) y += 1;
      return { x, y };
    };

    const onKeyDown = event => {
      const key = event.key.toLowerCase();
      const movementKeys = ["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"];
      if (movementKeys.includes(key)) {
        if (!document.querySelector(".overlay")) {
          if (!keys.has(key)) {
            const tapDirections = {
              arrowleft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
              arrowright: { x: 1, y: 0 }, d: { x: 1, y: 0 },
              arrowup: { x: 0, y: -1 }, w: { x: 0, y: -1 },
              arrowdown: { x: 0, y: 1 }, s: { x: 0, y: 1 }
            };
            this.playerPosition = moveScenePosition(this.playerPosition, tapDirections[key], 0.055, controls);
            if (tapDirections[key].x < 0) manager.classList.add("facing-left");
            if (tapDirections[key].x > 0) manager.classList.remove("facing-left");
            setManagerPosition();
            updateProximity();
          }
          keys.add(key);
          event.preventDefault();
        }
      } else if ((key === "e" || key === "enter") && !event.repeat && !document.querySelector(".overlay")) {
        event.preventDefault();
        activateNearest();
      }
    };
    const onKeyUp = event => keys.delete(event.key.toLowerCase());
    document.addEventListener("keydown", onKeyDown, { signal });
    document.addEventListener("keyup", onKeyUp, { signal });
    window.addEventListener("blur", () => keys.clear(), { signal });
    window.addEventListener("resize", updateCamera, { signal });

    const setJoystickFromPointer = event => {
      const rect = joystick.getBoundingClientRect();
      const max = rect.width * 0.31;
      let dx = event.clientX - (rect.left + rect.width / 2);
      let dy = event.clientY - (rect.top + rect.height / 2);
      const distance = Math.hypot(dx, dy);
      if (distance > max) {
        dx = dx / distance * max;
        dy = dy / distance * max;
      }
      joystickInput = { x: dx / max, y: dy / max };
      joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const releaseJoystick = event => {
      if (activePointer !== null && event.pointerId !== activePointer) return;
      activePointer = null;
      joystickInput = { x: 0, y: 0 };
      joystickKnob.style.transform = "translate(0, 0)";
      manager.classList.remove("is-moving");
    };
    joystick.addEventListener("pointerdown", event => {
      activePointer = event.pointerId;
      joystick.setPointerCapture?.(event.pointerId);
      setJoystickFromPointer(event);
      event.preventDefault();
    }, { signal });
    joystick.addEventListener("pointermove", event => {
      if (event.pointerId !== activePointer) return;
      setJoystickFromPointer(event);
      event.preventDefault();
    }, { signal });
    joystick.addEventListener("pointerup", releaseJoystick, { signal });
    joystick.addEventListener("pointercancel", releaseJoystick, { signal });
    interactButton.addEventListener("click", activateNearest, { signal });

    const tick = now => {
      const elapsed = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const input = movementInput();
      const moving = !document.querySelector(".overlay") && Math.hypot(input.x, input.y) > 0.08;
      manager.classList.toggle("is-moving", moving);
      updateWalkSprite(input, moving, now);
      if (moving) {
        this.playerPosition = moveScenePosition(this.playerPosition, input, elapsed, controls);
        if (input.x < -0.08) manager.classList.add("facing-left");
        if (input.x > 0.08) manager.classList.remove("facing-left");
        setManagerPosition();
        updateProximity();
        if (now >= lastStepAt + 310) {
          this.callbacks.onUiCue?.("step");
          lastStepAt = now;
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };

    setManagerPosition();
    updateProximity();
    animationFrame = requestAnimationFrame(tick);
    this.sceneControllerCleanup = () => {
      abortController.abort();
      cancelAnimationFrame(animationFrame);
    };
  }

  showManager(state) {
    const returnFocus = document.activeElement;
    const manager = this.data.staff?.manager || { name: "你", role: "護理長", thoughts: {} };
    const mood = managerMood(state.meters.stress);
    const moodLabels = { happy: "精神還行", normal: "表面正常", tired: "明顯疲累", burning: "燃燒中" };
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `<section class="overlay-paper manager-paper" role="dialog" aria-modal="true" aria-labelledby="managerTitle" tabindex="-1">
      <div class="manager-card-head">
        <div class="manager-card-sprite manager-${mood}"><span class="manager-sprite" aria-hidden="true"></span></div>
        <div><div class="eyebrow">${esc(manager.role)}本人</div><h2 id="managerTitle">${esc(manager.name)}</h2><strong>${esc(moodLabels[mood])}</strong></div>
      </div>
      <blockquote class="npc-thought-line">「${esc(manager.thoughts?.[mood] || "先處理眼前這件。") }」</blockquote>
      <div class="npc-detail-row"><span>壓力</span><div class="npc-detail-track stress"><i style="width:${state.meters.stress}%"></i></div><strong>${state.meters.stress}</strong></div>
      <p class="manager-hint">點護理站裡發光的物件，可以直接把 AP 花在現場工作上。</p>
      <button class="secondary-btn" id="closeManager">回到護理站</button>
    </section>`;
    document.body.appendChild(overlay);
    const sprite = overlay.querySelector(".manager-sprite");
    if (sprite && this.data.staff?.visuals?.managerSprite) sprite.style.backgroundImage = `url("${this.data.staff.visuals.managerSprite}")`;
    this.bindClosableOverlay(overlay, "#closeManager", returnFocus);
  }

  showSceneAction(engine, hotspotId) {
    const returnFocus = document.activeElement;
    const hotspot = (this.data.scene?.hotspots || []).find(item => item.id === hotspotId);
    const action = hotspot ? engine.getAction(hotspot.actionId) : null;
    if (!hotspot || !action) return;
    const availability = engine.actionAvailability(action);
    const deltas = formatDelta(action.effect);
    const cost = action.ap === "all" ? "剩餘全部 AP" : `${action.ap} AP`;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `<section class="overlay-paper scene-action-paper" role="dialog" aria-modal="true" aria-labelledby="sceneActionTitle" tabindex="-1">
      <div class="scene-action-head"><span aria-hidden="true">${esc(hotspot.glyph || "＋")}</span><div><div class="eyebrow">護理站互動</div><h2 id="sceneActionTitle">${esc(hotspot.label)}</h2></div></div>
      <p>${esc(hotspot.description)}</p>
      <div class="scene-action-name"><strong>${esc(action.name)}</strong><span>消耗 ${cost}</span></div>
      <div class="delta-line">${deltas.map(item => `<span class="delta-chip ${item.value > 0 ? "pos" : "neg"}">${esc(item.label)} ${item.value > 0 ? "+" : ""}${item.value}</span>`).join("")}</div>
      ${availability.ok ? "" : `<p class="scene-action-reason">${esc(availability.reason)}</p>`}
      <div class="dialog-actions"><button class="primary-btn" id="doSceneAction" ${availability.ok ? "" : "disabled"}>執行現場工作</button><button class="secondary-btn" id="cancelSceneAction">先不要</button></div>
    </section>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      returnFocus?.focus?.({ preventScroll: true });
    };
    overlay.querySelector("#cancelSceneAction").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelector("#doSceneAction")?.addEventListener("click", () => {
      overlay.remove();
      this.callbacks.onSceneAction(action.id, hotspot.sound);
    });
    overlay.querySelector(".scene-action-paper").focus({ preventScroll: true });
  }

  showVisitor(event, visitorId) {
    const returnFocus = document.activeElement;
    const visitor = (this.data.scene?.visitors || []).find(item => item.id === visitorId);
    if (!visitor) return;
    const column = Math.max(0, Math.min(2, Number(visitor.spriteColumn) || 0));
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `<section class="overlay-paper visitor-paper" role="dialog" aria-modal="true" aria-labelledby="visitorTitle" tabindex="-1">
      <div class="visitor-card-head"><div class="visitor-card-sprite" style="--visitor-sprite-x:${column * 50}%"><span class="visitor-sprite" aria-hidden="true"></span></div><div><div class="eyebrow">${esc(visitor.role)}</div><h2 id="visitorTitle">${esc(visitor.name)}</h2><strong>${esc(visitor.trait)}</strong></div></div>
      <p>${esc(visitor.description)}</p>
      <blockquote class="npc-thought-line">「${esc(event?.actorLine || visitor.defaultLine)}」</blockquote>
      <button class="secondary-btn" id="closeVisitor">繼續應付</button>
    </section>`;
    document.body.appendChild(overlay);
    const sprite = overlay.querySelector(".visitor-sprite");
    if (sprite && this.data.scene?.visuals?.visitorSprite) sprite.style.backgroundImage = `url("${this.data.scene.visuals.visitorSprite}")`;
    this.bindClosableOverlay(overlay, "#closeVisitor", returnFocus);
  }

  bindClosableOverlay(overlay, closeSelector, returnFocus) {
    const close = () => {
      overlay.remove();
      returnFocus?.focus?.({ preventScroll: true });
    };
    overlay.querySelector(closeSelector).addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelector(".overlay-paper").focus({ preventScroll: true });
  }

  showNpc(engine, npcId) {
    const state = engine.state;
    const returnFocus = document.activeElement;
    const npc = this.getStaffViews(state).find(item => item.id === npcId);
    if (!npc) return;
    const mood = npcMood(npc);
    const thought = npc.thoughts?.[mood] || npc.thoughts?.happy || "先把今天撐過去。";
    const spriteRow = Math.max(0, Math.min(5, Number(npc.spriteRow) || 0));
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper npc-paper" role="dialog" aria-modal="true" aria-labelledby="npcTitle" tabindex="-1">
        <div class="npc-card-head">
          <div class="npc-portrait mood-${mood}" style="--sprite-y:${spriteRow * 20}%"><div class="npc-sprite" aria-hidden="true"></div></div>
          <div>
            <div class="eyebrow">${esc(npc.role)}</div>
            <h2 id="npcTitle">${esc(npc.name)}</h2>
            <div class="npc-trait">${esc(npc.trait)}・${esc(NPC_MOOD_LABELS[mood])}</div>
          </div>
        </div>
        <p class="npc-trait-desc">${esc(npc.traitDesc)}</p>
        <blockquote class="npc-thought-line">「${esc(thought)}」</blockquote>
        <div class="npc-detail-bars">
          <div class="npc-detail-row"><span>體力</span><div class="npc-detail-track"><i style="width:${npc.stamina}%"></i></div><strong>${npc.stamina}</strong></div>
          <div class="npc-detail-row"><span>忠誠</span><div class="npc-detail-track loyalty"><i style="width:${npc.loyalty}%"></i></div><strong>${npc.loyalty}</strong></div>
        </div>
        <div class="npc-interaction-head"><strong>你要怎麼帶這位同仁？</strong><span>關係也會消耗 AP</span></div>
        <div class="npc-interaction-list">
          ${(this.data.staff?.interactions || []).map(interaction => {
            const availability = engine.npcInteractionAvailability(npc.id, interaction);
            const npcEffects = Object.entries(interaction.npcEffect || {}).map(([key, value]) => `<span class="${value >= 0 ? "pos" : "neg"}">${key === "stamina" ? "體力" : "忠誠"} ${value > 0 ? "+" : ""}${value}</span>`).join("");
            return `<button class="npc-interaction-btn" data-npc-interaction="${esc(interaction.id)}" ${availability.ok ? "" : "disabled"}>
              <span><strong>${esc(interaction.label)}</strong><small>${esc(interaction.description)}</small><em>${npcEffects}</em></span>
              <b>${interaction.ap} AP</b>
              ${availability.ok ? "" : `<i>${esc(availability.reason)}</i>`}
            </button>`;
          }).join("")}
        </div>
        <button class="secondary-btn" id="closeNpc">回到護理站</button>
      </section>`;
    document.body.appendChild(overlay);
    const sprite = overlay.querySelector(".npc-sprite");
    const staffSprite = this.data.staff?.visuals?.staffSprite;
    if (sprite && staffSprite) sprite.style.backgroundImage = `url("${staffSprite}")`;
    const close = () => {
      overlay.remove();
      returnFocus?.focus?.({ preventScroll: true });
    };
    overlay.querySelector("#closeNpc").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelectorAll("[data-npc-interaction]").forEach(button => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        overlay.remove();
        this.callbacks.onNpcInteraction(npc.id, button.dataset.npcInteraction);
      });
    });
    overlay.querySelector(".npc-paper").focus({ preventScroll: true });
  }

  showSceneReaction(npcId, text, reaction = "busy") {
    const figure = this.root.querySelector(`[data-npc="${CSS.escape(npcId)}"]`);
    if (!figure) return;
    figure.classList.add(`react-${reaction}`);
    const bubble = document.createElement("span");
    bubble.className = "scene-reaction";
    bubble.textContent = text;
    figure.appendChild(bubble);
    this.root.querySelector(".manager-figure")?.classList.add("manager-react");
    setTimeout(() => {
      bubble.remove();
      figure.classList.remove(`react-${reaction}`);
      this.root.querySelector(".manager-figure")?.classList.remove("manager-react");
    }, 2800);
  }

  showDawn(state, quitters = [], onContinue) {
    document.body.classList.add("page-flip");
    setTimeout(() => document.body.classList.remove("page-flip"), 430);
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper dawn-paper" role="dialog" aria-modal="true" aria-labelledby="dawnTitle">
        <div class="eyebrow" id="dawnTitle">晨間交班</div>
        <div class="dawn-day">第 ${state.day} 天</div>
        <div class="dawn-fortune">宜：${esc(state.fortune?.good)}　　忌：${esc(state.fortune?.bad)}</div>
        ${state.meters.stress >= 80 ? `<p class="quit-note">你已經進入「燃燒中」。今天只有 ${state.maxAp} AP。事情沒有變少。</p>` : ""}
        ${quitters.length ? `<div class="quit-note">${quitters.map(npc => `${esc(npc.name)}離職了。`).join(" ")} 班表多了空白，士氣少了一截。</div>` : ""}
        <button class="primary-btn" id="dawnContinue">翻到今天</button>
      </section>`;
    document.body.appendChild(overlay);
    const continueButton = overlay.querySelector("#dawnContinue");
    continueButton.focus({ preventScroll: true });
    continueButton.addEventListener("click", () => {
      overlay.remove();
      onContinue();
    });
  }

  showResult(result, changes, onContinue, context = {}) {
    const deltas = formatDelta(changes);
    const mood = managerMood(context.state?.meters?.stress ?? 30);
    const hasCost = deltas.some(item => item.key === "stress" ? item.value > 0 : item.value < 0);
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper result-paper ${hasCost ? "has-cost" : ""}" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <div class="result-head">
          <div class="result-manager-sprite manager-${mood}"><span class="manager-sprite" aria-hidden="true"></span></div>
          <div><div class="eyebrow">這個決定已經做了</div><h2 id="resultTitle">現場會記得結果</h2></div>
        </div>
        <p class="result-line">${esc(result)}</p>
        <div class="delta-line">
          ${deltas.map(item => `<span class="delta-chip ${item.value > 0 ? "pos" : "neg"}">${esc(item.label)} ${item.value > 0 ? "+" : ""}${item.value}</span>`).join("")}
        </div>
        ${context.npc ? `<div class="result-person"><strong>${esc(context.npc.name)}</strong><span>現在體力 ${context.npc.stamina}・忠誠 ${context.npc.loyalty}</span></div>` : ""}
        ${context.followUp ? `<div class="followup-warning"><strong>延遲炸彈已埋下</strong><span>${context.followUp.delay} 天後，這件事可能回來。</span></div>` : ""}
        <button class="primary-btn" id="resultContinue">承擔結果，處理下一件</button>
      </section>`;
    document.body.appendChild(overlay);
    const sprite = overlay.querySelector(".manager-sprite");
    if (sprite && this.data.staff?.visuals?.managerSprite) sprite.style.backgroundImage = `url("${this.data.staff.visuals.managerSprite}")`;
    const continueButton = overlay.querySelector("#resultContinue");
    continueButton.focus({ preventScroll: true });
    continueButton.addEventListener("click", () => {
      overlay.remove();
      onContinue();
    });
  }

  showStaff(state) {
    const returnFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper" role="dialog" aria-modal="true" aria-labelledby="staffTitle" tabindex="-1">
        <h2 id="staffTitle">今天還在的人</h2>
        <div class="staff-list">
          ${this.getStaffViews(state).map(npc => {
            const mood = npcMood(npc);
            const thought = npc.thoughts?.[mood] || npc.thoughts?.happy || "先把今天撐過去。";
            return `
            <div class="staff-row ${npc.quit ? "quit" : ""}">
              <div class="staff-top"><span class="staff-avatar" aria-hidden="true">${esc(npc.name.slice(0, 1))}</span><strong>${esc(npc.name)}</strong><span class="staff-role">${esc(npc.role)}・${esc(npc.trait)}</span></div>
              <div class="staff-bars"><span>體力</span><div class="staff-mini-track"><div class="staff-mini-fill" style="width:${npc.stamina}%"></div></div><span>${npc.stamina}</span></div>
              <div class="staff-bars"><span>忠誠</span><div class="staff-mini-track"><div class="staff-mini-fill" style="width:${npc.loyalty}%"></div></div><span>${npc.loyalty}</span></div>
              <small>${esc(npc.traitDesc)}</small><em>「${esc(thought)}」</em>
            </div>`;
          }).join("")}
        </div>
        <button class="secondary-btn" id="closeOverlay">闔上名冊</button>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      returnFocus?.focus?.({ preventScroll: true });
    };
    overlay.querySelector("#closeOverlay").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelector(".overlay-paper").focus({ preventScroll: true });
  }

  showAchievements() {
    const returnFocus = document.activeElement;
    const unlocked = new Set(loadAchievements());
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper achievement-paper" role="dialog" aria-modal="true" aria-labelledby="achievementTitle" tabindex="-1">
        <h2 id="achievementTitle">成就總覽　${unlocked.size} / ${this.data.achievements.length}</h2>
        <div class="achievement-grid">
          ${this.data.achievements.map(item => `
            <div class="achievement-row ${unlocked.has(item.id) ? "unlocked" : ""}">
              <div class="achievement-medal" aria-hidden="true"></div>
              <div><strong>${unlocked.has(item.id) ? esc(item.name) : "？？？"}</strong><small>${unlocked.has(item.id) ? esc(item.desc) : "繼續上班，也許會遇到。"}</small></div>
            </div>`).join("")}
        </div>
        <button class="secondary-btn" id="closeOverlay">收起來</button>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      returnFocus?.focus?.({ preventScroll: true });
    };
    overlay.querySelector("#closeOverlay").addEventListener("click", close);
    overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    overlay.querySelector(".overlay-paper").focus({ preventScroll: true });
  }

  showToast(changes = {}) {
    const deltas = formatDelta(changes);
    if (!deltas.length) return;
    document.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = deltas.map(item => `${esc(item.label)} ${item.value > 0 ? "+" : ""}${item.value}`).join("　");
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1300);
  }

  showObjectiveToast(message) {
    document.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast mission-toast";
    toast.innerHTML = `<strong>線索取得</strong><span>${esc(message)}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2200);
  }

  showProximityToast(label) {
    document.querySelector(".toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "toast proximity-toast";
    toast.textContent = `還太遠。先把護理長走到「${label}」旁邊。`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  }

  renderEnding(engine) {
    this.stopSceneController();
    const state = engine.state;
    const ending = this.data.endings.find(item => item.id === state.endingId);
    if (!ending) return;
    const unlocked = new Set(state.unlockedThisRun);
    const meterRows = ["quality", "morale", "family", "compliance", "budget", "stress"];
    this.root.className = "app-shell";
    this.root.innerHTML = `
      <main class="ending-wrap">
        <article class="ending-paper page-flip">
          <div class="eyebrow">本月結案</div>
          <h1>${esc(ending.title)}</h1>
          <div class="ending-score">${state.evaluationScore == null ? "評鑑尚未開始" : `年度評鑑 ${state.evaluationScore} 分`}</div>
          <p class="ending-text">${esc(ending.text)}</p>
          <table class="review-table">
            <tbody>
              ${meterRows.map(key => `<tr><th>${METER_LABELS[key]}</th><td>${state.meters[key]}</td></tr>`).join("")}
              <tr><th>離職同仁</th><td>${state.stats.quitCount} 人</td></tr>
              <tr><th>埋下延遲炸彈</th><td>${state.stats.bombsPlanted} 顆</td></tr>
              <tr><th>陪住民聊天</th><td>${state.stats.chatCount} 次</td></tr>
              <tr><th>訂飲料</th><td>${state.stats.drinkCount} 次</td></tr>
            </tbody>
          </table>
          ${unlocked.size ? `<p><strong>本局解鎖：</strong>${[...unlocked].map(id => esc(this.data.achievements.find(a => a.id === id)?.name || id)).join("、")}</p>` : ""}
          <p class="disclaimer">本作品為虛構情境，所有人物、事件與機構均非真實。</p>
          <p class="copyright">© 鄭瑞賢 製作・版權所有</p>
          <div class="end-actions">
            <button class="primary-btn" id="restartBtn">再當一次護理長</button>
            <button class="secondary-btn" id="endingAchievements">看成就總覽</button>
            <button class="secondary-btn" id="endingHome">回首頁</button>
          </div>
        </article>
      </main>`;
    this.root.querySelector("#restartBtn").addEventListener("click", this.callbacks.onNewGame);
    this.root.querySelector("#endingAchievements").addEventListener("click", () => this.showAchievements());
    this.root.querySelector("#endingHome").addEventListener("click", this.callbacks.onHome);
  }

  renderLoadError(error) {
    this.stopSceneController();
    this.root.className = "app-shell";
    this.root.innerHTML = `
      <main class="load-error">
        <section class="overlay-paper">
          <h2>交班本打不開</h2>
          <p>遊戲資料沒有成功載入。若你是直接雙擊 <code>index.html</code>，這通常是瀏覽器對 ES Modules／JSON 的本機安全限制。</p>
          <p>部署到 GitHub Pages 可直接執行；本機測試可在專案資料夾執行 <code>python3 -m http.server 8000</code>，再開啟 <code>http://localhost:8000</code>。</p>
          <small>${esc(error?.message || error)}</small>
        </section>
      </main>`;
  }

  animateMeterChanges(current) {
    if (!this.previousMeters) return;
    for (const [key, value] of Object.entries(current)) {
      const before = this.previousMeters[key];
      if (before === value) continue;
      const row = this.root.querySelector(`[data-meter-row="${key}"]`);
      const target = row || this.root.querySelector(".stress-dock");
      if (target) {
        target.classList.add(value > before ? "flash-pos" : "flash-neg");
        setTimeout(() => target.classList.remove("flash-pos", "flash-neg"), 450);
      }
    }
  }
}
