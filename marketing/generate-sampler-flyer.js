// One-off script: builds a printable flyer advertising the Farm Sampler Box.
// Run with: node marketing/generate-sampler-flyer.js
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const ORDER_URL = 'https://www.heartoftexasorganics.com/offerings.html?open=sampler';
const OUT_PATH = path.join(__dirname, 'Heart-of-Texas-Organics-Sampler-Box-Flyer.pdf');
const LOGO_PATH = path.join(__dirname, '..', 'images', 'logo.png');

const LOGO_NATURAL_W = 1267;
const LOGO_ICON_CROP_H = 600;

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

const INCLUDED = [
  ['Whole Chicken', 'Pasture-raised 13 weeks and processed into 10 cuts — ready for your freezer. Add neckbone for $2.'],
  ['Farm Fresh Eggs', 'Pasture-raised, Non-GMO, soy-free. 1 dozen.'],
  ['Real Cream Butter', 'Made from real grass-fed and finished cream. Half a pound of the real thing. Choose Sea Salt or Unsalted — add Rosemary for $4.'],
  ['Garlic Chili Crunch', 'A farm-made finishing oil with heat and depth. 4oz — swap for Tuscany Herb Dipping Oil.'],
  ['Farm to Table Recipe Guide', 'Digital download with recipes built around what\'s in the box.'],
];

const ADDONS = [
  ['Chicken Bone Broth, 16 oz', '$20'],
  ['Seasonal Preserves', '$15-$18'],
  ['Butter  1/2 lb $17  |  1 lb $24.99', ''],
  ['Cinnamon Rolls (1/2 doz)', '$35'],
  ['Yeast Rolls (1 doz)', '$24'],
];

async function main() {
  const qrBuffer = await QRCode.toBuffer(ORDER_URL, {
    width: 600,
    margin: 1,
    color: { dark: COLOR.green, light: '#FFFFFF' },
  });

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 0, bottom: 0, left: 0, right: 0 } });
  doc.pipe(fs.createWriteStream(OUT_PATH));

  const W = doc.page.width;
  const H = doc.page.height;

  doc.rect(0, 0, W, H).fill(COLOR.cream);

  // --- Header band ---
  const headerH = 85;
  doc.rect(0, 0, W, headerH).fill(COLOR.green);

  const iconW = 56;
  const iconH = iconW * (LOGO_ICON_CROP_H / LOGO_NATURAL_W);
  const iconY = 18;
  doc.save();
  doc.rect((W - iconW) / 2, iconY, iconW, iconH).clip();
  doc.image(LOGO_PATH, (W - iconW) / 2, iconY, { width: iconW });
  doc.restore();

  doc.font('Helvetica').fontSize(11).fillColor(COLOR.tanLight)
    .text('HEART OF TEXAS ORGANICS', 0, iconY + iconH + 9, { width: W, align: 'center', characterSpacing: 2 });

  // --- Eyebrow ---
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.rustLight)
    .text('NEW TO THE FARM?', 0, headerH + 20, { width: W, align: 'center', characterSpacing: 2 });

  // --- Headline ---
  doc.font('Times-Bold').fontSize(32).fillColor(COLOR.green)
    .text('The Farm Sampler Box', 50, headerH + 42, { width: W - 100, align: 'center' });

  // --- Price ---
  doc.font('Helvetica-Bold').fontSize(15).fillColor(COLOR.rust)
    .text('$149  ·  One-Time Purchase', 0, headerH + 84, { width: W, align: 'center' });

  // --- Subhead ---
  doc.font('Helvetica').fontSize(11).fillColor(COLOR.text)
    .text(
      'The easiest way to taste what our farm is all about — a hand-picked box of our ' +
      'most-loved pasture-raised staples, ready for your table.',
      75, headerH + 110, { width: W - 150, align: 'center', lineGap: 2 }
    );

  // --- What's Included ---
  const listY = headerH + 148;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.green)
    .text("WHAT'S INCLUDED", 60, listY, { characterSpacing: 1.5 });

  let rowY = listY + 14;
  const rowH = 44;
  const detailW = W - 120 - 34;
  INCLUDED.forEach(([name, detail]) => {
    doc.roundedRect(60, rowY, W - 120, rowH - 4, 6).fill(COLOR.white);
    doc.rect(76, rowY + 12, 7, 7).fill(COLOR.rust);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR.green)
      .text(name, 94, rowY + 5, { continued: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.textMuted)
      .text(detail, 94, rowY + 18, { width: detailW, lineGap: 1 });
    rowY += rowH;
  });

  // --- Add-Ons ---
  const addonY = rowY + 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLOR.green)
    .text('ADD TO YOUR BOX (OPTIONAL)', 60, addonY, { characterSpacing: 1.5 });

  const ay = addonY + 18;
  const addonCols = 2;
  const addonColW = (W - 120 - 10) / addonCols;
  const addonRowH = 26;
  ADDONS.forEach(([name, price], i) => {
    const col = i % addonCols;
    const row = Math.floor(i / addonCols);
    const x = 60 + col * (addonColW + 10);
    const y = ay + row * addonRowH;
    doc.roundedRect(x, y, addonColW, 22, 5).strokeColor(COLOR.tan).lineWidth(1).stroke();
    const nameW = price ? addonColW - 68 : addonColW - 16;
    doc.font('Helvetica').fontSize(8.5).fillColor(COLOR.text)
      .text(name, x + 8, y + 6, { width: nameW });
    if (price) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(COLOR.rust)
        .text(price, x + addonColW - 62, y + 6, { width: 56, align: 'right' });
    }
  });

  const addonBottom = ay + Math.ceil(ADDONS.length / addonCols) * addonRowH;

  // --- CTA banner ---
  const bannerY = addonBottom + 12;
  const bannerH = 26;
  doc.rect(70, bannerY, W - 140, bannerH).fill(COLOR.rust);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLOR.cream)
    .text('SCAN TO ORDER YOUR BOX', 70, bannerY + 7, { width: W - 140, align: 'center', characterSpacing: 1 });

  // --- QR code card ---
  const qrSize = 78;
  const qrCardW = qrSize + 24;
  const qrCardH = qrSize + 34;
  const qrCardX = (W - qrCardW) / 2;
  const qrCardY = bannerY + bannerH + 12;
  doc.roundedRect(qrCardX, qrCardY, qrCardW, qrCardH, 10)
    .fillAndStroke(COLOR.white, COLOR.tan);
  doc.image(qrBuffer, qrCardX + 12, qrCardY + 10, { width: qrSize, height: qrSize });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLOR.textMuted)
    .text('heartoftexasorganics.com/offerings.html', qrCardX, qrCardY + qrSize + 14, { width: qrCardW, align: 'center' });

  // --- Footer band ---
  const footerH = 56;
  doc.rect(0, H - footerH, W, footerH).fill(COLOR.green);
  doc.font('Times-Bold').fontSize(12).fillColor(COLOR.cream)
    .text('Real food, made by real people. NO shortcuts!', 0, H - footerH + 20, { width: W, align: 'center' });

  doc.end();
  doc.on('end', () => console.log('Saved flyer to: ' + OUT_PATH));
}

main().catch(err => { console.error(err); process.exit(1); });
