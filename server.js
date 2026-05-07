require('dotenv').config({ path: process.env.DOTENV_PATH || '/etc/secrets/.env' });
if (!process.env.STRIPE_SECRET_KEY) require('dotenv').config();
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const path     = require('path');
const fs       = require('fs');

const app = express();

// =========================================
// EMAIL
// =========================================

const mailer = nodemailer.createTransport({
  host: 'smtp-mail.outlook.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.OUTLOOK_USER,
    pass: process.env.OUTLOOK_PASSWORD,
  },
  tls: { ciphers: 'SSLv3' },
});

async function sendEmail(subject, html) {
  if (!process.env.OUTLOOK_PASSWORD || process.env.OUTLOOK_PASSWORD === 'your_outlook_password_here') {
    console.log('[Email skipped OUTLOOK_PASSWORD not set]\nSubject:', subject);
    return;
  }
  await mailer.sendMail({
    from: `"Heart of Texas Organics" <${process.env.OUTLOOK_USER}>`,
    to: process.env.OUTLOOK_USER,
    subject,
    html,
  });
  console.log('Email sent:', subject);
}

function formatMoney(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function lineItemsHtml(items) {
  if (!items || !items.length) return '<p style="color:#888;">No item details available.</p>';
  return `<table style="border-collapse:collapse;width:100%;max-width:500px;margin:16px 0;">
    ${items.map(li => `
      <tr>
        <td style="padding:8px 16px 8px 0;border-bottom:1px solid #eee;">${li.description}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">
          ${li.quantity} &times; ${formatMoney(li.price?.unit_amount)}
        </td>
      </tr>`).join('')}
  </table>`;
}

// =========================================
// ORDER TRACKING  (orders.json)
// =========================================

const ORDERS_FILE = path.join(__dirname, 'orders.json');

function readOrders() {
  try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); }
  catch { return {}; }
}

function saveOrder(paymentIntentId, data) {
  const orders = readOrders();
  orders[paymentIntentId] = {
    ...orders[paymentIntentId],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function fulfillmentBadge(status) {
  const map = {
    AWAITING_PAYMENT: { label: 'Awaiting Payment',  bg: '#FFF3CD', border: '#8B4A2F', icon: '⏳' },
    READY_TO_SHIP:    { label: 'Ready to Ship',      bg: '#D4EDDA', border: '#2C3E2D', icon: '✅' },
    PAYMENT_FAILED:   { label: 'Payment Failed',     bg: '#F8D7DA', border: '#dc3545', icon: '❌' },
  };
  const s = map[status] || map.AWAITING_PAYMENT;
  return `<div style="display:inline-block;background:${s.bg};border-left:4px solid ${s.border};
          padding:12px 20px;font-size:14px;font-weight:600;margin:16px 0;">
    ${s.icon} FULFILLMENT STATUS: ${s.label}
  </div>`;
}

// =========================================
// WEBHOOK  (must be before express.json())
// =========================================

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  console.log('Webhook received:', event.type);

  try {
    switch (event.type) {

      // --- New order submitted -------------------------------------------
      case 'checkout.session.completed': {
        const session = await stripe.checkout.sessions.retrieve(event.data.object.id, {
          expand: ['line_items'],
        });

        const isPaid = session.payment_status === 'paid';
        const total  = formatMoney(session.amount_total);
        const items  = session.line_items?.data ?? [];
        const date   = formatDate(session.created);
        const piId   = session.payment_intent;

        if (isPaid) {
          // Card money cleared immediately
          saveOrder(piId, {
            sessionId: session.id,
            status: 'READY_TO_SHIP',
            total: session.amount_total,
            items: items.map(li => ({ name: li.description, qty: li.quantity })),
            paymentMethod: 'card',
            created: new Date().toISOString(),
          });

          await sendEmail(
            `✅ New Order ${total} Ready to Ship`,
            `<h2 style="color:#2C3E2D;">New Order Payment Cleared</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Payment:</strong> Card (cleared immediately)</p>
             ${lineItemsHtml(items)}
             ${fulfillmentBadge('READY_TO_SHIP')}
             <p style="color:#888;font-size:12px;">Reference: ${session.id}</p>`
          );

        } else {
          // ACH bank info submitted money not yet transferred
          saveOrder(piId, {
            sessionId: session.id,
            status: 'AWAITING_PAYMENT',
            total: session.amount_total,
            items: items.map(li => ({ name: li.description, qty: li.quantity })),
            paymentMethod: 'us_bank_account',
            created: new Date().toISOString(),
          });

          await sendEmail(
            `⏳ New ACH Order ${total} DO NOT SHIP YET`,
            `<h2 style="color:#8B4A2F;">New ACH Order Awaiting Bank Settlement</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Payment:</strong> ACH Bank Transfer (3–5 business days to clear)</p>
             ${lineItemsHtml(items)}
             ${fulfillmentBadge('AWAITING_PAYMENT')}
             <p style="color:#888;font-size:12px;">
               You will receive a second email the moment funds clear.<br>
               Reference: ${session.id}
             </p>`
          );
        }
        break;
      }

      // ACH payment cleared safe to ship
      case 'payment_intent.succeeded': {
        const pi = event.data.object;

        // FIX: check the actual payment method TYPE used, not the allowed list.
        // pi.payment_method_types is always ['card','us_bank_account'] for all sessions
        // checking it would always evaluate to 'card' and skip ACH. Instead, retrieve
        // the actual PaymentMethod object and inspect its .type field.
        let pmType = null;
        if (pi.payment_method) {
          const pm = await stripe.paymentMethods.retrieve(pi.payment_method);
          pmType = pm.type;
        }

        // Card payments are handled at checkout.session.completed so skip them here
        if (pmType !== 'us_bank_account') break;

        // Retrieve originating session for line items
        const sessions = await stripe.checkout.sessions.list({
          payment_intent: pi.id,
          expand: ['data.line_items'],
          limit: 1,
        });
        const session = sessions.data[0];
        const items   = session?.line_items?.data ?? [];
        const total   = formatMoney(pi.amount_received);
        const date    = formatDate(pi.created);

        // Update fulfillment status
        saveOrder(pi.id, { status: 'READY_TO_SHIP', clearedAt: new Date().toISOString() });

        await sendEmail(
          `✅ ACH Cleared ${total} Ship This Order Now`,
          `<h2 style="color:#2C3E2D;">ACH Payment Settled Ship This Order</h2>
           <p><strong>Funds cleared:</strong> ${date}</p>
           <p><strong>Amount received:</strong> ${total}</p>
           ${lineItemsHtml(items)}
           ${fulfillmentBadge('READY_TO_SHIP')}
           <p style="color:#888;font-size:12px;">PaymentIntent: ${pi.id}</p>`
        );
        break;
      }

      // --- Payment failed ------------------------------------------------
      case 'payment_intent.payment_failed': {
        const pi    = event.data.object;
        const total = formatMoney(pi.amount);
        const reason = pi.last_payment_error?.message ?? 'Unknown reason';

        saveOrder(pi.id, { status: 'PAYMENT_FAILED', failedAt: new Date().toISOString(), reason });

        await sendEmail(
          `❌ Payment Failed ${total}`,
          `<h2 style="color:#dc3545;">Payment Failed</h2>
           <p><strong>Amount:</strong> ${total}</p>
           <p><strong>Reason:</strong> ${reason}</p>
           ${fulfillmentBadge('PAYMENT_FAILED')}
           <p>The customer may retry. Do not fulfill this order.</p>
           <p style="color:#888;font-size:12px;">PaymentIntent: ${pi.id}</p>`
        );
        break;
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err.message);
  }

  res.json({ received: true });
});

// =========================================
// MIDDLEWARE
// =========================================

app.use(express.json());

app.use((req, res, next) => {
  if (/\.(css|js)$/.test(req.path)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

// Coming soon redirect — send all HTML page routes to /coming-soon
// Static assets (images, css, js) and API routes pass through unchanged
const ALLOWED_PATHS = new Set([
  '/', '/coming-soon', '/coming-soon.html',
  '/success', '/success.html',
]);
app.use((req, res, next) => {
  const isAsset   = /\.(css|js|webp|jpg|jpeg|png|gif|svg|ico|woff2?|ttf)$/i.test(req.path);
  const isApi     = req.path.startsWith('/create-') || req.path === '/webhook';
  const isAllowed = ALLOWED_PATHS.has(req.path);
  if (!isAsset && !isApi && !isAllowed && req.method === 'GET') {
    return res.redirect(301, '/coming-soon');
  }
  next();
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// =========================================
// STRIPE CHECKOUT
// =========================================

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card', 'us_bank_account'],
      line_items: items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: item.name },
          unit_amount: item.price,
        },
        quantity: item.quantity,
      })),
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offerings.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/create-subscription-session', async (req, res) => {
  try {
    const { item } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: item.name },
          unit_amount: item.price,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offerings.html#subscriptions`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Subscription error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// COINBASE COMMERCE (BITCOIN)
// =========================================

app.post('/create-crypto-session', async (req, res) => {
  try {
    const { items } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;

    const totalCents  = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const description = items.map(i => `${i.quantity}× ${i.name}`).join(', ');

    const response = await fetch('https://api.commerce.coinbase.com/charges', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CC-Api-Key': process.env.COINBASE_COMMERCE_API_KEY,
        'X-CC-Version': '2018-03-22',
      },
      body: JSON.stringify({
        name: 'Heart of Texas Organics Order',
        description,
        pricing_type: 'fixed_price',
        local_price: { amount: (totalCents / 100).toFixed(2), currency: 'USD' },
        redirect_url: `${origin}/success.html`,
        cancel_url: `${origin}/offerings.html`,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Coinbase Commerce error');
    res.json({ url: data.data.hosted_url });
  } catch (err) {
    console.error('Crypto checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// START
// =========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Heart of Texas Organics running at http://localhost:${PORT}`);
});
