// Cloudflare Worker - LINE Summarizer Backend v9.1 (Fix empty summary)
//
// v9.1 重點改動：
// - maxOutputTokens 8000 → 16000（防止 Gemini 寫完 summary 前就 token 用罄）
// - prompt 大幅精簡（保留指派規則核心，移除冗餘範例與 emoji）
// - 加 finishReason 檢查，被截斷時清楚告訴前端
// - backfill 改為僅在「真的缺欄位」時才補，空字串不再被視為缺失
//
// v9 既有：說話者≠執行者規則、原文引用、CoT
// v8 既有：對話上限 30000
// v7 既有：gemini-2.5-flash、responseMimeType、responseSchema
//
// 環境變數：GEMINI_API_KEY = AIza...

const ALLOWED_ORIGIN = '*';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const TEXT_LIMIT = 30000;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await request.json();
      const { mode } = body;

      if (!env.GEMINI_API_KEY) {
        return jsonResponse({ error: 'API Key 未設定，請聯絡管理員' }, 500);
      }

      if (mode === 'analyze') return await handleAnalyze(body, env);
      if (mode === 'keyword') return await handleKeyword(body, env);

      return jsonResponse({ error: '未知的請求模式' }, 400);
    } catch (e) {
      return jsonResponse({ error: '伺服器錯誤：' + e.message }, 500);
    }
  }
};

// ---------- Mode: analyze ----------
async function handleAnalyze(body, env) {
  const { groups, selected } = body;

  if (!groups || !groups.length || !selected || !selected.length) {
    return jsonResponse({ error: '缺少必要參數' }, 400);
  }

  const combinedText = groups.map(g => `[${g.name}]\n${g.text}`).join('\n\n');
  const trimmedText = trimSmart(combinedText, TEXT_LIMIT);

  const responseSchema = buildAnalyzeSchema(selected);
  const fieldDescriptions = selected.map(k => `- ${SCHEMA_LABELS[k] || k}`).join('\n');

  const prompt = `你是專業 LINE 對話分析師。從對話找出重點：指派、決定、承諾、爭議、數字、新資訊、明顯情緒。忽略社交客套、貼圖、單字回應。\n\n【關鍵規則：說話者 ≠ 執行者】\n"A: B 去處理" → 執行者是 B，A 是指派者\n"A: 幫我處理" → 執行者是被請求的人，A 是請求者\n"A: 我來處理" → 執行者才是 A\n範例：對話 "宗原: 小明 4/20 前交報告" → 執行者是小明，宗原是指派者\n中文裡 幫/去/請/麻煩/記得 都代表指派給聽者\n\n【寫作要求】\n- summary：2-3 句具體事件，明確標示誰做什麼。範例「宗原指派小明 4/20 前交報告，Anna 質疑時程，最後決定先做 MVP」。不要寫「大家討論了 X」這種空話\n- actions 格式：「執行者：任務（原文：XXX）」\n- decisions 格式：「決定者決定：內容（原文：XXX）」\n- followup 格式：「待確認者：問題（原文：XXX）」\n- speakers 格式：「人名：他的立場/決定」\n- topics 是具體事件名（如 V2 改版爭議）非類別（如 工作討論）\n- keywords 是具體名詞（如 V2 改版、4/20）非泛詞（如 討論、問題）\n- mood 用具體形容（如 前半輕鬆後半轉緊繃）非「還好」\n\n【欄位】\n${fieldDescriptions}\n\n【對話】\n${trimmedText}`;

  const result = await callGemini({
    prompt,
    responseSchema,
    maxTokens: 16000,
    env
  });

  const parsed = parseAndBackfill(result.text, selected, FIELD_DEFAULTS_ANALYZE, result.finishReason);
  return jsonResponse({ result: parsed });
}

// ---------- Mode: keyword ----------
async function handleKeyword(body, env) {
  const { keyword, groups } = body;

  if (!keyword || !groups || !groups.length) {
    return jsonResponse({ error: '缺少關鍵字或對話內容' }, 400);
  }

  const combinedText = groups.map(g => `[${g.name}]\n${g.text}`).join('\n\n');
  const trimmedText = trimSmart(combinedText, TEXT_LIMIT);

  const responseSchema = {
    type: 'object',
    properties: {
      discussion_summary: { type: 'string' },
      quotes:             { type: 'array', items: { type: 'string' } },
      speakers:           { type: 'array', items: { type: 'string' } },
      conclusions:        { type: 'array', items: { type: 'string' } },
      sources:            { type: 'array', items: { type: 'string' } }
    },
    required: ['discussion_summary', 'quotes', 'speakers', 'conclusions', 'sources']
  };

  const prompt = `你是專業 LINE 對話分析師，聚焦關鍵字「${keyword}」。\n\n【關鍵規則：說話者 ≠ 執行者】\n"A: B 去做..." → 執行者是 B，A 是指派者\n中文裡 幫/去/請/麻煩 都代表指派給聽者\n\n【任務】\n找出對話中所有與「${keyword}」相關段落，按時間排序。\n\n【輸出】\n- discussion_summary：2-3 句說明圍繞「${keyword}」發生了什麼具體事件\n- quotes：對話原句（不改寫），格式「說話者：對話內容」，至少 3 則\n- speakers：提到此關鍵字的人 + 立場/指派/承諾\n- conclusions：結論或決定（明確標示誰決定）\n- sources：提及此關鍵字的群組名稱\n\n若找不到內容，相關陣列填 []，但 discussion_summary 必填。\n\n【對話】\n${trimmedText}`;

  const result = await callGemini({
    prompt,
    responseSchema,
    maxTokens: 8000,
    env
  });

  const parsed = parseAndBackfill(result.text, null, FIELD_DEFAULTS_KEYWORD, result.finishReason);
  return jsonResponse({ result: parsed });
}

// ---------- 智能截取：超過上限時取「頭 + 尾」各一半 ----------
function trimSmart(text, limit) {
  if (text.length <= limit) return text;
  const halfLimit = Math.floor((limit - 100) / 2);
  const head = text.slice(0, halfLimit);
  const tail = text.slice(text.length - halfLimit);
  return head + '\n\n...(中段省略)...\n\n' + tail;
}

// ---------- Schema 定義 ----------
const SCHEMA_LABELS = {
  summary:   '重點摘要（2-3 句具體事件，明確標示誰做什麼）',
  keywords:  '關鍵字（3-8 個具體名詞）',
  speakers:  '重要發言者（人名+他的立場/決定）',
  topics:    '話題分類（具體事件名）',
  actions:   '待辦事項（執行者：任務（原文：XXX））',
  decisions: '已決定事項（決定者決定：內容（原文：XXX））',
  followup:  '需跟進事項（待確認者：問題（原文：XXX））',
  mood:      '整體氛圍（具體形容）'
};

const FIELD_DEFAULTS_ANALYZE = {
  summary:   { type: 'string', fallback: '（未取得摘要，請重試）' },
  keywords:  { type: 'array',  fallback: [] },
  speakers:  { type: 'array',  fallback: [] },
  topics:    { type: 'array',  fallback: [] },
  actions:   { type: 'array',  fallback: [] },
  decisions: { type: 'array',  fallback: [] },
  followup:  { type: 'array',  fallback: [] },
  mood:      { type: 'string', fallback: '' }
};

const FIELD_DEFAULTS_KEYWORD = {
  discussion_summary: { type: 'string', fallback: '找不到相關討論' },
  quotes:             { type: 'array',  fallback: [] },
  speakers:           { type: 'array',  fallback: [] },
  conclusions:        { type: 'array',  fallback: [] },
  sources:            { type: 'array',  fallback: [] }
};

function buildAnalyzeSchema(selected) {
  const properties = {};
  const required = [];

  for (const key of selected) {
    if (!(key in FIELD_DEFAULTS_ANALYZE)) continue;
    const def = FIELD_DEFAULTS_ANALYZE[key];
    if (def.type === 'string') {
      properties[key] = { type: 'string' };
    } else {
      properties[key] = { type: 'array', items: { type: 'string' } };
    }
    required.push(key);
  }

  return { type: 'object', properties, required };
}

// ---------- Gemini 呼叫 ----------
async function callGemini({ prompt, responseSchema, maxTokens, env }) {
  const res = await fetch(
    `${GEMINI_ENDPOINT}?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: maxTokens,
          responseMimeType: 'application/json',
          responseSchema
        }
      })
    }
  );

  if (!res.ok) {
    let msg = `Gemini API HTTP ${res.status}`;
    try {
      const err = await res.json();
      msg = err.error?.message || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  const finishReason = candidate?.finishReason || 'UNKNOWN';

  return { text, finishReason };
}

// ---------- JSON 解析與欄位補位 ----------
function parseAndBackfill(raw, selected, defaults, finishReason) {
  let parsed = tryParse(raw);

  if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim().startsWith('{')) {
    try {
      const inner = JSON.parse(parsed.summary);
      if (inner && Object.keys(inner).length > 1) parsed = inner;
    } catch (_) {}
  }

  if (!parsed || typeof parsed !== 'object') parsed = {};

  const keys = Array.isArray(selected) && selected.length ? selected : Object.keys(defaults);
  for (const k of keys) {
    const def = defaults[k];
    if (!def) continue;
    const v = parsed[k];
    if (def.type === 'array') {
      if (!Array.isArray(v)) parsed[k] = def.fallback;
    } else {
      if (v === undefined || v === null) parsed[k] = def.fallback;
    }
  }

  if (finishReason === 'MAX_TOKENS' && (!parsed.summary || parsed.summary === defaults.summary?.fallback)) {
    parsed.summary = '（Gemini 輸出超過長度限制，建議縮短時間範圍再試）';
  }

  return parsed;
}

function tryParse(raw) {
  if (!raw) return null;
  let clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    clean = clean.slice(start, end + 1);
  }
  try {
    return JSON.parse(clean);
  } catch (_) {
    try {
      return JSON.parse(clean.replace(/,\s*([}\]])/g, '$1'));
    } catch (_) {
      return tryRepairTruncated(clean);
    }
  }
}

function tryRepairTruncated(s) {
  let depth = 0, inStr = false, esc = false, lastBalanced = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) lastBalanced = i;
    }
  }
  if (lastBalanced > 0) {
    try { return JSON.parse(s.slice(0, lastBalanced + 1)); } catch (_) {}
  }
  return null;
}

// ---------- HTTP 回應 ----------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    }
  });
}
