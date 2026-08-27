const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const OpenAI = require('openai');
const { toFile } = require('openai');

const MODULE_DATA_DIR = path.join(__dirname, '..', '..', 'data', 'image-style');
const GENERATED_DIR = path.join(MODULE_DATA_DIR, 'generated');
const GENERATED_INDEX_FILE = path.join(MODULE_DATA_DIR, 'generated.json');

function ensureDirs() {
  [MODULE_DATA_DIR, GENERATED_DIR].forEach((d) => {
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

// 商品去背照只當這次生成的輸入，不需要留存，用記憶體暫存就好
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

router.get('/generated', (req, res) => {
  res.json({ items: loadIndex(GENERATED_INDEX_FILE).slice().reverse() });
});

router.get('/generated/:id/file', (req, res) => {
  const items = loadIndex(GENERATED_INDEX_FILE);
  const item = items.find((i) => i.id === req.params.id);
  if (!item) return res.status(404).end();
  res.sendFile(path.join(GENERATED_DIR, item.filename));
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

module.exports = router;
