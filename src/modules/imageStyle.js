const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const OpenAI = require('openai');
const { toFile } = require('openai');

const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const MODULE_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'image-style');
const LIBRARY_DIR = path.join(MODULE_DATA_DIR, 'library');
const LIBRARY_INDEX_FILE = path.join(MODULE_DATA_DIR, 'library.json');
const GENERATED_DIR = path.join(MODULE_DATA_DIR, 'generated');
const GENERATED_INDEX_FILE = path.join(MODULE_DATA_DIR, 'generated.json');

function ensureDirs() {
  [MODULE_DATA_DIR, LIBRARY_DIR, GENERATED_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}
ensureDirs();

function loadIndex(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIndex(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.diskStorage({
    destination: LIBRARY_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, crypto.randomBytes(8).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

function buildPrompt(productName, reference, extraPrompt) {
  let p = `為「${productName}」這款3C配件商品，拍攝一張電商商品主圖。`;
  if (reference) {
    p += `風格需比照參考圖片的整體構圖、背景、光線與色調，維持一致的品牌視覺風格（參考圖類別：${
      reference.category || '未分類'
    }${reference.note ? '，風格重點：' + reference.note : ''}）。`;
  }
  if (extraPrompt && extraPrompt.trim()) {
    p += ` ${extraPrompt.trim()}`;
  }
  p += ' 畫面乾淨、商品置中、適合放在蝦皮商品頁當主圖，不要有文字浮水印。';
  return p;
}

const router = express.Router();

router.get('/library', (req, res) => {
  res.json({ items: loadIndex(LIBRARY_INDEX_FILE) });
});

router.post('/library', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳圖片檔案(jpg/png/webp，10MB以內)' });
  const { category, note } = req.body || {};
  const items = loadIndex(LIBRARY_INDEX_FILE);
  const item = {
    id: crypto.randomBytes(6).toString('hex'),
    filename: req.file.filename,
    category: category || '',
    note: note || '',
    uploadedAt: new Date().toISOString(),
  };
  items.push(item);
  saveIndex(LIBRARY_INDEX_FILE, items);
  res.json({ ok: true, item });
});

router.delete('/library/:id', (req, res) => {
  const items = loadIndex(LIBRARY_INDEX_FILE);
  const target = items.find((i) => i.id === req.params.id);
  if (target) {
    const filePath = path.join(LIBRARY_DIR, target.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  saveIndex(
    LIBRARY_INDEX_FILE,
    items.filter((i) => i.id !== req.params.id)
  );
  res.json({ ok: true });
});

router.get('/library/:id/file', (req, res) => {
  const items = loadIndex(LIBRARY_INDEX_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).end();
  res.sendFile(path.join(LIBRARY_DIR, item.filename));
});

router.get('/generated', (req, res) => {
  res.json({ items: loadIndex(GENERATED_INDEX_FILE).slice().reverse() });
});

router.get('/generated/:id/file', (req, res) => {
  const items = loadIndex(GENERATED_INDEX_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).end();
  res.sendFile(path.join(GENERATED_DIR, item.filename));
});

router.post('/generate', async (req, res) => {
  const { productName, extraPrompt, referenceId } = req.body || {};
  if (!productName || !productName.trim()) {
    return res.status(400).json({ error: '請輸入商品名稱' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({
      error:
        '尚未設定 OpenAI API 金鑰。請到 platform.openai.com 申請金鑰並綁定付款方式，在 .env 加入 OPENAI_API_KEY=你的金鑰 後重啟伺服器再試一次。',
    });
  }

  const libraryItems = loadIndex(LIBRARY_INDEX_FILE);
  const reference = libraryItems.find((i) => i.id === referenceId);
  const prompt = buildPrompt(productName.trim(), reference, extraPrompt);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    let result;
    if (reference) {
      const refPath = path.join(LIBRARY_DIR, reference.filename);
      const mime = EXT_MIME[path.extname(refPath).toLowerCase()] || 'image/png';
      const refFile = await toFile(fs.createReadStream(refPath), path.basename(refPath), { type: mime });
      result = await openai.images.edit({
        model: 'gpt-image-1.5',
        image: refFile,
        prompt,
        size: '1024x1024',
        quality: 'medium',
      });
    } else {
      result = await openai.images.generate({
        model: 'gpt-image-1.5',
        prompt,
        size: '1024x1024',
        quality: 'medium',
      });
    }

    const genItems = loadIndex(GENERATED_INDEX_FILE);
    const saved = [];
    for (const img of result.data || []) {
      if (!img.b64_json) continue;
      const filename = crypto.randomBytes(8).toString('hex') + '.png';
      fs.writeFileSync(path.join(GENERATED_DIR, filename), Buffer.from(img.b64_json, 'base64'));
      const record = {
        id: crypto.randomBytes(6).toString('hex'),
        filename,
        productName: productName.trim(),
        prompt,
        referenceId: referenceId || null,
        createdAt: new Date().toISOString(),
      };
      genItems.push(record);
      saved.push(record);
    }
    saveIndex(GENERATED_INDEX_FILE, genItems);
    res.json({ ok: true, items: saved });
  } catch (e) {
    res.status(500).json({ error: e.message || '生成失敗' });
  }
});

module.exports = router;
