/* =========================================
   HEART OF TEXAS ORGANICS CART
   ========================================= */

const PRODUCTS = {
  'japanese-milk-loaf': { name: 'Japanese Milk Loaf', price: 0, image: 'images/japanese-milk-loaf.webp' },
  'whole-wheat-loaf':   { name: 'Whole Wheat Loaf',   price: 0, image: 'images/whole-wheat-loaf.webp' },
  'cinnamon-rolls':     { name: 'Cinnamon Rolls',      price: 0, image: 'images/cinnamon-rolls.webp' },
  'yeast-rolls':        { name: 'Yeast Rolls',         price: 0, image: 'images/yeast-rolls.webp' },
  'focaccia-loaf':      { name: 'Focaccia Loaf',       price: 0, image: 'images/focaccia-loaf.webp' },
  'whole-chicken':     { name: 'Whole Chicken',       price: 1800, image: 'images/chicken.webp' },
  'cultured-butter':   { name: 'Cultured Butter',     price: 900,  image: 'images/butter.webp' },
  'farm-eggs':         { name: 'Farm Eggs (1 dozen)', price: 800,  image: 'images/eggs.webp' },
  'harvest-basket':    { name: 'Harvest Basket',      price: 3500, image: 'images/harvest.webp' },
};

const STORAGE_KEY = 'hoto-cart';

// --- State ---

function getCart() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [] }; }
  catch { return { items: [] }; }
}

function saveCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

function addItem(productId) {
  if (!PRODUCTS[productId]) return; // reject unknown ids
  const cart = getCart();
  const existing = cart.items.find(i => i.id === productId);
  if (existing) { existing.qty += 1; } else { cart.items.push({ id: productId, qty: 1 }); }
  saveCart(cart);
  renderCart();
  openCart();
}

function updateQty(productId, delta) {
  const cart = getCart();
  const item = cart.items.find(i => i.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart.items = cart.items.filter(i => i.id !== productId);
  saveCart(cart);
  renderCart();
}

function removeItem(productId) {
  const cart = getCart();
  cart.items = cart.items.filter(i => i.id !== productId);
  saveCart(cart);
  renderCart();
}

function getTotal() {
  return getCart().items.reduce((sum, item) => {
    const p = PRODUCTS[item.id];
    return sum + (p ? p.price * item.qty : 0);
  }, 0);
}

function getItemCount() {
  return getCart().items.reduce((sum, item) => sum + item.qty, 0);
}

function fmt(cents) {
  return '$' + (cents / 100).toFixed(2);
}

// --- DOM Setup ---

function injectCartDrawer() {
  const overlay = document.createElement('div');
  overlay.className = 'cart-overlay';
  overlay.id = 'cart-overlay';

  const drawer = document.createElement('aside');
  drawer.className = 'cart-drawer';
  drawer.id = 'cart-drawer';
  drawer.setAttribute('aria-label', 'Shopping cart');

  const header = document.createElement('div');
  header.className = 'cart-drawer__header';

  const title = document.createElement('h2');
  title.className = 'cart-drawer__title';
  title.textContent = 'Your Cart';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cart-drawer__close';
  closeBtn.id = 'cart-close';
  closeBtn.setAttribute('aria-label', 'Close cart');
  closeBtn.textContent = '✕';

  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = document.createElement('div');
  body.className = 'cart-drawer__body';
  body.id = 'cart-body';

  drawer.appendChild(header);
  drawer.appendChild(body);

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);

  overlay.addEventListener('click', closeCart);
  closeBtn.addEventListener('click', closeCart);
}

function injectCartIcon() {
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const btn = document.createElement('button');
  btn.className = 'nav__cart';
  btn.setAttribute('aria-label', 'Open cart');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>';

  const label = document.createElement('span');
  label.className = 'nav__cart-label';
  label.textContent = 'Cart';

  const badge = document.createElement('span');
  badge.className = 'nav__cart-count';
  badge.id = 'cart-count';
  badge.setAttribute('aria-live', 'polite');
  badge.textContent = '0';

  btn.appendChild(svg);
  btn.appendChild(label);
  btn.appendChild(badge);
  btn.addEventListener('click', openCart);

  const toggle = nav.querySelector('.nav__toggle');
  toggle ? nav.insertBefore(btn, toggle) : nav.appendChild(btn);
}

// --- Render ---

function renderCart() {
  const cart = getCart();
  const body = document.getElementById('cart-body');
  const countEl = document.getElementById('cart-count');
  if (!body) return;

  const count = getItemCount();
  if (countEl) {
    countEl.textContent = count;
    countEl.classList.toggle('has-items', count > 0);
  }

  // Clear current content
  body.textContent = '';

  if (!cart.items.length) {
    const empty = document.createElement('div');
    empty.className = 'cart-empty';

    const msg = document.createElement('p');
    msg.className = 'cart-empty__text';
    msg.textContent = 'Your cart is empty.';

    const link = document.createElement('a');
    link.className = 'btn btn--dark';
    link.href = 'offerings.html';
    link.textContent = 'Browse Offerings';

    empty.appendChild(msg);
    empty.appendChild(link);
    body.appendChild(empty);
    return;
  }

  const itemsWrap = document.createElement('div');
  itemsWrap.className = 'cart-items';

  // Only render items whose product id exists in PRODUCTS (extra safety)
  cart.items.filter(({ id }) => PRODUCTS[id]).forEach(({ id, qty }) => {
    const p = PRODUCTS[id];
    const item = document.createElement('div');
    item.className = 'cart-item';
    item.dataset.id = id;

    const img = document.createElement('img');
    img.className = 'cart-item__image';
    img.src = p.image;
    img.alt = p.name;

    const info = document.createElement('div');
    info.className = 'cart-item__info';

    const name = document.createElement('p');
    name.className = 'cart-item__name';
    name.textContent = p.name;

    const price = document.createElement('p');
    price.className = 'cart-item__price';
    price.textContent = fmt(p.price);

    const qtyRow = document.createElement('div');
    qtyRow.className = 'cart-item__qty';

    const minusBtn = document.createElement('button');
    minusBtn.className = 'cart-qty-btn';
    minusBtn.setAttribute('aria-label', 'Decrease quantity');
    minusBtn.textContent = '−';
    minusBtn.addEventListener('click', () => updateQty(id, -1));

    const qtyNum = document.createElement('span');
    qtyNum.className = 'cart-qty-num';
    qtyNum.textContent = qty;

    const plusBtn = document.createElement('button');
    plusBtn.className = 'cart-qty-btn';
    plusBtn.setAttribute('aria-label', 'Increase quantity');
    plusBtn.textContent = '+';
    plusBtn.addEventListener('click', () => updateQty(id, 1));

    qtyRow.appendChild(minusBtn);
    qtyRow.appendChild(qtyNum);
    qtyRow.appendChild(plusBtn);

    info.appendChild(name);
    info.appendChild(price);
    info.appendChild(qtyRow);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'cart-item__remove';
    removeBtn.setAttribute('aria-label', 'Remove ' + p.name);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeItem(id));

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(removeBtn);
    itemsWrap.appendChild(item);
  });

  const footer = document.createElement('div');
  footer.className = 'cart-footer';

  const totalRow = document.createElement('div');
  totalRow.className = 'cart-footer__total';

  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Subtotal';

  const totalAmount = document.createElement('span');
  totalAmount.id = 'cart-total';
  totalAmount.textContent = fmt(getTotal());

  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalAmount);

  const note = document.createElement('p');
  note.className = 'cart-footer__note';
  note.textContent = 'Shipping calculated at checkout';

  const checkoutBtn = document.createElement('button');
  checkoutBtn.className = 'btn btn--dark cart-footer__checkout';
  checkoutBtn.id = 'cart-checkout';
  checkoutBtn.textContent = 'Proceed to Checkout';
  checkoutBtn.addEventListener('click', checkout);

  const divider = document.createElement('div');
  divider.className = 'cart-footer__divider';
  const dividerLabel = document.createElement('span');
  dividerLabel.textContent = 'or';
  divider.appendChild(dividerLabel);

  const cryptoBtn = document.createElement('button');
  cryptoBtn.className = 'cart-footer__crypto';
  cryptoBtn.id = 'cart-checkout-crypto';
  cryptoBtn.textContent = '₿  Pay with Bitcoin';
  cryptoBtn.addEventListener('click', checkoutCrypto);

  footer.appendChild(totalRow);
  footer.appendChild(note);
  footer.appendChild(checkoutBtn);
  footer.appendChild(divider);
  footer.appendChild(cryptoBtn);

  body.appendChild(itemsWrap);
  body.appendChild(footer);
}

// --- Open / Close ---

function openCart() {
  document.getElementById('cart-drawer')?.classList.add('open');
  document.getElementById('cart-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  document.getElementById('cart-drawer')?.classList.remove('open');
  document.getElementById('cart-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
}

// --- Checkout ---

async function checkout() {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  const original = btn.textContent;
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty }) => ({ name: PRODUCTS[id].name, price: PRODUCTS[id].price, quantity: qty }));

  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    btn.textContent = 'Error. Try Again';
    btn.disabled = false;
    console.error('Checkout error:', err);
  }
}

// --- Crypto Checkout ---

async function checkoutCrypto() {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout-crypto');
  const original = btn.textContent;
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty }) => ({ name: PRODUCTS[id].name, price: PRODUCTS[id].price, quantity: qty }));

  try {
    const res = await fetch('/create-crypto-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    console.error('Crypto checkout error:', err);
  }
}

// --- Subscribe ---

async function subscribe(subId, name, price) {
  const btn = document.querySelector(`[data-sub-id="${CSS.escape(subId)}"]`);
  const original = btn?.textContent;
  if (btn) { btn.textContent = 'Redirecting…'; btn.disabled = true; }

  try {
    const res = await fetch('/create-subscription-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { name, price } }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    if (btn) { btn.textContent = original; btn.disabled = false; }
    console.error('Subscription error:', err);
  }
}

// --- Init ---

document.addEventListener('DOMContentLoaded', () => {
  injectCartDrawer();
  injectCartIcon();
  renderCart();

  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', () => addItem(btn.dataset.addToCart));
  });

  document.querySelectorAll('[data-sub-id]').forEach(btn => {
    btn.addEventListener('click', () =>
      subscribe(btn.dataset.subId, btn.dataset.subName, parseInt(btn.dataset.subPrice, 10))
    );
  });
});
