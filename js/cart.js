/* =========================================
   HEART OF TEXAS ORGANICS CART
   ========================================= */

const PRODUCTS = {
  'japanese-milk-loaf': { name: 'Japanese Milk Loaf', price: 1500, subPrice: null, image: 'images/japanese-milk-loaf.jpg' },
  'whole-wheat-loaf':   { name: 'Whole Wheat Loaf',   price: 1800, subPrice: null, image: 'images/whole-wheat-loaf.jpg' },
  'cinnamon-rolls':     { name: 'Cinnamon Rolls',      price: 600,  subPrice: null, image: 'images/cinnamon-rolls.jpg' },
  'yeast-rolls':        { name: 'Yeast Rolls',         price: 2400, subPrice: null, image: 'images/yeast-rolls.jpg' },
  'focaccia-loaf':      { name: 'Focaccia Loaf',       price: 3200, subPrice: null, image: 'images/focaccia-loaf.jpg' },
  'whole-chicken':      { name: 'Whole Chicken',       price: 4900, subPrice: null, image: 'images/chicken.jpg' },
  'cultured-butter':    { name: 'Real Cream Butter',   price: 1700, subPrice: null, image: 'images/butter.jpg' },
  'farm-eggs':          { name: 'Farm Eggs (1 dozen)', price: 1300, subPrice: null, image: 'images/eggs.jpg' },
  'harvest-basket':        { name: 'Harvest Basket',        price: 0, subPrice: null, image: 'images/harvest.jpg' },
  'thanksgiving-turkey':   { name: 'Thanksgiving Turkey',   price: 10000, subPrice: null, image: 'images/chicken.jpg' },
  'sampler-box':           { name: 'The Farm Sampler Box',  price: 14900, subPrice: null, image: null },
  'garlic-chili-crunch':   { name: 'Garlic Chili Crunch',   price: 1800, subPrice: null, image: 'images/chili-crunch.jpg' },
  'herb-dipping-oil':      { name: 'Tuscany Herb Dipping Oil', price: 1800, subPrice: null, image: 'images/herb-dipping-oil.jpg' },
  'seasonal-preserves':    { name: 'Seasonal Preserves',    price: 1500, subPrice: null, image: 'images/preserves.jpg' },
  // Subscription boxes — shown as a single line item in the cart
  'bread-box':            { name: 'The Bread & Butter Board Box', price: 5500, subPrice: null, image: null },
  'harvest-subscription': { name: 'The Supper Starter Box',       price: 15000, subPrice: null, image: null },
  'farm-box':             { name: "Monthly Farm Butcher's Box",   price: 0, subPrice: null, image: null },
  // Add-on items selectable from the box customizer
  'addon-yeast-rolls':    { name: 'Yeast Rolls (1 doz)',              price: 2400,  subPrice: null, image: null },
  'addon-cinnamon-rolls': { name: 'Extra Cinnamon Rolls (½ doz)',    price: 3500, subPrice: null, image: null },
  'addon-butter':         { name: 'Extra Real Cream Butter (½ lb)',  price: 1700, subPrice: null, image: null },
  'addon-eggs':           { name: 'Farm Eggs — add-on (1 doz)',      price: 1300, subPrice: null, image: null },
  'addon-preserves':      { name: 'Seasonal Preserves — add-on',     price: 1500, subPrice: null, image: null },
  'addon-chili-crunch':   { name: 'Garlic Chili Crunch — add-on',    price: 1800, subPrice: null, image: null },
  'addon-herb-oil':       { name: 'Tuscany Herb Dipping Oil — add-on', price: 1800, subPrice: null, image: null },
  'addon-whole-chicken':  { name: 'Whole Chicken — add-on',          price: 0,    subPrice: null, image: null },
  'addon-neckbone':       { name: 'Neckbone',                          price: 200,  subPrice: null, image: null },
  'addon-chicken-broth':  { name: 'Chicken Bone Broth (16 oz)',         price: 2000, subPrice: null, image: null },
};

const STORAGE_KEY   = 'hoto-cart';
const SHIP_MINIMUM  = 0;

// Approximate product weights in lbs (used for shipping rate calculation)
const PRODUCT_WEIGHTS = {
  'japanese-milk-loaf': 2.0,
  'whole-wheat-loaf':   2.0,
  'cinnamon-rolls':     1.5,
  'yeast-rolls':        1.0,
  'focaccia-loaf':      1.5,
  'whole-chicken':      4.5,
  'cultured-butter':    1.0,
  'farm-eggs':          1.5,
  'harvest-basket':     5.0,
  'garlic-chili-crunch': 0.8,
  'herb-dipping-oil':   1.0,
  'seasonal-preserves': 1.2,
  'sampler-box':        4.0,
};

function calcCartWeight() {
  const cart = getCart();
  return cart.items.reduce((sum, { id, qty }) => sum + (PRODUCT_WEIGHTS[id] || 1) * qty, 0);
}

function getBoxDims(lbs) {
  if (lbs <= 5)  return { length: 12, width: 10, height: 6 };
  if (lbs <= 10) return { length: 14, width: 12, height: 8 };
  return { length: 18, width: 14, height: 10 };
}

// --- State ---

function getCart() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { items: [] }; }
  catch { return { items: [] }; }
}

function saveCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

// Items sold only in fixed increments (e.g. cinnamon rolls: half-dozen minimum)
const QTY_STEP = { 'cinnamon-rolls': 6 };

function addItem(productId, priceOverride) {
  if (!PRODUCTS[productId]) return;
  const cart = getCart();
  const existing = cart.items.find(i => i.id === productId);
  const price = priceOverride ?? null;
  const step = QTY_STEP[productId] || 1;
  if (existing) { existing.qty += step; existing.price = price; }
  else { cart.items.push({ id: productId, qty: step, price }); }
  saveCart(cart);
  renderCart();
  openCart();
}

function updateQty(productId, delta) {
  const cart = getCart();
  const item = cart.items.find(i => i.id === productId);
  if (!item) return;
  const step = QTY_STEP[productId] || 1;
  item.qty += delta * step;
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
    const price = item.price ?? (p ? p.price : 0);
    return sum + price * item.qty;
  }, 0);
}

function getItemCount() {
  return getCart().items.reduce((sum, item) => sum + item.qty, 0);
}

function fmt(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function isSubscribing() {
  return localStorage.getItem('hoto-subscribe') === '1';
}

function setSubscribing(v) {
  localStorage.setItem('hoto-subscribe', v ? '1' : '0');
}

function getAdminSub() {
  try { return JSON.parse(localStorage.getItem('hoto-admin-sub') || 'null'); } catch { return null; }
}
function clearAdminSub() { localStorage.removeItem('hoto-admin-sub'); }

function getDiscountedTotal() {
  return getCart().items.reduce((sum, item) => {
    const p = PRODUCTS[item.id];
    const price = item.price ?? (p ? p.price : 0);
    return sum + Math.round(price * 0.90) * item.qty;
  }, 0);
}

function getMonthlyTotal() {
  return getTotal() * 4;
}

// --- DOM Setup ---

function injectCartDrawer() {
  if (document.getElementById('cart-drawer')) return; // already injected
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
  if (document.getElementById('cart-icon-btn')) return; // already injected
  const nav = document.querySelector('.nav');
  if (!nav) return;

  const btn = document.createElement('button');
  btn.className = 'nav__cart';
  btn.id = 'cart-icon-btn';
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

  // Render known products AND custom items (those with a stored name field)
  const adminSub   = getAdminSub();
  const subscribing = !!adminSub;

  cart.items.filter(({ id, name }) => PRODUCTS[id] || name).forEach(({ id, qty, price: itemPrice, name: storedName }) => {
    const p = PRODUCTS[id];
    const displayName  = storedName || (p && p.name) || id;
    const basePrice    = itemPrice || (p ? p.price : 0);
    const displayPrice = basePrice;
    const item = document.createElement('div');
    item.className = 'cart-item';
    item.dataset.id = id;

    const img = document.createElement('img');
    img.className = 'cart-item__image';
    img.src = (p && p.image) || '';
    img.alt = displayName;
    if (!p || !p.image) img.style.display = 'none';

    const info = document.createElement('div');
    info.className = 'cart-item__info';

    const name = document.createElement('p');
    name.className = 'cart-item__name';
    name.textContent = displayName;

    const price = document.createElement('p');
    price.className = 'cart-item__price';
    if (displayPrice < 0) {
      price.textContent = '-' + fmt(Math.abs(displayPrice));
      price.style.color = '#2a7a2a';
    } else {
      price.textContent = fmt(displayPrice);
    }

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
    removeBtn.setAttribute('aria-label', 'Remove ' + displayName);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeItem(id));

    item.appendChild(img);
    item.appendChild(info);
    item.appendChild(removeBtn);
    itemsWrap.appendChild(item);

    // If this is a sampler/box item and we have saved included items, show them as sub-rows
    if (id === 'sampler-box' && adminSub && adminSub.includedItems && adminSub.includedItems.length) {
      const subList = document.createElement('div');
      subList.style.cssText = 'padding:6px 12px 10px 12px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid rgba(44,62,45,0.08);margin-bottom:4px;';
      const subHeader = document.createElement('p');
      subHeader.style.cssText = 'font-family:var(--font-sans);font-size:0.62rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(44,62,45,0.4);margin:0 0 6px;';
      subHeader.textContent = "What's Inside";
      subList.appendChild(subHeader);
      adminSub.includedItems.forEach(inc => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
        const incName = document.createElement('span');
        incName.style.cssText = 'font-family:var(--font-sans);font-size:0.8rem;color:var(--color-green,#2C3E2D);';
        incName.textContent = '· ' + inc.name;
        const incPrice = document.createElement('span');
        incPrice.style.cssText = 'font-family:var(--font-sans);font-size:0.75rem;color:rgba(44,62,45,0.4);';
        incPrice.textContent = 'Included';
        row.appendChild(incName);
        row.appendChild(incPrice);
        subList.appendChild(row);
      });
      // Also show paid add-ons that came from the customizer
      if (adminSub.addons && adminSub.addons.length) {
        adminSub.addons.filter(a => a.price > 0).forEach(addon => {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;';
          const aName = document.createElement('span');
          aName.style.cssText = 'font-family:var(--font-sans);font-size:0.8rem;color:var(--color-green,#2C3E2D);';
          aName.textContent = '+ ' + addon.name;
          const aPrice = document.createElement('span');
          aPrice.style.cssText = 'font-family:var(--font-sans);font-size:0.75rem;color:var(--color-rust,#8B4A2F);';
          aPrice.textContent = fmt(addon.price);
          row.appendChild(aName);
          row.appendChild(aPrice);
          subList.appendChild(row);
        });
      }
      itemsWrap.appendChild(subList);
    }
  });

  const footer = document.createElement('div');
  footer.className = 'cart-footer';

  // Promo code row — the typed input box is subscription-only, but an
  // already-applied code (e.g. from the cart-abandonment save offer) is
  // honored and shown for any cart type
  const hasTurkey = getCart().items.some(i => i.id === 'thanksgiving-turkey');
  const savedPromo    = localStorage.getItem('hoto-promo-code') || '';
  const savedPromoAmt = parseInt(localStorage.getItem('hoto-promo-amt') || '0', 10);

  const promoRow = document.createElement('div');
  promoRow.style.cssText = 'display:' + (subscribing ? 'flex' : 'none') + ';align-items:center;gap:8px;margin-bottom:8px;';

  const promoInput = document.createElement('input');
  promoInput.type = 'text';
  promoInput.placeholder = 'Promo code';
  promoInput.value = savedPromo;
  promoInput.style.cssText = 'flex:1;padding:8px 10px;border:1px solid rgba(44,62,45,0.2);border-radius:8px;font-family:var(--font-sans);font-size:0.82rem;color:var(--color-green);text-transform:uppercase;';

  const promoBtn = document.createElement('button');
  promoBtn.textContent = savedPromo ? 'Remove' : 'Apply';
  promoBtn.style.cssText = 'padding:8px 14px;background:var(--color-green);color:#fff;border:none;border-radius:8px;font-family:var(--font-sans);font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;';

  const promoMsg = document.createElement('p');
  promoMsg.style.cssText = 'font-family:var(--font-sans);font-size:0.75rem;margin:0 0 6px;padding:0;';
  if (savedPromo && savedPromoAmt) {
    promoMsg.style.color = '#2a7a2a';
    promoMsg.textContent = subscribing
      ? savedPromo + ' applied — ' + fmt(savedPromoAmt) + ' off your first week'
      : savedPromo + ' applied — -' + fmt(savedPromoAmt) + ' off order';
  }

  const BOX_ITEM_IDS = new Set(['bread-box', 'harvest-subscription', 'farm-box']);

  promoBtn.addEventListener('click', async () => {
    if (savedPromo) {
      localStorage.removeItem('hoto-promo-code');
      localStorage.removeItem('hoto-promo-amt');
      renderCart();
      return;
    }
    const code = promoInput.value.trim().toUpperCase();
    if (!code) return;
    promoBtn.textContent = '…';
    promoBtn.disabled = true;
    try {
      const r = await fetch('/api/validate-promo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (d.valid) {
        localStorage.setItem('hoto-promo-code', code);
        // Subscription: 10% off ONE week only; one-time: off full order
        const weeklyTotal = getTotal();
        const discountAmt = Math.round(weeklyTotal * (d.percent_off / 100));
        localStorage.setItem('hoto-promo-amt', discountAmt);
        renderCart();
      } else {
        promoMsg.style.color = '#c0392b';
        promoMsg.textContent = d.error || 'Invalid code';
        promoBtn.textContent = 'Apply';
        promoBtn.disabled = false;
      }
    } catch {
      promoMsg.style.color = '#c0392b';
      promoMsg.textContent = 'Could not validate code';
      promoBtn.textContent = 'Apply';
      promoBtn.disabled = false;
    }
  });

  promoRow.appendChild(promoInput);
  promoRow.appendChild(promoBtn);

  const totalRow = document.createElement('div');
  totalRow.className = 'cart-footer__total';

  const totalLabel = document.createElement('span');
  const monthlyPrice = getMonthlyTotal();
  // For subscriptions with promo: monthly total shows full recurring price;
  // first-week discount is shown separately in promoMsg
  const baseTotal    = subscribing ? monthlyPrice : getTotal();
  const displayTotal = (!subscribing && savedPromoAmt) ? baseTotal - savedPromoAmt : baseTotal;
  totalLabel.textContent = subscribing ? 'Monthly total' : 'Subtotal';

  const totalAmount = document.createElement('span');
  totalAmount.id = 'cart-total';
  totalAmount.textContent = subscribing ? fmt(monthlyPrice) + '/mo' : fmt(displayTotal);

  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalAmount);

  // Subscribe & Save toggle — only show when weekly spend is $55 or more
  const hasSamplerBox = cart.items.some(i => i.id === 'sampler-box');
  if (!adminSub && !hasSamplerBox && getTotal() >= 5500) {
    const subToggleWrap = document.createElement('label');
    subToggleWrap.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--color-cream,#F5F0E8);border-radius:10px;cursor:pointer;margin-bottom:10px;';
    const subToggleCb = document.createElement('input');
    subToggleCb.type = 'checkbox';
    subToggleCb.checked = subscribing;
    subToggleCb.style.cssText = 'width:16px;height:16px;accent-color:var(--color-green,#2C3E2D);flex-shrink:0;';
    const subToggleText = document.createElement('div');
    const subToggleLine1 = document.createElement('span');
    subToggleLine1.style.cssText = 'font-family:var(--font-sans);font-size:0.86rem;font-weight:600;color:var(--color-green,#2C3E2D);display:block;';
    subToggleLine1.textContent = 'Subscribe & Save — 10% off your first box';
    const subToggleLine2 = document.createElement('span');
    subToggleLine2.style.cssText = 'font-family:var(--font-sans);font-size:0.72rem;color:rgba(44,62,45,0.55);display:block;margin-top:2px;';
    subToggleLine2.textContent = 'Monthly · cancel anytime · subsequent boxes at full price';
    subToggleText.appendChild(subToggleLine1);
    subToggleText.appendChild(subToggleLine2);
    subToggleWrap.appendChild(subToggleCb);
    subToggleWrap.appendChild(subToggleText);

    // Email capture section — shows below toggle when subscribe is checked and email not yet captured
    const emailCaptureDiv = document.createElement('div');
    emailCaptureDiv.id = 'cart-email-capture';
    emailCaptureDiv.style.cssText = 'display:' + (subscribing && !localStorage.getItem('hoto-email-signup') ? 'block' : 'none') + ';padding:12px 14px;background:#fff;border:1px solid rgba(44,62,45,0.12);border-radius:10px;margin-bottom:10px;';
    const ecLabel = document.createElement('p');
    ecLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.8rem;color:var(--color-green,#2C3E2D);margin:0 0 8px;font-weight:600;';
    ecLabel.textContent = '🌿 Enter your email to receive your 10% off code';
    const ecRow = document.createElement('div');
    ecRow.style.cssText = 'display:flex;gap:8px;';
    const ecInput = document.createElement('input');
    ecInput.type = 'email';
    ecInput.placeholder = 'your@email.com';
    ecInput.style.cssText = 'flex:1;padding:8px 10px;border:1px solid rgba(44,62,45,0.2);border-radius:8px;font-family:var(--font-sans);font-size:0.82rem;color:var(--color-green,#2C3E2D);';
    const ecBtn = document.createElement('button');
    ecBtn.type = 'button';
    ecBtn.textContent = 'Claim →';
    ecBtn.style.cssText = 'padding:8px 14px;background:var(--color-green,#2C3E2D);color:#F5F0E8;border:none;border-radius:8px;font-family:var(--font-sans);font-size:0.78rem;font-weight:700;cursor:pointer;white-space:nowrap;';
    const ecMsg = document.createElement('p');
    ecMsg.style.cssText = 'font-family:var(--font-sans);font-size:0.75rem;margin:6px 0 0;display:none;';
    ecBtn.addEventListener('click', async () => {
      const em = ecInput.value.trim();
      if (!em || !em.includes('@')) { ecMsg.style.color='#c0392b'; ecMsg.style.display='block'; ecMsg.textContent='Please enter a valid email.'; return; }
      ecBtn.textContent = '…'; ecBtn.disabled = true;
      try {
        const r = await fetch('/subscribe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email: em, source: 'cart' }) });
        const d = await r.json();
        localStorage.setItem('hoto-email-signup', em);
        if (d.promoCode) {
          localStorage.setItem('hoto-promo-code', d.promoCode);
          const weeklyTotal = getTotal();
          localStorage.setItem('hoto-promo-amt', String(Math.round(weeklyTotal * 0.10)));
        }
        ecMsg.style.color = '#2a7a2a'; ecMsg.style.display = 'block';
        ecMsg.textContent = d.already ? 'Welcome back! Check your inbox for your code.' : 'Code sent to ' + em + '! Applied below.';
        setTimeout(renderCart, 1200);
      } catch { ecBtn.textContent='Claim →'; ecBtn.disabled=false; }
    });
    ecRow.appendChild(ecInput);
    ecRow.appendChild(ecBtn);
    emailCaptureDiv.appendChild(ecLabel);
    emailCaptureDiv.appendChild(ecRow);
    emailCaptureDiv.appendChild(ecMsg);

    subToggleCb.addEventListener('change', () => {
      setSubscribing(subToggleCb.checked);
      if (!subToggleCb.checked) { localStorage.removeItem('hoto-subscribe'); }
      renderCart();
    });
    footer.appendChild(subToggleWrap);
    footer.appendChild(emailCaptureDiv);
  }

  const note = document.createElement('p');
  note.className = 'cart-footer__note';
  note.textContent = subscribing ? 'Charged monthly · cancel anytime' : 'Shipping calculated at checkout';

  const checkoutBtn = document.createElement('button');
  checkoutBtn.className = 'btn btn--dark cart-footer__checkout';
  checkoutBtn.id = 'cart-checkout';
  checkoutBtn.textContent = subscribing ? `Subscribe — ${fmt(monthlyPrice)}/mo` : 'Proceed to Checkout';
  const checkoutHandler = adminSub ? openAdminSubDeliveryModal
                        : subscribing ? openCartDeliveryModal
                        : openOneTimeDeliveryChoice;
  checkoutBtn.addEventListener('click', checkoutHandler);

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

  const clearBtn = document.createElement('button');
  clearBtn.className = 'cart-footer__clear';
  clearBtn.id = 'cart-clear';
  clearBtn.textContent = 'Clear Cart';
  clearBtn.addEventListener('click', openClearCartModal);

  footer.appendChild(promoRow);
  footer.appendChild(promoMsg);
  footer.appendChild(totalRow);
  footer.appendChild(note);
  footer.appendChild(checkoutBtn);
  footer.appendChild(divider);
  footer.appendChild(cryptoBtn);
  footer.appendChild(clearBtn);

  body.appendChild(itemsWrap);
  body.appendChild(footer);
}

// --- Clear Cart (with a save-the-sale offer) ---

function injectClearCartModal() {
  if (document.getElementById('clear-cart-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'clear-cart-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'Wait — are you sure?';

  const body = document.createElement('p');
  body.className = 'sub-prompt__body';
  body.id = 'clear-cart-body';

  const keepBtn = document.createElement('button');
  keepBtn.className = 'sub-prompt__btn sub-prompt__btn--yes';
  keepBtn.id = 'clear-cart-keep';
  keepBtn.textContent = 'Keep My Cart & Receive Free Gift';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  confirmBtn.id = 'clear-cart-confirm';
  confirmBtn.textContent = 'No thanks, clear my cart';

  const actions = document.createElement('div');
  actions.className = 'sub-prompt__actions';
  actions.appendChild(keepBtn);
  actions.appendChild(confirmBtn);

  box.appendChild(heading);
  box.appendChild(body);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeClearCartModal(); });

  keepBtn.addEventListener('click', () => {
    localStorage.setItem('hoto-free-gift-eligible', 'true');
    closeClearCartModal();
    document.getElementById('cart-checkout')?.click();
  });

  confirmBtn.addEventListener('click', () => {
    saveCart({ items: [] });
    localStorage.removeItem('hoto-promo-code');
    localStorage.removeItem('hoto-promo-amt');
    closeClearCartModal();
    renderCart();
  });
}

function openClearCartModal() {
  const bodyText = document.getElementById('clear-cart-body');
  if (bodyText) {
    bodyText.textContent = "You're so close to having real, local food on your table. Stick around and enjoy a free gift from us.";
  }
  document.getElementById('clear-cart-overlay')?.classList.add('open');
}

function closeClearCartModal() {
  document.getElementById('clear-cart-overlay')?.classList.remove('open');
}

// --- Whole Chicken — weight + processing modal ---

const CHICKEN_PRICE_PER_LB = 700; // $7/lb
const CHICKEN_PROCESSING_PRICE = 1000; // $10
const CHICKEN_WEIGHTS = [
  { lbs: 7,  available: true },
  { lbs: 8,  available: true },
  { lbs: 9,  available: false },
  { lbs: 10, available: false },
];

function injectChickenModal() {
  if (document.getElementById('chicken-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'chicken-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,28,28,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 0.3s,visibility 0.3s;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.25);">
      <div style="padding:24px 28px 16px;border-bottom:1px solid rgba(44,62,45,0.08);">
        <p style="font-family:var(--font-sans);font-size:0.65rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);margin:0 0 4px;">Pasture-Raised</p>
        <h2 style="font-family:var(--font-serif);font-size:1.4rem;color:var(--color-green);margin:0;font-weight:400;">Whole Chicken</h2>
      </div>
      <div style="padding:24px 28px;">
        <p style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-green);margin:0 0 12px;">Choose a Weight</p>
        <div id="chk-weights" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;"></div>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:var(--color-cream,#F5F0E8);border-radius:10px;cursor:pointer;margin-bottom:20px;">
          <input type="checkbox" id="chk-processing" style="width:16px;height:16px;accent-color:var(--color-rust,#8B4A2F);flex-shrink:0;margin-top:2px;">
          <div>
            <span style="font-family:var(--font-sans);font-size:0.86rem;color:var(--color-green);display:block;">Cut into 10 Premium Cuts <strong style="color:var(--color-rust,#8B4A2F);">+$10</strong></span>
            <span style="font-family:var(--font-sans);font-size:0.72rem;color:rgba(44,62,45,0.5);display:block;margin-top:3px;">2 Breasts · 2 Leg Quarters · 2 Tenders · 2 Drums · 2 Flats</span>
          </div>
        </label>

        <div style="background:var(--color-cream,#F5F0E8);border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-green);">Total</span>
          <span id="chk-total" style="font-family:var(--font-serif);font-size:1.3rem;color:var(--color-green);font-weight:400;"></span>
        </div>
        <div style="display:flex;gap:12px;">
          <button id="chk-cancel" style="flex:1;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;border:1.5px solid rgba(44,62,45,0.2);background:transparent;color:rgba(44,62,45,0.6);border-radius:8px;cursor:pointer;">Cancel</button>
          <button id="chk-add" style="flex:2;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border:none;background:var(--color-green);color:var(--color-cream,#F5F0E8);border-radius:8px;cursor:pointer;">Add to Cart</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeChickenModal(); });
  document.getElementById('chk-cancel').onclick = closeChickenModal;

  const weightsEl = document.getElementById('chk-weights');
  CHICKEN_WEIGHTS.forEach((w, i) => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px solid rgba(44,62,45,0.15);border-radius:8px;cursor:' + (w.available ? 'pointer' : 'not-allowed') + ';opacity:' + (w.available ? '1' : '0.45') + ';';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'chk-weight';
    radio.value = String(w.lbs);
    radio.disabled = !w.available;
    radio.checked = w.available && !CHICKEN_WEIGHTS.slice(0, i).some(x => x.available);
    radio.style.cssText = 'width:16px;height:16px;accent-color:var(--color-rust,#8B4A2F);';
    radio.addEventListener('change', chkUpdateTotal);
    const text = document.createElement('span');
    text.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);flex:1;';
    text.textContent = w.lbs + ' lb' + (w.available ? '' : ' — Sold Out');
    const price = document.createElement('span');
    price.style.cssText = 'font-family:var(--font-sans);font-size:0.82rem;color:rgba(44,62,45,0.5);';
    price.textContent = w.available ? '$' + (w.lbs * CHICKEN_PRICE_PER_LB / 100).toFixed(2) : '';
    label.appendChild(radio); label.appendChild(text); label.appendChild(price);
    weightsEl.appendChild(label);
  });

  document.getElementById('chk-processing').addEventListener('change', chkUpdateTotal);

  document.getElementById('chk-add').onclick = () => {
    const lbs = parseInt(document.querySelector('input[name="chk-weight"]:checked')?.value || '7', 10);
    const processing = document.getElementById('chk-processing').checked;
    const priceCents = lbs * CHICKEN_PRICE_PER_LB + (processing ? CHICKEN_PROCESSING_PRICE : 0);
    const name = 'Whole Chicken — ' + lbs + ' lb' + (processing ? ' (Cut into 10 Premium Cuts)' : '');

    const cart = getCart();
    cart.items = cart.items.filter(i => i.id !== 'whole-chicken');
    cart.items.unshift({ id: 'whole-chicken', qty: 1, price: priceCents, name });
    saveCart(cart);

    closeChickenModal();
    renderCart();
    openCart();
  };
}

function chkUpdateTotal() {
  const lbs = parseInt(document.querySelector('input[name="chk-weight"]:checked')?.value || '7', 10);
  const processing = document.getElementById('chk-processing')?.checked;
  const total = lbs * CHICKEN_PRICE_PER_LB + (processing ? CHICKEN_PROCESSING_PRICE : 0);
  const el = document.getElementById('chk-total');
  if (el) el.textContent = fmt(total);
}

function openChickenModal() {
  if (!document.getElementById('chicken-modal-overlay')) injectChickenModal();
  chkUpdateTotal();
  const overlay = document.getElementById('chicken-modal-overlay');
  overlay.style.visibility = 'visible';
  overlay.style.pointerEvents = 'all';
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function closeChickenModal() {
  const overlay = document.getElementById('chicken-modal-overlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.visibility = 'hidden'; overlay.style.pointerEvents = 'none'; }, 300);
}

// --- Real Cream Butter — size + salt type modal ---

const BUTTER_SIZES = [
  { id: 'half', label: '½ lb', price: 1700 },
  { id: 'full', label: '1 lb',  price: 2499 },
];
const BUTTER_TYPES = ['Sea Salt', 'Unsalted', 'Rosemary (+$4)'];
const BUTTER_ROSEMARY_UPCHARGE = 400; // $4

function injectButterModal() {
  if (document.getElementById('butter-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'butter-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,28,28,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;visibility:hidden;pointer-events:none;transition:opacity 0.3s,visibility 0.3s;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;max-width:440px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.25);">
      <div style="padding:24px 28px 16px;border-bottom:1px solid rgba(44,62,45,0.08);">
        <p style="font-family:var(--font-sans);font-size:0.65rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);margin:0 0 4px;">Dairy</p>
        <h2 style="font-family:var(--font-serif);font-size:1.4rem;color:var(--color-green);margin:0;font-weight:400;">Real Cream Butter</h2>
      </div>
      <div style="padding:24px 28px;">
        <p style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-green);margin:0 0 12px;">Choose a Size</p>
        <div id="but-sizes" style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;"></div>

        <p style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-green);margin:0 0 12px;">Choose a Type</p>
        <select id="but-type" style="width:100%;padding:10px 12px;font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);border:1.5px solid rgba(44,62,45,0.15);border-radius:8px;background:#fff;cursor:pointer;margin-bottom:24px;"></select>

        <div style="background:var(--color-cream,#F5F0E8);border-radius:10px;padding:14px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:baseline;">
          <span style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-green);">Total</span>
          <span id="but-total" style="font-family:var(--font-serif);font-size:1.3rem;color:var(--color-green);font-weight:400;"></span>
        </div>
        <div style="display:flex;gap:12px;">
          <button id="but-cancel" style="flex:1;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;border:1.5px solid rgba(44,62,45,0.2);background:transparent;color:rgba(44,62,45,0.6);border-radius:8px;cursor:pointer;">Cancel</button>
          <button id="but-add" style="flex:2;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border:none;background:var(--color-green);color:var(--color-cream,#F5F0E8);border-radius:8px;cursor:pointer;">Add to Cart</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeButterModal(); });
  document.getElementById('but-cancel').onclick = closeButterModal;

  const sizesEl = document.getElementById('but-sizes');
  BUTTER_SIZES.forEach((s, i) => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;border:1.5px solid rgba(44,62,45,0.15);border-radius:8px;cursor:pointer;';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'but-size';
    radio.value = s.id;
    radio.checked = i === 0;
    radio.style.cssText = 'width:16px;height:16px;accent-color:var(--color-rust,#8B4A2F);';
    radio.addEventListener('change', butUpdateTotal);
    const text = document.createElement('span');
    text.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);flex:1;';
    text.textContent = s.label;
    const price = document.createElement('span');
    price.style.cssText = 'font-family:var(--font-sans);font-size:0.82rem;color:rgba(44,62,45,0.5);';
    price.textContent = fmt(s.price);
    label.appendChild(radio); label.appendChild(text); label.appendChild(price);
    sizesEl.appendChild(label);
  });

  const typeSel = document.getElementById('but-type');
  BUTTER_TYPES.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });
  typeSel.addEventListener('change', butUpdateTotal);

  document.getElementById('but-add').onclick = () => {
    const sizeId = document.querySelector('input[name="but-size"]:checked')?.value || 'half';
    const size = BUTTER_SIZES.find(s => s.id === sizeId) || BUTTER_SIZES[0];
    const type = document.getElementById('but-type').value;
    const rosemary = type.startsWith('Rosemary');
    const priceCents = size.price + (rosemary ? BUTTER_ROSEMARY_UPCHARGE : 0);
    const typeLabel = rosemary ? 'Rosemary' : type;
    const name = 'Real Cream Butter — ' + size.label + ', ' + typeLabel;

    const cart = getCart();
    cart.items = cart.items.filter(i => i.id !== 'cultured-butter');
    cart.items.unshift({ id: 'cultured-butter', qty: 1, price: priceCents, name });
    saveCart(cart);

    closeButterModal();
    renderCart();
    openCart();
  };
}

function butUpdateTotal() {
  const sizeId = document.querySelector('input[name="but-size"]:checked')?.value || 'half';
  const size = BUTTER_SIZES.find(s => s.id === sizeId) || BUTTER_SIZES[0];
  const type = document.getElementById('but-type')?.value || '';
  const rosemary = type.startsWith('Rosemary');
  const total = size.price + (rosemary ? BUTTER_ROSEMARY_UPCHARGE : 0);
  const el = document.getElementById('but-total');
  if (el) el.textContent = fmt(total);
}

function openButterModal() {
  if (!document.getElementById('butter-modal-overlay')) injectButterModal();
  butUpdateTotal();
  const overlay = document.getElementById('butter-modal-overlay');
  overlay.style.visibility = 'visible';
  overlay.style.pointerEvents = 'all';
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function closeButterModal() {
  const overlay = document.getElementById('butter-modal-overlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.visibility = 'hidden'; overlay.style.pointerEvents = 'none'; }, 300);
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

// --- Shipping Calculator Modal ---

let _shipCalcRate = null;

// ---- Address Confirmation Modal ----

function injectAddressConfirmModal() {
  if (document.getElementById('addr-confirm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'addr-confirm-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt addr-confirm-modal';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'Confirm Your Address';

  const subtitle = document.createElement('p');
  subtitle.className = 'addr-confirm-subtitle';
  subtitle.textContent = 'USPS returned a standardized version. Select which to use:';

  const cols = document.createElement('div');
  cols.className = 'addr-confirm-cols';
  cols.id = 'addr-confirm-cols';

  const cancelLink = document.createElement('button');
  cancelLink.className = 'addr-confirm-cancel';
  cancelLink.textContent = 'Cancel — let me correct it';
  cancelLink.addEventListener('click', () => overlay.classList.remove('open'));

  box.appendChild(heading);
  box.appendChild(subtitle);
  box.appendChild(cols);
  box.appendChild(cancelLink);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
}

function showAddressConfirmModal(entered, suggested, onSelect) {
  const cols = document.getElementById('addr-confirm-cols');
  cols.textContent = '';

  function makeAddrCol(labelText, addr, btnText, choice) {
    const col = document.createElement('div');
    col.className = 'addr-confirm-col';

    const lbl = document.createElement('div');
    lbl.className = 'addr-confirm-col-label';
    lbl.textContent = labelText;

    const zip = addr.zip + (addr.zip4 ? '-' + addr.zip4 : '');
    const text = document.createElement('div');
    text.className = 'addr-confirm-col-text';
    text.appendChild(document.createTextNode(addr.street));
    text.appendChild(document.createElement('br'));
    text.appendChild(document.createTextNode(addr.city + ', ' + addr.state + ' ' + zip));

    const btn = document.createElement('button');
    btn.className = 'addr-confirm-col-btn';
    btn.textContent = btnText;
    btn.addEventListener('click', () => {
      document.getElementById('addr-confirm-overlay').classList.remove('open');
      onSelect(choice, addr);
    });

    col.appendChild(lbl);
    col.appendChild(text);
    col.appendChild(btn);
    return col;
  }

  cols.appendChild(makeAddrCol('You Entered', entered, 'Use What I Entered', 'entered'));
  cols.appendChild(makeAddrCol('USPS Standardized', suggested, 'Use USPS Version', 'suggested'));

  document.getElementById('addr-confirm-overlay').classList.add('open');
}

function makeField(id, labelText, placeholder, maxLen) {
  const wrap = document.createElement('div');
  wrap.className = 'ship-calc-field';
  const lbl = document.createElement('label');
  lbl.className = 'ship-calc-label';
  lbl.textContent = labelText;
  lbl.htmlFor = id;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.id = id; inp.placeholder = placeholder;
  inp.className = 'ship-calc-input';
  if (maxLen) inp.maxLength = maxLen;
  wrap.appendChild(lbl);
  wrap.appendChild(inp);
  return wrap;
}

function injectShipCalcModal() {
  if (document.getElementById('ship-calc-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'ship-calc-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt ship-calc-modal';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'Calculate Shipping';

  const form = document.createElement('div');
  form.className = 'ship-calc-form';
  form.appendChild(makeField('sc-name',   'Full Name',      'Jane Smith'));
  form.appendChild(makeField('sc-street', 'Street Address', '123 Main St'));
  // City on its own row (full width)
  form.appendChild(makeField('sc-city',   'City',           'Austin'));

  // State / ZIP / ZIP+4 on one row
  const zipRow = document.createElement('div');
  zipRow.className = 'ship-calc-row';

  const stateF = makeField('sc-state', 'State', 'TX', 2);
  const zipF   = makeField('sc-zip',   'ZIP',   '78701', 5);

  // ZIP+4 field (optional 4-digit extension)
  const zip4F = document.createElement('div');
  zip4F.className = 'ship-calc-field';
  const zip4Lbl = document.createElement('label');
  zip4Lbl.className = 'ship-calc-label';
  zip4Lbl.htmlFor = 'sc-zip4';
  zip4Lbl.textContent = 'ZIP+4';
  const zip4Row = document.createElement('div');
  zip4Row.className = 'ship-calc-zip4-row';
  const zip4Dash = document.createElement('span');
  zip4Dash.className = 'ship-calc-zip4-dash';
  zip4Dash.textContent = '-';
  const zip4Inp = document.createElement('input');
  zip4Inp.type = 'text'; zip4Inp.id = 'sc-zip4'; zip4Inp.placeholder = '0000';
  zip4Inp.className = 'ship-calc-input'; zip4Inp.maxLength = 4;
  zip4Row.appendChild(zip4Dash);
  zip4Row.appendChild(zip4Inp);
  zip4F.appendChild(zip4Lbl);
  zip4F.appendChild(zip4Row);

  stateF.style.flex = '0 0 70px';
  zipF.style.flex   = '0 0 96px';
  zip4F.style.flex  = '0 0 92px';

  zipRow.appendChild(stateF);
  zipRow.appendChild(zipF);
  zipRow.appendChild(zip4F);
  form.appendChild(zipRow);

  const getRatesBtn = document.createElement('button');
  getRatesBtn.className = 'sub-prompt__btn sub-prompt__btn--yes';
  getRatesBtn.id = 'sc-get-rates';
  getRatesBtn.textContent = 'Calculate Shipping Rates';
  getRatesBtn.style.marginTop = '4px';

  const ratesDiv = document.createElement('div');
  ratesDiv.id = 'sc-rates';
  ratesDiv.style.display = 'none';

  const continueBtn = document.createElement('button');
  continueBtn.className = 'ship-calc-continue';
  continueBtn.id = 'sc-continue';
  continueBtn.textContent = 'Continue to Payment →';
  continueBtn.style.display = 'none';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  cancelBtn.id = 'sc-cancel';
  cancelBtn.textContent = 'Cancel';

  box.appendChild(heading);
  box.appendChild(form);
  box.appendChild(getRatesBtn);
  box.appendChild(ratesDiv);
  box.appendChild(continueBtn);
  box.appendChild(cancelBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Autocomplete hints for browser autofill
  document.getElementById('sc-name').setAttribute('autocomplete', 'name');
  document.getElementById('sc-street').setAttribute('autocomplete', 'shipping street-address');
  document.getElementById('sc-city').setAttribute('autocomplete', 'shipping address-level2');
  document.getElementById('sc-state').setAttribute('autocomplete', 'shipping address-level1');
  document.getElementById('sc-zip').setAttribute('autocomplete', 'shipping postal-code');

  // ── ZIP input: as soon as 5 digits are typed, fetch city + state from Zippopotam.us
  document.getElementById('sc-zip').addEventListener('input', async function() {
    const zip = this.value.trim();
    if (!/^\d{5}$/.test(zip)) return;
    const cityEl  = document.getElementById('sc-city');
    const stateEl = document.getElementById('sc-state');
    if (cityEl.value.trim() && stateEl.value.trim()) return; // already filled
    try {
      const res = await fetch('/api/zip-lookup?zip=' + zip);
      if (!res.ok) return;
      const data = await res.json();
      if (data.city  && !cityEl.value.trim())  cityEl.value  = data.city;
      if (data.state && !stateEl.value.trim()) stateEl.value = data.state;
    } catch { /* silent */ }
  });

  // ── City blur: best-effort state guess via Nominatim (state only — zip unreliable from city name)
  document.getElementById('sc-city').addEventListener('blur', async function() {
    const city = this.value.trim();
    if (!city) return;
    const stateEl = document.getElementById('sc-state');
    if (stateEl.value.trim()) return; // already have state
    try {
      const street = document.getElementById('sc-street').value.trim();
      const params = new URLSearchParams({ city });
      if (street) params.set('street', street);
      const res = await fetch('/api/geocode?' + params);
      if (!res.ok) return;
      const data = await res.json();
      if (data.state && !stateEl.value.trim()) stateEl.value = data.state;
    } catch { /* silent */ }
  });

  // ── ZIP blur: verify full address via EasyPost → fill ZIP+4, show comparison modal if address differs
  document.getElementById('sc-zip').addEventListener('blur', async function() {
    const zip = this.value.trim();
    if (!/^\d{5}$/.test(zip)) return;
    const name   = document.getElementById('sc-name').value.trim();
    const street = document.getElementById('sc-street').value.trim();
    const city   = document.getElementById('sc-city').value.trim();
    const state  = document.getElementById('sc-state').value.trim();
    if (!street || !city || !state) return;
    try {
      const res = await fetch('/api/verify-address', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, street1: street, city, state, zip }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.standardized) return;
      const std = data.standardized;
      // Always fill ZIP+4
      if (std.zip4) document.getElementById('sc-zip4').value = std.zip4;
      // Show comparison modal only if the standardized address differs from what was entered
      const differs =
        std.street1.toUpperCase() !== street.toUpperCase() ||
        std.city.toUpperCase()    !== city.toUpperCase()   ||
        std.state.toUpperCase()   !== state.toUpperCase()  ||
        std.zip                   !== zip;
      if (differs) {
        showAddressConfirmModal(
          { street, city, state, zip, zip4: '' },
          { street: std.street1, city: std.city, state: std.state, zip: std.zip, zip4: std.zip4 || '' },
          (choice, addr) => {
            if (choice === 'suggested') {
              document.getElementById('sc-street').value = addr.street;
              document.getElementById('sc-city').value   = addr.city;
              document.getElementById('sc-state').value  = addr.state;
              document.getElementById('sc-zip').value    = addr.zip;
              document.getElementById('sc-zip4').value   = addr.zip4 || '';
            }
          }
        );
      }
    } catch { /* silent — not critical */ }
  });

  overlay.addEventListener('click', e => { if (e.target === overlay) closeShipCalcModal(); });
  cancelBtn.addEventListener('click', closeShipCalcModal);
  getRatesBtn.addEventListener('click', fetchShippingRates);
  continueBtn.addEventListener('click', checkoutWithShipping);
}

function openShipCalcModal(opts) {
  if (!opts?.preserveRates) {
    _shipCalcRate = null;
    const ratesDiv = document.getElementById('sc-rates');
    if (ratesDiv) { ratesDiv.style.display = 'none'; ratesDiv.textContent = ''; }
    const cont = document.getElementById('sc-continue');
    if (cont) cont.style.display = 'none';
  }
  document.getElementById('ship-calc-overlay').classList.add('open');
}

function closeShipCalcModal() {
  document.getElementById('ship-calc-overlay')?.classList.remove('open');
}

async function fetchShippingRates() {
  const name   = document.getElementById('sc-name').value.trim();
  const street = document.getElementById('sc-street').value.trim();
  const city   = document.getElementById('sc-city').value.trim();
  const state  = document.getElementById('sc-state').value.trim().toUpperCase();
  const zip    = document.getElementById('sc-zip').value.trim();
  if (!name || !street || !city || !state || !zip) {
    alert('Please fill in all address fields.'); return;
  }

  const totalWeight = calcCartWeight();
  const box = getBoxDims(totalWeight);
  const btn = document.getElementById('sc-get-rates');
  btn.textContent = 'Calculating…'; btn.disabled = true;
  _shipCalcRate = null;
  const cont = document.getElementById('sc-continue');
  cont.style.display = 'none';

  try {
    const res = await fetch('/api/shipping-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: { name, street1: street, city, state, zip }, weight_lbs: totalWeight, ...box }),
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not get rates'); return; }
    renderCalcRates(data.rates);
  } catch { alert('Connection error. Please try again.'); }
  finally { btn.textContent = 'Recalculate Rates'; btn.disabled = false; }
}

function renderCalcRates(rates) {
  const div = document.getElementById('sc-rates');
  div.textContent = '';

  if (!rates.length) {
    const p = document.createElement('p');
    p.style.cssText = 'color:#888;font-size:0.85rem;margin:12px 0;';
    p.textContent = 'No rates available for this address.';
    div.appendChild(p);
    div.style.display = '';
    return;
  }

  const hdr = document.createElement('p');
  hdr.className = 'ship-rates-label';
  hdr.textContent = 'Select a shipping option:';
  div.appendChild(hdr);

  rates.forEach(r => {
    const card = document.createElement('button');
    card.className = 'ship-rate-option';
    card.dataset.rateId = r.id;

    const info = document.createElement('span');
    info.className = 'ship-rate-option__info';
    const name = document.createElement('strong');
    name.textContent = r.carrier + ' ' + r.service;
    const days = document.createElement('span');
    days.style.cssText = 'color:#27ae60;font-size:0.78rem;margin-top:2px;';
    days.textContent = r.delivery_days ? r.delivery_days + ' day' + (r.delivery_days !== 1 ? 's' : '') : '';
    info.appendChild(name);
    info.appendChild(days);

    const price = document.createElement('span');
    price.className = 'ship-rate-option__price';
    price.textContent = '$' + parseFloat(r.rate).toFixed(2);

    card.appendChild(info);
    card.appendChild(price);

    card.addEventListener('click', () => {
      document.querySelectorAll('.ship-rate-option').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      _shipCalcRate = { id: r.id, rate: r.rate, carrier: r.carrier, service: r.service };
      const cont = document.getElementById('sc-continue');
      if (cont) { cont.style.display = 'block'; cont.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });

    div.appendChild(card);
  });

  div.style.display = '';
}

function checkoutWithShipping() {
  if (!_shipCalcRate) return;
  closeShipCalcModal();
  openOrderDetailsModal();
}

// --- Order Details Modal (billing address + gift options) ---

function injectOrderDetailsModal() {
  if (document.getElementById('order-details-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'order-details-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt order-details-modal';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'Complete Your Order';

  // ── Billing Address ──────────────────────────────────────────
  const billSection = document.createElement('div');
  billSection.className = 'order-section';

  const billTitle = document.createElement('p');
  billTitle.className = 'order-section__title';
  billTitle.textContent = 'Billing Address';

  const sameLabel = document.createElement('label');
  sameLabel.className = 'order-same-ship';
  sameLabel.htmlFor = 'od-same-ship';

  const sameCheck = document.createElement('input');
  sameCheck.type = 'checkbox';
  sameCheck.id = 'od-same-ship';
  sameCheck.checked = true;

  const sameBox = document.createElement('span');
  sameBox.className = 'order-same-ship__box';

  const sameText = document.createElement('span');
  sameText.textContent = 'Same as shipping address';

  sameLabel.appendChild(sameCheck);
  sameLabel.appendChild(sameBox);
  sameLabel.appendChild(sameText);

  const billFields = document.createElement('div');
  billFields.className = 'order-bill-fields';
  billFields.id = 'od-bill-fields';
  billFields.style.display = 'none';
  billFields.appendChild(makeField('od-bill-name',   'Full Name',      'Jane Smith'));
  billFields.appendChild(makeField('od-bill-street', 'Street Address', '123 Main St'));
  const bCityRow = document.createElement('div');
  bCityRow.className = 'ship-calc-row';
  const bCityF  = makeField('od-bill-city',  'City',  'Austin');
  const bStateF = makeField('od-bill-state', 'State', 'TX', 2);
  const bZipF   = makeField('od-bill-zip',   'ZIP',   '78701', 5);
  bStateF.style.flex = '0 0 70px';
  bZipF.style.flex   = '0 0 96px';
  bCityRow.appendChild(bCityF);
  bCityRow.appendChild(bStateF);
  bCityRow.appendChild(bZipF);
  billFields.appendChild(bCityRow);

  sameCheck.addEventListener('change', () => {
    billFields.style.display = sameCheck.checked ? 'none' : 'flex';
  });

  billSection.appendChild(billTitle);
  billSection.appendChild(sameLabel);
  billSection.appendChild(billFields);

  // ── Gift Options ────────────────────────────────────────────
  const giftSection = document.createElement('div');
  giftSection.className = 'order-section';

  const giftTitle = document.createElement('p');
  giftTitle.className = 'order-section__title';
  giftTitle.textContent = 'Is This a Gift?';

  const giftToggle = document.createElement('div');
  giftToggle.className = 'gift-toggle';

  const giftNo = document.createElement('button');
  giftNo.type = 'button';
  giftNo.className = 'gift-toggle__btn gift-toggle__btn--active';
  giftNo.id = 'od-gift-no';
  giftNo.textContent = 'No';

  const giftYes = document.createElement('button');
  giftYes.type = 'button';
  giftYes.className = 'gift-toggle__btn';
  giftYes.id = 'od-gift-yes';
  giftYes.textContent = 'Yes — it\'s a gift!';

  giftToggle.appendChild(giftNo);
  giftToggle.appendChild(giftYes);

  const giftDetails = document.createElement('div');
  giftDetails.className = 'gift-details';
  giftDetails.id = 'od-gift-details';
  giftDetails.style.display = 'none';

  // Occasion select
  const occWrap = document.createElement('div');
  occWrap.className = 'ship-calc-field';
  const occLbl = document.createElement('label');
  occLbl.className = 'ship-calc-label';
  occLbl.htmlFor = 'od-occasion';
  occLbl.textContent = 'Occasion';
  const occSel = document.createElement('select');
  occSel.id = 'od-occasion';
  occSel.className = 'ship-calc-input gift-occasion-select';
  [
    ['', '— Select an occasion —'],
    ['birthday',     'Birthday'],
    ['anniversary',  'Anniversary'],
    ['thank-you',    'Thank You'],
    ['get-well',     'Get Well'],
    ['holiday',      'Holiday'],
    ['wedding',      'Wedding'],
    ['baby-shower',  'Baby Shower'],
    ['graduation',   'Graduation'],
    ['just-because', 'Just Because'],
    ['other',        'Other'],
  ].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    occSel.appendChild(opt);
  });
  occWrap.appendChild(occLbl);
  occWrap.appendChild(occSel);

  // Gift message
  const msgWrap = document.createElement('div');
  msgWrap.className = 'ship-calc-field';
  const msgLbl = document.createElement('label');
  msgLbl.className = 'ship-calc-label';
  msgLbl.htmlFor = 'od-gift-msg';
  msgLbl.textContent = 'Gift Message (optional)';
  const msgArea = document.createElement('textarea');
  msgArea.id = 'od-gift-msg';
  msgArea.className = 'ship-calc-input gift-message-area';
  msgArea.placeholder = 'Write a personal message to include in the package…';
  msgArea.maxLength = 250;
  msgArea.rows = 3;
  const msgCount = document.createElement('p');
  msgCount.className = 'gift-msg-count';
  msgCount.id = 'od-msg-count';
  msgCount.textContent = '0 / 250';
  msgArea.addEventListener('input', () => { msgCount.textContent = msgArea.value.length + ' / 250'; });
  msgWrap.appendChild(msgLbl);
  msgWrap.appendChild(msgArea);
  msgWrap.appendChild(msgCount);

  giftDetails.appendChild(occWrap);
  giftDetails.appendChild(msgWrap);

  giftNo.addEventListener('click', () => {
    giftNo.classList.add('gift-toggle__btn--active');
    giftYes.classList.remove('gift-toggle__btn--active');
    giftDetails.style.display = 'none';
  });
  giftYes.addEventListener('click', () => {
    giftYes.classList.add('gift-toggle__btn--active');
    giftNo.classList.remove('gift-toggle__btn--active');
    giftDetails.style.display = 'flex';
  });

  giftSection.appendChild(giftTitle);
  giftSection.appendChild(giftToggle);
  giftSection.appendChild(giftDetails);

  // ── Action buttons ─────────────────────────────────────────
  const proceedBtn = document.createElement('button');
  proceedBtn.className = 'sub-prompt__btn sub-prompt__btn--yes';
  proceedBtn.id = 'od-proceed';
  proceedBtn.textContent = 'Proceed to Payment →';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  backBtn.textContent = '← Back to Shipping';
  backBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
    openShipCalcModal({ preserveRates: true });
  });

  box.appendChild(heading);
  box.appendChild(billSection);
  box.appendChild(giftSection);
  box.appendChild(proceedBtn);
  box.appendChild(backBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  proceedBtn.addEventListener('click', submitOrderWithDetails);
}

function openOrderDetailsModal() {
  document.getElementById('order-details-overlay').classList.add('open');
}

async function submitOrderWithDetails() {
  if (!_shipCalcRate) return;
  const btn = document.getElementById('od-proceed');
  btn.textContent = 'Redirecting…'; btn.disabled = true;

  // Billing address
  const sameAsShip = document.getElementById('od-same-ship').checked;
  let billing = null;
  if (!sameAsShip) {
    billing = {
      name:   document.getElementById('od-bill-name').value.trim(),
      street: document.getElementById('od-bill-street').value.trim(),
      city:   document.getElementById('od-bill-city').value.trim(),
      state:  document.getElementById('od-bill-state').value.trim(),
      zip:    document.getElementById('od-bill-zip').value.trim(),
    };
    if (!billing.name || !billing.street || !billing.city || !billing.state || !billing.zip) {
      alert('Please complete all billing address fields.');
      btn.textContent = 'Proceed to Payment →'; btn.disabled = false;
      return;
    }
  }

  // Gift info
  const isGift = document.getElementById('od-gift-yes').classList.contains('gift-toggle__btn--active');
  let gift = null;
  if (isGift) {
    gift = {
      occasion: document.getElementById('od-occasion').value,
      message:  document.getElementById('od-gift-msg').value.trim(),
    };
  }

  const cart = getCart();
  if (!cart.items.length) return;

  const items = cart.items
    .filter(({ id, name }) => PRODUCTS[id] || name)
    .map(({ id, qty, price, name: storedName, taxable, free }) => {
      const p = PRODUCTS[id];
      return { id, name: storedName || (p && p.name) || id, price: free ? 0 : (price ?? (p ? p.price : 0)), quantity: qty, taxable: !!taxable };
    });

  const promoCode = localStorage.getItem('hoto-promo-code') || null;
  const promoAmt  = parseInt(localStorage.getItem('hoto-promo-amt') || '0', 10);
  const taxRatePct = parseFloat(localStorage.getItem('hoto-cart-tax-rate') || '0');
  const freeGiftEligible = localStorage.getItem('hoto-free-gift-eligible') === 'true';
  const shipBody  = { items, shipping: _shipCalcRate, delivery_method: 'ship', billing, gift };
  if (promoCode && promoAmt) { shipBody.promo_code = promoCode; shipBody.promo_discount_cents = promoAmt; }
  if (taxRatePct > 0) shipBody.tax_rate_pct = taxRatePct;
  if (freeGiftEligible) shipBody.free_gift_eligible = true;

  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(shipBody),
    });
    const data = await res.json();
    if (data.url) {
      localStorage.removeItem('hoto-free-gift-eligible');
      window.location.href = data.url;
    } else {
      alert(data.error || 'Checkout error');
      btn.textContent = 'Proceed to Payment →'; btn.disabled = false;
    }
  } catch {
    alert('Connection error.');
    btn.textContent = 'Proceed to Payment →'; btn.disabled = false;
  }
}

// --- Checkout ---

async function checkout(deliveryMethod, pickupLocation, pickupContact) {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  const original = btn.textContent;
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id, name }) => PRODUCTS[id] || name)
    .map(({ id, qty, price, name: storedName, taxable, free }) => {
      const p = PRODUCTS[id];
      return { id, name: storedName || (p && p.name) || id, price: free ? 0 : (price || (p ? p.price : 0)), quantity: qty, taxable: !!taxable };
    });

  const promoCode = localStorage.getItem('hoto-promo-code') || null;
  const promoAmt  = parseInt(localStorage.getItem('hoto-promo-amt') || '0', 10);
  const taxRatePct = parseFloat(localStorage.getItem('hoto-cart-tax-rate') || '0');
  const freeGiftEligible = localStorage.getItem('hoto-free-gift-eligible') === 'true';
  const cartLinkToken = localStorage.getItem('hoto-cart-link-token') || null;

  // If this is a sampler box delivery (QR flow), override method and inject delivery details
  const samplerDelivery = (() => { try { return JSON.parse(localStorage.getItem('hoto-sampler-delivery') || 'null'); } catch { return null; } })();
  const hasSamplerBox = items.some(i => i.id === 'sampler-box');
  if (hasSamplerBox && samplerDelivery) {
    deliveryMethod = 'delivery';
    pickupContact = {
      address: { street: samplerDelivery.street, city: samplerDelivery.city, state: samplerDelivery.state, zip: samplerDelivery.zip },
      deliveryFeeCents: samplerDelivery.feeCents,
    };
  }

  try {
    const body = { items, delivery_method: deliveryMethod || 'pickup' };
    if (cartLinkToken) body.cart_link_token = cartLinkToken;
    if (pickupLocation)                body.pickup_location    = pickupLocation;
    if (pickupContact)                 body.pickup_contact     = pickupContact;
    if (pickupContact?.address)        body.delivery_address   = pickupContact.address;
    if (pickupContact?.deliveryFeeCents)  body.delivery_fee_cents    = pickupContact.deliveryFeeCents;
    if (pickupContact?.deliveryPromoCode) body.delivery_promo_code   = pickupContact.deliveryPromoCode;
    if (promoCode && promoAmt)            { body.promo_code = promoCode; body.promo_discount_cents = promoAmt; }
    if (taxRatePct > 0)                body.tax_rate_pct = taxRatePct;
    if (freeGiftEligible)              body.free_gift_eligible = true;
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.url) {
      localStorage.setItem('hoto-checkout-delivery', deliveryMethod || 'pickup');
      localStorage.setItem('hoto-checkout-location', pickupLocation || '');
      localStorage.removeItem('hoto-promo-code');
      localStorage.removeItem('hoto-promo-amt');
      localStorage.removeItem('hoto-cart-tax-rate');
      localStorage.removeItem('hoto-free-gift-eligible');
      localStorage.removeItem('hoto-cart-link-token');
      localStorage.removeItem('hoto-sampler-delivery');
      // Save abandoned cart so SMS reminders can fire if they don't complete
      if (deliveryMethod === 'pickup' && pickupContact?.phone) {
        try {
          await fetch('/api/save-pending-cart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone:    pickupContact.phone,
              email:    pickupContact.email || '',
              items,
              location: pickupLocation || '',
            }),
          });
        } catch {}
      }
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    console.error('Checkout error:', err);
    alert('Checkout error: ' + (err.message || 'Please try again.'));
  }
}

// --- Subscription Checkout ---

function applyShipMinimum() {} // shipping disabled — no-op

const DELIVERY_MIN_CENTS = 3500;

function updateDeliveryMinimumState() {
  const btn = document.getElementById('dm-delivery');
  if (!btn) return;
  const note  = btn.querySelector('.delivery-modal__note');
  const total = getTotal();
  if (total < DELIVERY_MIN_CENTS) {
    btn.disabled = true;
    if (note) note.textContent = 'Requires a $' + (DELIVERY_MIN_CENTS / 100).toFixed(0) + ' minimum order — add ' + fmt(DELIVERY_MIN_CENTS - total) + ' more to qualify';
  } else {
    btn.disabled = false;
    if (note) note.textContent = 'Free delivery for eligible orders · Enter your delivery address';
  }
}

function openCartDeliveryModal() {
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  const s1 = document.getElementById('dm-step1'), s2 = document.getElementById('dm-step2');
  if (s1) s1.style.display = 'block';
  if (s2) s2.style.display = 'none';
  overlay.classList.add('open');
  updateDeliveryMinimumState();
  document.getElementById('dm-pickup').onclick   = () => { closeDeliveryModal(); openPickupLocationModal((loc, contact) => checkoutSubscription('pickup', loc, contact)); };
  document.getElementById('dm-delivery').onclick = () => { _openDeliveryStep2((addr, fee, delivPromo) => checkoutSubscription('delivery', null, { address: addr, deliveryFeeCents: fee, deliveryPromoCode: delivPromo })); };
  document.getElementById('dm-cancel').onclick   = closeDeliveryModal;
}

function openAdminSubDeliveryModal() {
  const meta = getAdminSub();
  if (!meta) return openCartDeliveryModal();
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.getElementById('dm-pickup').onclick = () => {
    closeDeliveryModal();
    openPickupLocationModal(loc => subscribe(meta.token, meta.subName, meta.subPrice, 'pickup', loc, meta.swaps || [], meta.addons || []));
  };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function openOneTimeDeliveryChoice() {
  // Sampler box QR flow — delivery already verified in the modal, skip straight to checkout
  const samplerDelivery = (() => { try { return JSON.parse(localStorage.getItem('hoto-sampler-delivery') || 'null'); } catch { return null; } })();
  const cartItems = getCart().items;
  if (samplerDelivery && cartItems.some(i => i.id === 'sampler-box')) {
    checkout('delivery', null, {
      address: { street: samplerDelivery.street, city: samplerDelivery.city, state: samplerDelivery.state, zip: samplerDelivery.zip },
      deliveryFeeCents: samplerDelivery.feeCents,
    });
    return;
  }

  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  // Reset to step 1
  const s1 = document.getElementById('dm-step1'), s2 = document.getElementById('dm-step2');
  if (s1) s1.style.display = 'block';
  if (s2) s2.style.display = 'none';
  overlay.classList.add('open');
  updateDeliveryMinimumState();
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); openPickupLocationModal((loc, contact) => checkout('pickup', loc, contact)); };
  document.getElementById('dm-delivery').onclick = () => { _openDeliveryStep2((addr, fee, delivPromo) => checkout('delivery', null, { address: addr, deliveryFeeCents: fee, deliveryPromoCode: delivPromo })); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

async function checkoutSubscription(deliveryMethod, pickupLocation, pickupContact) {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id, name }) => PRODUCTS[id] || name)
    .map(({ id, qty, price, name: storedName }) => {
      const p = PRODUCTS[id];
      return { name: storedName || (p && p.name) || id, price: price || (p ? p.price : 0), quantity: qty };
    });

  try {
    const body = { items, delivery_method: deliveryMethod || 'ship' };
    if (pickupLocation) body.pickup_location = pickupLocation;
    if (pickupContact)  body.pickup_contact  = pickupContact;
    const res = await fetch('/create-cart-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.url) {
      localStorage.setItem('hoto-checkout-delivery', deliveryMethod || 'ship');
      localStorage.setItem('hoto-checkout-location', pickupLocation || '');
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'Unknown error');
    }
  } catch (err) {
    btn.textContent = `Subscribe — ${fmt(getMonthlyTotal())}/mo`;
    btn.disabled = false;
    console.error('Subscription checkout error:', err);
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
    .filter(({ id, name }) => PRODUCTS[id] || name)
    .map(({ id, qty, price, name: storedName }) => {
      const p = PRODUCTS[id];
      return { name: storedName || (p && p.name) || id, price: price ?? (p ? p.price : 0), quantity: qty };
    });

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

// --- Subscriber Prompt Modal ---

function injectSubscriberModal() {
  const overlay = document.createElement('div');
  overlay.id = 'sub-prompt-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'Want the subscriber price?';

  const body = document.createElement('p');
  body.className = 'sub-prompt__body';
  body.textContent = 'Join our subscription and save on every order.';

  const prices = document.createElement('div');
  prices.className = 'sub-prompt__prices';
  prices.id = 'sub-prompt-prices';

  const yesBtn = document.createElement('button');
  yesBtn.className = 'sub-prompt__btn sub-prompt__btn--yes';
  yesBtn.id = 'sub-prompt-yes';
  yesBtn.textContent = 'Subscribe & Save';

  const noBtn = document.createElement('button');
  noBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  noBtn.id = 'sub-prompt-no';
  noBtn.textContent = 'No thanks, add at full price';

  const actions = document.createElement('div');
  actions.className = 'sub-prompt__actions';
  actions.appendChild(yesBtn);
  actions.appendChild(noBtn);

  box.appendChild(heading);
  box.appendChild(body);
  box.appendChild(prices);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeSubPrompt(); });
}

function openSubPrompt(productId) {
  const p = PRODUCTS[productId];
  const overlay = document.getElementById('sub-prompt-overlay');
  const prices = document.getElementById('sub-prompt-prices');
  const yesBtn = document.getElementById('sub-prompt-yes');
  const noBtn = document.getElementById('sub-prompt-no');

  prices.textContent = '';
  const reg = document.createElement('span');
  reg.className = 'sub-prompt__regular';
  reg.textContent = `Regular: ${fmt(p.price)}`;
  const sub = document.createElement('span');
  sub.className = 'sub-prompt__subscriber';
  sub.textContent = `Subscribers: ${fmt(p.subPrice)}`;
  prices.appendChild(reg);
  prices.appendChild(sub);

  yesBtn.onclick = () => { addItem(productId, p.subPrice); closeSubPrompt(); };
  noBtn.onclick = () => { addItem(productId, p.price); closeSubPrompt(); };

  overlay.classList.add('open');
}

function closeSubPrompt() {
  document.getElementById('sub-prompt-overlay')?.classList.remove('open');
}

// --- Pickup Location Modal ---

function injectPickupLocationModal() {
  if (document.getElementById('pickup-loc-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'pickup-loc-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'pickup-loc-modal';

  const heading = document.createElement('p');
  heading.className = 'pickup-loc-modal__heading';
  heading.textContent = 'Choose a pick-up location';

  const sub = document.createElement('p');
  sub.className = 'pickup-loc-modal__sub';
  sub.textContent = 'Pick-up details will be sent after your order is placed.';

  const opts = document.createElement('div');
  opts.className = 'pickup-loc-opts';

  const locations = [
    { id: 'pl-lakeway',   icon: '📍', label: 'Lakeway / Bee Cave',  note: 'Central location near Lake Travis', disabled: true },
    { id: 'pl-dripping',  icon: '📍', label: 'Dripping Springs',    note: 'Hill Country pick-up point',        disabled: false },
    { id: 'pl-austin',    icon: '📍', label: 'Austin',              note: 'South Austin area pick-up',         disabled: true },
  ];

  locations.forEach(({ id, icon, label, note, disabled }) => {
    const btn = document.createElement('button');
    btn.className = 'pickup-loc-opt' + (disabled ? ' pickup-loc-opt--disabled' : '');
    btn.id = id;
    if (disabled) btn.disabled = true;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'pickup-loc-opt__icon';
    iconSpan.textContent = icon;

    const textWrap = document.createElement('span');

    const labelSpan = document.createElement('span');
    labelSpan.className = 'pickup-loc-opt__label';
    labelSpan.textContent = label;

    const noteSpan = document.createElement('span');
    noteSpan.className = 'pickup-loc-opt__note';
    noteSpan.textContent = note;

    textWrap.appendChild(labelSpan);
    textWrap.appendChild(noteSpan);
    if (disabled) {
      const comingSoon = document.createElement('span');
      comingSoon.className = 'pickup-loc-opt__coming-soon';
      comingSoon.textContent = '*Location Coming Soon';
      textWrap.appendChild(comingSoon);
    }
    btn.appendChild(iconSpan);
    btn.appendChild(textWrap);
    opts.appendChild(btn);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'pickup-loc-cancel';
  cancelBtn.id = 'pl-cancel';
  cancelBtn.textContent = 'Cancel';

  box.appendChild(heading);
  box.appendChild(sub);
  box.appendChild(opts);
  box.appendChild(cancelBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePickupLocationModal(); });
}

function closePickupLocationModal() {
  document.getElementById('pickup-loc-overlay')?.classList.remove('open');
}

function openPickupContactModal(location, onConfirm) {
  document.getElementById('pickup-contact-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pickup-contact-overlay';
  overlay.className = 'sub-prompt-overlay';

  const box = document.createElement('div');
  box.className = 'pickup-contact-box';

  function mkLabel(text) {
    const l = document.createElement('p');
    l.className = 'pickup-contact__label';
    l.textContent = text;
    return l;
  }
  function mkInput(type, placeholder, id) {
    const i = document.createElement('input');
    i.type = type; i.placeholder = placeholder;
    if (id) i.id = id;
    i.className = 'pickup-contact__input';
    return i;
  }

  const heading = document.createElement('h2');
  heading.className = 'pickup-contact__heading';
  heading.textContent = 'Your Contact Info';

  const sub = document.createElement('p');
  sub.className = 'pickup-contact__sub';
  sub.textContent = 'So we can coordinate your ' + location + ' pick-up.';

  // Restore previously entered info (same browser)
  var _saved = {};
  try { _saved = JSON.parse(localStorage.getItem('hoto-pickup-contact') || '{}'); } catch {}

  // Phone
  const phoneInput  = mkInput('tel',   '(555) 000-0000',           'pc-phone');
  // Email
  const emailInput  = mkInput('email', 'you@example.com',           'pc-email');
  // Address fields
  const street1Input = mkInput('text', 'Street Address',            'pc-street1');
  const street2Input = mkInput('text', 'Apt, Suite, Unit (optional)','pc-street2');

  const cityRow = document.createElement('div');
  cityRow.className = 'pickup-contact__city-row';
  const cityInput  = mkInput('text', 'City',  'pc-city');
  const stateInput = mkInput('text', 'State', 'pc-state');
  const zipInput   = mkInput('text', 'ZIP',   'pc-zip');
  stateInput.maxLength = 2;
  zipInput.maxLength = 5;
  zipInput.setAttribute('inputmode', 'numeric');
  cityRow.appendChild(cityInput);
  cityRow.appendChild(stateInput);
  cityRow.appendChild(zipInput);

  // Pre-fill from saved info
  if (_saved.phone)   phoneInput.value   = _saved.phone;
  if (_saved.email)   emailInput.value   = _saved.email;
  if (_saved.street1) street1Input.value = _saved.street1;
  if (_saved.street2) street2Input.value = _saved.street2;
  if (_saved.city)    cityInput.value    = _saved.city;
  if (_saved.state)   stateInput.value   = _saved.state;
  if (_saved.zip)     zipInput.value     = _saved.zip;

  // Auto-fill city/state from ZIP
  zipInput.addEventListener('input', async () => {
    const z = zipInput.value.replace(/\D/g, '');
    if (z.length === 5) {
      try {
        const r = await fetch('/api/zip-lookup?zip=' + z);
        if (r.ok) {
          const d = await r.json();
          if (d.city  && !cityInput.value)  cityInput.value  = d.city;
          if (d.state && !stateInput.value) stateInput.value = d.state;
        }
      } catch {}
    }
  });

  // Comm preference — multi-select, ordered
  const commNote = document.createElement('p');
  commNote.className = 'pickup-contact__sub';
  commNote.style.margin = '4px 0 10px';
  commNote.textContent = 'Select up to 2 in order of preference.';

  const commOpts = document.createElement('div');
  commOpts.className = 'pickup-contact__comm-opts';
  let commSelected = [];

  ['Text', 'Call', 'Email'].forEach(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pickup-contact__comm-btn';
    btn.dataset.value = opt.toLowerCase();

    const badge = document.createElement('span');
    badge.className = 'pickup-contact__comm-badge';
    badge.style.display = 'none';

    const lbl = document.createElement('span');
    lbl.textContent = opt;

    btn.appendChild(badge);
    btn.appendChild(lbl);
    commOpts.appendChild(btn);

    btn.addEventListener('click', () => {
      const val = btn.dataset.value;
      const idx = commSelected.indexOf(val);
      if (idx !== -1) {
        commSelected.splice(idx, 1);
      } else if (commSelected.length < 2) {
        commSelected.push(val);
      } else { return; }

      commOpts.querySelectorAll('.pickup-contact__comm-btn').forEach(b => {
        const i = commSelected.indexOf(b.dataset.value);
        const bg = b.querySelector('.pickup-contact__comm-badge');
        if (i !== -1) {
          b.classList.add('selected');
          bg.textContent = (i + 1) + (i === 0 ? 'st' : 'nd');
          bg.style.display = 'inline-flex';
        } else {
          b.classList.remove('selected');
          bg.textContent = '';
          bg.style.display = 'none';
        }
      });
    });
  });

  // Pre-select saved comm prefs
  if (_saved.commPref) {
    const savedPrefs = _saved.commPref.split(',').filter(Boolean);
    commSelected = savedPrefs.slice(0, 2);
    commOpts.querySelectorAll('.pickup-contact__comm-btn').forEach(b => {
      const i = commSelected.indexOf(b.dataset.value);
      const bg = b.querySelector('.pickup-contact__comm-badge');
      if (i !== -1) {
        b.classList.add('selected');
        bg.textContent = (i + 1) + (i === 0 ? 'st' : 'nd');
        bg.style.display = 'inline-flex';
      }
    });
  }

  const errMsg = document.createElement('p');
  errMsg.className = 'pickup-contact__error';

  const continueBtn = document.createElement('button');
  continueBtn.className = 'pickup-contact__submit';
  continueBtn.textContent = 'Continue';

  async function verifyAndContinue() {
    const phone = phoneInput.value.trim();
    const email = emailInput.value.trim();

    if (!phone)               { errMsg.textContent = 'Please enter your phone number.'; return; }
    if (!email)               { errMsg.textContent = 'Please enter your email address.'; return; }
    if (!commSelected.length) { errMsg.textContent = 'Please select at least one contact method.'; return; }
    errMsg.textContent = '';

    overlay.remove();
    var _contact = { phone, email, street1: '', street2: '', city: '', state: '', zip: '', commPref: commSelected.join(',') };
    localStorage.setItem('hoto-pickup-contact', JSON.stringify(_contact));
    onConfirm(_contact);
  }

  continueBtn.addEventListener('click', verifyAndContinue);

  box.appendChild(heading);
  box.appendChild(sub);
  box.appendChild(mkLabel('Phone Number'));
  box.appendChild(phoneInput);
  box.appendChild(mkLabel('Email Address'));
  box.appendChild(emailInput);
  box.appendChild(mkLabel('Preferred Contact Methods'));
  box.appendChild(commNote);
  box.appendChild(commOpts);
  box.appendChild(errMsg);
  box.appendChild(continueBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function showAddressChoice(entered, verified, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'sub-prompt-overlay';
  overlay.style.zIndex = '10001';

  const box = document.createElement('div');
  box.className = 'pickup-contact-box';

  const h = document.createElement('h2');
  h.className = 'pickup-contact__heading';
  h.textContent = 'Confirm Your Address';

  const sub = document.createElement('p');
  sub.className = 'pickup-contact__sub';
  sub.textContent = 'USPS found a standardized version. Which would you like to use?';

  box.appendChild(h);
  box.appendChild(sub);

  let chosen = 'verified';

  function mkAddrBtn(labelText, addr, value) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'addr-choice-btn' + (value === 'verified' ? ' selected' : '');
    btn.dataset.choice = value;

    const lbl = document.createElement('strong');
    lbl.textContent = labelText;
    const br = document.createElement('br');
    const addrTxt = document.createTextNode(
      [addr.street1, addr.street2, addr.city, addr.state, addr.zip].filter(Boolean).join(', ')
    );
    btn.appendChild(lbl);
    btn.appendChild(br);
    btn.appendChild(addrTxt);
    btn.addEventListener('click', () => {
      chosen = value;
      box.querySelectorAll('.addr-choice-btn').forEach(b =>
        b.classList.toggle('selected', b.dataset.choice === value)
      );
    });
    return btn;
  }

  box.appendChild(mkAddrBtn('✅ USPS Verified', verified, 'verified'));

  const or = document.createElement('p');
  or.style.cssText = 'text-align:center;color:#aaa;font-size:0.8rem;margin:8px 0;';
  or.textContent = '— or —';
  box.appendChild(or);

  box.appendChild(mkAddrBtn('✏️ My Entered Address', entered, 'entered'));

  const useBtn = document.createElement('button');
  useBtn.className = 'pickup-contact__submit';
  useBtn.style.marginTop = '16px';
  useBtn.textContent = 'Use This Address';
  useBtn.addEventListener('click', () => {
    overlay.remove();
    onSelect(chosen === 'verified' ? verified : entered);
  });
  box.appendChild(useBtn);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
}

function openPickupLocationModal(onSelect) {
  const overlay = document.getElementById('pickup-loc-overlay');
  if (!overlay) return;
  overlay.classList.add('open');

  const locations = [
    { id: 'pl-lakeway',  label: 'Lakeway / Bee Cave' },
    { id: 'pl-dripping', label: 'Dripping Springs' },
    { id: 'pl-austin',   label: 'Austin' },
  ];

  locations.forEach(({ id, label }) => {
    document.getElementById(id).onclick = () => {
      closePickupLocationModal();
      openPickupContactModal(label, contact => onSelect(label, contact));
    };
  });

  document.getElementById('pl-cancel').onclick = closePickupLocationModal;
}

// --- Delivery Choice Modal ---

function makeDeliveryOpt(id, icon, label, note) {
  const btn = document.createElement('button');
  btn.className = 'delivery-modal__opt';
  btn.id = id;

  const iconSpan = document.createElement('span');
  iconSpan.className = 'delivery-modal__icon';
  iconSpan.textContent = icon;

  const textWrap = document.createElement('span');

  const labelSpan = document.createElement('span');
  labelSpan.className = 'delivery-modal__label';
  labelSpan.textContent = label;

  const noteSpan = document.createElement('span');
  noteSpan.className = 'delivery-modal__note';
  noteSpan.textContent = note;

  textWrap.appendChild(labelSpan);
  textWrap.appendChild(noteSpan);
  btn.appendChild(iconSpan);
  btn.appendChild(textWrap);
  return btn;
}

// ─── Box Customizer ──────────────────────────────────────────────────────────

const BOX_CONTENTS = {
  'bread-box': {
    label: 'The Bread & Butter Board Box',
    items: [
      { id: 'japanese-milk-loaf', name: 'Japanese Milk Loaf',       swapGroup: 'bread' },
      { id: 'cultured-butter',    name: 'Real Cream Butter (½ lb)', swapGroup: null },
      { id: 'seasonal-preserves', name: 'Seasonal Preserves',        swapGroup: null },
    ],
  },
  'harvest-subscription': {
    label: 'The Supper Starter Box',
    items: [
      { id: 'yeast-rolls',        name: 'Dinner Rolls (1 doz)',      swapGroup: null },
      { id: 'whole-chicken',      name: 'Whole Chicken',             swapGroup: null },
      { id: 'herb-dipping-oil',   name: 'Tuscany Bread Dipping Oil', swapGroup: null },
      { id: 'cultured-butter',    name: 'Real Cream Butter',         swapGroup: null },
      { id: 'cinnamon-rolls',     name: 'Cinnamon Rolls',            swapGroup: null },
    ],
  },
  'farm-box': {
    label: "Monthly Farm Butcher's Box",
    items: [
      { id: 'whole-chicken',      name: 'Whole Chicken',            swapGroup: null },
      { id: 'farm-eggs',          name: 'Farm Eggs (1 doz)',         swapGroup: null },
      { id: 'cultured-butter',    name: 'Real Cream Butter',        swapGroup: null },
      { id: 'japanese-milk-loaf', name: 'Japanese Milk Loaf',       swapGroup: 'bread' },
      { id: 'garlic-chili-crunch',name: 'Garlic Chili Crunch',      swapGroup: null },
      { id: 'seasonal-preserves', name: 'Seasonal Preserves',       swapGroup: null },
    ],
  },
  'sampler-box': {
    label: 'The Farm Sampler Box',
    items: [
      { id: 'whole-chicken',      name: 'Whole Chicken — Processed into 10 Cuts', swapGroup: null, subtitle: '2 Boneless/Skinless Breasts · 2 Leg Quarters · 2 Tenders · 2 Drums · 2 Flats' },
      { id: 'farm-eggs',          name: 'Farm Eggs — 1 dozen',           swapGroup: null },
      { id: 'cultured-butter',    name: 'Real Cream Butter — ½ lb',      swapGroup: null },
      { id: 'garlic-chili-crunch',name: 'Garlic Chili Crunch (4oz)',     swapGroup: 'larder' },
    ],
  },
};

const SWAP_OPTIONS = {
  bread: [
    { id: 'japanese-milk-loaf', name: 'Japanese Milk Loaf' },
    { id: 'whole-wheat-loaf',   name: 'Whole Wheat Loaf (+$2)' },
  ],
  larder: [
    { id: 'garlic-chili-crunch', name: 'Garlic Chili Crunch' },
    { id: 'herb-dipping-oil',    name: 'Tuscany Herb Dipping Oil' },
    { id: 'seasonal-preserves',  name: 'Seasonal Preserves' },
  ],
};

// Flavors shown in the included preserves picker (upcharge = extra above base box price)
const INCLUDED_PRESERVES_FLAVORS = [
  { name: 'Strawberry',                           upcharge: 0 },
  { name: 'Grape',                                upcharge: 0 },
  { name: 'Blackberry (+$3)',                     upcharge: 300 },
  { name: 'Peach (+$3)',                          upcharge: 300 },
  { name: 'Fig (+$3)',                            upcharge: 300 },
  { name: 'Orange Marmalade (+$3)',               upcharge: 300 },
  { name: 'Swap: Tuscany Herb Dipping Oil (+$4)', upcharge: 400 },
];

// Flavors for the add-on preserves (standalone purchase)
const PRESERVES_FLAVORS = [
  { name: 'Strawberry',       price: 1500 },
  { name: 'Grape',            price: 1500 },
  { name: 'Blackberry',       price: 1800 },
  { name: 'Peach',            price: 1800 },
  { name: 'Fig',              price: 1800 },
  { name: 'Orange Marmalade', price: 1800 },
];

// Per-box add-on overrides (set after PRESERVES_FLAVORS so we can reference it)
BOX_CONTENTS['sampler-box'].addons = [
  { id: 'addon-neckbone',      name: 'Neckbone',                    price: 200 },
  { id: 'addon-chicken-broth', name: 'Chicken Bone Broth (16 oz)',   price: 2000, note: '*12+ hr slow simmered bone broth w/ onion and garlic.' },
  { id: 'addon-preserves',     name: 'Seasonal Preserves',           price: 1500, priceLabel: '$15–$18', flavors: PRESERVES_FLAVORS },
  { id: 'addon-cinnamon-rolls',name: 'Cinnamon Rolls (½ doz)',       price: 3500 },
  { id: 'addon-yeast-rolls',   name: 'Yeast Rolls (1 doz)',          price: 2400 },
];

const ADDON_OPTIONS = [
  { id: 'addon-yeast-rolls',    name: 'Yeast Rolls (1 doz)',      price: 2400 },
  { id: 'addon-cinnamon-rolls', name: 'Cinnamon Rolls (½ doz)',   price: 3500 },
  { id: 'addon-butter',         name: 'Extra Real Cream Butter (½ lb)', price: 1700 },
  { id: 'addon-eggs',           name: 'Farm Eggs (1 doz)',           price: 1300 },
  { id: 'addon-preserves',      name: 'Seasonal Preserves',         price: 1500, priceLabel: '$15–$18',
    flavors: PRESERVES_FLAVORS,
  },
  { id: 'addon-chili-crunch',   name: 'Garlic Chili Crunch',        price: 1800 },
  { id: 'addon-herb-oil',       name: 'Tuscany Herb Dipping Oil',   price: 1800 },
  { id: 'addon-whole-chicken',  name: 'Whole Chicken',              price: 0, priceLabel: '$7/lb' },
  { id: 'addon-turkey-reserve', name: 'Reserve Your Thanksgiving Turkey', price: 10000 },
];

function injectBoxCustomizer() {
  if (document.getElementById('box-customizer-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'box-customizer-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28,28,28,0.6);z-index:9000;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;visibility:hidden;transition:opacity 0.3s,visibility 0.3s;';
  overlay.innerHTML = `
    <div id="box-customizer-panel" style="background:#fff;border-radius:20px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.25);">
      <div style="position:sticky;top:0;background:#fff;padding:24px 28px 16px;border-bottom:1px solid rgba(44,62,45,0.08);z-index:1;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <p style="font-family:var(--font-sans);font-size:0.65rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);margin:0 0 4px;">Your Box</p>
          <h2 id="bc-title" style="font-family:var(--font-serif);font-size:1.4rem;color:var(--color-green);margin:0;font-weight:400;"></h2>
        </div>
        <button id="bc-close" style="background:none;border:none;font-size:1.2rem;color:rgba(44,62,45,0.4);cursor:pointer;padding:4px;">✕</button>
      </div>
      <div style="padding:24px 28px;">
        <p style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-green);margin:0 0 16px;">What's Included</p>
        <div id="bc-items" style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px;"></div>
        <p style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--color-green);margin:0 0 16px;">Add-Ons <span style="font-weight:400;color:rgba(44,62,45,0.4);font-size:0.7rem;text-transform:none;letter-spacing:0;">(optional — we'll confirm availability)</span></p>
        <div id="bc-addons" style="display:flex;flex-direction:column;gap:8px;margin-bottom:32px;"></div>
        <!-- Live price summary -->
        <div id="bc-price-summary" style="background:var(--color-cream,#F5F0E8);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
          <div id="bc-price-lines" style="font-family:var(--font-sans);font-size:0.78rem;color:rgba(44,62,45,0.6);display:flex;flex-direction:column;gap:4px;margin-bottom:10px;"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid rgba(44,62,45,0.15);padding-top:10px;">
            <span style="font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-green);">Your Total</span>
            <span id="bc-price-total" style="font-family:var(--font-serif);font-size:1.3rem;color:var(--color-green);font-weight:400;"></span>
          </div>
        </div>
        <div style="display:flex;gap:12px;">
          <button id="bc-cancel" style="flex:1;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;border:1.5px solid rgba(44,62,45,0.2);background:transparent;color:rgba(44,62,45,0.6);border-radius:8px;cursor:pointer;">Cancel</button>
          <button id="bc-continue" style="flex:2;padding:14px;font-family:var(--font-sans);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border:none;background:var(--color-green);color:var(--color-cream,#F5F0E8);border-radius:8px;cursor:pointer;">Continue →</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeBoxCustomizer(); });
  document.getElementById('bc-close').onclick = closeBoxCustomizer;
  document.getElementById('bc-cancel').onclick = closeBoxCustomizer;
}

let _bcPendingArgs = null;

function openBoxCustomizer(subId, name, price) {
  _bcPendingArgs = { subId, name, price };
  const box = BOX_CONTENTS[subId];
  const overlay = document.getElementById('box-customizer-overlay');
  document.getElementById('bc-title').textContent = box ? box.label : name;

  // Render items
  const itemsEl = document.getElementById('bc-items');
  itemsEl.innerHTML = '';
  const defaultItems = box ? box.items : [];
  defaultItems.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-cream,#F5F0E8);border-radius:10px;gap:12px;';
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);';
    nameSpan.textContent = item.name;
    nameWrap.appendChild(nameSpan);
    if (item.subtitle) {
      const subSpan = document.createElement('span');
      subSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.72rem;color:rgba(44,62,45,0.5);';
      subSpan.textContent = item.subtitle;
      nameWrap.appendChild(subSpan);
    }
    row.appendChild(nameWrap);
    let extraPanel = null;
    if (item.swapGroup && SWAP_OPTIONS[item.swapGroup]) {
      const sel = document.createElement('select');
      sel.dataset.originalId = item.id;
      sel.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;border:1px solid rgba(44,62,45,0.2);border-radius:6px;padding:5px 8px;background:#fff;color:var(--color-green);cursor:pointer;';
      SWAP_OPTIONS[item.swapGroup].forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.id;
        o.textContent = opt.id === item.id ? opt.name + ' ✓' : opt.name;
        o.selected = opt.id === item.id;
        sel.appendChild(o);
      });
      // Flavor sub-panel — shown below the row when seasonal-preserves is chosen
      const swapFlavorPanel = document.createElement('div');
      swapFlavorPanel.style.cssText = 'display:none;align-items:center;gap:12px;padding:8px 16px 10px;background:rgba(44,62,45,0.04);border-radius:0 0 10px 10px;margin-top:-4px;';
      const sfLabel = document.createElement('span');
      sfLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.72rem;color:rgba(44,62,45,0.5);flex:1;font-style:italic;';
      sfLabel.textContent = 'other flavors available';
      const swapFlavorSel = document.createElement('select');
      swapFlavorSel.dataset.swapPreservesFlavor = 'true';
      swapFlavorSel.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;border:1px solid rgba(44,62,45,0.2);border-radius:6px;padding:5px 8px;background:#fff;color:var(--color-green);cursor:pointer;';
      [
        { name: 'Strawberry',       upcharge: 0 },
        { name: 'Grape',            upcharge: 0 },
        { name: 'Blackberry',       upcharge: 300 },
        { name: 'Peach',            upcharge: 300 },
        { name: 'Fig',              upcharge: 300 },
        { name: 'Orange Marmalade', upcharge: 300 },
      ].forEach(function(f) {
        const o = document.createElement('option');
        o.value = String(f.upcharge);
        o.dataset.flavorLabel = f.name;
        o.textContent = f.upcharge > 0 ? f.name + ' (+$' + (f.upcharge / 100) + ')' : f.name;
        swapFlavorSel.appendChild(o);
      });
      swapFlavorSel.addEventListener('change', function() {
        const lbl = swapFlavorSel.options[swapFlavorSel.selectedIndex].dataset.flavorLabel;
        nameSpan.textContent = lbl + ' Preserves';
        recalcBoxTotal();
      });
      swapFlavorPanel.appendChild(sfLabel);
      swapFlavorPanel.appendChild(swapFlavorSel);
      extraPanel = swapFlavorPanel;

      sel.onchange = () => {
        if (sel.value === 'seasonal-preserves') {
          swapFlavorSel.selectedIndex = 0;
          nameSpan.textContent = 'Strawberry Preserves';
          swapFlavorPanel.style.display = 'flex';
          row.style.borderRadius = '10px 10px 0 0';
        } else {
          swapFlavorPanel.style.display = 'none';
          row.style.borderRadius = '10px';
          nameSpan.textContent = sel.options[sel.selectedIndex].text.replace(' ✓','');
        }
        recalcBoxTotal();
      };
      const swapWrap = document.createElement('div');
      swapWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
      const swapLabel = document.createElement('span');
      swapLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);';
      swapLabel.textContent = 'Swap';
      swapWrap.appendChild(swapLabel);
      swapWrap.appendChild(sel);
      row.appendChild(swapWrap);
    } else if (item.id === 'seasonal-preserves') {
      // Flavor picker for included preserves — no extra charge, just preference
      const flavorWrap = document.createElement('div');
      flavorWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
      const flavorLabel = document.createElement('span');
      flavorLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);';
      flavorLabel.textContent = 'Flavor';
      const flavorSel = document.createElement('select');
      flavorSel.dataset.preservesFlavor = 'included';
      flavorSel.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;border:1px solid rgba(44,62,45,0.2);border-radius:6px;padding:5px 8px;background:#fff;color:var(--color-green);cursor:pointer;';
      INCLUDED_PRESERVES_FLAVORS.forEach(f => {
        const o = document.createElement('option');
        o.value = f.name;
        o.textContent = f.name;
        flavorSel.appendChild(o);
      });
      flavorWrap.appendChild(flavorLabel);
      flavorWrap.appendChild(flavorSel);
      row.appendChild(flavorWrap);
    } else if (item.id === 'cultured-butter') {
      // Salted / Unsalted picker for included butter
      const butterWrap = document.createElement('div');
      butterWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
      const butterLabel = document.createElement('span');
      butterLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);';
      butterLabel.textContent = 'Type';
      const butterSel = document.createElement('select');
      butterSel.dataset.butterType = 'included';
      butterSel.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;border:1px solid rgba(44,62,45,0.2);border-radius:6px;padding:5px 8px;background:#fff;color:var(--color-green);cursor:pointer;';
      ['Sea Salt', 'Unsalted', 'Rosemary (+$4)'].forEach(type => {
        const o = document.createElement('option');
        o.value = type;
        o.textContent = type;
        butterSel.appendChild(o);
      });
      butterWrap.appendChild(butterLabel);
      butterWrap.appendChild(butterSel);
      row.appendChild(butterWrap);
    } else {
      const fixed = document.createElement('span');
      fixed.style.cssText = 'font-family:var(--font-sans);font-size:0.65rem;color:rgba(44,62,45,0.35);letter-spacing:0.06em;';
      fixed.textContent = 'included';
      row.appendChild(fixed);
    }
    itemsEl.appendChild(row);
    if (extraPanel) itemsEl.appendChild(extraPanel);
  });

  // Render add-ons (use per-box list if defined, otherwise fall back to global ADDON_OPTIONS)
  const boxItemIds = new Set(defaultItems.map(i => i.id));
  const addonsEl = document.getElementById('bc-addons');
  addonsEl.innerHTML = '';
  const addonList = (box && box.addons) ? box.addons : ADDON_OPTIONS.filter(a => !boxItemIds.has(a.id.replace('addon-','')));
  addonList.forEach(addon => {
    const wrapper = document.createElement('div');

    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;border:1px solid rgba(44,62,45,0.1);border-radius:10px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = addon.id;
    cb.dataset.addonName = addon.name;
    cb.dataset.addonPrice = addon.price;
    cb.style.cssText = 'accent-color:var(--color-rust,#8B4A2F);width:16px;height:16px;flex-shrink:0;';
    const nameWrap = document.createElement('div');
    nameWrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:2px;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);';
    nameSpan.textContent = addon.name;
    nameWrap.appendChild(nameSpan);
    if (addon.note) {
      const noteSpan = document.createElement('span');
      noteSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.7rem;color:rgba(44,62,45,0.45);font-style:italic;';
      noteSpan.textContent = addon.note;
      nameWrap.appendChild(noteSpan);
    }
    const priceSpan = document.createElement('span');
    priceSpan.style.cssText = 'font-family:var(--font-serif);font-size:0.95rem;color:var(--color-rust,#8B4A2F);white-space:nowrap;';
    priceSpan.textContent = addon.priceLabel ? addon.priceLabel : (addon.price === 0 ? '$0' : '$' + (addon.price / 100).toFixed(2).replace(/\.00$/, ''));
    label.appendChild(cb);
    label.appendChild(nameWrap);
    label.appendChild(priceSpan);
    wrapper.appendChild(label);

    // Weight + processing selector for whole chicken add-on
    if (addon.id === 'addon-whole-chicken') {
      const chickenPanel = document.createElement('div');
      chickenPanel.style.cssText = 'display:none;padding:10px 14px 12px;border:1px solid rgba(44,62,45,0.08);border-top:none;border-radius:0 0 10px 10px;background:var(--color-cream,#F5F0E8);';

      // Weight dropdown
      const weightRow = document.createElement('div');
      weightRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
      const weightLbl = document.createElement('span');
      weightLbl.style.cssText = 'font-family:var(--font-sans);font-size:0.82rem;color:var(--color-green);flex:1;';
      weightLbl.textContent = 'Estimated weight:';
      const weightSel = document.createElement('select');
      weightSel.style.cssText = 'font-family:var(--font-sans);font-size:0.82rem;border:1px solid rgba(44,62,45,0.2);border-radius:6px;padding:6px 10px;background:#fff;color:var(--color-green);cursor:pointer;';
      [7, 8].forEach(lbs => {
        const o = document.createElement('option');
        o.value = String(lbs * 700);
        o.textContent = `~${lbs} lbs  ·  $${lbs * 7}`;
        weightSel.appendChild(o);
      });
      weightRow.appendChild(weightLbl);
      weightRow.appendChild(weightSel);
      chickenPanel.appendChild(weightRow);

      // Processing sub-option
      const procLbl = document.createElement('label');
      procLbl.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#fff;border:1px solid rgba(44,62,45,0.12);border-radius:8px;cursor:pointer;';
      const procCb = document.createElement('input');
      procCb.type = 'checkbox';
      procCb.style.cssText = 'accent-color:var(--color-rust,#8B4A2F);width:16px;height:16px;flex-shrink:0;margin-top:2px;';
      const procText = document.createElement('div');
      const procLine = document.createElement('span');
      procLine.style.cssText = 'font-family:var(--font-sans);font-size:0.85rem;color:var(--color-green);display:block;';
      procLine.textContent = 'Skip the butchering at home ';
      const procTag = document.createElement('strong');
      procTag.style.color = 'var(--color-rust,#8B4A2F)';
      procTag.textContent = '+$10';
      procLine.appendChild(procTag);
      const procCuts = document.createElement('span');
      procCuts.style.cssText = 'font-family:var(--font-sans);font-size:0.72rem;color:rgba(44,62,45,0.5);display:block;margin-top:3px;';
      procCuts.textContent = '2 Breasts · 2 Leg Quarters · 2 Tenders · 2 Drumsticks · 2 Wings';
      procText.appendChild(procLine);
      procText.appendChild(procCuts);
      procLbl.appendChild(procCb);
      procLbl.appendChild(procText);
      chickenPanel.appendChild(procLbl);

      // Neckbone add-on
      const neckLbl = document.createElement('label');
      neckLbl.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1px solid rgba(44,62,45,0.12);border-radius:8px;cursor:pointer;margin-top:8px;';
      const neckCb = document.createElement('input');
      neckCb.type = 'checkbox';
      neckCb.style.cssText = 'accent-color:var(--color-rust,#8B4A2F);width:16px;height:16px;flex-shrink:0;';
      const neckText = document.createElement('span');
      neckText.style.cssText = 'font-family:var(--font-sans);font-size:0.85rem;color:var(--color-green);flex:1;';
      neckText.textContent = 'Neckbone ';
      const neckTag = document.createElement('strong');
      neckTag.style.color = 'var(--color-rust,#8B4A2F)';
      neckTag.textContent = '+$2';
      neckText.appendChild(neckTag);
      neckLbl.appendChild(neckCb);
      neckLbl.appendChild(neckText);
      neckLbl.style.display = 'none';
      chickenPanel.appendChild(neckLbl);

      procCb.addEventListener('change', () => {
        neckLbl.style.display = procCb.checked ? 'flex' : 'none';
        if (!procCb.checked) neckCb.checked = false;
      });
      neckCb.addEventListener('change', updateChickenAddon);

      wrapper.appendChild(chickenPanel);

      function updateChickenAddon() {
        const baseCents = parseInt(weightSel.value, 10);
        const procExtra = procCb.checked ? 1000 : 0;
        const neckExtra = neckCb.checked ? 200 : 0;
        const totalCents = baseCents + procExtra + neckExtra;
        cb.dataset.addonPrice = String(totalCents);
        const lbs = Math.round(baseCents / 700);
        const extras = [procCb.checked ? 'Cut-Up Processing' : '', neckCb.checked ? 'Neckbone' : ''].filter(Boolean).join(' + ');
        cb.dataset.addonName = `Whole Chicken (~${lbs} lbs)${extras ? ' + ' + extras : ''}`;
        priceSpan.textContent = '$' + (totalCents / 100).toFixed(0);
        recalcBoxTotal();
      }

      weightSel.addEventListener('change', updateChickenAddon);
      procCb.addEventListener('change', updateChickenAddon);

      cb.addEventListener('change', () => {
        chickenPanel.style.display = cb.checked ? 'block' : 'none';
        label.style.borderRadius = cb.checked ? '10px 10px 0 0' : '10px';
        if (cb.checked) {
          updateChickenAddon();
        } else {
          cb.dataset.addonPrice = '0';
          cb.dataset.addonName = addon.name;
          priceSpan.textContent = addon.priceLabel || '$7/lb';
        }
      });
    }

    // Flavor dropdown for preserves
    if (addon.flavors) {
      const flavorWrap = document.createElement('div');
      flavorWrap.style.cssText = 'display:none;padding:8px 16px 4px;';
      const flavorSelect = document.createElement('select');
      flavorSelect.dataset.flavorFor = addon.id;
      flavorSelect.style.cssText = 'width:100%;padding:8px 10px;border:1px solid rgba(44,62,45,0.2);border-radius:8px;font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);background:#fff;cursor:pointer;';
      addon.flavors.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.price;
        opt.dataset.flavorName = f.name;
        opt.textContent = f.name + ' — $' + (f.price / 100).toFixed(2).replace(/\.00$/, '');
        flavorSelect.appendChild(opt);
      });
      flavorSelect.addEventListener('change', () => {
        cb.dataset.addonPrice = flavorSelect.value;
        cb.dataset.addonName = addon.name + ' (' + flavorSelect.options[flavorSelect.selectedIndex].dataset.flavorName + ')';
      });
      flavorWrap.appendChild(flavorSelect);
      wrapper.appendChild(flavorWrap);

      cb.addEventListener('change', () => {
        flavorWrap.style.display = cb.checked ? 'block' : 'none';
        if (cb.checked) {
          cb.dataset.addonPrice = flavorSelect.value;
          cb.dataset.addonName = addon.name + ' (' + flavorSelect.options[flavorSelect.selectedIndex].dataset.flavorName + ')';
        } else {
          cb.dataset.addonPrice = addon.price;
          cb.dataset.addonName = addon.name;
        }
      });
    }

    addonsEl.appendChild(wrapper);
  });

  // ── Live price calculator ──────────────────────────────────────────────────
  const BASE_PRICE = PRODUCTS[subId] ? PRODUCTS[subId].price : 5500; // cents

  function recalcBoxTotal() {
    const lines = [];
    let total = BASE_PRICE;

    lines.push({ label: 'Box base', amount: BASE_PRICE });

    // Bread swap upcharge
    const breadSel = document.querySelector('#bc-items select[data-original-id="japanese-milk-loaf"]');
    if (breadSel && breadSel.value === 'whole-wheat-loaf') {
      lines.push({ label: 'Whole Wheat upgrade', amount: 200 });
      total += 200;
    }

    // Butter type upcharge
    const butterSel = document.querySelector('#bc-items select[data-butter-type="included"]');
    if (butterSel && butterSel.value === 'Rosemary (+$4)') {
      lines.push({ label: 'Rosemary butter upgrade', amount: 400 });
      total += 400;
    }

    // Swap-to-preserves flavor upcharge (garlic chili crunch → seasonal preserves)
    const swapToPreservesSel = document.querySelector('#bc-items select[data-original-id="garlic-chili-crunch"]');
    const swapFlavorPickerSel = document.querySelector('#bc-items select[data-swap-preserves-flavor]');
    if (swapToPreservesSel && swapToPreservesSel.value === 'seasonal-preserves' && swapFlavorPickerSel) {
      const up = parseInt(swapFlavorPickerSel.value, 10) || 0;
      if (up > 0) {
        const lbl = swapFlavorPickerSel.options[swapFlavorPickerSel.selectedIndex].dataset.flavorLabel;
        lines.push({ label: lbl + ' preserves upgrade', amount: up });
        total += up;
      }
    }

    // Preserves flavor upcharge
    const flavorSel = document.querySelector('#bc-items select[data-preserves-flavor="included"]');
    if (flavorSel) {
      const val = flavorSel.value;
      if (val.includes('+$4')) {
        lines.push({ label: 'Herb dipping oil swap', amount: 400 });
        total += 400;
      } else if (val.includes('+$3')) {
        lines.push({ label: 'Premium preserves flavor', amount: 300 });
        total += 300;
      }
    }

    // Add-ons
    document.querySelectorAll('#bc-addons input:checked').forEach(cb => {
      const price = parseFloat(cb.dataset.addonPrice) || 0;
      if (price > 0) {
        lines.push({ label: cb.dataset.addonName, amount: price });
        total += price;
      }
    });

    // Render lines (safe DOM — no innerHTML with user data)
    const linesEl = document.getElementById('bc-price-lines');
    while (linesEl.firstChild) linesEl.removeChild(linesEl.firstChild);
    lines.forEach(l => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;';
      const labelSpan = document.createElement('span');
      labelSpan.textContent = l.label;
      const amountSpan = document.createElement('span');
      amountSpan.textContent = '$' + (l.amount / 100).toFixed(2).replace(/\.00$/, '');
      row.appendChild(labelSpan);
      row.appendChild(amountSpan);
      linesEl.appendChild(row);
    });

    document.getElementById('bc-price-total').textContent = '$' + (total / 100).toFixed(2).replace(/\.00$/, '') + '/wk';
    return total;
  }

  // Wire to all interactive elements
  document.querySelectorAll('#bc-items select, #bc-addons input').forEach(el => {
    el.addEventListener('change', recalcBoxTotal);
  });
  recalcBoxTotal(); // initial render

  // Continue → populate cart with box items, open cart drawer
  document.getElementById('bc-continue').onclick = () => {
    const calculatedTotal = recalcBoxTotal();
    const swaps = [...document.querySelectorAll('#bc-items select[data-original-id]')].map(s => ({ from: s.dataset.originalId, to: s.value })).filter(s => s.from !== s.to);

    // Collect checked add-on inputs for both metadata and cart items
    const addonInputs = [...document.querySelectorAll('#bc-addons input:checked')];
    const addons = addonInputs.map(c => ({
      id: c.value,
      name: c.dataset.addonName,
      price: parseFloat(c.dataset.addonPrice) || 0,
    }));
    // Capture included preserves flavor
    const includedFlavorSel = document.querySelector('#bc-items select[data-preserves-flavor="included"]');
    if (includedFlavorSel) {
      addons.unshift({ id: 'preserves-flavor', name: 'Seasonal Preserves flavor: ' + includedFlavorSel.value, price: 0 });
    }
    // Capture butter type preference
    const butterSel = document.querySelector('#bc-items select[data-butter-type="included"]');
    if (butterSel) {
      addons.unshift({ id: 'butter-type', name: 'Butter: ' + butterSel.value, price: 0 });
    }

    const { subId, name } = _bcPendingArgs;
    const box = BOX_CONTENTS[subId];
    const subName = box ? box.label : name;

    // Box price = full calculated total minus add-on prices (upcharges stay with the box)
    let boxOnlyPrice = calculatedTotal;
    addonInputs.forEach(c => {
      if (PRODUCTS[c.value]) boxOnlyPrice -= (parseFloat(c.dataset.addonPrice) || 0);
    });

    // Box as one line item + each checked add-on as its own line item so cart shows itemized pricing
    const cartItems = [{ id: subId, qty: 1, price: boxOnlyPrice }];
    addonInputs.forEach(c => {
      const ap = parseFloat(c.dataset.addonPrice) || 0;
      if (PRODUCTS[c.value] && ap > 0) cartItems.push({ id: c.value, qty: 1, price: ap });
    });

    localStorage.setItem('hoto-cart', JSON.stringify({ items: cartItems }));

    // Build the final list of included items (applying swaps) for cart itemization display
    const includedItems = box ? box.items.map(item => {
      const swap = swaps.find(s => s.from === item.id);
      const finalId   = swap ? swap.to   : item.id;
      const finalName = swap ? (PRODUCTS[finalId] ? PRODUCTS[finalId].name : finalId) : item.name;
      // Append flavor/type notes
      let displayName = finalName;
      if (item.id === 'seasonal-preserves') {
        const flavorSel = document.querySelector('#bc-items select[data-preserves-flavor="included"]');
        if (flavorSel && flavorSel.value) displayName += ' — ' + flavorSel.value;
      }
      if (item.id === 'cultured-butter') {
        const butterSel = document.querySelector('#bc-items select[data-butter-type="included"]');
        if (butterSel && butterSel.value) displayName += ' — ' + butterSel.value;
      }
      if (item.id === 'garlic-chili-crunch' && finalId === 'seasonal-preserves') {
        const sfSel = document.querySelector('#bc-items select[data-swap-preserves-flavor]');
        if (sfSel) displayName = sfSel.options[sfSel.selectedIndex].dataset.flavorLabel + ' Preserves';
      }
      return { id: finalId, name: displayName };
    }) : [];

    // Persist subscription metadata (swaps + flavor/type notes carried through to checkout)
    localStorage.setItem('hoto-admin-sub', JSON.stringify({
      token: subId, subName, subPrice: calculatedTotal, swaps, addons, includedItems,
    }));

    closeBoxCustomizer();
    renderCart();
    openCart();
  };

  overlay.style.opacity = '0';
  overlay.style.visibility = 'visible';
  overlay.style.pointerEvents = 'all';
  requestAnimationFrame(() => { overlay.style.opacity = '1'; });
}

function closeBoxCustomizer() {
  const overlay = document.getElementById('box-customizer-overlay');
  if (!overlay) return;
  overlay.style.opacity = '0';
  setTimeout(() => { overlay.style.visibility = 'hidden'; overlay.style.pointerEvents = 'none'; }, 300);
  _bcPendingArgs = null;
}

function injectDeliveryModal() {
  if (document.getElementById('delivery-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'delivery-modal-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt delivery-modal';

  // ── Step 1: Pick-up or Delivery ──────────────────────────────────────
  const step1 = document.createElement('div');
  step1.id = 'dm-step1';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'How would you like to receive your order?';

  const opts = document.createElement('div');
  opts.className = 'delivery-modal__options';
  opts.appendChild(makeDeliveryOpt('dm-pickup', '📍', 'Local pick-up (free)', 'Pick-up details confirmed after checkout'));
  opts.appendChild(makeDeliveryOpt('dm-delivery', '🚚', 'Delivery', 'Free delivery for eligible orders · Enter your delivery address'));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  cancelBtn.id = 'dm-cancel';
  cancelBtn.textContent = 'Cancel';

  step1.appendChild(heading);
  step1.appendChild(opts);
  step1.appendChild(cancelBtn);

  // ── Step 2: Delivery address ──────────────────────────────────────────
  const step2 = document.createElement('div');
  step2.id = 'dm-step2';
  step2.style.display = 'none';

  const addrHeading = document.createElement('p');
  addrHeading.className = 'sub-prompt__heading';
  addrHeading.textContent = 'Delivery Address';

  const INP_S = 'width:100%;box-sizing:border-box;padding:9px 11px;margin-bottom:8px;border:1px solid rgba(44,62,45,0.2);border-radius:8px;font-family:var(--font-sans);font-size:0.85rem;color:var(--color-green,#2C3E2D);';

  // Saved address notice
  const savedNotice = document.createElement('div');
  savedNotice.id = 'dm-saved-addr-notice';
  savedNotice.style.cssText = 'display:none;background:var(--color-cream,#F5F0E8);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-family:var(--font-sans);font-size:0.82rem;color:var(--color-green,#2C3E2D);';

  const addrStreet = document.createElement('input');
  addrStreet.id = 'dm-addr-street'; addrStreet.placeholder = 'Street address'; addrStreet.style.cssText = INP_S;
  const addrCity = document.createElement('input');
  addrCity.id = 'dm-addr-city'; addrCity.placeholder = 'City'; addrCity.style.cssText = INP_S;

  const addrRow2 = document.createElement('div');
  addrRow2.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;';
  const addrState = document.createElement('input');
  addrState.id = 'dm-addr-state'; addrState.placeholder = 'State'; addrState.style.cssText = INP_S + 'margin-bottom:0;';
  const addrZip = document.createElement('input');
  addrZip.id = 'dm-addr-zip'; addrZip.placeholder = 'ZIP'; addrZip.style.cssText = INP_S + 'margin-bottom:0;';
  addrRow2.appendChild(addrState);
  addrRow2.appendChild(addrZip);

  const delivPromoRow = document.createElement('div');
  delivPromoRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';
  const delivPromoInput = document.createElement('input');
  delivPromoInput.id = 'dm-delivery-promo';
  delivPromoInput.placeholder = 'Delivery promo code (optional)';
  delivPromoInput.style.cssText = 'flex:1;padding:9px 12px;border:1px solid #d5c9bb;border-radius:6px;font-family:var(--font-sans);font-size:0.85rem;';
  const delivPromoBtn = document.createElement('button');
  delivPromoBtn.type = 'button';
  delivPromoBtn.textContent = 'Apply';
  delivPromoBtn.style.cssText = 'padding:9px 14px;background:var(--color-rust,#8B3A2A);color:#fff;border:none;border-radius:6px;font-family:var(--font-sans);font-size:0.85rem;cursor:pointer;white-space:nowrap;';
  const delivPromoMsg = document.createElement('p');
  delivPromoMsg.id = 'dm-delivery-promo-msg';
  delivPromoMsg.style.cssText = 'font-family:var(--font-sans);font-size:0.75rem;margin:0 0 8px;display:none;';
  delivPromoRow.appendChild(delivPromoInput);
  delivPromoRow.appendChild(delivPromoBtn);

  _validatedDeliveryPromo = null;
  delivPromoBtn.onclick = async () => {
    const code = delivPromoInput.value.trim().toUpperCase();
    delivPromoMsg.style.display = 'none';
    if (!code) return;
    delivPromoBtn.textContent = '…'; delivPromoBtn.disabled = true;
    try {
      const r = await fetch('/api/validate-delivery-promo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const d = await r.json();
      if (d.valid) {
        _validatedDeliveryPromo = code;
        delivPromoMsg.style.color = '#2a7a2a';
        delivPromoMsg.textContent = `✓ ${d.pct_off}% off delivery applied!`;
      } else {
        _validatedDeliveryPromo = null;
        delivPromoMsg.style.color = '#c0392b';
        delivPromoMsg.textContent = d.error || 'Invalid code';
      }
    } catch (_) {
      delivPromoMsg.style.color = '#c0392b';
      delivPromoMsg.textContent = 'Could not validate — try again';
    }
    delivPromoMsg.style.display = 'block';
    delivPromoBtn.textContent = 'Apply'; delivPromoBtn.disabled = false;
  };

  const addrErrMsg = document.createElement('p');
  addrErrMsg.id = 'dm-addr-err';
  addrErrMsg.style.cssText = 'color:#c0392b;font-family:var(--font-sans);font-size:0.75rem;margin:0 0 8px;display:none;';

  const addrActions = document.createElement('div');
  addrActions.style.cssText = 'display:flex;gap:8px;margin-top:4px;';

  const addrBack = document.createElement('button');
  addrBack.className = 'sub-prompt__btn sub-prompt__btn--no';
  addrBack.textContent = '← Back';
  addrBack.onclick = () => { step2.style.display = 'none'; step1.style.display = 'block'; };

  const addrConfirm = document.createElement('button');
  addrConfirm.className = 'sub-prompt__btn sub-prompt__btn--yes';
  addrConfirm.id = 'dm-addr-confirm';
  addrConfirm.textContent = 'Continue to Checkout →';

  addrActions.appendChild(addrBack);
  addrActions.appendChild(addrConfirm);

  step2.appendChild(addrHeading);
  step2.appendChild(savedNotice);
  step2.appendChild(addrStreet);
  step2.appendChild(addrCity);
  step2.appendChild(addrRow2);
  step2.appendChild(delivPromoRow);
  step2.appendChild(delivPromoMsg);
  step2.appendChild(addrErrMsg);
  step2.appendChild(addrActions);

  box.appendChild(step1);
  box.appendChild(step2);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDeliveryModal(); });
}

function _openDeliveryStep2(onConfirm) {
  const step1 = document.getElementById('dm-step1');
  const step2 = document.getElementById('dm-step2');
  if (!step2) return;
  step1.style.display = 'none';
  step2.style.display = 'block';

  // Always reset — a failed previous attempt leaves the button disabled
  const confirmBtn = document.getElementById('dm-addr-confirm');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Continue to Checkout →';

  // Pre-fill from localStorage if saved
  const saved = (() => { try { return JSON.parse(localStorage.getItem('hoto-delivery-address') || 'null'); } catch { return null; } })();
  const notice = document.getElementById('dm-saved-addr-notice');
  if (saved && saved.street) {
    notice.style.display = 'block';
    notice.textContent = '📍 Using saved address: ' + saved.street + ', ' + saved.city + ', ' + saved.state + ' ' + saved.zip + ' — update below to change.';
    document.getElementById('dm-addr-street').value = saved.street || '';
    document.getElementById('dm-addr-city').value   = saved.city   || '';
    document.getElementById('dm-addr-state').value  = saved.state  || '';
    document.getElementById('dm-addr-zip').value    = saved.zip    || '';
  } else {
    notice.style.display = 'none';
  }

  confirmBtn.onclick = async () => {
    const street = document.getElementById('dm-addr-street').value.trim();
    const city   = document.getElementById('dm-addr-city').value.trim();
    const state  = document.getElementById('dm-addr-state').value.trim();
    const zip    = document.getElementById('dm-addr-zip').value.trim();
    const errEl  = document.getElementById('dm-addr-err');
    if (!street || !city || !state || !zip) {
      errEl.textContent = 'Please fill in all address fields.'; errEl.style.display = 'block'; return;
    }
    errEl.style.display = 'none';
    confirmBtn.textContent = 'Proceeding to checkout…'; confirmBtn.disabled = true;

    const address = { street, city, state, zip };
    localStorage.setItem('hoto-delivery-address', JSON.stringify(address));
    // Capture promo BEFORE closeDeliveryModal resets _validatedDeliveryPromo
    const capturedPromo = _validatedDeliveryPromo || null;
    console.log('[HOTO] delivery promo captured:', capturedPromo);
    closeDeliveryModal();
    try {
      await onConfirm(address, 0, capturedPromo);
    } catch (err) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Continue to Checkout →';
    }
  };
}

let _validatedDeliveryPromo = null;
let _pendingSubArgs = null;

function openDeliveryModal(subId, name, price, swaps = [], addons = []) {
  _pendingSubArgs = { subId, name, price, swaps, addons };
  const overlay = document.getElementById('delivery-modal-overlay');
  overlay.classList.add('open');
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); openPickupLocationModal(loc => subscribe(_pendingSubArgs.subId, _pendingSubArgs.name, _pendingSubArgs.price, 'pickup', loc, _pendingSubArgs.swaps, _pendingSubArgs.addons)); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function closeDeliveryModal() {
  document.getElementById('delivery-modal-overlay')?.classList.remove('open');
  _pendingSubArgs = null;
  _validatedDeliveryPromo = null;
}

// --- Subscribe ---

async function subscribe(subId, name, price, deliveryMethod, pickupLocation, swaps = [], addons = []) {
  const btn = document.querySelector(`[data-sub-id="${CSS.escape(subId)}"]`);
  const original = btn?.textContent;
  if (btn) { btn.textContent = 'Redirecting…'; btn.disabled = true; }

  try {
    const body = { item: { name, price }, delivery_method: deliveryMethod || 'ship' };
    if (pickupLocation) body.pickup_location = pickupLocation;
    if (swaps && swaps.length) body.swaps = swaps;
    if (addons && addons.length) body.addons = addons;
    const res = await fetch('/create-subscription-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.url) {
      clearAdminSub();
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

// Restore cart from SMS abandon-link or admin cart link (?rc=TOKEN)
(function() {
  var params = new URLSearchParams(window.location.search);
  var rc = params.get('rc');
  if (!rc) return;
  fetch('/api/restore-cart?token=' + encodeURIComponent(rc))
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d || !d.items || !d.items.length) return;

      // Subscription link — load items into cart, store metadata, open cart drawer
      if (d.subscription && d.subPrice && d.subName) {
        var subCart = { items: [] };
        d.items.forEach(function(item) {
          var pid = (item.id && PRODUCTS[item.id]) ? item.id :
            Object.keys(PRODUCTS).find(function(k) { return PRODUCTS[k].name === item.name; });
          var cartItem = { id: pid || item.id, qty: item.quantity || item.qty || 1, price: item.price != null ? item.price : (pid ? PRODUCTS[pid].price : 0) };
          if (!pid && item.name) cartItem.name = item.name;
          subCart.items.push(cartItem);
        });
        if (subCart.items.length) localStorage.setItem('hoto-cart', JSON.stringify(subCart));
        localStorage.setItem('hoto-admin-sub', JSON.stringify({ token: rc, subName: d.subName, subPrice: d.subPrice }));
        var url = new URL(window.location.href);
        url.searchParams.delete('rc');
        window.history.replaceState({}, '', url.toString());
        function launchSubCart() {
          var od = document.getElementById('cart-drawer');
          var oo = document.getElementById('cart-overlay');
          var oi = document.getElementById('cart-icon-btn');
          if (od) od.parentNode.removeChild(od);
          if (oo) oo.parentNode.removeChild(oo);
          if (oi) oi.parentNode.removeChild(oi);
          injectCartDrawer();
          injectCartIcon();
          renderCart();
          openCart();
        }
        if (window._hotoCartReady) {
          launchSubCart();
        } else {
          window._hotoRestorePending = launchSubCart;
        }
        return;
      }

      var cart = { items: [] };
      d.items.forEach(function(item) {
        // Prefer id-based lookup; fall back to name match; keep custom items with stored name
        var pid = (item.id && PRODUCTS[item.id]) ? item.id :
          Object.keys(PRODUCTS).find(function(k) { return PRODUCTS[k].name === item.name; });
        var cartItem = { id: pid || item.id, qty: item.quantity || item.qty || 1, price: item.price != null ? item.price : (pid ? PRODUCTS[pid].price : 0), taxable: !!item.taxable, free: !!item.free };
        if (!pid && item.name) cartItem.name = item.name;
        cart.items.push(cartItem);
      });
      if (cart.items.length) {
        localStorage.setItem('hoto-cart', JSON.stringify(cart));
        // Calculate discount cents — kept in closure so showRestoredCart can use it directly
        // (charged subtotal — free items contribute $0 even though their real price is shown to the customer)
        var chargedSubtotal = cart.items.reduce(function(s, i) { return s + (i.free ? 0 : (i.price || 0)) * i.qty; }, 0);
        var taxableSubtotal = cart.items.reduce(function(s, i) { return s + (i.taxable && !i.free ? (i.price || 0) * i.qty : 0); }, 0);
        var discCents = 0;
        if (d.discount && d.discount.amount > 0) {
          discCents = d.discount.type === 'percent'
            ? Math.round(chargedSubtotal * d.discount.amount / 100)
            : Math.round(d.discount.amount * 100);
        }
        var taxRatePct = d.taxRate || 0;
        var taxCents = taxRatePct > 0 ? Math.round(taxableSubtotal * taxRatePct / 100) : 0;
        localStorage.setItem('hoto-cart-tax-rate', String(taxRatePct));
        // One-time purchase link — clear any stale subscription state so
        // the cart doesn't inherit a previous box customizer session
        localStorage.removeItem('hoto-admin-sub');
        localStorage.removeItem('hoto-subscribe');
        // Store token so checkout can pass it to Stripe metadata for precise webhook matching
        localStorage.setItem('hoto-cart-link-token', rc);
        // Persist cart-link discount so checkout() picks it up via the normal promo path
        if (discCents > 0) {
          localStorage.setItem('hoto-promo-code', d.discount.label || 'Discount');
          localStorage.setItem('hoto-promo-amt', String(discCents));
        }
        var url = new URL(window.location.href);
        url.searchParams.delete('rc');
        window.history.replaceState({}, '', url.toString());
        function showRestoredCart() {
          // Rebuild drawer completely fresh
          ['cart-drawer','cart-overlay','cart-icon-btn'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.parentNode.removeChild(el);
          });
          injectCartDrawer();
          injectCartIcon();

          // Build cart content directly — bypass renderCart() to avoid any hidden failure
          var body = document.getElementById('cart-body');
          var cartData = getCart();
          if (body && cartData && cartData.items && cartData.items.length) {
            body.textContent = '';
            var wrap = document.createElement('div');
            wrap.className = 'cart-items';
            cartData.items.forEach(function(item) {
              var p = PRODUCTS[item.id];
              var displayName = (p && p.name) || item.name || item.id;
              var price = item.price || (p ? p.price : 0);
              var div = document.createElement('div');
              div.className = 'cart-item';
              div.dataset.id = item.id;
              if (p && p.image) {
                var img = document.createElement('img');
                img.className = 'cart-item__image'; img.src = p.image; img.alt = displayName;
                div.appendChild(img);
              }
              var info = document.createElement('div');
              info.className = 'cart-item__info';
              var nameEl = document.createElement('p');
              nameEl.className = 'cart-item__name'; nameEl.textContent = displayName;
              var priceEl = document.createElement('p');
              priceEl.className = 'cart-item__price';
              if (item.free) {
                var origPriceSpan = document.createElement('span');
                origPriceSpan.style.cssText = 'text-decoration:line-through;opacity:0.6;';
                origPriceSpan.textContent = '$' + (price / 100).toFixed(2);
                var freeSpan = document.createElement('span');
                freeSpan.style.color = '#2a7a2a';
                freeSpan.textContent = ' FREE';
                priceEl.appendChild(origPriceSpan);
                priceEl.appendChild(freeSpan);
              } else {
                priceEl.textContent = '$' + (price / 100).toFixed(2);
              }
              var qtyRow = document.createElement('div');
              qtyRow.className = 'cart-item__qty';
              var minus = document.createElement('button'); minus.className='cart-qty-btn'; minus.textContent='−';
              minus.addEventListener('click', function() { updateQty(item.id, -1); });
              var qtyNum = document.createElement('span'); qtyNum.className='cart-qty-num'; qtyNum.textContent=item.qty;
              var plus = document.createElement('button'); plus.className='cart-qty-btn'; plus.textContent='+';
              plus.addEventListener('click', function() { updateQty(item.id, 1); });
              qtyRow.appendChild(minus); qtyRow.appendChild(qtyNum); qtyRow.appendChild(plus);
              info.appendChild(nameEl); info.appendChild(priceEl); info.appendChild(qtyRow);
              var removeBtn = document.createElement('button');
              removeBtn.className='cart-item__remove'; removeBtn.textContent='✕';
              removeBtn.addEventListener('click', function() { removeItem(item.id); });
              div.appendChild(info); div.appendChild(removeBtn);
              wrap.appendChild(div);
            });
            var subtotal = cartData.items.reduce(function(s, i) { return s + (i.free ? 0 : (i.price || 0)) * i.qty; }, 0);
            var footer = document.createElement('div');
            footer.className = 'cart-footer';

            // Show discount row if one was set on this cart link
            var appliedDiscCents = (typeof discCents !== 'undefined' && discCents > 0) ? discCents : 0;
            var appliedDiscLabel = (d.discount && d.discount.label) ? d.discount.label : 'Discount';
            if (appliedDiscCents > 0) {
              var discRow = document.createElement('p');
              discRow.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;color:#2a7a2a;margin:0 0 6px;display:flex;justify-content:space-between;';
              var discLbl = document.createElement('span'); discLbl.textContent = appliedDiscLabel;
              var discAmt = document.createElement('span'); discAmt.textContent = '-$' + (appliedDiscCents / 100).toFixed(2);
              discRow.appendChild(discLbl); discRow.appendChild(discAmt);
              footer.appendChild(discRow);
            }

            // Show sales tax row if this cart link has taxable items
            var appliedTaxCents = (typeof taxCents !== 'undefined' && taxCents > 0) ? taxCents : 0;
            if (appliedTaxCents > 0) {
              var taxRow = document.createElement('p');
              taxRow.style.cssText = 'font-family:var(--font-sans);font-size:0.78rem;color:#888;margin:0 0 6px;display:flex;justify-content:space-between;';
              var taxLbl = document.createElement('span'); taxLbl.textContent = 'Sales Tax (' + taxRatePct + '%)';
              var taxAmt = document.createElement('span'); taxAmt.textContent = '$' + (appliedTaxCents / 100).toFixed(2);
              taxRow.appendChild(taxLbl); taxRow.appendChild(taxAmt);
              footer.appendChild(taxRow);
            }

            var displayTotal = subtotal - appliedDiscCents + appliedTaxCents;
            var totalRow = document.createElement('div');
            totalRow.className = 'cart-footer__total';
            var lbl = document.createElement('span'); lbl.textContent = (appliedDiscCents > 0 || appliedTaxCents > 0) ? 'Total' : 'Subtotal';
            var amt = document.createElement('span'); amt.id = 'cart-total';
            amt.textContent = '$' + (displayTotal / 100).toFixed(2);
            totalRow.appendChild(lbl); totalRow.appendChild(amt);
            var noteEl = document.createElement('p');
            noteEl.className = 'cart-footer__note';
            noteEl.textContent = 'Shipping calculated at checkout';
            var checkoutBtn = document.createElement('button');
            checkoutBtn.className = 'btn btn--dark cart-footer__checkout';
            checkoutBtn.id = 'cart-checkout';
            checkoutBtn.textContent = 'Proceed to Checkout';

            // If sampler box is in the cart, show a customize prompt before checkout
            var hasSamplerInLink = cartData.items.some(function(i) { return i.id === 'sampler-box'; });
            if (hasSamplerInLink) {
              var _samplerCustomized = false;

              var customizeBtn = document.createElement('button');
              customizeBtn.style.cssText = 'width:100%;padding:12px;background:rgba(139,74,47,0.08);border:1.5px solid rgba(139,74,47,0.35);border-radius:8px;font-family:var(--font-sans);font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8B4A2F;cursor:pointer;margin-bottom:8px;';
              customizeBtn.textContent = 'Customize Your Box →';
              customizeBtn.addEventListener('click', function() {
                _samplerCustomized = true;
                if (!document.getElementById('box-customizer-overlay')) injectBoxCustomizer();
                openBoxCustomizer('sampler-box', 'The Farm Sampler Box', 14900);
              });

              checkoutBtn.addEventListener('click', function() {
                if (!_samplerCustomized) {
                  if (!document.getElementById('box-customizer-overlay')) injectBoxCustomizer();
                  openBoxCustomizer('sampler-box', 'The Farm Sampler Box', 14900);
                  _samplerCustomized = true;
                  return;
                }
                openOneTimeDeliveryChoice();
              });

              footer.appendChild(totalRow);
              footer.appendChild(noteEl);
              footer.appendChild(customizeBtn);
              footer.appendChild(checkoutBtn);
            } else {
              checkoutBtn.addEventListener('click', openOneTimeDeliveryChoice);
              footer.appendChild(totalRow);
              footer.appendChild(noteEl);
              footer.appendChild(checkoutBtn);
            }
            body.appendChild(wrap);
            body.appendChild(footer);

            // Update badge
            var badge = document.getElementById('cart-count');
            if (badge) { badge.textContent = cartData.items.reduce(function(s,i){return s+i.qty;},0); badge.classList.add('has-items'); }
          }
          openCart();
        }
        if (window._hotoCartReady) {
          showRestoredCart();
        } else {
          window._hotoRestorePending = showRestoredCart;
        }
      }
    })
    .catch(function() {});
})();

// Event delegation for subscribe buttons — runs immediately, not gated on DOMContentLoaded
document.addEventListener('click', function(e) {
  const btn = e.target.closest('[data-sub-id]');
  if (!btn) return;
  // Ensure the box customizer overlay exists before trying to open it
  if (!document.getElementById('box-customizer-overlay')) injectBoxCustomizer();
  openBoxCustomizer(btn.dataset.subId, btn.dataset.subName, parseInt(btn.dataset.subPrice || '0', 10));
});

document.addEventListener('DOMContentLoaded', () => {
  try { injectCartDrawer(); } catch(e) { console.error('injectCartDrawer', e); }
  try { injectCartIcon(); } catch(e) { console.error('injectCartIcon', e); }
  try { injectSubscriberModal(); } catch(e) { console.error('injectSubscriberModal', e); }
  try { injectDeliveryModal(); } catch(e) { console.error('injectDeliveryModal', e); }
  try { injectPickupLocationModal(); } catch(e) { console.error('injectPickupLocationModal', e); }
  try { injectShipCalcModal(); } catch(e) { console.error('injectShipCalcModal', e); }
  try { injectAddressConfirmModal(); } catch(e) { console.error('injectAddressConfirmModal', e); }
  try { injectOrderDetailsModal(); } catch(e) { console.error('injectOrderDetailsModal', e); }
  try { injectBoxCustomizer(); } catch(e) { console.error('injectBoxCustomizer', e); }
  try { injectClearCartModal(); } catch(e) { console.error('injectClearCartModal', e); }
  try { injectChickenModal(); } catch(e) { console.error('injectChickenModal', e); }
  try { injectButterModal(); } catch(e) { console.error('injectButterModal', e); }
  try { renderCart(); } catch(e) { console.error('renderCart', e); }

  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.addToCart;
      if (id === 'whole-chicken')      { openChickenModal(); }
      else if (id === 'cultured-butter') { openButterModal(); }
      else if (PRODUCTS[id]?.subPrice) { openSubPrompt(id); }
      else { addItem(id); }
    });
  });

  // Signal that cart is fully initialised — fire any pending restore from a cart link
  window._hotoCartReady = true;
  if (typeof window._hotoRestorePending === 'function') {
    window._hotoRestorePending();
    window._hotoRestorePending = null;
  }
});
