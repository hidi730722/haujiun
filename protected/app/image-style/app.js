const API = '/app/api/image-style';
let TEXT_OPTIONS = { fonts: [], positions: [] };

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadUser() {
  const res = await fetch('/auth/me');
  const data = await res.json();
  document.getElementById('currentUser').textContent = data.email || '';
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST' });
  location.href = '/login.html';
});

async function loadTextOptions() {
  const res = await fetch(`${API}/text-options`);
  TEXT_OPTIONS = await res.json();
}

const POSITION_LABELS = {
  'top-left': '左上',
  'top-center': '上中',
  'top-right': '右上',
  center: '正中央',
  'bottom-left': '左下',
  'bottom-center': '下中',
  'bottom-right': '右下',
};

function genItemHtml(item) {
  return `
    <div class="gen-item" data-id="${item.id}">
      <img src="${API}/generated/${item.id}/file" alt="${escapeHtml(item.sceneLabel || '')}" />
      <div class="gen-item-label">${escapeHtml(item.sceneLabel || '')}</div>
      <button type="button" class="btn-secondary text-toggle-btn">＋加文字</button>
      <div class="text-panel" hidden>
        <input type="text" class="text-input" placeholder="想加的文字（例如：強力防護）" maxlength="12" />
        <div class="text-panel-row">
          <select class="text-font">
            ${TEXT_OPTIONS.fonts.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')}
          </select>
          <input type="color" class="text-color" value="#ffffff" />
        </div>
        <div class="text-panel-row">
          <label class="text-size-label">大小 <span class="text-size-val">60</span>px</label>
          <input type="range" class="text-size" min="24" max="160" value="60" />
        </div>
        <select class="text-position">
          ${TEXT_OPTIONS.positions
            .map((p) => `<option value="${p}" ${p === 'top-left' ? 'selected' : ''}>${POSITION_LABELS[p] || p}</option>`)
            .join('')}
        </select>
        <button type="button" class="btn-primary text-apply-btn">套用</button>
        <div class="text-panel-msg"></div>
      </div>
    </div>`;
}

function wireGenItem(card) {
  const id = card.dataset.id;
  const toggleBtn = card.querySelector('.text-toggle-btn');
  const panel = card.querySelector('.text-panel');
  const sizeInput = card.querySelector('.text-size');
  const sizeVal = card.querySelector('.text-size-val');
  const applyBtn = card.querySelector('.text-apply-btn');
  const msg = card.querySelector('.text-panel-msg');

  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  sizeInput.addEventListener('input', () => {
    sizeVal.textContent = sizeInput.value;
  });

  applyBtn.addEventListener('click', async () => {
    const text = card.querySelector('.text-input').value.trim();
    if (!text) {
      msg.textContent = '請輸入文字內容';
      msg.className = 'text-panel-msg error';
      return;
    }
    const payload = {
      imageId: id,
      text,
      font: card.querySelector('.text-font').value,
      color: card.querySelector('.text-color').value,
      size: sizeInput.value,
      position: card.querySelector('.text-position').value,
    };
    msg.textContent = '套用中…';
    msg.className = 'text-panel-msg';
    applyBtn.disabled = true;
    try {
      const res = await fetch(`${API}/add-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || '加字失敗';
        msg.className = 'text-panel-msg error';
        return;
      }
      msg.textContent = '已加入下方生成紀錄';
      msg.className = 'text-panel-msg success';
      const resultEl = document.getElementById('generateSetResult');
      const newCard = document.createElement('div');
      newCard.innerHTML = genItemHtml(data.item);
      const el = newCard.firstElementChild;
      resultEl.appendChild(el);
      wireGenItem(el);
      await loadHistory();
    } catch (err) {
      msg.textContent = '加字失敗：' + err.message;
      msg.className = 'text-panel-msg error';
    } finally {
      applyBtn.disabled = false;
    }
  });
}

async function loadHistory() {
  const res = await fetch(`${API}/generated`);
  const data = await res.json();
  const grid = document.getElementById('historyGrid');
  const empty = document.getElementById('historyEmpty');
  const items = data.items || [];
  if (!items.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = items
    .map(
      (item) => `
      <a class="thumb-card" href="${API}/generated/${item.id}/file" target="_blank" rel="noopener">
        <img src="${API}/generated/${item.id}/file" alt="${escapeHtml(item.productName)}" loading="lazy" />
        <div class="thumb-meta">
          <div class="thumb-category">${escapeHtml(item.productName)}${
        item.sceneLabel ? `　${escapeHtml(item.sceneLabel)}` : ''
      }</div>
          <div class="thumb-note">${new Date(item.createdAt).toLocaleString('zh-TW')}</div>
        </div>
      </a>`
    )
    .join('');
}

document.getElementById('generateSetBtn').addEventListener('click', async () => {
  const fileInput = document.getElementById('productPhoto');
  const msg = document.getElementById('genMsg');
  const resultEl = document.getElementById('generateSetResult');

  if (!fileInput.files[0]) {
    msg.textContent = '請先上傳商品去背照片';
    msg.className = 'message error';
    return;
  }

  const count = document.getElementById('genCount').value;
  const formData = new FormData();
  formData.append('productImage', fileInput.files[0]);
  formData.append('productName', document.getElementById('productName2').value.trim());
  formData.append('count', count);
  formData.append('styleNote', document.getElementById('styleNote2').value.trim());
  formData.append('headline', document.getElementById('headline2').value.trim());

  msg.className = 'message';
  resultEl.innerHTML = `<div class="generate-loading">生成中…（共 ${count} 張，可能需要 30-90 秒，請耐心等候）</div>`;

  try {
    const res = await fetch(`${API}/generate-set`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '';
      msg.textContent = data.error || '生成失敗';
      msg.className = 'message error';
      return;
    }
    resultEl.innerHTML = (data.items || []).map(genItemHtml).join('');
    resultEl.querySelectorAll('.gen-item').forEach(wireGenItem);

    let msgText = `完成 ${data.items.length} 張`;
    const hasErrors = data.errors && data.errors.length;
    if (hasErrors) {
      msgText += `，${data.errors.length} 張失敗（${data.errors.map((e) => e.scene).join('、')}）`;
    }
    msg.textContent = msgText;
    msg.className = hasErrors ? 'message error' : 'message success';
    await loadHistory();
  } catch (err) {
    resultEl.innerHTML = '';
    msg.textContent = '生成失敗：' + err.message;
    msg.className = 'message error';
  }
});

loadUser();
loadHistory();
loadTextOptions();
