# 護理長模擬器：今天也沒有標準答案

純前端、資料驅動的 30 天回合制文字策略遊戲。無 npm、無 bundler、無後端，可直接部署至 GitHub Pages。

## 啟動

### GitHub Pages

把整個資料夾推到 GitHub repository，Settings → Pages → Deploy from a branch，選擇 `main` / root 即可。

### 本機

由於瀏覽器通常會封鎖 `file://` 頁面中的 ES Modules 與 JSON `fetch`，請在專案根目錄啟動一個最小靜態伺服器：

```bash
python3 -m http.server 8000
```

再開啟：`http://localhost:8000`

不需要安裝任何套件。

### 自動化檢查（選用）

若電腦已有 Node.js 22 以上版本，可執行完整資料與遊戲流程測試：

```bash
node tests/game.test.mjs
```

測試包含抽牌、AP、follow-up、NPC 離職、成就、結局、存檔，以及 100 局固定亂數的 30 天流程模擬；不需要安裝 npm 套件。

## 資料驅動

遊戲內容都在 `data/`：

- `events.json`：事件卡（目前 22 張：16 張隨機事件 + 6 張 follow-up）
- `actions.json`：行動與效果
- `staff.json`：NPC 與離職設定
- `fortune.json`：今日運勢
- `achievements.json`：成就與條件
- `endings.json`：結局、條件與文案

新增一般事件卡不需要修改 `.js`。引擎只讀取欄位、判斷條件並執行效果。

## 主要規則已實作

- 30 天循環、壓力 80+ 時 3 AP
- 第 1–5 天 1 張事件；第 6 天起 60% 機率 2 張
- 依 `weight` 加權抽卡
- 5 天內不重複同一張卡
- crisis 第 8 天後才進牌池
- follow-up 到期優先，且不佔隨機抽卡名額
- `requireAP`、`npcEffect`、`oneShot`、事件條件
- NPC 每日恢復、低體力／低忠誠隔日離職
- 離職後品質每日 -2，直到事件選項清除人力缺口
- 第 7 / 14 / 21 / 28 天週結算
- 12 項 localStorage 跨局成就
- 7 種結局優先判定
- 每日結算與操作時自動存檔
- `prefers-reduced-motion`

## localStorage

- `nurseSim.save.v1`
- `nurseSim.achievements.v1`

## 版權與免責

© 鄭瑞賢 製作・版權所有

本作品為虛構情境，所有人物、事件與機構均非真實。
