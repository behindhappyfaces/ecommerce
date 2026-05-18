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
  injectAddressConfirmModal();
  injectOrderDetailsModal();
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
