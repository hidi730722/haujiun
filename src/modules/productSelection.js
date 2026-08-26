const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const googleTrends = require('google-trends-api');

const MODULE_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'product-selection');
const DATA_REPO = path.join(MODULE_DATA_DIR, 'data-repo');
const MD_FILE = path.join(DATA_REPO, 'upcoming-devices.md');
const SELECTIONS_FILE = path.join(MODULE_DATA_DIR, 'selections.json');
const CALENDAR_NOTES_FILE = path.join(MODULE_DATA_DIR, 'calendar-notes.json');
const TRENDS_CACHE_FILE = path.join(MODULE_DATA_DIR, 'trends-cache.json');
const TRENDS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6小時內同關鍵字不重複打外部API

const SHOPEE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
  'X-Shopee-Language': 'zh-Hant',
};

function loadSelections() {
  try {
    return JSON.parse(fs.readFileSync(SELECTIONS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSelections(data) {
  fs.writeFileSync(SELECTIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function loadCalendarNotes() {
  try {
    return JSON.parse(fs.readFileSync(CALENDAR_NOTES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveCalendarNotes(notes) {
  fs.writeFileSync(CALENDAR_NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8');
}

function loadTrendsCache() {
  try {
    return JSON.parse(fs.readFileSync(TRENDS_CACHE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveTrendsCache(cache) {
  fs.writeFileSync(TRENDS_CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

// Google Trends 回傳的中文複合關鍵字有時會被拆字加空格(例如「手 機 殼」)，這裡清掉方便閱讀
function cleanCjkSpacing(str) {
  return String(str || '').replace(/([一-鿿])\s+(?=[一-鿿])/g, '$1');
}

async function fetchGoogleTrendsData(keyword) {
  const startTime = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const iotRaw = await googleTrends.interestOverTime({ keyword, geo: 'TW', startTime });
  const iot = JSON.parse(iotRaw);
  const points = (iot.default.timelineData || []).map((p) => ({
    date: p.formattedAxisTime,
    value: p.value[0],
  }));
  const recent = points.slice(-14);
  const avg = recent.reduce((s, p) => s + p.value, 0) / (recent.length || 1);
  const latest = recent.length ? recent[recent.length - 1].value : 0;
  const verdict = avg === 0 && latest === 0 ? '資料不足' : latest >= avg * 1.2 ? '上升' : latest <= avg * 0.8 ? '下滑' : '持平';

  let related = [];
  try {
    const rqRaw = await googleTrends.relatedQueries({ keyword, geo: 'TW' });
    const rq = JSON.parse(rqRaw);
    const list = rq.default.rankedList?.[0]?.rankedKeyword || [];
    related = list.slice(0, 8).map((k) => ({ query: cleanCjkSpacing(k.query), value: k.value }));
  } catch {
    // 相關關鍵字查不到就算了，不影響主要的熱度資料
  }

  return { points: recent, average: Math.round(avg), latest, verdict, related };
}

async function fetchShopeeSuggestions(keyword) {
  const url = `https://shopee.tw/api/v4/search/search_hint?keyword=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, {
    headers: { ...SHOPEE_HEADERS, Referer: `https://shopee.tw/search?keyword=${encodeURIComponent(keyword)}` },
  });
  if (!res.ok) throw new Error(`蝦皮回應狀態 ${res.status}`);
  const data = await res.json();
  return [...new Set((data.keywords || []).map((k) => k.keyword).filter(Boolean))];
}

function parseMarkdownTable(md) {
  const lines = md.split('\n').filter((l) => l.trim().startsWith('|'));
  if (lines.length < 2) return [];

  const splitRow = (line) => {
    const cells = line.split('|').map((c) => c.trim());
    if (cells[0] === '') cells.shift();
    if (cells[cells.length - 1] === '') cells.pop();
    return cells;
  };

  const header = splitRow(lines[0]);
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    if (cells.length < header.length) continue;
    const obj = {};
    header.forEach((h, idx) => {
      obj[h] = cells[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

function makeId(row) {
  return crypto
    .createHash('md5')
    .update((row['型號'] || '') + '|' + (row['發現日期'] || ''))
    .digest('hex')
    .slice(0, 10);
}

const router = express.Router();

router.get('/devices', (req, res) => {
  try {
    const md = fs.readFileSync(MD_FILE, 'utf-8');
    const rows = parseMarkdownTable(md);
    const selections = loadSelections();
    const devices = rows.map((r) => {
      const id = makeId(r);
      const sel = selections[id] || {};
      return {
        id,
        ...r,
        picked: !!sel.picked,
        note: sel.note || '',
        accessories: Array.isArray(sel.accessories) ? sel.accessories : [],
      };
    });
    res.json({ devices, updatedAt: fs.statSync(MD_FILE).mtime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/selections/:id', (req, res) => {
  const { id } = req.params;
  const { picked, note, accessories } = req.body;
  const selections = loadSelections();
  selections[id] = {
    picked: !!picked,
    note: note || '',
    accessories: Array.isArray(accessories) ? accessories : [],
    updatedAt: new Date().toISOString(),
  };
  saveSelections(selections);
  res.json({ ok: true });
});

router.get('/calendar-notes', (req, res) => {
  res.json({ notes: loadCalendarNotes() });
});

router.post('/calendar-notes', (req, res) => {
  const { date, text } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: '日期格式錯誤' });
  }
  if (!text || !text.trim()) {
    return res.status(400).json({ error: '備註內容不可為空' });
  }
  const notes = loadCalendarNotes();
  const note = {
    id: crypto.randomBytes(6).toString('hex'),
    date,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  notes.push(note);
  saveCalendarNotes(notes);
  res.json({ ok: true, note });
});

router.delete('/calendar-notes/:id', (req, res) => {
  const notes = loadCalendarNotes().filter((n) => n.id !== req.params.id);
  saveCalendarNotes(notes);
  res.json({ ok: true });
});

router.get('/trends', async (req, res) => {
  const keyword = String(req.query.keyword || '').trim();
  if (!keyword) return res.status(400).json({ error: '請提供關鍵字' });

  const cache = loadTrendsCache();
  const cached = cache[keyword];
  if (cached && Date.now() - cached.fetchedAt < TRENDS_CACHE_TTL_MS) {
    return res.json({ ...cached.data, cached: true, fetchedAt: cached.fetchedAt });
  }

  const [googleResult, shopeeResult] = await Promise.allSettled([
    fetchGoogleTrendsData(keyword),
    fetchShopeeSuggestions(keyword),
  ]);

  const data = {
    keyword,
    googleTrends: googleResult.status === 'fulfilled' ? googleResult.value : null,
    googleTrendsError: googleResult.status === 'rejected' ? String(googleResult.reason.message || googleResult.reason) : null,
    shopeeSuggestions: shopeeResult.status === 'fulfilled' ? shopeeResult.value : [],
    shopeeError: shopeeResult.status === 'rejected' ? String(shopeeResult.reason.message || shopeeResult.reason) : null,
  };

  const fetchedAt = Date.now();
  cache[keyword] = { data, fetchedAt };
  saveTrendsCache(cache);
  res.json({ ...data, cached: false, fetchedAt });
});

router.post('/refresh', (req, res) => {
  try {
    const output = execSync('git pull', { cwd: DATA_REPO, encoding: 'utf-8' });
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
