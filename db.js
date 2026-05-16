const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'inventory.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// =========================================
// SCHEMA
// =========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    category      TEXT NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    reorder_level INTEGER NOT NULL DEFAULT 5,
    unit          TEXT NOT NULL DEFAULT 'unit',
    price_cents   INTEGER NOT NULL DEFAULT 0,
    allow_preorder INTEGER NOT NULL DEFAULT 0,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   TEXT NOT NULL,
    type         TEXT NOT NULL CHECK(type IN ('sale','restock','adjustment','preorder')),
    quantity     INTEGER NOT NULL,
    batch_number TEXT,
    order_id     TEXT,
    notes        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_transactions_product_id  ON transactions(product_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at  ON transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_type        ON transactions(type);
`);

// =========================================
// SEED PRODUCTS
// =========================================

const count = db.prepare('SELECT COUNT(*) AS n FROM products').get();
if (count.n === 0) {
  const insert = db.prepare(`
    INSERT INTO products (id, name, category, stock, reorder_level, unit, price_cents)
    VALUES (@id, @name, @category, @stock, @reorder_level, @unit, @price_cents)
  `);

  const seed = db.transaction((products) => {
    for (const p of products) insert.run(p);
  });

  seed([
    { id: 'japanese-milk-loaf',  name: 'Japanese Milk Loaf',       category: 'Bakery',      stock: 12, reorder_level: 4,  unit: 'loaf',   price_cents: 1800 },
    { id: 'cinnamon-rolls',      name: 'Cinnamon Rolls',           category: 'Bakery',      stock: 24, reorder_level: 6,  unit: 'dozen',  price_cents: 1500 },
    { id: 'whole-wheat-loaf',    name: 'Whole Wheat Loaf',         category: 'Bakery',      stock: 8,  reorder_level: 3,  unit: 'loaf',   price_cents: 1400 },
    { id: 'yeast-rolls',         name: 'Yeast Rolls',              category: 'Bakery',      stock: 30, reorder_level: 10, unit: 'roll',   price_cents:  300 },
    { id: 'focaccia-loaf',       name: 'Focaccia Loaf',            category: 'Bakery',      stock: 5,  reorder_level: 3,  unit: 'loaf',   price_cents: 1400 },
    { id: 'sourdough',           name: 'Sourdough',                category: 'Bakery',      stock: 6,  reorder_level: 4,  unit: 'loaf',   price_cents: 1500 },
    { id: 'challah',             name: 'Challah',                  category: 'Bakery',      stock: 4,  reorder_level: 3,  unit: 'loaf',   price_cents: 1600 },
    { id: 'farm-eggs',           name: 'Pasture-Raised Eggs',      category: 'Farm Fresh',  stock: 18, reorder_level: 10, unit: 'dozen',  price_cents:  800 },
    { id: 'cultured-butter',     name: 'Real Cream Butter',        category: 'Dairy',       stock: 8,  reorder_level: 5,  unit: 'jar',    price_cents:  900 },
    { id: 'seasonal-preserves',  name: 'Seasonal Preserves',       category: 'Larder',      stock: 15, reorder_level: 8,  unit: 'jar',    price_cents: 1200 },
    { id: 'garlic-chili-crunch', name: 'Garlic Chili Crunch',      category: 'Larder',      stock: 10, reorder_level: 5,  unit: 'jar',    price_cents: 1400 },
    { id: 'herb-dipping-oil',    name: 'Tuscany Herb Dipping Oil', category: 'Larder',      stock: 7,  reorder_level: 5,  unit: 'bottle', price_cents: 1600 },
  ]);

  console.log('[DB] Seeded 12 products');
}

module.exports = db;
