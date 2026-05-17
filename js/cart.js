/* =========================================
   HEART OF TEXAS ORGANICS CART
   ========================================= */

const PRODUCTS = {
  'japanese-milk-loaf': { name: 'Japanese Milk Loaf', price: 0,    subPrice: null, image: 'images/japanese-milk-loaf.jpg' },
  'whole-wheat-loaf':   { name: 'Whole Wheat Loaf',   price: 0,    subPrice: null, image: 'images/whole-wheat-loaf.jpg' },
  'cinnamon-rolls':     { name: 'Cinnamon Rolls',      price: 0,    subPrice: null, image: 'images/cinnamon-rolls.jpg' },
  'yeast-rolls':        { name: 'Yeast Rolls',         price: 0,    subPrice: null, image: 'images/yeast-rolls.jpg' },
  'focaccia-loaf':      { name: 'Focaccia Loaf',       price: 0,    subPrice: null, image: 'images/focaccia-loaf.jpg' },
  'whole-chicken':      { name: 'Whole Chicken',       price: 1800, subPrice: 1500, image: 'images/chicken.jpg' },
  'cultured-butter':    { name: 'Real Cream Butter',   price: 900,  subPrice: 700,  image: 'images/butter.jpg' },
  'farm-eggs':          { name: 'Farm Eggs (1 dozen)', price: 800,  subPrice: 600,  image: 'images/eggs.jpg' },
  'harvest-basket':     { name: 'Harvest Basket',      price: 3500, subPrice: 2800, image: 'images/harvest.jpg' },
};

const STORAGE_KEY = 'hoto-cart';

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

function addItem(productId, priceOverride) {
  if (!PRODUCTS[productId]) return;
  const cart = getCart();
  const existing = cart.items.find(i => i.id === productId);
  const price = priceOverride ?? null;
  if (existing) { existing.qty += 1; existing.price = price; }
  else { cart.items.push({ id: productId, qty: 1, price }); }
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

function getDiscountedTotal() {
  return getCart().items.reduce((sum, item) => {
    const p = PRODUCTS[item.id];
    const price = item.price ?? (p ? p.price : 0);
    return sum + Math.round(price * 0.8) * item.qty;
  }, 0);
}

function getMonthlyTotal() {
  return getDiscountedTotal() * 4;
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
  const subscribing = isSubscribing();

  cart.items.filter(({ id }) => PRODUCTS[id]).forEach(({ id, qty, price: itemPrice }) => {
    const p = PRODUCTS[id];
    const basePrice = itemPrice ?? p.price;
    const displayPrice = subscribing && basePrice > 0 ? Math.round(basePrice * 0.8) : basePrice;
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
    if (subscribing && basePrice > 0) {
      const orig = document.createElement('span');
      orig.className = 'cart-item__price-orig';
      orig.textContent = fmt(basePrice);
      const disc = document.createElement('span');
      disc.className = 'cart-item__price-disc';
      disc.textContent = fmt(displayPrice);
      price.appendChild(orig);
      price.appendChild(disc);
    } else {
      price.textContent = fmt(displayPrice);
      if (itemPrice !== null && itemPrice !== undefined && p.subPrice && itemPrice === p.subPrice) {
        const badge = document.createElement('span');
        badge.className = 'cart-item__sub-badge';
        badge.textContent = 'Subscriber price';
        price.appendChild(badge);
      }
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

  // Subscribe & Save toggle
  const subToggle = document.createElement('label');
  subToggle.className = 'cart-subscribe' + (subscribing ? ' cart-subscribe--active' : '');
  subToggle.htmlFor = 'cart-sub-check';

  const subCheck = document.createElement('input');
  subCheck.type = 'checkbox';
  subCheck.id = 'cart-sub-check';
  subCheck.className = 'cart-subscribe__input';
  subCheck.checked = subscribing;
  subCheck.addEventListener('change', () => {
    setSubscribing(subCheck.checked);
    renderCart();
  });

  const subCheckbox = document.createElement('span');
  subCheckbox.className = 'cart-subscribe__box';

  const subText = document.createElement('span');
  subText.className = 'cart-subscribe__text';
  subText.innerHTML = '<strong>Subscribe &amp; Save 20%</strong><em>Billed monthly · cancel anytime</em>';

  subToggle.appendChild(subCheck);
  subToggle.appendChild(subCheckbox);
  subToggle.appendChild(subText);

  const totalRow = document.createElement('div');
  totalRow.className = 'cart-footer__total';

  const totalLabel = document.createElement('span');
  totalLabel.textContent = subscribing ? 'Monthly total' : 'Subtotal';

  const totalAmount = document.createElement('span');
  totalAmount.id = 'cart-total';
  totalAmount.textContent = subscribing ? fmt(getMonthlyTotal()) + '/mo' : fmt(getTotal());

  totalRow.appendChild(totalLabel);
  totalRow.appendChild(totalAmount);

  const note = document.createElement('p');
  note.className = 'cart-footer__note';
  note.textContent = subscribing ? 'Charged monthly · 4 weeks × discounted total' : 'Shipping calculated at checkout';

  const checkoutBtn = document.createElement('button');
  checkoutBtn.className = 'btn btn--dark cart-footer__checkout';
  checkoutBtn.id = 'cart-checkout';
  checkoutBtn.textContent = subscribing ? `Subscribe — ${fmt(getMonthlyTotal())}/mo` : 'Proceed to Checkout';
  checkoutBtn.addEventListener('click', subscribing ? openCartDeliveryModal : openOneTimeDeliveryChoice);

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

  footer.appendChild(subToggle);
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

// --- Shipping Calculator Modal ---

let _shipCalcRate = null;

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
  form.appendChild(makeField('sc-name',   'Full Name',       'Jane Smith'));
  form.appendChild(makeField('sc-street', 'Street Address',  '123 Main St'));

  const cityRow = document.createElement('div');
  cityRow.className = 'ship-calc-row';
  const cityF  = makeField('sc-city',  'City',  'Austin');
  const stateF = makeField('sc-state', 'State', 'TX', 2);
  const zipF   = makeField('sc-zip',   'ZIP',   '78701', 5);
  stateF.style.flex = '0 0 62px';
  zipF.style.flex   = '0 0 82px';
  cityRow.appendChild(cityF);
  cityRow.appendChild(stateF);
  cityRow.appendChild(zipF);
  form.appendChild(cityRow);

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

  overlay.addEventListener('click', e => { if (e.target === overlay) closeShipCalcModal(); });
  cancelBtn.addEventListener('click', closeShipCalcModal);
  getRatesBtn.addEventListener('click', fetchShippingRates);
  continueBtn.addEventListener('click', checkoutWithShipping);
}

function openShipCalcModal() {
  _shipCalcRate = null;
  const ratesDiv = document.getElementById('sc-rates');
  if (ratesDiv) { ratesDiv.style.display = 'none'; ratesDiv.textContent = ''; }
  const cont = document.getElementById('sc-continue');
  if (cont) cont.style.display = 'none';
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
      document.getElementById('sc-continue').style.display = '';
    });

    div.appendChild(card);
  });

  div.style.display = '';
}

async function checkoutWithShipping() {
  if (!_shipCalcRate) return;
  const btn = document.getElementById('sc-continue');
  btn.textContent = 'Redirecting…'; btn.disabled = true;

  const cart = getCart();
  if (!cart.items.length) return;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({ name: PRODUCTS[id].name, price: price ?? PRODUCTS[id].price, quantity: qty }));

  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, shipping: _shipCalcRate, delivery_method: 'ship' }),
    });
    const data = await res.json();
    if (data.url) { window.location.href = data.url; }
    else { alert(data.error || 'Checkout error'); btn.textContent = 'Continue to Payment →'; btn.disabled = false; }
  } catch { alert('Connection error.'); btn.textContent = 'Continue to Payment →'; btn.disabled = false; }
}

// --- Checkout ---

async function checkout(deliveryMethod) {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  const original = btn.textContent;
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({ name: PRODUCTS[id].name, price: price ?? PRODUCTS[id].price, quantity: qty }));

  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, delivery_method: deliveryMethod || 'pickup' }),
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
    console.error('Checkout error:', err);
  }
}

// --- Subscription Checkout ---

function openCartDeliveryModal() {
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); checkoutSubscription('ship'); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); checkoutSubscription('pickup'); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function openOneTimeDeliveryChoice() {
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); openShipCalcModal(); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); checkout('pickup'); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

async function checkoutSubscription(deliveryMethod) {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({
      name: PRODUCTS[id].name,
      price: Math.round((price ?? PRODUCTS[id].price) * 0.8),
      quantity: qty,
    }));

  try {
    const res = await fetch('/create-cart-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, delivery_method: deliveryMethod || 'ship' }),
    });
    const data = await res.json();
    if (data.url) {
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
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({ name: PRODUCTS[id].name, price: price ?? PRODUCTS[id].price, quantity: qty }));

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

function injectDeliveryModal() {
  if (document.getElementById('delivery-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'delivery-modal-overlay';
  overlay.className = 'sub-prompt-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const box = document.createElement('div');
  box.className = 'sub-prompt delivery-modal';

  const heading = document.createElement('p');
  heading.className = 'sub-prompt__heading';
  heading.textContent = 'How would you like to receive your box?';

  const opts = document.createElement('div');
  opts.className = 'delivery-modal__options';
  opts.appendChild(makeDeliveryOpt('dm-ship',   '🚚', 'Ship to my address',     'Shipping rates confirmed at checkout'));
  opts.appendChild(makeDeliveryOpt('dm-pickup', '📍', 'Local pick-up (free)',    'Pick-up details sent after signup'));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'sub-prompt__btn sub-prompt__btn--no';
  cancelBtn.id = 'dm-cancel';
  cancelBtn.textContent = 'Cancel';

  box.appendChild(heading);
  box.appendChild(opts);
  box.appendChild(cancelBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDeliveryModal(); });
}

let _pendingSubArgs = null;

function openDeliveryModal(subId, name, price) {
  _pendingSubArgs = { subId, name, price };
  const overlay = document.getElementById('delivery-modal-overlay');
  overlay.classList.add('open');
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); subscribe(_pendingSubArgs.subId, _pendingSubArgs.name, _pendingSubArgs.price, 'ship'); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); subscribe(_pendingSubArgs.subId, _pendingSubArgs.name, _pendingSubArgs.price, 'pickup'); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function closeDeliveryModal() {
  document.getElementById('delivery-modal-overlay')?.classList.remove('open');
  _pendingSubArgs = null;
}

// --- Subscribe ---

async function subscribe(subId, name, price, deliveryMethod) {
  const btn = document.querySelector(`[data-sub-id="${CSS.escape(subId)}"]`);
  const original = btn?.textContent;
  if (btn) { btn.textContent = 'Redirecting…'; btn.disabled = true; }

  try {
    const res = await fetch('/create-subscription-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { name, price }, delivery_method: deliveryMethod || 'ship' }),
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
  injectSubscriberModal();
  injectDeliveryModal();
  injectShipCalcModal();
  renderCart();

  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.addToCart;
      if (PRODUCTS[id]?.subPrice) { openSubPrompt(id); } else { addItem(id); }
    });
  });

  document.querySelectorAll('[data-sub-id]').forEach(btn => {
    btn.addEventListener('click', () =>
      openDeliveryModal(btn.dataset.subId, btn.dataset.subName, parseInt(btn.dataset.subPrice, 10))
    );
  });
});
