// Pure-JS JSON inventory store — no native modules, works on any Node host
const fs   = require('fs');
const path = require('path');

const DATA_PATH = process.env.DB_PATH || path.join(__dirname, 'inventory-data.json');

const SEED = [
  { id:'japanese-milk-loaf',  name:'Japanese Milk Loaf',       category:'Bakery',    stock:12, reorder_level:4,  unit:'loaf',   price_cents:1800, allow_preorder:0, active:1 },
  { id:'cinnamon-rolls',      name:'Cinnamon Rolls',           category:'Bakery',    stock:24, reorder_level:6,  unit:'dozen',  price_cents:1500, allow_preorder:0, active:1 },
  { id:'whole-wheat-loaf',    name:'Whole Wheat Loaf',         category:'Bakery',    stock:8,  reorder_level:3,  unit:'loaf',   price_cents:1400, allow_preorder:0, active:1 },
  { id:'yeast-rolls',         name:'Yeast Rolls',              category:'Bakery',    stock:30, reorder_level:10, unit:'roll',   price_cents:300,  allow_preorder:0, active:1 },
  { id:'focaccia-loaf',       name:'Focaccia Loaf',            category:'Bakery',    stock:5,  reorder_level:3,  unit:'loaf',   price_cents:1400, allow_preorder:0, active:1 },
  { id:'sourdough',           name:'Sourdough',                category:'Bakery',    stock:6,  reorder_level:4,  unit:'loaf',   price_cents:1500, allow_preorder:0, active:1 },
  { id:'challah',             name:'Challah',                  category:'Bakery',    stock:4,  reorder_level:3,  unit:'loaf',   price_cents:1600, allow_preorder:0, active:1 },
  { id:'farm-eggs',           name:'Pasture-Raised Eggs',      category:'Farm Fresh',stock:18, reorder_level:10, unit:'dozen',  price_cents:800,  allow_preorder:0, active:1 },
  { id:'cultured-butter',     name:'Real Cream Butter',        category:'Dairy',     stock:8,  reorder_level:5,  unit:'jar',    price_cents:900,  allow_preorder:0, active:1 },
  { id:'seasonal-preserves',  name:'Seasonal Preserves',       category:'Larder',    stock:15, reorder_level:8,  unit:'jar',    price_cents:1200, allow_preorder:0, active:1 },
  { id:'garlic-chili-crunch', name:'Garlic Chili Crunch',      category:'Larder',    stock:10, reorder_level:5,  unit:'jar',    price_cents:1400, allow_preorder:0, active:1 },
  { id:'herb-dipping-oil',    name:'Tuscany Herb Dipping Oil', category:'Larder',    stock:7,  reorder_level:5,  unit:'bottle', price_cents:1600, allow_preorder:0, active:1 },
];

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    if (!raw.products) throw new Error('bad format');
    return raw;
  } catch {
    return { products: SEED.map(p => ({ ...p, created_at: new Date().toISOString() })), transactions: [], nextTxId: 1 };
  }
}

function persist(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

const _data = load();
if (_data.products.length === 0) {
  _data.products = SEED.map(p => ({ ...p, created_at: new Date().toISOString() }));
  persist(_data);
}
console.log(`[Store] Loaded ${_data.products.length} products, ${_data.transactions.length} transactions`);

const store = {
  getAll() {
    return _data.products
      .filter(p => p.active)
      .slice()
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },

  getProduct(id) {
    return _data.products.find(p => p.id === id) || null;
  },

  updateProduct(id, fields) {
    const p = _data.products.find(p => p.id === id);
    if (!p) return false;
    Object.assign(p, fields);
    persist(_data);
    return true;
  },

  adjustStock(id, qty) {
    const p = _data.products.find(p => p.id === id);
    if (!p) return null;
    p.stock = Math.max(0, p.stock + qty);
    persist(_data);
    return p.stock;
  },

  addTransaction(productId, type, quantity, batchNumber = null, orderId = null, notes = null) {
    const tx = {
      id: _data.nextTxId++,
      product_id: productId,
      type,
      quantity,
      batch_number: batchNumber,
      order_id: orderId,
      notes,
      created_at: new Date().toISOString(),
    };
    _data.transactions.push(tx);
    if (_data.transactions.length > 500) _data.transactions = _data.transactions.slice(-500);
    persist(_data);
    return tx;
  },

  getTransactions(productId = null, limit = 150) {
    const nameMap = Object.fromEntries(_data.products.map(p => [p.id, p.name]));
    let list = _data.transactions.slice().reverse();
    if (productId) list = list.filter(t => t.product_id === productId);
    return list.slice(0, limit).map(t => ({ ...t, product_name: nameMap[t.product_id] || t.product_id }));
  },

  getSales(daysSince) {
    const since    = new Date(Date.now() - daysSince * 864e5).toISOString();
    const nameMap  = Object.fromEntries(_data.products.map(p => [p.id, p.name]));
    const priceMap = Object.fromEntries(_data.products.map(p => [p.id, p.price_cents]));
    const grouped  = {};
    for (const t of _data.transactions) {
      if (t.type !== 'sale' || t.created_at < since) continue;
      if (!grouped[t.product_id]) grouped[t.product_id] = { product_id: t.product_id, name: nameMap[t.product_id] || t.product_id, units_sold: 0, revenue_cents: 0 };
      const u = Math.abs(t.quantity);
      grouped[t.product_id].units_sold    += u;
      grouped[t.product_id].revenue_cents += u * (priceMap[t.product_id] || 0);
    }
    return Object.values(grouped).sort((a, b) => b.units_sold - a.units_sold);
  },

  getAllForCSV() {
    const nameMap = Object.fromEntries(_data.products.map(p => [p.id, p.name]));
    return {
      products:     this.getAll(),
      transactions: _data.transactions.slice().reverse().map(t => ({ ...t, product_name: nameMap[t.product_id] || t.product_id })),
    };
  },
};

module.exports = store;
