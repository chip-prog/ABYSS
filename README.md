# ABYSS

Roguelike 卡牌遊戲的底層架構：一個資料驅動的戰鬥引擎、遊戲本體（經典模式・第一章），以及讓沒有程式基礎的人也能編輯內容的 Studio。

## 怎麼開啟

純網頁，不需要安裝或建置。

- **線上**：在 GitHub 儲存庫的 Settings → Pages，把來源設為 `main` 分支的根目錄，之後用 Pages 網址開啟即可。
- **本機**：在這個資料夾執行下面的指令，然後開啟 http://localhost:8000

```bash
python3 -m http.server 8000
```

| 頁面 | 用途 |
|---|---|
| `index.html` | 入口 |
| `game.html` | 遊戲本體，只使用「正式」內容 |
| `game.html?preview=1` | 測試環境：使用 Studio 的工作內容（含草稿） |
| `studio.html` | Studio |

## 內容怎麼流動

1. 共同創作者在 Studio 編輯。修改只存在自己的瀏覽器裡，新增的項目預設是「草稿」。
2. 用試玩沙盒或「完整試玩一輪」確認。
3. 在「匯入／匯出」匯出內容檔，交給負責審核的人。
4. 審核者在自己的 Studio「合併匯入」（匯入的項目會標成草稿），確認後切成「正式」。
5. 「匯出為 content.json」，取代儲存庫的 `content/content.json`。遊戲只會顯示「正式」的項目。

## 資料夾

```
content/content.json   所有遊戲內容（卡片、角色、敵人、遭遇、遺物、狀態、陣營、規則）
js/engine/             引擎，純邏輯、不碰畫面
  schema.js            積木定義：效果、條件、時機、關鍵字（Studio 表單由此自動產生）
  battle.js            戰鬥規則與每種效果積木的實作
  describe.js          由積木自動產生卡片說明文字
  validate.js          防呆檢查
  run.js               一輪冒險的流程（連戰、獎勵、篝火、頭目）
js/ui/                 遊戲與 Studio 共用的畫面（卡片外觀、戰鬥畫面）
js/game.js             遊戲本體
js/studio.js           Studio
tests/engine.test.mjs  引擎自動測試
```

## 哪些事不用寫程式

新卡片、角色、敵人與招式、遭遇、遺物、狀態、陣營、初始牌組、關卡流程、所有數值，都在 Studio 裡用現有積木完成。

## 哪些事需要改程式

只有「全新的積木」：一種引擎還不認得的效果、條件或時機。步驟是在 `schema.js` 加上定義，在 `battle.js` 的 `EFFECTS` 加上實作，在 `describe.js` 加上說明文字。加完之後 Studio 會自動出現對應的選項。

## 測試

```bash
node tests/engine.test.mjs
```
