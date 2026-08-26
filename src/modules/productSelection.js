const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const MODULE_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'product-selection');
const DATA_REPO = path.join(MODULE_DATA_DIR, 'data-repo');
const MD_FILE = path.join(DATA_REPO, 'upcoming-devices.md');
const SELECTIONS_FILE = path.join(MODULE_DATA_DIR, 'selections.json');
const CALENDAR_NOTES_FILE = path.join(MODULE_DATA_DIR, 'calendar-notes.json');

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

router.post('/refresh', (req, res) => {
  try {
    const output = execSync('git pull', { cwd: DATA_REPO, encoding: 'utf-8' });
    res.json({ ok: true, output });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
