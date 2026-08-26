const API = '/app/api/image-style';
let libraryItems = [];

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
      <div class="thumb-card" data-id="${item.id}">
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

  grid.querySelectorAll('.thumb-del').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('確定要刪除這張風格參考圖嗎？')) return;
      await fetch(`${API}/library/${btn.dataset.id}`, { method: 'DELETE' });
      await loadLibrary();
    });
  });
}

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById('uploadFile');
  const msg = document.getElementById('uploadMsg');
  if (!fileInput.files.length) return;

  const formData = new FormData();
  Array.from(fileInput.files).forEach((f) => formData.append('images', f));
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
    msg.textContent = `已加入風格庫（${data.items.length} 張）`;
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
    resultEl.innerHTML = (data.items || [])
      .map(
        (item) => `
        <div class="gen-item">
          <img src="${API}/generated/${item.id}/file" alt="${escapeHtml(item.sceneLabel || '')}" />
          <div class="gen-item-label">${escapeHtml(item.sceneLabel || '')}</div>
        </div>`
      )
      .join('');

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
loadLibrary();
loadHistory();
