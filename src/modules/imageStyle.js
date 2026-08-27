const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const OpenAI = require('openai');
const { toFile } = require('openai');
const sharp = require('sharp');
const { renderFeatureCard, THEMES, ICON_PATHS } = require('../lib/cardTemplate');

const EXT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const MODULE_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'image-style');
const LIBRARY_DIR = path.join(MODULE_DATA_DIR, 'library');
const LIBRARY_INDEX_FILE = path.join(MODULE_DATA_DIR, 'library.json');
const GENERATED_DIR = path.join(MODULE_DATA_DIR, 'generated');
const GENERATED_INDEX_FILE = path.join(MODULE_DATA_DIR, 'generated.json');
const LOGO_FILE = path.join(MODULE_DATA_DIR, 'logo.png');

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

// 商品去背照只當這次生成的輸入，不需要存進風格庫，用記憶體暫存就好
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.includes(file.mimetype)),
});

// 一張商品去背照 → 自動生成一整套不同用途的蝦皮商品圖，依「要生成幾張」取前N個模板
const SCENE_TEMPLATES = [
  {
    label: '主圖-純白底',
    prompt:
      '把這張商品去背照片，合成一張電商標準主圖：純白色背景，商品置中並完整呈現最清楚的正面角度，打光均勻乾淨，適合當蝦皮商品主圖。',
  },
  {
    label: '情境圖-生活實拍',
    prompt:
      '把這個商品自然地融入真實生活情境畫面中（例如放在木質桌面、有人手持使用、居家或戶外場景），呈現商品實際使用情境，光線自然溫暖。',
  },
  {
    label: '細節特寫',
    prompt:
      '將這個商品做特寫鏡頭，放大呈現材質、做工、接縫、按鍵或logo等細節質感，背景模糊呈現淺景深，凸顯品質感。',
  },
  {
    label: '多角度-側背面',
    prompt: '呈現這個商品的側面或背面角度，讓消費者能看到主圖看不到的另一面設計細節，背景維持簡潔淺色。',
  },
  {
    label: '質感情境',
    prompt: '將商品擺放在質感生活風格場景中拍攝（大理石、原木、簡約北歐風），搭配少量道具點綴，呈現品牌質感與氛圍。',
  },
  {
    label: '尺寸比例參考',
    prompt: '呈現這個商品與常見參考物（例如手機、硬幣、手掌）並列的畫面，方便消費者理解實際尺寸大小，背景簡潔。',
  },
  {
    label: '色彩質感呈現',
    prompt: '強調商品的顏色或材質特色，畫面色調與商品主色呼應，呈現時尚精品般的視覺效果。',
  },
  {
    label: '使用手勢-動態感',
    prompt: '呈現有人手持或正在使用這個商品的動態畫面，帶出商品的實際操作情境與尺寸手感。',
  },
];

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

function buildScenePrompt(productName, template, styleNote) {
  let p = `這是「${productName || '這款3C配件商品'}」的商品去背照片。${template.prompt}`;
  if (styleNote && styleNote.trim()) {
    p += ` 額外要求：${styleNote.trim()}`;
  }
  p +=
    ' 務必保留商品本身的外觀、顏色、比例與細節完全一致，不要更改商品造型或新增不存在的元件，只改變背景、情境與拍攝角度。畫面乾淨、不要出現文字浮水印，適合直接用於蝦皮商品頁。';
  return p;
}

const ENRICH_SYSTEM_PROMPT =
  '你是專業商品攝影指導，負責把簡短的生圖需求擴寫成詳細、生動、具體的英文攝影描述，供AI生圖模型使用。要包含：燈光設定、構圖角度、背景材質與氛圍、鏡頭感(景深/焦段)、色調。絕對不要更改商品本身外觀、顏色、比例。只輸出擴寫後的描述本身，不要其他說明文字。';

// 用便宜的文字模型把固定模板擴寫成更生動具體的描述(比照ChatGPT聊天生圖時內部會做的prompt擴寫)，
// 讓結果更接近使用者在ChatGPT網頁手動生成的品質。擴寫失敗就直接用原本的prompt，不影響主流程。
async function enrichPrompt(openai, basePrompt) {
  try {
    const r = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: ENRICH_SYSTEM_PROMPT },
        { role: 'user', content: basePrompt },
      ],
      max_completion_tokens: 400,
    });
    const text = r.choices?.[0]?.message?.content?.trim();
    return text || basePrompt;
  } catch {
    return basePrompt;
  }
}

const router = express.Router();

router.get('/logo', (req, res) => {
  if (!fs.existsSync(LOGO_FILE)) return res.status(404).end();
  res.sendFile(LOGO_FILE);
});

router.post('/logo', uploadMemory.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '請上傳 LOGO 圖片(建議透明背景 PNG)' });
  try {
    await sharp(req.file.buffer)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toFile(LOGO_FILE);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message || 'LOGO 處理失敗' });
  }
});

router.get('/library', (req, res) => {
  res.json({ items: loadIndex(LIBRARY_INDEX_FILE) });
});

router.post('/library', upload.array('images', 20), (req, res) => {
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: '請上傳圖片檔案(jpg/png/webp，10MB以內，可一次選多張)' });
  }
  const { category, note } = req.body || {};
  const items = loadIndex(LIBRARY_INDEX_FILE);
  const saved = [];
  for (const file of req.files) {
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      filename: file.filename,
      category: category || '',
      note: note || '',
      uploadedAt: new Date().toISOString(),
    };
    items.push(item);
    saved.push(item);
  }
  saveIndex(LIBRARY_INDEX_FILE, items);
  res.json({ ok: true, items: saved });
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

router.post('/generate-set', uploadMemory.single('productImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '請上傳商品去背照片(jpg/png/webp，10MB以內)' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({
      error:
        '尚未設定 OpenAI API 金鑰。請到 platform.openai.com 申請金鑰並綁定付款方式，在 .env 加入 OPENAI_API_KEY=你的金鑰 後重啟伺服器再試一次。',
    });
  }

  const productName = (req.body.productName || '').trim();
  const styleNote = req.body.styleNote || '';
  let count = parseInt(req.body.count, 10);
  if (!Number.isFinite(count)) count = 4;
  count = Math.min(SCENE_TEMPLATES.length, Math.max(2, count));

  const templates = SCENE_TEMPLATES.slice(0, count);
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const jobs = templates.map(async (tmpl) => {
    const refFile = await toFile(req.file.buffer, req.file.originalname || 'product.png', {
      type: req.file.mimetype,
    });
    const basePrompt = buildScenePrompt(productName, tmpl, styleNote);
    const prompt = await enrichPrompt(openai, basePrompt);
    const result = await openai.images.edit({
      model: 'gpt-image-1.5',
      image: refFile,
      prompt,
      size: '1024x1024',
      quality: 'medium',
    });
    const img = result.data && result.data[0];
    if (!img || !img.b64_json) throw new Error('沒有取得圖片資料');
    const filename = crypto.randomBytes(8).toString('hex') + '.png';
    fs.writeFileSync(path.join(GENERATED_DIR, filename), Buffer.from(img.b64_json, 'base64'));
    return { filename, sceneLabel: tmpl.label, prompt };
  });

  const settled = await Promise.allSettled(jobs);
  const genItems = loadIndex(GENERATED_INDEX_FILE);
  const saved = [];
  const errors = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const record = {
        id: crypto.randomBytes(6).toString('hex'),
        filename: result.value.filename,
        productName: productName || '未命名商品',
        sceneLabel: result.value.sceneLabel,
        prompt: result.value.prompt,
        createdAt: new Date().toISOString(),
      };
      genItems.push(record);
      saved.push(record);
    } else {
      errors.push({ scene: templates[i].label, error: result.reason.message || String(result.reason) });
    }
  });

  saveIndex(GENERATED_INDEX_FILE, genItems);
  res.json({ ok: true, items: saved, errors });
});

router.get('/card-options', (req, res) => {
  res.json({
    themes: Object.keys(THEMES),
    icons: Object.keys(ICON_PATHS),
    hasLogo: fs.existsSync(LOGO_FILE),
  });
});

router.post('/generate-card', uploadMemory.single('productImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '請上傳商品圖片(jpg/png/webp，10MB以內)' });
  }

  const headline = (req.body.headline || '').trim();
  if (!headline) {
    return res.status(400).json({ error: '請輸入大標題文字' });
  }

  let bullets = [];
  try {
    bullets = JSON.parse(req.body.bulletsJson || '[]');
  } catch {
    bullets = [];
  }

  const theme = req.body.theme || 'purple';
  const subheadline = req.body.subheadline || '';
  const tag = req.body.tag || '';
  const productName = (req.body.productName || '').trim() || '未命名商品';

  try {
    const logoBuffer = fs.existsSync(LOGO_FILE) ? fs.readFileSync(LOGO_FILE) : null;
    const pngBuffer = await renderFeatureCard({
      headline,
      subheadline,
      bullets,
      tag,
      theme,
      productImageBuffer: req.file.buffer,
      logoBuffer,
    });

    const filename = crypto.randomBytes(8).toString('hex') + '.png';
    fs.writeFileSync(path.join(GENERATED_DIR, filename), pngBuffer);

    const genItems = loadIndex(GENERATED_INDEX_FILE);
    const record = {
      id: crypto.randomBytes(6).toString('hex'),
      filename,
      productName,
      sceneLabel: '圖文行銷卡',
      createdAt: new Date().toISOString(),
    };
    genItems.push(record);
    saveIndex(GENERATED_INDEX_FILE, genItems);

    res.json({ ok: true, item: record });
  } catch (e) {
    res.status(500).json({ error: e.message || '生成失敗' });
  }
});

module.exports = router;
