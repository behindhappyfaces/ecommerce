/* =========================================
   HEART OF TEXAS ORGANICS CART
   ========================================= */

const PRODUCTS = {
  'japanese-milk-loaf': { name: 'Japanese Milk Loaf', price: 0,    subPrice: null, image: 'images/japanese-milk-loaf.jpg' },
  'whole-wheat-loaf':   { name: 'Whole Wheat Loaf',   price: 0,    subPrice: null, image: 'images/whole-wheat-loaf.jpg' },
  'cinnamon-rolls':     { name: 'Cinnamon Rolls',      price: 0,    subPrice: null, image: 'images/cinnamon-rolls.jpg' },
  'yeast-rolls':        { name: 'Yeast Rolls',         price: 0,    subPrice: null, image: 'images/yeast-rolls.jpg' },
  'focaccia-loaf':      { name: 'Focaccia Loaf',       price: 0,    subPrice: null, image: 'images/focaccia-loaf.jpg' },
  'whole-chicken':      { name: 'Whole Chicken',       price: 0, subPrice: null, image: 'images/chicken.jpg' },
  'cultured-butter':    { name: 'Real Cream Butter',   price: 0, subPrice: null, image: 'images/butter.jpg' },
  'farm-eggs':          { name: 'Farm Eggs (1 dozen)', price: 0, subPrice: null, image: 'images/eggs.jpg' },
  'harvest-basket':        { name: 'Harvest Basket',        price: 0, subPrice: null, image: 'images/harvest.jpg' },
  'thanksgiving-turkey':   { name: 'Thanksgiving Turkey',   price: 10000, subPrice: null, image: 'images/chicken.jpg' },
  'sampler-box':           { name: 'The Farm Sampler Box',  price: 9900,  subPrice: null, image: null },
  'garlic-chili-crunch':   { name: 'Garlic Chili Crunch',   price: 0,     subPrice: null, image: 'images/chili-crunch.jpg' },
  'herb-dipping-oil':      { name: 'Tuscany Herb Dipping Oil', price: 0,  subPrice: null, image: 'images/herb-dipping-oil.jpg' },
  'seasonal-preserves':    { name: 'Seasonal Preserves',    price: 0,     subPrice: null, image: 'images/preserves.jpg' },
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
    return sum + Math.round(price * 0.85) * item.qty;
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
    const displayPrice = subscribing && basePrice > 0 ? Math.round(basePrice * 0.85) : basePrice;
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
  subText.innerHTML = '<strong>Subscribe &amp; Save 15%</strong><em>Billed monthly · cancel anytime</em>';

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
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({ name: PRODUCTS[id].name, price: price ?? PRODUCTS[id].price, quantity: qty }));

  try {
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, shipping: _shipCalcRate, delivery_method: 'ship', billing, gift }),
    });
    const data = await res.json();
    if (data.url) {
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
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({ name: PRODUCTS[id].name, price: price ?? PRODUCTS[id].price, quantity: qty }));

  try {
    const body = { items, delivery_method: deliveryMethod || 'pickup' };
    if (pickupLocation) body.pickup_location = pickupLocation;
    if (pickupContact)  body.pickup_contact  = pickupContact;
    const res = await fetch('/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.url) {
      localStorage.setItem('hoto-checkout-delivery', deliveryMethod || 'pickup');
      localStorage.setItem('hoto-checkout-location', pickupLocation || '');
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
  }
}

// --- Subscription Checkout ---

function applyShipMinimum(totalCents) {
  const shortfall = SHIP_MINIMUM - totalCents;
  const shipBtn   = document.getElementById('dm-ship');
  const existing  = document.getElementById('dm-ship-min-note');
  if (existing) existing.remove();

  if (shortfall > 0) {
    shipBtn.disabled      = true;
    shipBtn.style.opacity = '0.4';
    shipBtn.style.cursor  = 'not-allowed';
    const note = document.createElement('p');
    note.id = 'dm-ship-min-note';
    note.style.cssText = 'font-size:0.8rem;color:#8B4A2F;margin:6px 0 4px;text-align:center;line-height:1.5;padding:0 16px;';
    note.textContent = `Add $${(shortfall / 100).toFixed(2)} more to your order to qualify for shipping. Orders under $75 are pick-up only.`;
    shipBtn.after(note);
  } else {
    shipBtn.disabled      = false;
    shipBtn.style.opacity = '';
    shipBtn.style.cursor  = '';
  }
}

function openCartDeliveryModal() {
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  applyShipMinimum(getTotal());
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); checkoutSubscription('ship'); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); openPickupLocationModal((loc, contact) => checkoutSubscription('pickup', loc, contact)); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function openOneTimeDeliveryChoice() {
  const overlay = document.getElementById('delivery-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('open');
  applyShipMinimum(getTotal());
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); openShipCalcModal(); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); openPickupLocationModal((loc, contact) => checkout('pickup', loc, contact)); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

async function checkoutSubscription(deliveryMethod, pickupLocation, pickupContact) {
  const cart = getCart();
  if (!cart.items.length) return;

  const btn = document.getElementById('cart-checkout');
  btn.textContent = 'Redirecting…';
  btn.disabled = true;

  const items = cart.items
    .filter(({ id }) => PRODUCTS[id])
    .map(({ id, qty, price }) => ({
      name: PRODUCTS[id].name,
      price: Math.round((price ?? PRODUCTS[id].price) * 0.85),
      quantity: qty,
    }));

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
    { id: 'pl-lakeway',   icon: '📍', label: 'Lakeway / Bee Cave',  note: 'Central location near Lake Travis' },
    { id: 'pl-dripping',  icon: '📍', label: 'Dripping Springs',    note: 'Hill Country pick-up point' },
    { id: 'pl-austin',    icon: '📍', label: 'Austin',              note: 'South Austin area pick-up' },
  ];

  locations.forEach(({ id, icon, label, note }) => {
    const btn = document.createElement('button');
    btn.className = 'pickup-loc-opt';
    btn.id = id;

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

    const comingSoon = document.createElement('span');
    comingSoon.className = 'pickup-loc-opt__coming-soon';
    comingSoon.textContent = '*Location Coming Soon';

    textWrap.appendChild(labelSpan);
    textWrap.appendChild(noteSpan);
    textWrap.appendChild(comingSoon);
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
      { id: 'japanese-milk-loaf', name: 'Japanese Milk Loaf',      swapGroup: 'bread' },
      { id: 'cultured-butter',    name: 'Real Cream Butter',        swapGroup: null },
      { id: 'seasonal-preserves', name: 'Seasonal Preserves',       swapGroup: null },
      { id: 'herb-dipping-oil',   name: 'Tuscany Herb Dipping Oil', swapGroup: null },
    ],
  },
  'harvest-subscription': {
    label: 'The Supper Starter Box',
    items: [
      { id: 'whole-wheat-loaf',   name: 'Whole Wheat Loaf',        swapGroup: 'bread' },
      { id: 'focaccia-loaf',      name: 'Focaccia Loaf',            swapGroup: null },
      { id: 'farm-eggs',          name: 'Farm Eggs (1 doz)',         swapGroup: null },
      { id: 'cultured-butter',    name: 'Real Cream Butter',        swapGroup: null },
      { id: 'garlic-chili-crunch',name: 'Garlic Chili Crunch',      swapGroup: null },
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
      { id: 'yeast-rolls',        name: 'Yeast Rolls (1 doz)',    swapGroup: null },
      { id: 'cultured-butter',    name: 'Real Cream Butter (½ lb)', swapGroup: null },
      { id: 'cinnamon-rolls',     name: 'Cinnamon Rolls (½ doz)', swapGroup: null },
      { id: 'garlic-chili-crunch',name: 'Garlic Chili Crunch',    swapGroup: null },
      { id: 'seasonal-preserves', name: 'Seasonal Preserves',     swapGroup: null },
    ],
  },
};

const SWAP_OPTIONS = {
  bread: [
    { id: 'japanese-milk-loaf', name: 'Japanese Milk Loaf' },
    { id: 'whole-wheat-loaf',   name: 'Whole Wheat Loaf' },
    { id: 'focaccia-loaf',      name: 'Focaccia Loaf' },
  ],
  larder: [
    { id: 'garlic-chili-crunch', name: 'Garlic Chili Crunch' },
    { id: 'herb-dipping-oil',    name: 'Tuscany Herb Dipping Oil' },
    { id: 'seasonal-preserves',  name: 'Seasonal Preserves' },
  ],
};

const ADDON_OPTIONS = [
  { id: 'addon-yeast-rolls',    name: 'Extra Yeast Rolls (½ doz)',  price: 1600 },
  { id: 'addon-cinnamon-rolls', name: 'Extra Cinnamon Rolls (½ doz)', price: 3500 },
  { id: 'addon-butter',         name: 'Extra Real Cream Butter (½ lb)', price: 1700 },
  { id: 'addon-eggs',           name: 'Farm Eggs (1 doz)',           price: 1300 },
  { id: 'addon-preserves',      name: 'Seasonal Preserves',         price: 1500, priceLabel: '$15–$18' },
  { id: 'addon-chili-crunch',   name: 'Garlic Chili Crunch',        price: 1899 },
  { id: 'addon-herb-oil',       name: 'Tuscany Herb Dipping Oil',   price: 1699 },
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
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);flex:1;';
    nameSpan.textContent = item.name;
    row.appendChild(nameSpan);
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
      sel.onchange = () => { nameSpan.textContent = sel.options[sel.selectedIndex].text.replace(' ✓',''); };
      const swapWrap = document.createElement('div');
      swapWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;';
      const swapLabel = document.createElement('span');
      swapLabel.style.cssText = 'font-family:var(--font-sans);font-size:0.6rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-rust,#8B4A2F);';
      swapLabel.textContent = 'Swap';
      swapWrap.appendChild(swapLabel);
      swapWrap.appendChild(sel);
      row.appendChild(swapWrap);
    } else {
      const fixed = document.createElement('span');
      fixed.style.cssText = 'font-family:var(--font-sans);font-size:0.65rem;color:rgba(44,62,45,0.35);letter-spacing:0.06em;';
      fixed.textContent = 'included';
      row.appendChild(fixed);
    }
    itemsEl.appendChild(row);
  });

  // Render add-ons (hide ones already in the box)
  const boxItemIds = new Set(defaultItems.map(i => i.id));
  const addonsEl = document.getElementById('bc-addons');
  addonsEl.innerHTML = '';
  ADDON_OPTIONS.filter(a => !boxItemIds.has(a.id.replace('addon-',''))).forEach(addon => {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 16px;border:1px solid rgba(44,62,45,0.1);border-radius:10px;cursor:pointer;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = addon.id;
    cb.dataset.addonName = addon.name;
    cb.dataset.addonPrice = addon.price;
    cb.style.cssText = 'accent-color:var(--color-rust,#8B4A2F);width:16px;height:16px;flex-shrink:0;';
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-family:var(--font-sans);font-size:0.88rem;color:var(--color-green);flex:1;';
    nameSpan.textContent = addon.name;
    const priceSpan = document.createElement('span');
    priceSpan.style.cssText = 'font-family:var(--font-serif);font-size:0.95rem;color:var(--color-rust,#8B4A2F);white-space:nowrap;';
    priceSpan.textContent = addon.priceLabel ? addon.priceLabel : (addon.price === 0 ? '$0' : '$' + (addon.price / 100).toFixed(2).replace(/\.00$/, ''));
    label.appendChild(cb);
    label.appendChild(nameSpan);
    label.appendChild(priceSpan);
    addonsEl.appendChild(label);
  });

  // Continue → delivery modal
  document.getElementById('bc-continue').onclick = () => {
    const swaps = [...document.querySelectorAll('#bc-items select')].map(s => ({ from: s.dataset.originalId, to: s.value })).filter(s => s.from !== s.to);
    const addons = [...document.querySelectorAll('#bc-addons input:checked')].map(c => ({
      id: c.value,
      name: c.dataset.addonName,
      price: parseFloat(c.dataset.addonPrice) || 0,
    }));
    closeBoxCustomizer();
    openDeliveryModal(_bcPendingArgs.subId, _bcPendingArgs.name, _bcPendingArgs.price, swaps, addons);
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

function openDeliveryModal(subId, name, price, swaps = [], addons = []) {
  _pendingSubArgs = { subId, name, price, swaps, addons };
  const overlay = document.getElementById('delivery-modal-overlay');
  overlay.classList.add('open');
  applyShipMinimum(price);
  document.getElementById('dm-ship').onclick   = () => { closeDeliveryModal(); subscribe(_pendingSubArgs.subId, _pendingSubArgs.name, _pendingSubArgs.price, 'ship',   null, _pendingSubArgs.swaps, _pendingSubArgs.addons); };
  document.getElementById('dm-pickup').onclick = () => { closeDeliveryModal(); openPickupLocationModal(loc => subscribe(_pendingSubArgs.subId, _pendingSubArgs.name, _pendingSubArgs.price, 'pickup', loc, _pendingSubArgs.swaps, _pendingSubArgs.addons)); };
  document.getElementById('dm-cancel').onclick = closeDeliveryModal;
}

function closeDeliveryModal() {
  document.getElementById('delivery-modal-overlay')?.classList.remove('open');
  _pendingSubArgs = null;
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

// Restore cart from SMS abandon-link (?rc=TOKEN)
(function() {
  var params = new URLSearchParams(window.location.search);
  var rc = params.get('rc');
  if (!rc) return;
  fetch('/api/restore-cart?token=' + encodeURIComponent(rc))
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d || !d.items || !d.items.length) return;
      var cart = { items: [] };
      d.items.forEach(function(item) {
        var pid = Object.keys(PRODUCTS).find(function(k) { return PRODUCTS[k].name === item.name; });
        if (pid) cart.items.push({ id: pid, qty: item.quantity || item.qty || 1, price: item.price ?? PRODUCTS[pid].price });
      });
      if (cart.items.length) {
        localStorage.setItem('hoto-cart', JSON.stringify(cart));
        // Clean URL without reload
        var url = new URL(window.location.href);
        url.searchParams.delete('rc');
        window.history.replaceState({}, '', url.toString());
      }
    })
    .catch(function() {});
})();

document.addEventListener('DOMContentLoaded', () => {
  injectCartDrawer();
  injectCartIcon();
  injectSubscriberModal();
  injectDeliveryModal();
  injectPickupLocationModal();
  injectShipCalcModal();
  injectAddressConfirmModal();
  injectOrderDetailsModal();
  injectBoxCustomizer();
  renderCart();

  document.querySelectorAll('[data-add-to-cart]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.addToCart;
      if (PRODUCTS[id]?.subPrice) { openSubPrompt(id); } else { addItem(id); }
    });
  });

  document.querySelectorAll('[data-sub-id]').forEach(btn => {
    btn.addEventListener('click', () =>
      openBoxCustomizer(btn.dataset.subId, btn.dataset.subName, parseInt(btn.dataset.subPrice, 10))
    );
  });
});
