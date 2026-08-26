const API = '/app/api/image-style';
let libraryItems = [];
let selectedRefId = null;

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

async function loadLibrary() {
  const res = await fetch(`${API}/library`);
  const data = await res.json();
  libraryItems = data.items || [];
  renderLibrary();
}

function renderLibrary() {
  const grid = document.getElementById('libraryGrid');
  const empty = document.getElementById('libraryEmpty');
  if (!libraryItems.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  grid.innerHTML = libraryItems
    .slice()
    .reverse()
    .map(
      (item) => `
      <div class="thumb-card ${item.id === selectedRefId ? 'selected' : ''}" data-id="${item.id}">
        <img src="${API}/library/${item.id}/file" alt="${escapeHtml(item.category || '風格參考圖')}" loading="lazy" />
        <div class="thumb-meta">
          <div class="thumb-category">${escapeHtml(item.category || '未分類')}</div>
          ${item.note ? `<div class="thumb-note">${escapeHtml(item.note)}</div>` : ''}
        </div>
        <div class="thumb-actions">
          <button type="button" class="thumb-del" data-id="${item.id}">刪除</button>
        </div>
      </div>`
    )
    .join('');

  grid.querySelectorAll('.thumb-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.thumb-del')) return;
      selectedRefId = card.dataset.id;
      renderLibrary();
      renderSelectedRefPreview();
    });
  });
  grid.querySelectorAll('.thumb-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('確定要刪除這張風格參考圖嗎？')) return;
      await fetch(`${API}/library/${btn.dataset.id}`, { method: 'DELETE' });
      if (selectedRefId === btn.dataset.id) selectedRefId = null;
      await loadLibrary();
      renderSelectedRefPreview();
    });
  });
}

function renderSelectedRefPreview() {
  const el = document.getElementById('selectedRefPreview');
  const item = libraryItems.find((i) => i.id === selectedRefId);
  if (!item) {
    el.innerHTML = '未選擇（將只依文字描述生成）';
    return;
  }
  el.innerHTML = `<img src="${API}/library/${item.id}/file" alt="" /> <span>${escapeHtml(
    item.category || '未分類'
  )}${item.note ? '　' + escapeHtml(item.note) : ''}</span>`;
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('uploadFile');
  const msg = document.getElementById('uploadMsg');
  if (!fileInput.files[0]) return;

  const formData = new FormData();
  formData.append('image', fileInput.files[0]);
  formData.append('category', document.getElementById('uploadCategory').value);
  formData.append('note', document.getElementById('uploadNote').value);

  msg.className = 'message';
  try {
    const res = await fetch(`${API}/library`, { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || '上傳失敗';
      msg.className = 'message error';
      return;
    }
    msg.textContent = '已加入風格庫';
    msg.className = 'message success';
    e.target.reset();
    await loadLibrary();
  } catch (err) {
    msg.textContent = '上傳失敗：' + err.message;
    msg.className = 'message error';
  }
});

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
          <div class="thumb-category">${escapeHtml(item.productName)}</div>
          <div class="thumb-note">${new Date(item.createdAt).toLocaleString('zh-TW')}</div>
        </div>
      </a>`
    )
    .join('');
}

document.getElementById('generateBtn').addEventListener('click', async () => {
  const productName = document.getElementById('productName').value.trim();
  const extraPrompt = document.getElementById('extraPrompt').value.trim();
  const msg = document.getElementById('generateMsg');
  const resultEl = document.getElementById('generateResult');

  if (!productName) {
    msg.textContent = '請輸入商品名稱';
    msg.className = 'message error';
    return;
  }

  msg.className = 'message';
  resultEl.innerHTML = '<div class="generate-loading">生成中…（呼叫 OpenAI 圖片生成，可能需要 10-30 秒）</div>';

  try {
    const res = await fetch(`${API}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName, extraPrompt, referenceId: selectedRefId }),
    });
    const data = await res.json();
    if (!res.ok) {
      resultEl.innerHTML = '';
      msg.textContent = data.error || '生成失敗';
      msg.className = 'message error';
      return;
    }
    resultEl.innerHTML = (data.items || [])
      .map((item) => `<img src="${API}/generated/${item.id}/file" alt="${escapeHtml(item.productName)}" />`)
      .join('');
    msg.textContent = '生成完成，已加入下方生成紀錄';
    msg.className = 'message success';
    await loadHistory();
  } catch (err) {
    resultEl.innerHTML = '';
    msg.textContent = '生成失敗：' + err.message;
    msg.className = 'message error';
  }
});

loadUser();
loadLibrary();
loadHistory();
renderSelectedRefPreview();
