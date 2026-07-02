// Inventory store — uses PostgreSQL (Supabase) when DATABASE_URL is set,
// falls back to local JSON for development without a database.
const fs   = require('fs');
const path = require('path');

const USE_PG = !!process.env.DATABASE_URL;

const SEED = [
  { id:'japanese-milk-loaf',  name:'Japanese Milk Loaf',           category:'Bakery',       stock:12, reorder_level:4,  unit:'loaf',   price_cents:1800,  cost_cents:600,  allow_preorder:0, active:1 },
  { id:'cinnamon-rolls',      name:'Cinnamon Rolls',               category:'Bakery',       stock:24, reorder_level:6,  unit:'dozen',  price_cents:1500,  cost_cents:450,  allow_preorder:0, active:1 },
  { id:'whole-wheat-loaf',    name:'Whole Wheat Loaf',             category:'Bakery',       stock:8,  reorder_level:3,  unit:'loaf',   price_cents:1400,  cost_cents:400,  allow_preorder:0, active:1 },
  { id:'yeast-rolls',         name:'Yeast Rolls',                  category:'Bakery',       stock:30, reorder_level:10, unit:'roll',   price_cents:300,   cost_cents:80,   allow_preorder:0, active:1 },
  { id:'focaccia-loaf',       name:'Focaccia Loaf',                category:'Bakery',       stock:5,  reorder_level:3,  unit:'loaf',   price_cents:1400,  cost_cents:380,  allow_preorder:0, active:1 },
  { id:'challah',             name:'Challah',                      category:'Bakery',       stock:4,  reorder_level:3,  unit:'loaf',   price_cents:1600,  cost_cents:500,  allow_preorder:0, active:1 },
  { id:'farm-eggs',           name:'Pasture-Raised Eggs',          category:'Farm Fresh',   stock:18, reorder_level:10, unit:'dozen',  price_cents:800,   cost_cents:200,  allow_preorder:0, active:1 },
  { id:'whole-chicken',       name:'Whole Chicken',                category:'Farm Fresh',   stock:10, reorder_level:3,  unit:'bird',   price_cents:4900,  cost_cents:0,    allow_preorder:0, active:1 },
  { id:'cultured-butter',     name:'Real Cream Butter',            category:'Dairy',        stock:8,  reorder_level:5,  unit:'jar',    price_cents:900,   cost_cents:280,  allow_preorder:0, active:1 },
  { id:'seasonal-preserves',  name:'Seasonal Preserves',           category:'Larder',       stock:15, reorder_level:8,  unit:'jar',    price_cents:1200,  cost_cents:350,  allow_preorder:0, active:1 },
  { id:'garlic-chili-crunch', name:'Garlic Chili Crunch',          category:'Larder',       stock:10, reorder_level:5,  unit:'jar',    price_cents:1400,  cost_cents:400,  allow_preorder:0, active:1 },
  { id:'herb-dipping-oil',    name:'Tuscany Herb Dipping Oil',     category:'Larder',       stock:7,  reorder_level:5,  unit:'bottle', price_cents:1600,  cost_cents:480,  allow_preorder:0, active:1 },
  { id:'bundle-farm',         name:'Farm Bundle',                  category:'Reservations', stock:15, reorder_level:3,  unit:'bundle', price_cents:12500, cost_cents:0,    allow_preorder:0, active:1 },
  { id:'bundle-turkey',       name:'Thanksgiving Turkey Bundle',   category:'Reservations', stock:10, reorder_level:2,  unit:'bundle', price_cents:10000, cost_cents:0,    allow_preorder:0, active:1 },
  { id:'sampler-box',                  name:'Farm Sampler Box',             category:'Sampler',      stock:10, reorder_level:2,  unit:'box',    price_cents:14900, cost_cents:0,    allow_preorder:0, active:1 },
  { id:'chicken-dinner-roll-bundle',   name:'Chicken & Dinner Roll Bundle', category:'Bundles',      stock:10, reorder_level:2,  unit:'bundle', price_cents:9900,  cost_cents:0,    allow_preorder:0, active:1 },
  { id:'bundle-4th-july',             name:'4th of July Homestead Table',  category:'Bundles',      stock:0,  reorder_level:0,  unit:'bundle', price_cents:19900, cost_cents:8600, allow_preorder:0, active:1 },
];

// ─── PostgreSQL store ────────────────────────────────────────────────────────

let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  console.log('[DB] Using PostgreSQL (Supabase)');
} else {
  console.log('[DB] DATABASE_URL not set — using local JSON store');
}

async function initPg() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      category       TEXT NOT NULL DEFAULT '',
      stock          INTEGER NOT NULL DEFAULT 0,
      reorder_level  INTEGER NOT NULL DEFAULT 0,
      unit           TEXT NOT NULL DEFAULT '',
      price_cents    INTEGER NOT NULL DEFAULT 0,
      cost_cents     INTEGER NOT NULL DEFAULT 0,
      allow_preorder INTEGER NOT NULL DEFAULT 0,
      active         INTEGER NOT NULL DEFAULT 1,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id              SERIAL PRIMARY KEY,
      product_id      TEXT NOT NULL,
      type            TEXT NOT NULL,
      quantity        INTEGER NOT NULL,
      batch_number    TEXT,
      order_id        TEXT,
      notes           TEXT,
      channel         TEXT,
      stock_before    INTEGER,
      stock_after     INTEGER,
      prod_date       TEXT,
      expiry_date     TEXT,
      batch_cost_cents INTEGER,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Seed products that don't exist yet
  for (const s of SEED) {
    await pool.query(`
      INSERT INTO products (id, name, category, stock, reorder_level, unit, price_cents, cost_cents, allow_preorder, active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING
    `, [s.id, s.name, s.category, s.stock, s.reorder_level, s.unit, s.price_cents, s.cost_cents, s.allow_preorder, s.active]);
  }
  console.log('[DB] PostgreSQL tables ready');
}

// Call this once at startup
async function init() {
  if (USE_PG) await initPg();
}

// ─── PG implementations ──────────────────────────────────────────────────────

const pgStore = {
  async getAll() {
    const { rows } = await pool.query(
      `SELECT * FROM products WHERE active = 1 ORDER BY category, name`
    );
    return rows;
  },

  async getProduct(id) {
    const { rows } = await pool.query(`SELECT * FROM products WHERE id = $1`, [id]);
    return rows[0] || null;
  },

  async updateProduct(id, fields) {
    const keys = Object.keys(fields);
    if (!keys.length) return false;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = keys.map(k => fields[k]);
    await pool.query(`UPDATE products SET ${sets} WHERE id = $1`, [id, ...vals]);
    return true;
  },

  async adjustStock(id, qty) {
    const { rows } = await pool.query(
      `UPDATE products SET stock = GREATEST(0, stock + $1) WHERE id = $2
       RETURNING stock`,
      [qty, id]
    );
    if (!rows.length) return null;
    const after  = rows[0].stock;
    const before = after - qty < 0 ? 0 : after - qty;
    return { before, after };
  },

  async hasTransaction(orderId, productId) {
    const { rows } = await pool.query(
      `SELECT 1 FROM transactions WHERE order_id = $1 AND product_id = $2 LIMIT 1`,
      [orderId, productId]
    );
    return rows.length > 0;
  },

  async addTransaction(productId, type, quantity, batchNumber = null, orderId = null, notes = null, channel = null, stockBefore = null, stockAfter = null, extra = {}) {
    const overrideDate = extra.created_at ? new Date(extra.created_at) : null;
    const { rows } = await pool.query(`
      INSERT INTO transactions
        (product_id, type, quantity, batch_number, order_id, notes, channel, stock_before, stock_after, prod_date, expiry_date, batch_cost_cents, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, COALESCE($13, NOW()))
      RETURNING *
    `, [
      productId, type, quantity,
      batchNumber || null, orderId || null, notes || null, channel || null,
      stockBefore ?? null, stockAfter ?? null,
      extra.prod_date || null, extra.expiry_date || null, extra.batch_cost_cents || null,
      overrideDate,
    ]);
    return rows[0];
  },

  async deleteTransactionsByNotes(notesValue) {
    // Find net stock impact per product before deleting
    const { rows: impacts } = await pool.query(
      `SELECT product_id, SUM(quantity) AS net FROM transactions WHERE notes = $1 GROUP BY product_id`,
      [notesValue]
    );
    // Reverse the stock changes
    for (const row of impacts) {
      await pool.query(
        `UPDATE products SET stock = GREATEST(0, stock - $1) WHERE id = $2`,
        [parseInt(row.net), row.product_id]
      );
    }
    const { rowCount } = await pool.query(
      `DELETE FROM transactions WHERE notes = $1`, [notesValue]
    );
    return { deleted: rowCount, products: impacts.length };
  },

  async getTransactions(productId = null, limit = 150, dateFrom = null, dateTo = null) {
    const conditions = [];
    const vals = [];
    let i = 1;
    if (productId) { conditions.push(`t.product_id = $${i++}`); vals.push(productId); }
    if (dateFrom)  { conditions.push(`t.created_at >= $${i++}`); vals.push(dateFrom + 'T00:00:00Z'); }
    if (dateTo)    { conditions.push(`t.created_at <= $${i++}`); vals.push(dateTo + 'T23:59:59Z'); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    vals.push(limit);
    const { rows } = await pool.query(`
      SELECT t.*, p.name AS product_name
      FROM transactions t
      LEFT JOIN products p ON p.id = t.product_id
      ${where}
      ORDER BY t.created_at DESC
      LIMIT $${i}
    `, vals);
    return rows;
  },

  async getSales(daysSince, dateFrom = null, dateTo = null) {
    let since;
    if (dateFrom) {
      since = dateFrom + 'T00:00:00Z';
    } else {
      since = new Date(Date.now() - daysSince * 864e5).toISOString();
    }
    const until = dateTo ? dateTo + 'T23:59:59Z' : null;

    const vals = [since];
    let i = 2;
    let untilClause = '';
    if (until) { untilClause = `AND t.created_at <= $${i++}`; vals.push(until); }

    const { rows } = await pool.query(`
      SELECT
        t.product_id,
        p.name,
        p.price_cents,
        p.cost_cents,
        SUM(ABS(t.quantity)) AS units_sold,
        SUM(ABS(t.quantity) * p.price_cents) AS revenue_cents,
        SUM(ABS(t.quantity) * COALESCE(p.cost_cents, 0)) AS cost_cents_total
      FROM transactions t
      LEFT JOIN products p ON p.id = t.product_id
      WHERE t.type = 'sale' AND t.created_at >= $1 ${untilClause}
      GROUP BY t.product_id, p.name, p.price_cents, p.cost_cents
      ORDER BY units_sold DESC
    `, vals);

    return rows.map(r => ({
      product_id:      r.product_id,
      name:            r.name || r.product_id,
      units_sold:      parseInt(r.units_sold) || 0,
      revenue_cents:   parseInt(r.revenue_cents) || 0,
      cost_cents_total: parseInt(r.cost_cents_total) || 0,
      profit_cents:    (parseInt(r.revenue_cents) || 0) - (parseInt(r.cost_cents_total) || 0),
      margin_pct:      r.revenue_cents > 0
        ? Math.round(((r.revenue_cents - r.cost_cents_total) / r.revenue_cents) * 100)
        : 0,
    }));
  },

  async getAllForCSV() {
    const products     = await this.getAll();
    const { rows: txns } = await pool.query(`
      SELECT t.*, p.name AS product_name
      FROM transactions t
      LEFT JOIN products p ON p.id = t.product_id
      ORDER BY t.created_at DESC
    `);
    return { products, transactions: txns };
  },
};

// ─── JSON fallback store (local dev) ─────────────────────────────────────────

const DATA_PATH = process.env.DB_PATH || path.join(__dirname, 'inventory-data.json');

function loadJson() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (!raw.products) throw new Error('bad format');
    for (const p of raw.products) {
      if (p.cost_cents == null) {
        const s = SEED.find(x => x.id === p.id);
        p.cost_cents = s ? s.cost_cents : 0;
      }
    }
    return raw;
  } catch {
    return { products: SEED.map(p => ({ ...p, created_at: new Date().toISOString() })), transactions: [], nextTxId: 1 };
  }
}

function persistJson(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

const _json = USE_PG ? null : (() => {
  const d = loadJson();
  if (d.products.length === 0) {
    d.products = SEED.map(p => ({ ...p, created_at: new Date().toISOString() }));
    persistJson(d);
  } else {
    let changed = false;
    for (const s of SEED) {
      if (!d.products.find(p => p.id === s.id)) {
        d.products.push({ ...s, created_at: new Date().toISOString() });
        changed = true;
      }
    }
    if (changed) persistJson(d);
  }
  console.log(`[Store] Loaded ${d.products.length} products, ${d.transactions.length} transactions`);
  return d;
})();

const jsonStore = {
  getAll() {
    return _json.products.filter(p => p.active).slice().sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
  getProduct(id) { return _json.products.find(p => p.id === id) || null; },
  updateProduct(id, fields) {
    const p = _json.products.find(p => p.id === id);
    if (!p) return false;
    Object.assign(p, fields);
    persistJson(_json);
    return true;
  },
  adjustStock(id, qty) {
    const p = _json.products.find(p => p.id === id);
    if (!p) return null;
    const before = p.stock;
    p.stock = Math.max(0, p.stock + qty);
    persistJson(_json);
    return { before, after: p.stock };
  },
  hasTransaction(orderId, productId) {
    return _json.transactions.some(t => t.order_id === orderId && t.product_id === productId);
  },

  addTransaction(productId, type, quantity, batchNumber = null, orderId = null, notes = null, channel = null, stockBefore = null, stockAfter = null, extra = {}) {
    const { created_at: overrideDate, ...restExtra } = extra;
    const tx = {
      id: _json.nextTxId++, product_id: productId, type, quantity,
      batch_number: batchNumber, order_id: orderId, notes, channel,
      stock_before: stockBefore, stock_after: stockAfter,
      created_at: overrideDate || new Date().toISOString(),
      ...restExtra,
    };
    _json.transactions.push(tx);
    if (_json.transactions.length > 500) _json.transactions = _json.transactions.slice(-500);
    persistJson(_json);
    return tx;
  },

  deleteTransactionsByNotes(notesValue) {
    const toDelete = _json.transactions.filter(t => t.notes === notesValue);
    // Reverse stock changes
    const netByProduct = {};
    for (const t of toDelete) {
      netByProduct[t.product_id] = (netByProduct[t.product_id] || 0) + t.quantity;
    }
    for (const [pid, net] of Object.entries(netByProduct)) {
      const p = _json.products.find(p => p.id === pid);
      if (p) p.stock = Math.max(0, p.stock - net);
    }
    _json.transactions = _json.transactions.filter(t => t.notes !== notesValue);
    persistJson(_json);
    return { deleted: toDelete.length, products: Object.keys(netByProduct).length };
  },
  getTransactions(productId = null, limit = 150, dateFrom = null, dateTo = null) {
    const nameMap = Object.fromEntries(_json.products.map(p => [p.id, p.name]));
    let list = _json.transactions.slice().reverse();
    if (productId) list = list.filter(t => t.product_id === productId);
    if (dateFrom)  list = list.filter(t => t.created_at >= dateFrom);
    if (dateTo)    list = list.filter(t => t.created_at <= dateTo + 'T23:59:59Z');
    return list.slice(0, limit).map(t => ({ ...t, product_name: nameMap[t.product_id] || t.product_id }));
  },
  getSales(daysSince, dateFrom = null, dateTo = null) {
    const nameMap  = Object.fromEntries(_json.products.map(p => [p.id, p.name]));
    const priceMap = Object.fromEntries(_json.products.map(p => [p.id, p.price_cents]));
    const costMap  = Object.fromEntries(_json.products.map(p => [p.id, p.cost_cents || 0]));
    let since = dateFrom ? dateFrom + 'T00:00:00Z' : new Date(Date.now() - daysSince * 864e5).toISOString();
    const until = dateTo ? dateTo + 'T23:59:59Z' : null;
    const grouped = {};
    for (const t of _json.transactions) {
      if (t.type !== 'sale') continue;
      if (t.created_at < since) continue;
      if (until && t.created_at > until) continue;
      if (!grouped[t.product_id]) grouped[t.product_id] = { product_id: t.product_id, name: nameMap[t.product_id] || t.product_id, units_sold: 0, revenue_cents: 0, cost_cents_total: 0 };
      const u = Math.abs(t.quantity);
      grouped[t.product_id].units_sold       += u;
      grouped[t.product_id].revenue_cents    += u * (priceMap[t.product_id] || 0);
      grouped[t.product_id].cost_cents_total += u * (costMap[t.product_id]  || 0);
    }
    return Object.values(grouped).map(r => ({ ...r, profit_cents: r.revenue_cents - r.cost_cents_total, margin_pct: r.revenue_cents > 0 ? Math.round((r.revenue_cents - r.cost_cents_total) / r.revenue_cents * 100) : 0 })).sort((a, b) => b.units_sold - a.units_sold);
  },
  getAllForCSV() {
    const nameMap = Object.fromEntries(_json.products.map(p => [p.id, p.name]));
    return { products: this.getAll(), transactions: _json.transactions.slice().reverse().map(t => ({ ...t, product_name: nameMap[t.product_id] || t.product_id })) };
  },
};

// ─── Unified async wrapper ────────────────────────────────────────────────────
// server.js calls db.getAll(), db.adjustStock() etc. synchronously in some
// places. We wrap everything so PG returns promises and JSON returns resolved
// promises — server.js just awaits everything.

const store = USE_PG ? pgStore : {
  getAll:                     (...a) => Promise.resolve(jsonStore.getAll(...a)),
  getProduct:                 (...a) => Promise.resolve(jsonStore.getProduct(...a)),
  updateProduct:              (...a) => Promise.resolve(jsonStore.updateProduct(...a)),
  adjustStock:                (...a) => Promise.resolve(jsonStore.adjustStock(...a)),
  hasTransaction:             (...a) => Promise.resolve(jsonStore.hasTransaction(...a)),
  addTransaction:             (...a) => Promise.resolve(jsonStore.addTransaction(...a)),
  deleteTransactionsByNotes:  (...a) => Promise.resolve(jsonStore.deleteTransactionsByNotes(...a)),
  getTransactions:            (...a) => Promise.resolve(jsonStore.getTransactions(...a)),
  getSales:                   (...a) => Promise.resolve(jsonStore.getSales(...a)),
  getAllForCSV:                (...a) => Promise.resolve(jsonStore.getAllForCSV(...a)),
};

store.init = init;
module.exports = store;
