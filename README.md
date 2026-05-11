# LINE 對話重點整理工具 (LINE Chat Summarizer)

上傳 LINE 群組匯出的 .txt 對話紀錄，AI 自動整理重點摘要、待辦事項、關鍵字深度分析等。

**線上版**：https://futurestarai.com/line_summarizer.html

---

## 專案架構

```
前端 (GitHub Pages)          後端 (Cloudflare Worker)          AI (Google Gemini)
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│ line_summarizer │ POST │ line-summarizer       │ POST │ Gemini 2.5-flash│
│ .html           │─────>│ .workers.dev          │─────>│ generateContent │
│                 │<─────│                       │<─────│                 │
│ 純 HTML/CSS/JS  │ JSON │ worker.js (本 repo)   │ JSON │ responseSchema  │
└─────────────────┘      └──────────────────────┘      └─────────────────┘
```

| 層 | 技術 | 檔案 |
|---|---|---|
| 前端 | HTML + CSS + Vanilla JS | `futurestarai.com/line_summarizer.html` |
| 後端 | Cloudflare Worker (Serverless) | `worker.js` (本 repo) |
| AI | Google Gemini 2.5-flash API | 透過 Worker 呼叫 |
| 部署 | GitHub Pages + Cloudflare | 零伺服器成本 |

---

## 功能清單

### 核心功能
- 多群組 .txt 上傳（可自訂群組名稱）
- 時間篩選（近 24h / 3天 / 7天 / 全部 / 自訂範圍）
- 8 個分析項目可勾選：摘要、關鍵字、發言者、話題、待辦、決定、跟進、氛圍
- 關鍵字點擊展開深度分析（對話原句、發言者觀點、結論）
- 主題搜尋框（輸入任意主題查找相關討論）
- 複製全部結果

### 技術亮點
- **responseSchema 結構化輸出**：Gemini 原生 JSON Schema 約束，強制每個欄位都存在
- **說話者 vs 執行者辨識**：中文句法規則（幫/去/請/麻煩→指派給聽者）
- **原文引用**：每個待辦/決定附上對話原句，可追溯驗證
- **智能截取**：超長對話取頭尾各半，避免遺漏結尾重要內容
- **多層 JSON 修復**：trailing comma 修復、截斷修復、巢狀拆解
- **finishReason 診斷**：Gemini 輸出被截斷時給出明確提示

---

## 技能總覽 (Skills)

### Frontend
| 技能 | 應用場景 |
|---|---|
| HTML5 / CSS3 | 單檔 SPA、CSS 變數主題系統、RWD |
| Vanilla JavaScript (ES6+) | 無框架前端、事件委派、async/await |
| File API | .txt 檔案上傳與讀取（FileReader） |
| Clipboard API | 一鍵複製分析結果 |
| DOM 操作 | 動態渲染分析結果、關鍵字面板展開/收合 |
| UX 設計 | 進度條動畫、chip 多選、pill 切換 |

### Backend
| 技能 | 應用場景 |
|---|---|
| Cloudflare Workers | Serverless 函數、邊緣運算部署 |
| REST API 設計 | POST endpoint、mode 路由（analyze/keyword） |
| CORS 處理 | OPTIONS preflight、Access-Control headers |
| 錯誤處理 | HTTP 狀態碼、try-catch、使用者友善錯誤訊息 |
| 環境變數管理 | Cloudflare Secrets（API Key 不外洩） |

### AI / LLM Integration
| 技能 | 應用場景 |
|---|---|
| Google Gemini API | REST 呼叫、generationConfig 調參 |
| Prompt Engineering | 結構化指令、Chain-of-thought、好壞範例對比 |
| Structured Output | responseMimeType + responseSchema 強制 JSON |
| 中文 NLP 邏輯 | 說話者/執行者辨識、指派句法規則 |
| JSON Schema | 動態 schema 生成（根據使用者勾選欄位） |
| Output 修復 | 截斷修復、trailing comma 修復、巢狀 JSON 拆解 |
| Token 管理 | maxOutputTokens 調整、finishReason 診斷 |

### Data Processing
| 技能 | 應用場景 |
|---|---|
| 文字解析 | LINE 對話格式解析（日期行、訊息行分離） |
| 日期處理 | 多格式日期提取、補零排序、時間範圍篩選 |
| 智能截取 | 超長文本頭尾各半截取（保留結尾重要內容） |
| JSON 容錯 | 多層 parse 嘗試、brace 平衡修復 |

### DevOps / 部署
| 技能 | 應用場景 |
|---|---|
| GitHub Pages | 靜態前端部署、自訂域名 |
| Cloudflare Workers | Serverless 後端部署、環境變數設定 |
| Git | 版本控管、分支管理 |
| 零成本架構 | 前端 GitHub Pages 免費 + 後端 Cloudflare 免費額度 |

---

## API 介面

### POST /（mode: analyze）

**Request**
```json
{
  "mode": "analyze",
  "groups": [{"name": "群組名", "text": "對話內容"}],
  "selected": ["summary", "keywords", "actions", "decisions", "followup", "speakers", "topics", "mood"]
}
```

**Response**
```json
{
  "result": {
    "summary": "2-3 句具體事件摘要",
    "keywords": ["關鍵字1", "關鍵字2"],
    "actions": ["執行者：任務（原文：XXX）"],
    "decisions": ["決定者決定：內容（原文：XXX）"],
    "followup": ["待確認者：問題（原文：XXX）"],
    "speakers": ["人名：立場/決定"],
    "topics": ["具體事件名：說明"],
    "mood": "具體氛圍描述"
  }
}
```

### POST /（mode: keyword）

**Request**
```json
{
  "mode": "keyword",
  "keyword": "搜尋關鍵字",
  "groups": [{"name": "群組名", "text": "對話內容"}]
}
```

**Response**
```json
{
  "result": {
    "discussion_summary": "討論重點摘要",
    "quotes": ["說話者：對話原句"],
    "speakers": ["人名：觀點"],
    "conclusions": ["結論"],
    "sources": ["群組名"]
  }
}
```

---

## 版本演進

| 版本 | 重點 |
|---|---|
| v6 | 原版 Gemini 2.5-flash，純 prompt 約束，輸出不穩定 |
| v7 | 加 responseMimeType + responseSchema，改 gemini-2.5-flash，欄位自動補位 |
| v8 | 對話上限 6000→30000，明確定義「重點」，Chain-of-thought |
| v9 | 說話者≠執行者規則、原文引用、5 步驗證 |
| v9.1 | maxOutputTokens 提高至 16000、prompt 精簡、finishReason 診斷 |

---

## 部署方式

### 前端
前端 HTML 部署在另一個 repo：[founderai813/futurestarai.com](https://github.com/founderai813/futurestarai.com)

### 後端（Cloudflare Worker）
1. 到 [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → `line-summarizer`
2. Edit code → 貼上 `worker.js` → Save and deploy
3. Settings → Variables and Secrets → 新增 `GEMINI_API_KEY`（Secret 類型）

---

## 目標用戶
- 管理多個 LINE 群組的人（社群管理者、創業者、講師）
- 需要定期整理群組重點的人
- 沒時間看完幾千則訊息的人

## License
MIT
