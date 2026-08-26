const sharp = require('sharp');

const FONT_FAMILY = 'Microsoft JhengHei, PMingLiU, PingFang TC, sans-serif';

const THEMES = {
  purple: { bg1: '#f3e8ff', bg2: '#ddd0fb', accent: '#7c3aed', text: '#3b1f6b' },
  blue: { bg1: '#e6f0ff', bg2: '#cfe2ff', accent: '#2563eb', text: '#1e3a8a' },
  pink: { bg1: '#ffe8f3', bg2: '#fbd0e6', accent: '#db2777', text: '#831843' },
  green: { bg1: '#e8fff3', bg2: '#c8f7dd', accent: '#059669', text: '#064e3b' },
  neutral: { bg1: '#f5f5f5', bg2: '#e5e5e5', accent: '#374151', text: '#111827' },
};

// 簡單向量小圖示，畫在 icon 圓圈裡（避免用emoji在不同系統顯示不一致）
const ICON_PATHS = {
  sparkle: 'M12 2 L14 9 L21 11 L14 13 L12 20 L10 13 L3 11 L10 9 Z',
  check: 'M4 12 L10 18 L20 6',
  shield: 'M12 2 L20 6 V11 C20 16 16.5 20 12 22 C7.5 20 4 16 4 11 V6 Z',
  diamond: 'M6 3 H18 L22 9 L12 21 L2 9 Z',
  bolt: 'M13 2 L4 14 H11 L10 22 L20 9 H13 Z',
  drop: 'M12 2 C12 2 5 11 5 15.5 C5 19.09 8.13 22 12 22 C15.87 22 19 19.09 19 15.5 C19 11 12 2 12 2 Z',
};

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function iconGlyph(type, cx, cy, color) {
  const d = ICON_PATHS[type] || ICON_PATHS.sparkle;
  return `<circle cx="${cx}" cy="${cy}" r="24" fill="${color}"/>
    <g transform="translate(${cx - 12}, ${cy - 12}) scale(1)">
      <path d="${d}" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>`;
}

function fitHeadlineSize(text) {
  const len = [...text].length;
  if (len <= 5) return 72;
  if (len <= 8) return 56;
  if (len <= 12) return 42;
  return 34;
}

/**
 * 產生一張蝦皮風格的圖文行銷卡（大標題+副標+重點條列+商品圖+品牌LOGO）
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderFeatureCard({
  headline,
  subheadline,
  bullets = [],
  tag,
  productImageBuffer,
  logoBuffer,
  theme = 'purple',
  size = 1000,
}) {
  const t = THEMES[theme] || THEMES.purple;
  const headlineSize = fitHeadlineSize(headline || '');

  const bulletsSvg = bullets
    .slice(0, 4)
    .map((b, i) => {
      const y = 300 + i * 78;
      return `${iconGlyph(b.icon, 70, y, t.accent)}
        <text x="112" y="${y + 8}" font-family="${FONT_FAMILY}" font-size="26" fill="${t.text}">${escapeXml(
        b.text
      )}</text>`;
    })
    .join('\n');

  const tagSvg = tag
    ? `<rect x="50" y="40" width="${Math.min(500, 40 + [...tag].length * 20)}" height="44" rx="22" fill="${t.accent}"/>
       <text x="${50 + 20}" y="68" font-family="${FONT_FAMILY}" font-size="20" font-weight="600" fill="white">${escapeXml(
        tag
      )}</text>`
    : '';

  const headlineY = tag ? 175 : 130;
  const subheadlineY = headlineY + 55;
  const lineY = subheadlineY + 20;
  const bulletsStartY = lineY + 90;

  let productSvg = '';
  if (productImageBuffer) {
    const b64 = productImageBuffer.toString('base64');
    const boxSize = 560;
    const boxX = size - boxSize - 60;
    const boxY = size - boxSize - 60;
    productSvg = `
      <defs>
        <clipPath id="productClip">
          <rect x="${boxX}" y="${boxY}" width="${boxSize}" height="${boxSize}" rx="24"/>
        </clipPath>
      </defs>
      <rect x="${boxX}" y="${boxY}" width="${boxSize}" height="${boxSize}" rx="24" fill="white"/>
      <image href="data:image/png;base64,${b64}" x="${boxX}" y="${boxY}" width="${boxSize}" height="${boxSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#productClip)"/>
    `;
  }

  let logoSvg = '';
  const logoCx = size - 90;
  const logoCy = size - 90;
  if (logoBuffer) {
    const logoB64 = logoBuffer.toString('base64');
    logoSvg = `<image href="data:image/png;base64,${logoB64}" x="${logoCx - 80}" y="${logoCy - 80}" width="160" height="160"/>`;
  } else {
    logoSvg = `<circle cx="${logoCx}" cy="${logoCy}" r="60" fill="white" stroke="${t.accent}" stroke-width="2"/>
      <text x="${logoCx}" y="${logoCy + 8}" font-family="${FONT_FAMILY}" font-size="18" font-weight="700" text-anchor="middle" fill="${t.accent}">LOGO</text>`;
  }

  const svg = `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${t.bg1}"/>
        <stop offset="100%" stop-color="${t.bg2}"/>
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" fill="url(#bg)"/>
    ${tagSvg}
    <text x="50" y="${headlineY}" font-family="${FONT_FAMILY}" font-size="${headlineSize}" font-weight="700" fill="${t.text}">${escapeXml(
    headline || ''
  )}</text>
    ${
      subheadline
        ? `<text x="50" y="${subheadlineY}" font-family="${FONT_FAMILY}" font-size="26" fill="${t.text}">${escapeXml(
            subheadline
          )}</text>`
        : ''
    }
    <line x1="50" y1="${lineY}" x2="230" y2="${lineY}" stroke="${t.text}" stroke-width="4"/>
    ${bulletsSvg}
    ${productSvg}
    ${logoSvg}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = { renderFeatureCard, THEMES, ICON_PATHS };
