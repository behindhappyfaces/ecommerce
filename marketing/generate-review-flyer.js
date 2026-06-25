// One-off script: builds a printable 5-star review flyer matching the site theme.
// Run with: node marketing/generate-review-flyer.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const REVIEW_URL = 'https://g.page/r/CUUfyz-9bw9BEBM/review';
const OUT_PATH = path.join(__dirname, 'Heart-of-Texas-Organics-Review-Flyer.pdf');
const LOGO_PATH = path.join(__dirname, '..', 'images', 'logo.png');

// The logo PNG is icon-on-top, wordmark-below. The wordmark is dark green —
// illegible against a dark green band — so only the icon portion is used in
// the header; a custom light-colored wordmark is set as text instead.
const LOGO_NATURAL_W = 1267;
const LOGO_NATURAL_H = 914;
const LOGO_ICON_CROP_H = 600; // px, icon ends ~555, text starts ~660

const COLOR = {
  cream: '#F5F0E8',
  green: '#2C3E2D',
  greenMid: '#4A5E3A',
  rust: '#8B4A2F',
  rustLight: '#C4714A',
  tan: '#B89B6E',
  tanLight: '#D4BA8A',
  text: '#2A2A2A',
  textMuted: '#6B6B5E',
  white: '#FAFAF5',
};

function drawStar(doc, cx, cy, outerR, innerR, color) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  doc.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) doc.lineTo(points[i][0], points[i][1]);
  doc.closePath().fill(color);
}

async function main() {
  const qrBuffer = await QRCode.toBuffer(REVIEW_URL, {
    width: 600,
    margin: 1,
    color: { dark: COLOR.green, light: '#FFFFFF' },
  });

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  doc.pipe(fs.createWriteStream(OUT_PATH));

  const W = doc.page.width;
  const H = doc.page.height;

  // Background
  doc.rect(0, 0, W, H).fill(COLOR.cream);

  // --- Header band ---
  const headerH = 145;
  doc.rect(0, 0, W, headerH).fill(COLOR.green);

  const iconW = 70;
  const iconH = iconW * (LOGO_ICON_CROP_H / LOGO_NATURAL_W);
  const iconY = 24;
  doc.save();
  doc.rect((W - iconW) / 2, iconY, iconW, iconH).clip();
  doc.image(LOGO_PATH, (W - iconW) / 2, iconY, { width: iconW });
  doc.restore();

  doc.font('Helvetica').fontSize(13).fillColor(COLOR.tanLight)
    .text('HEART OF TEXAS ORGANICS', 0, iconY + iconH + 12, { width: W, align: 'center', characterSpacing: 2 });

  doc.strokeColor(COLOR.tan).lineWidth(1)
    .moveTo(W / 2 - 40, iconY + iconH + 34).lineTo(W / 2 + 40, iconY + iconH + 34).stroke();

  // --- Eyebrow ---
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.rustLight)
    .text('A SMALL FAVOR FOR A SMALL FARM', 0, headerH + 30, { width: W, align: 'center', characterSpacing: 2 });

  // --- Headline ---
  doc.font('Times-Bold').fontSize(30).fillColor(COLOR.green)
    .text('Loved What Landed', 50, headerH + 58, { width: W - 100, align: 'center' });
  doc.font('Times-Bold').fontSize(30).fillColor(COLOR.green)
    .text('on Your Table?', 50, headerH + 58 + 38, { width: W - 100, align: 'center' });

  // --- Subhead ---
  doc.font('Helvetica').fontSize(12).fillColor(COLOR.text)
    .text(
      'If our pasture-raised eggs, fresh-baked bread, or farm-raised chicken made it into ' +
      'your kitchen, we would love to hear about it. A 5-star review takes less time than ' +
      'waiting for the bread to rise — and it means everything to a small family farm like ours.',
      85, headerH + 160, { width: W - 170, align: 'center', lineGap: 2 }
    );

  // --- CTA banner ---
  const bannerY = headerH + 248;
  const bannerH = 28;
  doc.rect(70, bannerY, W - 140, bannerH).fill(COLOR.rust);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR.cream)
    .text('SCAN BELOW TO LEAVE YOUR 5-STAR REVIEW', 70, bannerY + 8, { width: W - 140, align: 'center', characterSpacing: 1 });

  // --- QR code card ---
  const qrSize = 160;
  const qrCardSize = qrSize + 30;
  const qrCardX = (W - qrCardSize) / 2;
  const qrCardY = bannerY + bannerH + 18;
  doc.roundedRect(qrCardX, qrCardY, qrCardSize, qrCardSize, 10)
    .fillAndStroke(COLOR.white, COLOR.tan);
  doc.image(qrBuffer, qrCardX + 15, qrCardY + 15, { width: qrSize, height: qrSize });

  // --- Stars ---
  const starsY = qrCardY + qrCardSize + 12;
  const starR = 9, starGap = 26, starCount = 5;
  const starsRowW = starGap * (starCount - 1);
  const starsStartX = (W - starsRowW) / 2;
  for (let i = 0; i < starCount; i++) {
    drawStar(doc, starsStartX + i * starGap, starsY + starR, starR, starR * 0.42, COLOR.tan);
  }

  // --- Fallback link ---
  doc.font('Helvetica').fontSize(9).fillColor(COLOR.textMuted)
    .text('Can’t scan? Visit:', 0, starsY + 26, { width: W, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.greenMid)
    .text(REVIEW_URL, 0, starsY + 41, { width: W, align: 'center' });

  // --- Footer band ---
  const footerH = 92;
  doc.rect(0, H - footerH, W, footerH).fill(COLOR.green);
  doc.font('Times-Bold').fontSize(13).fillColor(COLOR.cream)
    .text('With gratitude, the Heart of Texas Organics family', 0, H - footerH + 28, { width: W, align: 'center' });
  doc.font('Helvetica').fontSize(10).fillColor(COLOR.tanLight)
    .text('Real food, made by real people. NO shortcuts!', 0, H - footerH + 52, { width: W, align: 'center', characterSpacing: 0.5 });

  doc.end();
  doc.on('end', () => console.log('Saved flyer to: ' + OUT_PATH));
}

main().catch(err => { console.error(err); process.exit(1); });
