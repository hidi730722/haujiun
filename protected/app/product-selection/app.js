let allDevices = [];
let noteTimers = {};
let calendarMonth = new Date();
calendarMonth.setDate(1);
let calendarNotes = [];
let activeNoteDate = null;

const ACCESSORY_CATALOG = {
  手機: ['手機殼', '保護貼', '鏡頭貼', '支架', '掛繩', '傳輸線/快充頭', '行動電源'],
  平板: ['保護殼', '保護貼', '支架', '鍵盤保護套', '觸控筆'],
  隨身相機: ['防水殼', '鏡頭保護貼', '自拍桿', '收納包', '快拆配件', '電池/充電盒'],
};
const DEFAULT_ACCESSORIES = ['保護殼', '保護貼'];

const ACCESSORY_KEYWORDS = {
  手機殼: ['手機殼', '機殼', '殼貼'],
  保護殼: ['保護殼', '防護殼'],
  保護貼: ['保護貼', '螢幕貼', '殼貼'],
  鏡頭貼: ['鏡頭貼', '鏡頭保護貼'],
  支架: ['支架'],
  掛繩: ['掛繩', '掛脖'],
  '傳輸線/快充頭': ['快充', '傳輸線'],
  行動電源: ['行動電源'],
  鍵盤保護套: ['鍵盤'],
  觸控筆: ['觸控筆', '手寫筆'],
  防水殼: ['防水殼', '防水'],
  鏡頭保護貼: ['鏡頭保護貼', '鏡頭貼'],
  自拍桿: ['自拍桿'],
  收納包: ['收納包', '收納'],
  快拆配件: ['快拆'],
  '電池/充電盒': ['電池', '充電盒'],
};

function accessoryCatalogFor(device) {
  return ACCESSORY_CATALOG[device['類型']] || DEFAULT_ACCESSORIES;
}

function suggestedAccessories(device) {
  const text = device['話題重點'] || '';
  return accessoryCatalogFor(device).filter((item) =>
    (ACCESSORY_KEYWORDS[item] || [item]).some((kw) => text.includes(kw))
  );
}

// 從「預計或實際上市日期」這種自由文字欄位裡，盡量抓出所有可用日期
// (同一機型常常同時有「發表」跟「上市/開賣」兩個不同日期，要分開明確標示，不能只挑一個)
function extractDateEvents(text, fallbackYear) {
  if (!text) return [];
  const candidates = [];
  let working = text;

  working = working.replace(/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (m, y, mo, d, offset) => {
    candidates.push({ year: +y, month: +mo, day: +d, index: offset, end: offset + m.length });
    return ' '.repeat(m.length);
  });

  working = working.replace(/(\d{4})\/(\d{1,2})\/(\d{1,2})/g, (m, y, mo, d, offset) => {
    candidates.push({ year: +y, month: +mo, day: +d, index: offset, end: offset + m.length });
    return ' '.repeat(m.length);
  });

  working = working.replace(/(\d{4})年(\d{1,2})月/g, (m, y, mo, offset) => {
    candidates.push({ year: +y, month: +mo, day: 1, index: offset, end: offset + m.length, precision: 'month' });
    return ' '.repeat(m.length);
  });

  working = working.replace(/(\d{4})\/(\d{1,2})月/g, (m, y, mo, offset) => {
    candidates.push({ year: +y, month: +mo, day: 1, index: offset, end: offset + m.length, precision: 'month' });
    return ' '.repeat(m.length);
  });

  const bareRe = /(\d{1,2})\/(\d{1,2})(?!\d)/g;
  let bm;
  while ((bm = bareRe.exec(working))) {
    const idx = bm.index;
    let year = fallbackYear;
    let nearestDist = Infinity;
    for (const c of candidates) {
      if (c.index < idx && idx - c.index < nearestDist) {
        nearestDist = idx - c.index;
        year = c.year;
      }
    }
    candidates.push({ year, month: +bm[1], day: +bm[2], index: idx, end: idx + bm[0].length });
  }

  if (!candidates.length) return [];

  // 先依照在原文中出現的先後排序，這樣才能限制每個日期只看「自己附近、不越界到隔壁日期」的文字來判斷發表/上市
  candidates.sort((a, b) => a.index - b.index);

  candidates.forEach((c, i) => {
    c.precision = c.precision || 'day';
    const prevEnd = i > 0 ? candidates[i - 1].end : 0;
    const nextStart = i < candidates.length - 1 ? candidates[i + 1].index : text.length;
    const before = text.slice(Math.max(prevEnd, c.index - 16), c.index);
    const after = text.slice(c.end, Math.min(nextStart, c.end + 16));
    const ctx = before + after;
    if (/上市|開賣|發售/.test(ctx)) c.label = 'launch';
    else if (/發表|公布|亮相/.test(ctx)) c.label = 'announce';
    else c.label = 'other';
  });

  // 同年月日+同類型的重複標記去掉重複(例如同一句話裡數字被抓到兩次)
  const seen = new Set();
  const events = [];
  for (const c of candidates) {
    if (c.month < 1 || c.month > 12 || c.day < 1 || c.day > 31) continue;
    const key = `${c.year}-${c.month}-${c.day}-${c.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(c);
  }

  events.sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  return events;
}

function dateEventLabelText(label) {
  return label === 'launch' ? '上市' : label === 'announce' ? '發表' : '預估';
}

function dateEventIcon(label) {
  return label === 'launch' ? '🚀' : label === 'announce' ? '📣' : '📅';
}

function formatDateSummary(d) {
  const discoveredYear = parseInt((d['發現日期'] || '').slice(0, 4), 10) || calendarMonth.getFullYear();
  const events = extractDateEvents(d['預計或實際上市日期'], discoveredYear);
  if (!events.length) return '';
  return events
    .map((e) => {
      const dateStr = e.precision === 'month' ? `${e.year}/${e.month}月` : `${e.year}/${e.month}/${e.day}`;
      return `${dateEventIcon(e.label)}${dateEventLabelText(e.label)} ${dateStr}`;
    })
    .join('　');
}

const gridEl = document.getElementById('grid');
const emptyEl = document.getElementById('empty');
const searchEl = document.getElementById('search');
const typeSelect = document.getElementById('filterType');
const statusSelect = document.getElementById('filterStatus');
const onlyPickedEl = document.getElementById('onlyPicked');
const refreshBtn = document.getElementById('refreshBtn');
const updatedAtEl = document.getElementById('updatedAt');
const statsEl = document.getElementById('stats');

async function loadDevices() {
  const res = await fetch('/app/api/product-selection/devices');
  const data = await res.json();
  allDevices = data.devices;
  updatedAtEl.textContent = data.updatedAt
    ? `資料檔案最後更新：${new Date(data.updatedAt).toLocaleString('zh-TW')}`
    : '';
  populateFilters();
  render();
}

async function loadCalendarNotes() {
  const res = await fetch('/app/api/product-selection/calendar-notes');
  const data = await res.json();
  calendarNotes = data.notes || [];
}

function notesForDate(dateStr) {
  return calendarNotes.filter((n) => n.date === dateStr);
}

function openNoteModal(dateStr) {
  activeNoteDate = dateStr;
  document.getElementById('noteModalDate').textContent = dateStr;
  renderNoteList();
  document.getElementById('noteModal').hidden = false;
  const input = document.getElementById('noteInput');
  input.value = '';
  input.focus();
}

function closeNoteModal() {
  document.getElementById('noteModal').hidden = true;
  activeNoteDate = null;
}

function renderNoteList() {
  const list = notesForDate(activeNoteDate);
  const listEl = document.getElementById('noteList');
  listEl.innerHTML = list.length
    ? list
        .map(
          (n) =>
            `<li><span>${escapeHtml(n.text)}</span><button type="button" class="note-del" data-id="${n.id}">✕</button></li>`
        )
        .join('')
    : '<li class="note-empty">尚無備註</li>';

  listEl.querySelectorAll('.note-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await fetch(`/app/api/product-selection/calendar-notes/${btn.dataset.id}`, { method: 'DELETE' });
      await loadCalendarNotes();
      renderNoteList();
      renderCalendar();
    });
  });
}

async function addNote() {
  const input = document.getElementById('noteInput');
  const text = input.value.trim();
  if (!text || !activeNoteDate) return;
  await fetch('/app/api/product-selection/calendar-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: activeNoteDate, text }),
  });
  input.value = '';
  await loadCalendarNotes();
  renderNoteList();
  renderCalendar();
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth(); // 0-indexed
  document.getElementById('calendarLabel').textContent = `${year}年${month + 1}月`;

  const dateMap = {};
  allDevices.forEach((d) => {
    const discoveredYear = parseInt((d['發現日期'] || '').slice(0, 4), 10) || year;
    const events = extractDateEvents(d['預計或實際上市日期'], discoveredYear);
    events.forEach((info) => {
      if (info.year !== year || info.month !== month + 1) return;
      if (!dateMap[info.day]) dateMap[info.day] = [];
      dateMap[info.day].push({ device: d, precision: info.precision, label: info.label });
    });
  });

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  let html = weekdayNames.map((w) => `<div class="cal-weekday">${w}</div>`).join('');
  for (let i = 0; i < firstWeekday; i++) html += '<div class="cal-cell empty"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const items = dateMap[day] || [];
    const shown = items.slice(0, 3);
    const eventsHtml = shown
      .map(
        (it) =>
          `<div class="cal-event cal-event-${it.label} ${it.precision === 'month' ? 'approx' : ''}" data-id="${it.device.id}" title="${escapeAttr(
            dateEventLabelText(it.label) + '：' + it.device['型號']
          )}">${dateEventIcon(it.label)} ${dateEventLabelText(it.label)}｜${escapeHtml(it.device['型號'] || '')}</div>`
      )
      .join('');
    const moreHtml = items.length > 3 ? `<div class="cal-more">+${items.length - 3} 個</div>` : '';

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayNotes = notesForDate(dateStr);
    const noteChips = dayNotes
      .slice(0, 2)
      .map((n) => `<div class="cal-note" data-date="${dateStr}" title="${escapeAttr(n.text)}">📝 ${escapeHtml(n.text)}</div>`)
      .join('');
    const noteMoreHtml = dayNotes.length > 2 ? `<div class="cal-more">+${dayNotes.length - 2} 則備註</div>` : '';

    html += `<div class="cal-cell ${items.length || dayNotes.length ? 'has-events' : ''}">
      <div class="cal-day-row">
        <span class="cal-day">${day}</span>
        <button type="button" class="cal-add-btn" data-date="${dateStr}" title="新增備註/行程">＋</button>
      </div>
      ${eventsHtml}${moreHtml}${noteChips}${noteMoreHtml}
    </div>`;
  }

  document.getElementById('calendarGrid').innerHTML = html;

  document.querySelectorAll('.cal-event').forEach((el) => {
    el.addEventListener('click', () => {
      const card = document.getElementById(`card-${el.dataset.id}`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1500);
    });
  });

  document.querySelectorAll('.cal-add-btn, .cal-note').forEach((el) => {
    el.addEventListener('click', () => openNoteModal(el.dataset.date));
  });
}

function populateFilters() {
  const types = [...new Set(allDevices.map((d) => d['類型']).filter(Boolean))];
  const statuses = [...new Set(allDevices.map((d) => d['狀態']).filter(Boolean))];

  const prevType = typeSelect.value;
  const prevStatus = statusSelect.value;

  typeSelect.innerHTML = '<option value="">全部類型</option>' +
    types.map((t) => `<option value="${t}">${t}</option>`).join('');
  statusSelect.innerHTML = '<option value="">全部狀態</option>' +
    statuses.map((s) => `<option value="${s}">${s}</option>`).join('');

  typeSelect.value = types.includes(prevType) ? prevType : '';
  statusSelect.value = statuses.includes(prevStatus) ? prevStatus : '';
}

function getFiltered() {
  const q = searchEl.value.trim().toLowerCase();
  const type = typeSelect.value;
  const status = statusSelect.value;
  const onlyPicked = onlyPickedEl.checked;

  return allDevices.filter((d) => {
    if (type && d['類型'] !== type) return false;
    if (status && d['狀態'] !== status) return false;
    if (onlyPicked && !d.picked) return false;
    if (q) {
      const haystack = [d['型號'], d['品牌'], d['話題重點']]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const list = getFiltered();
  statsEl.textContent = `共 ${allDevices.length} 筆機型，符合條件 ${list.length} 筆，已選品 ${allDevices.filter((d) => d.picked).length} 筆`;

  if (list.length === 0) {
    gridEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  gridEl.innerHTML = list.map(renderCard).join('');

  list.forEach((d) => {
    const card = document.getElementById(`card-${d.id}`);
    const checkbox = card.querySelector('.pick-checkbox');
    const note = card.querySelector('.card-note');

    checkbox.addEventListener('change', () => {
      d.picked = checkbox.checked;
      card.classList.toggle('picked', d.picked);
      saveSelection(d.id, d.picked, note.value, d.accessories || []);
      statsEl.textContent = `共 ${allDevices.length} 筆機型，符合條件 ${getFiltered().length} 筆，已選品 ${allDevices.filter((x) => x.picked).length} 筆`;
    });

    note.addEventListener('input', () => {
      d.note = note.value;
      clearTimeout(noteTimers[d.id]);
      noteTimers[d.id] = setTimeout(() => {
        saveSelection(d.id, checkbox.checked, note.value, d.accessories || []);
      }, 600);
    });

    card.querySelectorAll('.accessory-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        d.accessories = Array.from(card.querySelectorAll('.accessory-chip.selected')).map(
          (c) => c.dataset.item
        );
        saveSelection(d.id, checkbox.checked, note.value, d.accessories);
      });
    });

    const trendsInput = card.querySelector('.trends-keyword-input');
    const trendsResult = card.querySelector('.trends-result');
    const trendsBtn = card.querySelector('.trends-search-btn');
    trendsBtn.addEventListener('click', () => runTrendsQuery(trendsInput.value.trim(), trendsResult));
    trendsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runTrendsQuery(trendsInput.value.trim(), trendsResult);
    });
  });
}

function renderCard(d) {
  const statusClass = `badge-status-${d['狀態'] || ''}`;
  const link = d['來源連結'];
  const linkHtml = link && link.startsWith('http')
    ? `<div class="card-link"><a href="${escapeAttr(link)}" target="_blank" rel="noopener">來源連結 ↗</a></div>`
    : '';

  return `
    <div id="card-${d.id}" class="card ${d.picked ? 'picked' : ''}">
      <div class="card-head">
        <div>
          <div class="card-title">${escapeHtml(d['型號'] || '未命名機型')}</div>
          <div class="card-brand">${escapeHtml(d['品牌'] || '')}</div>
        </div>
      </div>
      <div class="badge-row">
        <span class="badge badge-type">${escapeHtml(d['類型'] || '')}</span>
        <span class="badge ${statusClass}">${escapeHtml(d['狀態'] || '')}</span>
      </div>
      <div class="card-date">發現日期：${escapeHtml(d['發現日期'] || '-')}</div>
      ${
        formatDateSummary(d)
          ? `<div class="card-date-parsed">${formatDateSummary(d)}</div>`
          : ''
      }
      <div class="card-date-raw" title="原始資料文字">原始：${escapeHtml(d['預計或實際上市日期'] || '-')}</div>
      <div class="card-highlight">${escapeHtml(d['話題重點'] || '')}</div>
      ${linkHtml}
      <div class="card-footer">
        <label class="pick-row">
          <input type="checkbox" class="pick-checkbox" ${d.picked ? 'checked' : ''} />
          加入選品清單
        </label>
        <textarea class="card-note" placeholder="選品備註（例如：先做手機殼+保護貼）">${escapeHtml(d.note || '')}</textarea>
        ${renderAccessorySection(d)}
        ${renderTrendsSection(d)}
      </div>
    </div>
  `;
}

function renderAccessorySection(d) {
  const catalog = accessoryCatalogFor(d);
  const suggested = new Set(suggestedAccessories(d));
  const selected = new Set(d.accessories || []);
  const chips = catalog
    .map((item) => {
      const isSuggested = suggested.has(item);
      const isSelected = selected.has(item);
      return `<button type="button" class="accessory-chip ${isSelected ? 'selected' : ''} ${
        isSuggested ? 'suggested' : ''
      }" data-item="${escapeAttr(item)}">${isSuggested ? '★ ' : ''}${escapeHtml(item)}</button>`;
    })
    .join('');
  return `<div class="accessory-section">
    <div class="accessory-label">配件建議（★ 為話題重點文字判讀建議，點選即可加入/移除）</div>
    <div class="accessory-chips">${chips}</div>
  </div>`;
}

function defaultTrendsKeyword(d) {
  const acc = suggestedAccessories(d)[0] || accessoryCatalogFor(d)[0] || '';
  const primaryModel = (d['型號'] || '').split('/')[0].trim();
  return `${primaryModel} ${acc}`.trim();
}

function renderTrendsSection(d) {
  const defaultKeyword = defaultTrendsKeyword(d);
  return `<div class="trends-section">
    <div class="accessory-label">🔍 Google Trends / 蝦皮關鍵字建議</div>
    <div class="trends-query-row">
      <input type="text" class="trends-keyword-input" value="${escapeAttr(defaultKeyword)}" placeholder="輸入要查詢的關鍵字" />
      <button type="button" class="btn-secondary trends-search-btn">查詢</button>
    </div>
    <div class="trends-result"></div>
  </div>`;
}

function renderTrendsResult(data) {
  let html = '';

  if (data.googleTrends) {
    const gt = data.googleTrends;
    const max = Math.max(...gt.points.map((p) => p.value), 1);
    const bars = gt.points
      .map(
        (p) =>
          `<div class="trend-bar" style="height:${Math.max(4, Math.round((p.value / max) * 32))}px" title="${escapeAttr(
            p.date + ' = ' + p.value
          )}"></div>`
      )
      .join('');
    const verdictClass =
      gt.verdict === '上升' ? 'up' : gt.verdict === '下滑' ? 'down' : gt.verdict === '資料不足' ? 'na' : 'flat';
    const relatedHtml = gt.related.length
      ? `<div class="trend-chips">${gt.related
          .map(
            (r) =>
              `<span class="trend-chip" data-keyword="${escapeAttr(r.query)}">${escapeHtml(r.query)}（${r.value}）</span>`
          )
          .join('')}</div>`
      : '';
    html += `<div class="trend-block">
      <div class="trend-block-title">Google Trends(近14天，台灣)　<span class="trend-verdict ${verdictClass}">${gt.verdict}</span>　目前 ${gt.latest}/100</div>
      <div class="trend-sparkline">${bars}</div>
      ${relatedHtml}
    </div>`;
  } else if (data.googleTrendsError) {
    html += `<div class="trend-block-error">Google Trends 查詢失敗：${escapeHtml(data.googleTrendsError)}</div>`;
  }

  if (data.shopeeSuggestions && data.shopeeSuggestions.length) {
    html += `<div class="trend-block">
      <div class="trend-block-title">蝦皮搜尋關鍵字建議</div>
      <div class="trend-chips">${data.shopeeSuggestions
        .map((k) => `<span class="trend-chip" data-keyword="${escapeAttr(k)}">${escapeHtml(k)}</span>`)
        .join('')}</div>
    </div>`;
  } else if (data.shopeeError) {
    html += `<div class="trend-block-error">蝦皮關鍵字建議查詢失敗：${escapeHtml(data.shopeeError)}</div>`;
  }

  if (data.cached) {
    html += `<div class="trend-cached-note">快取資料，查詢時間 ${new Date(data.fetchedAt).toLocaleString('zh-TW')}（6小時內同關鍵字不重查）</div>`;
  }

  return html || '<div class="trends-error">查無資料</div>';
}

async function runTrendsQuery(keyword, resultEl) {
  if (!keyword) return;
  resultEl.innerHTML = '<div class="trends-loading">查詢中…（Google Trends + 蝦皮建議，可能需要幾秒）</div>';
  try {
    const res = await fetch(`/app/api/product-selection/trends?keyword=${encodeURIComponent(keyword)}`);
    const data = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = `<div class="trends-error">查詢失敗：${escapeHtml(data.error || '未知錯誤')}</div>`;
      return;
    }
    resultEl.innerHTML = renderTrendsResult(data);
    resultEl.querySelectorAll('.trend-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const section = resultEl.closest('.trends-section');
        const input = section.querySelector('.trends-keyword-input');
        input.value = chip.dataset.keyword;
        runTrendsQuery(chip.dataset.keyword, resultEl);
      });
    });
  } catch (e) {
    resultEl.innerHTML = `<div class="trends-error">查詢失敗：${escapeHtml(e.message)}</div>`;
  }
}

async function saveSelection(id, picked, note, accessories) {
  await fetch(`/app/api/product-selection/selections/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ picked, note, accessories: accessories || [] }),
  });
}

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '同步中...';
  try {
    const res = await fetch('/app/api/product-selection/refresh', { method: 'POST' });
    const data = await res.json();
    if (!data.ok) {
      alert('同步失敗：' + data.error);
    }
  } catch (e) {
    alert('同步失敗：' + e.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 同步最新機型資料';
    await loadDevices();
    renderCalendar();
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

searchEl.addEventListener('input', render);
typeSelect.addEventListener('change', render);
statusSelect.addEventListener('change', render);
onlyPickedEl.addEventListener('change', render);
refreshBtn.addEventListener('click', refresh);

document.getElementById('calPrev').addEventListener('click', () => {
  calendarMonth.setMonth(calendarMonth.getMonth() - 1);
  renderCalendar();
});
document.getElementById('calNext').addEventListener('click', () => {
  calendarMonth.setMonth(calendarMonth.getMonth() + 1);
  renderCalendar();
});

document.getElementById('noteModalClose').addEventListener('click', closeNoteModal);
document.getElementById('noteModal').addEventListener('click', (e) => {
  if (e.target.id === 'noteModal') closeNoteModal();
});
document.getElementById('noteAddBtn').addEventListener('click', addNote);
document.getElementById('noteInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addNote();
});

async function loadUser() {
  const res = await fetch('/auth/me');
  const data = await res.json();
  const userEl = document.getElementById('currentUser');
  if (userEl) userEl.textContent = data.email || '';
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  });
}

loadUser();
Promise.all([loadDevices(), loadCalendarNotes()]).then(renderCalendar);
