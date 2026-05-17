#!/usr/bin/env node
'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const CSV_PATH      = path.join(__dirname, 'shipping-products.csv');
const OBSIDIAN_PATH = '/Users/deborahsmith/Documents/collab/BehindHappyFaces/shipping-estimates';

const STANDARD_BOXES = [
  { name: 'Small',  l: 8,  w: 6,  h: 4  },
  { name: 'Medium', l: 12, w: 10, h: 6  },
  { name: 'Large',  l: 16, w: 12, h: 8  },
  { name: 'XL',     l: 20, w: 16, h: 12 },
  { name: 'XXL',    l: 24, w: 18, h: 18 },
  { name: '2XL',    l: 30, w: 20, h: 20 },
];

// ─── CSV helpers ─────────────────────────────────────────────────────────────

function readProducts() {
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, 'name,weight_lbs,length_in,width_in,height_in\n');
    return [];
  }
  const lines = fs.readFileSync(CSV_PATH, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).filter(Boolean).map(line => {
    const [name, weight_lbs, length_in, width_in, height_in] = line.split(',');
    return {
      name:       name.trim(),
      weight_lbs: parseFloat(weight_lbs),
      length_in:  parseFloat(length_in),
      width_in:   parseFloat(width_in),
      height_in:  parseFloat(height_in),
    };
  });
}

function writeProducts(products) {
  const header = 'name,weight_lbs,length_in,width_in,height_in';
  const rows   = products.map(p =>
    `${p.name},${p.weight_lbs},${p.length_in},${p.width_in},${p.height_in}`
  );
  fs.writeFileSync(CSV_PATH, [header, ...rows, ''].join('\n'));
}

// ─── Calculation helpers ──────────────────────────────────────────────────────

function recommendBox(selectedItems) {
  const totalVolume = selectedItems.reduce(
    (s, i) => s + i.length_in * i.width_in * i.height_in * i.qty, 0
  );
  const buffered  = Math.ceil(totalVolume * 1.3);
  const maxDim    = Math.max(...selectedItems.map(i =>
    Math.max(i.length_in, i.width_in, i.height_in)
  ));

  for (const box of STANDARD_BOXES) {
    const longestSide = Math.max(box.l, box.w, box.h);
    const boxVol      = box.l * box.w * box.h;
    if (boxVol >= buffered && longestSide >= maxDim) return { box, totalVolume, buffered };
  }
  const box = STANDARD_BOXES[STANDARD_BOXES.length - 1];
  return { box, totalVolume, buffered };
}

function calcGelPacks(totalWeight) {
  return Math.max(1, Math.ceil(totalWeight / 5));
}

// ─── Obsidian markdown ────────────────────────────────────────────────────────

function saveEstimate(selectedItems) {
  const now         = new Date();
  const dateStr     = now.toISOString().slice(0, 10);
  const timeStr     = now.toTimeString().slice(0, 5);
  const totalWeight = selectedItems.reduce((s, i) => s + i.weight_lbs * i.qty, 0);
  const gelPacks    = calcGelPacks(totalWeight);
  const { box, totalVolume, buffered } = recommendBox(selectedItems);

  const productRows = selectedItems.map(i => {
    const vol = (i.length_in * i.width_in * i.height_in * i.qty).toFixed(0);
    return `| ${i.name} | ${i.qty} | ${(i.weight_lbs * i.qty).toFixed(1)} | ${vol} |`;
  }).join('\n');

  const markdown = `---
title: Shipment Estimate — ${dateStr}
date: ${dateStr}
tags: [shipping, bhf, estimate]
---

# Shipment Estimate — ${dateStr} ${timeStr}

## Products

| Product | Qty | Weight (lbs) | Volume (cu in) |
|---------|-----|-------------|----------------|
${productRows}

## Totals

| | |
|---|---|
| **Total Weight** | ${totalWeight.toFixed(1)} lbs |
| **Total Volume** | ${totalVolume.toFixed(0)} cu in (${buffered} cu in with 30% packing buffer) |
| **Gel Packs Needed** | ${gelPacks} |
| **Recommended Box** | ${box.name} — ${box.l}×${box.w}×${box.h} in |

## Notes

<!-- Add shipping notes, carrier, tracking, etc. here -->
`;

  if (!fs.existsSync(OBSIDIAN_PATH)) fs.mkdirSync(OBSIDIAN_PATH, { recursive: true });

  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename  = `estimate-${timestamp}.md`;
  const filepath  = path.join(OBSIDIAN_PATH, filename);
  fs.writeFileSync(filepath, markdown);
  return filepath;
}

// ─── readline helpers ─────────────────────────────────────────────────────────

function createRL() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function hr() { console.log('─'.repeat(52)); }
function blank() { console.log(''); }

// ─── Menus ───────────────────────────────────────────────────────────────────

async function addProduct(rl) {
  blank();
  console.log('  ADD PRODUCT');
  hr();
  const name       = (await ask(rl, '  Product name: ')).trim();
  if (!name) { console.log('  Cancelled.'); return; }
  const weight_lbs = parseFloat(await ask(rl, '  Weight (lbs): '));
  const length_in  = parseFloat(await ask(rl, '  Length (in):  '));
  const width_in   = parseFloat(await ask(rl, '  Width  (in):  '));
  const height_in  = parseFloat(await ask(rl, '  Height (in):  '));

  if ([weight_lbs, length_in, width_in, height_in].some(isNaN)) {
    console.log('  Invalid number — product not saved.');
    return;
  }

  const products = readProducts();
  if (products.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    console.log(`  "${name}" already exists. Use Update to edit it.`);
    return;
  }

  products.push({ name, weight_lbs, length_in, width_in, height_in });
  writeProducts(products);
  console.log(`  ✓ "${name}" added to library.`);
}

async function updateProduct(rl) {
  const products = readProducts();
  if (!products.length) { console.log('  Library is empty.'); return; }

  blank();
  console.log('  UPDATE PRODUCT');
  hr();
  products.forEach((p, i) => console.log(`  [${i + 1}] ${p.name}`));
  blank();
  const idx = parseInt(await ask(rl, '  Select number: '), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= products.length) { console.log('  Invalid selection.'); return; }

  const p = products[idx];
  console.log(`\n  Editing: ${p.name} (press Enter to keep current value)`);
  const name       = (await ask(rl, `  Name [${p.name}]: `)).trim() || p.name;
  const wRaw       = (await ask(rl, `  Weight lbs [${p.weight_lbs}]: `)).trim();
  const lRaw       = (await ask(rl, `  Length in  [${p.length_in}]: `)).trim();
  const wdRaw      = (await ask(rl, `  Width  in  [${p.width_in}]: `)).trim();
  const hRaw       = (await ask(rl, `  Height in  [${p.height_in}]: `)).trim();

  products[idx] = {
    name,
    weight_lbs: wRaw  ? parseFloat(wRaw)  : p.weight_lbs,
    length_in:  lRaw  ? parseFloat(lRaw)  : p.length_in,
    width_in:   wdRaw ? parseFloat(wdRaw) : p.width_in,
    height_in:  hRaw  ? parseFloat(hRaw)  : p.height_in,
  };
  writeProducts(products);
  console.log(`  ✓ "${name}" updated.`);
}

async function deleteProduct(rl) {
  const products = readProducts();
  if (!products.length) { console.log('  Library is empty.'); return; }

  blank();
  console.log('  DELETE PRODUCT');
  hr();
  products.forEach((p, i) => console.log(`  [${i + 1}] ${p.name}`));
  blank();
  const idx = parseInt(await ask(rl, '  Select number to delete: '), 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= products.length) { console.log('  Invalid selection.'); return; }

  const confirm = (await ask(rl, `  Delete "${products[idx].name}"? (y/N): `)).trim().toLowerCase();
  if (confirm !== 'y') { console.log('  Cancelled.'); return; }

  const removed = products.splice(idx, 1)[0];
  writeProducts(products);
  console.log(`  ✓ "${removed.name}" removed.`);
}

function viewLibrary() {
  const products = readProducts();
  blank();
  console.log('  PRODUCT LIBRARY');
  hr();
  if (!products.length) { console.log('  No products yet. Use "Add Product" to get started.'); return; }
  console.log(`  ${'#'.padEnd(4)} ${'Name'.padEnd(28)} ${'Wt(lb)'.padEnd(8)} ${'L×W×H (in)'.padEnd(18)}`);
  hr();
  products.forEach((p, i) => {
    const dims = `${p.length_in}×${p.width_in}×${p.height_in}`;
    console.log(`  ${String(i + 1).padEnd(4)} ${p.name.padEnd(28)} ${String(p.weight_lbs).padEnd(8)} ${dims}`);
  });
}

async function buildEstimate(rl) {
  const products = readProducts();
  if (!products.length) { console.log('  No products in library. Add products first.'); return; }

  const selectedItems = [];

  while (true) {
    blank();
    console.log('  BUILD SHIPMENT ESTIMATE');
    hr();
    if (selectedItems.length) {
      console.log('  Current selection:');
      selectedItems.forEach(i => console.log(`    • ${i.name} × ${i.qty}`));
      blank();
    }

    products.forEach((p, i) => console.log(`  [${i + 1}] ${p.name}`));
    console.log('  [c] Calculate & save');
    console.log('  [x] Cancel');
    blank();

    const choice = (await ask(rl, '  Add product (number) or action: ')).trim().toLowerCase();

    if (choice === 'x') return;
    if (choice === 'c') break;

    const idx = parseInt(choice, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= products.length) { console.log('  Invalid choice.'); continue; }

    const qtyRaw = (await ask(rl, `  Quantity of "${products[idx].name}": `)).trim();
    const qty    = parseInt(qtyRaw, 10);
    if (isNaN(qty) || qty < 1) { console.log('  Invalid quantity.'); continue; }

    const existing = selectedItems.find(i => i.name === products[idx].name);
    if (existing) {
      existing.qty += qty;
    } else {
      selectedItems.push({ ...products[idx], qty });
    }
  }

  if (!selectedItems.length) { console.log('  Nothing selected.'); return; }

  const totalWeight = selectedItems.reduce((s, i) => s + i.weight_lbs * i.qty, 0);
  const gelPacks    = calcGelPacks(totalWeight);
  const { box, totalVolume, buffered } = recommendBox(selectedItems);

  blank();
  console.log('  ══════════════════════════════════════════════');
  console.log('  ESTIMATE RESULTS');
  console.log('  ══════════════════════════════════════════════');
  selectedItems.forEach(i =>
    console.log(`  • ${i.name} × ${i.qty}  (${(i.weight_lbs * i.qty).toFixed(1)} lbs)`)
  );
  hr();
  console.log(`  Total Weight:      ${totalWeight.toFixed(1)} lbs`);
  console.log(`  Total Volume:      ${totalVolume.toFixed(0)} cu in  →  ${buffered} cu in buffered`);
  console.log(`  Gel Packs Needed:  ${gelPacks}`);
  console.log(`  Recommended Box:   ${box.name}  (${box.l}×${box.w}×${box.h} in)`);
  console.log('  ══════════════════════════════════════════════');

  const save = (await ask(rl, '\n  Save to Obsidian? (Y/n): ')).trim().toLowerCase();
  if (save !== 'n') {
    const filepath = saveEstimate(selectedItems);
    console.log(`  ✓ Saved: ${filepath}`);
  }
}

function viewEstimates() {
  blank();
  console.log('  SAVED ESTIMATES');
  hr();
  if (!fs.existsSync(OBSIDIAN_PATH)) { console.log('  No estimates saved yet.'); return; }
  const files = fs.readdirSync(OBSIDIAN_PATH)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 20);
  if (!files.length) { console.log('  No estimates saved yet.'); return; }
  files.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
  console.log(`\n  Location: ${OBSIDIAN_PATH}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = createRL();

  while (true) {
    blank();
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║   BHF Shipping Estimator                 ║');
    console.log('  ╚══════════════════════════════════════════╝');
    blank();
    console.log('  [1] View product library');
    console.log('  [2] Add product');
    console.log('  [3] Update product');
    console.log('  [4] Delete product');
    console.log('  [5] Build shipment estimate');
    console.log('  [6] View saved estimates');
    console.log('  [q] Quit');
    blank();

    const choice = (await ask(rl, '  Select: ')).trim().toLowerCase();

    switch (choice) {
      case '1': viewLibrary();              break;
      case '2': await addProduct(rl);       break;
      case '3': await updateProduct(rl);    break;
      case '4': await deleteProduct(rl);    break;
      case '5': await buildEstimate(rl);    break;
      case '6': viewEstimates();            break;
      case 'q': rl.close(); process.exit(0);
      default:  console.log('  Invalid choice.');
    }

    if (!['q', '5', '6'].includes(choice)) {
      await ask(rl, '\n  Press Enter to continue...');
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
