const sharp = require('sharp');

// Windows 上常見、Traditional Chinese顯示沒問題的字型
const FONT_MAP = {
  jhenghei: { label: '微軟正黑體（現代）', family: 'Microsoft JhengHei, sans-serif' },
  kai: { label: '標楷體（書法感）', family: 'DFKai-SB, BiauKai, serif' },
  ming: { label: '新細明體（襯線）', family: 'PMingLiU, serif' },
};

const POSITIONS = ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right'];

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 在既有圖片上疊加一行可精準控制的文字(字型/顏色/大小/位置)
 * @returns {Promise<Buffer>} PNG buffer
 */
async function applyTextOverlay(imageBuffer, { text, font = 'jhenghei', color = '#ffffff', size = 60, position = 'top-left' }) {
  const image = sharp(imageBuffer);
  const meta = await image.metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;

  const fontFamily = (FONT_MAP[font] || FONT_MAP.jhenghei).family;
  const fontSize = Math.max(16, Math.min(300, Number(size) || 60));
  const pad = Math.round(width * 0.05);

  let x = pad;
  let y = pad + fontSize;
  let anchor = 'start';

  switch (position) {
    case 'top-center':
      x = width / 2;
      anchor = 'middle';
      break;
    case 'top-right':
      x = width - pad;
      anchor = 'end';
      break;
    case 'center':
      x = width / 2;
      y = height / 2;
      anchor = 'middle';
      break;
    case 'bottom-left':
      y = height - pad;
      break;
    case 'bottom-center':
      x = width / 2;
      y = height - pad;
      anchor = 'middle';
      break;
    case 'bottom-right':
      x = width - pad;
      y = height - pad;
      anchor = 'end';
      break;
    default:
      break;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="textShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.45"/>
      </filter>
    </defs>
    <text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="700"
      fill="${color}" text-anchor="${anchor}" filter="url(#textShadow)">${escapeXml(text)}</text>
  </svg>`;

  return image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

module.exports = { applyTextOverlay, FONT_MAP, POSITIONS };
