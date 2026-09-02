import { loadAchievements } from "./state.js";

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

export class GameUI {
  constructor(root, data, callbacks) {
    this.root = root;
    this.data = data;
    this.callbacks = callbacks;
    this.previousMeters = null;
  }

  renderHome(hasSave = false) {
    const unlocked = loadAchievements();
    this.root.className = "app-shell";
    this.root.innerHTML = `
      <main class="home">
        <section class="home-paper page-flip">
          <div class="home-mark-row">
            <div class="life-mark" aria-hidden="true"></div>
            <div class="home-folio">交班紀錄・第 01 冊</div>
          </div>
          <div class="eyebrow">46 床住宿長照機構・30 天生存紀錄</div>
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
          </div>
          <p class="disclaimer">本作品為虛構情境，所有人物、事件與機構均非真實。</p>
          <p class="copyright">© 鄭瑞賢 製作・版權所有</p>
        </section>
      </main>`;

    this.root.querySelector("#continueGame")?.addEventListener("click", this.callbacks.onContinue);
    this.root.querySelector("#newGame")?.addEventListener("click", this.callbacks.onNewGame);
    this.root.querySelector("#showAchievements")?.addEventListener("click", () => this.showAchievements());
  }

  renderGame(engine) {
    const state = engine.state;
    const burning = state.meters.stress >= 80;
    this.root.className = `app-shell ${burning ? "burning" : ""}`;
    const activeCount = state.staff.filter(npc => !npc.quit).length;
    const meterOrder = ["quality", "morale", "family", "compliance", "budget"];
    const event = engine.currentEvent();

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
          <div class="status-strip">
            <span class="team-status ${state.staffShortage ? "shortage" : ""}"><i aria-hidden="true"></i>在職 ${activeCount} / ${state.staff.length}${state.staffShortage ? "・人力缺口中" : ""}</span>
            <nav aria-label="遊戲選單">
              <button id="staffBtn">名冊</button>
              <button id="achievementBtn">成就</button>
              <button id="homeBtn">首頁</button>
            </nav>
          </div>
          ${state.phase === "events" && event ? this.renderEvent(engine, event) : this.renderActions(engine)}
        </div>

        <section class="stress-dock" aria-label="你的壓力">
          <div class="stress-inner">
            <div class="stress-label">你的壓力</div>
            <div class="stress-track"><div class="stress-fill" data-meter="stress" style="width:${state.meters.stress}%"></div></div>
            <div class="stress-value" data-meter-value="stress">${state.meters.stress}</div>
            <div class="stress-status">${state.meters.stress < 40 ? "尚可呼吸" : state.meters.stress < 80 ? "開始透支" : "燃燒中"}</div>
          </div>
        </section>
      </main>`;

    this.bindGameEvents(engine);
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

  renderMeter(key, value) {
    return `
      <div class="meter-row" data-meter-row="${key}">
        <span>${METER_LABELS[key]}</span>
        <div class="meter-track" role="progressbar" aria-label="${METER_LABELS[key]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><div class="meter-fill" data-meter="${key}" style="width:${value}%"></div></div>
        <span class="meter-value" data-meter-value="${key}">${value}</span>
      </div>`;
  }

  renderEvent(engine, event) {
    const state = engine.state;
    const burning = state.meters.stress >= 80;
    const fatigue = state.meters.stress >= 50 && state.meters.stress < 80 && state.fortune?.fatigueAside;
    return `
      <article class="event-paper page-flip">
        <span class="paper-clip" aria-hidden="true"></span>
        <div class="event-meta">
          <div class="event-tags">
            ${(event.tags || []).map(tag => `<span class="event-tag ${event.type === "crisis" ? "crisis" : ""}">${esc(tag)}</span>`).join("")}
          </div>
          <span class="event-count">待處理 ${state.eventQueue.length + 1}</span>
        </div>
        <h2>${esc(event.title)}</h2>
        ${event.subtitle ? `<p class="event-subtitle">${esc(event.subtitle)}</p>` : ""}
        <p class="event-text">${esc(event.text)}</p>
        ${fatigue ? `<p class="fatigue-aside">${esc(state.fortune.fatigueAside)}</p>` : ""}
        <div class="choice-list">
          ${event.choices.map((choice, index) => {
            const available = engine.choiceAvailability(choice);
            return `<button class="choice-btn" data-choice="${index}" ${available.ok ? "" : "disabled"}>
              <span class="choice-arrow" aria-hidden="true">↳</span>
              <span class="choice-copy">${esc(choice.label)}${burning ? "……" : ""}
                ${available.ok ? "" : `<span class="reason">${esc(available.reason)}</span>`}
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
          ${this.data.actions.map(action => {
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
    this.root.querySelectorAll("[data-choice]").forEach(button => {
      button.addEventListener("click", () => this.callbacks.onChoice(Number(button.dataset.choice)));
    });
    this.root.querySelectorAll("[data-action]").forEach(button => {
      button.addEventListener("click", () => this.callbacks.onAction(button.dataset.action));
    });
    this.root.querySelector("#settleDay")?.addEventListener("click", this.callbacks.onSettle);
    this.root.querySelector("#staffBtn")?.addEventListener("click", () => this.showStaff(engine.state));
    this.root.querySelector("#achievementBtn")?.addEventListener("click", () => this.showAchievements());
    this.root.querySelector("#homeBtn")?.addEventListener("click", this.callbacks.onHome);
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

  showResult(result, changes, onContinue) {
    const deltas = formatDelta(changes);
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <section class="overlay-paper" role="dialog" aria-modal="true" aria-labelledby="resultTitle">
        <div class="eyebrow" id="resultTitle">處理結果</div>
        <p class="result-line">${esc(result)}</p>
        <div class="delta-line">
          ${deltas.map(item => `<span class="delta-chip ${item.value > 0 ? "pos" : "neg"}">${esc(item.label)} ${item.value > 0 ? "+" : ""}${item.value}</span>`).join("")}
        </div>
        <button class="primary-btn" id="resultContinue">知道了，下一件</button>
      </section>`;
    document.body.appendChild(overlay);
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
          ${state.staff.map(npc => `
            <div class="staff-row ${npc.quit ? "quit" : ""}">
              <div class="staff-top"><span class="staff-avatar" aria-hidden="true">${esc(npc.name.slice(0, 1))}</span><strong>${esc(npc.name)}</strong><span class="staff-role">${esc(npc.role)}・${esc(npc.trait)}</span></div>
              <div class="staff-bars"><span>體力</span><div class="staff-mini-track"><div class="staff-mini-fill" style="width:${npc.stamina}%"></div></div><span>${npc.stamina}</span></div>
              <div class="staff-bars"><span>忠誠</span><div class="staff-mini-track"><div class="staff-mini-fill" style="width:${npc.loyalty}%"></div></div><span>${npc.loyalty}</span></div>
              <small>${esc(npc.traitDesc)}</small>
            </div>`).join("")}
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

  renderEnding(engine) {
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
