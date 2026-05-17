require('dotenv').config({ path: process.env.DOTENV_PATH || '/etc/secrets/.env' });
if (!process.env.STRIPE_SECRET_KEY) require('dotenv').config();
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const db       = require('./db');
let cron;
try { cron = require('node-cron'); } catch(e) { console.log('[Cron] node-cron not available'); }

const EasyPostClient = require('@easypost/api');
const easypost = process.env.EASYPOST_API_KEY ? new EasyPostClient(process.env.EASYPOST_API_KEY) : null;

const BHF_FROM_ADDRESS = {
  name:    'Heart of Texas Organics',
  street1: '100 Commons Rd Ste 7-121',
  city:    'Dripping Springs',
  state:   'TX',
  zip:     '78620',
  country: 'US',
};

// Update PICKUP_ADDRESS env var in Render when location is confirmed
const PICKUP_LOCATION = {
  name:    'Heart of Texas Organics — Local Pick-up',
  address: process.env.PICKUP_ADDRESS || 'Address TBD — contact us to arrange',
  hours:   process.env.PICKUP_HOURS   || 'Hours TBD',
  notes:   process.env.PICKUP_NOTES   || 'We will reach out to confirm your pick-up time.',
};

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

async function sendEmailTo(to, subject, html) {
  if (!process.env.OUTLOOK_PASSWORD || process.env.OUTLOOK_PASSWORD === 'your_outlook_password_here') {
    console.log('[Customer email skipped]\nTo:', to, '\nSubject:', subject);
    return;
  }
  await mailer.sendMail({
    from: `"Heart of Texas Organics" <${process.env.OUTLOOK_USER}>`,
    to,
    subject,
    html,
  });
  console.log('Customer email sent:', to, subject);
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
          deductStockForOrder(items, session.id);

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
          deductStockForOrder(items, session.id);

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

      // --- New subscription started --------------------------------------
      case 'customer.subscription.created': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const email = customer.email;
        if (!email) break;

        const amount    = sub.items.data[0]?.price?.unit_amount;
        const items     = sub.metadata?.items || 'your selected items';
        const siteUrl   = process.env.SITE_URL || 'https://heartoftexasorganics.onrender.com';
        const nextDate  = new Date(sub.current_period_end * 1000).toLocaleDateString('en-US', {
          timeZone: 'America/Chicago', dateStyle: 'full',
        });

        await sendEmailTo(email,
          'Your Heart of Texas Organics Subscription is Active',
          `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
            <img src="${siteUrl}/images/logo.png" alt="Heart of Texas Organics" style="height:52px;margin-bottom:28px;filter:brightness(0.3);" />
            <h2 style="color:#2C3E2D;margin:0 0 16px;">You're subscribed!</h2>
            <p style="color:#3d3d3d;line-height:1.8;">Thank you for joining the Heart of Texas Organics family. Here's a summary of your subscription:</p>
            <table style="width:100%;border-collapse:collapse;margin:24px 0;background:#fff;padding:24px;">
              <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2C3E2D;">Items</td><td style="padding:10px 16px;border-bottom:1px solid #eee;">${items}</td></tr>
              <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2C3E2D;">Monthly charge</td><td style="padding:10px 16px;border-bottom:1px solid #eee;">${formatMoney(amount)}</td></tr>
              <tr><td style="padding:10px 16px;font-weight:600;color:#2C3E2D;">Next charge</td><td style="padding:10px 16px;">${nextDate}</td></tr>
            </table>
            <a href="${siteUrl}/subscription-dashboard.html" style="display:inline-block;background:#2C3E2D;color:#F5F0E8;padding:14px 28px;text-decoration:none;font-family:sans-serif;font-size:0.85rem;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:24px;">Manage Your Subscription</a>
            <p style="color:#888;font-size:12px;line-height:1.7;">You can pause, skip, or cancel anytime from your dashboard. Questions? Reply to this email or visit our contact page.</p>
          </div>`
        );

        await sendEmail(
          `New Farm Subscription — ${formatMoney(amount)}/month`,
          `<h2 style="color:#2C3E2D;">New Subscription Started</h2>
           <p><strong>Customer:</strong> ${email}</p>
           <p><strong>Items:</strong> ${items}</p>
           <p><strong>Monthly charge:</strong> ${formatMoney(amount)}</p>
           <p><strong>Next charge:</strong> ${nextDate}</p>`
        );
        break;
      }

      // --- Upcoming charge reminder (fires 7 days before) ---------------
      case 'invoice.upcoming': {
        const invoice  = event.data.object;
        if (!invoice.subscription) break;
        const customer = await stripe.customers.retrieve(invoice.customer);
        const email    = customer.email;
        if (!email) break;

        const sub      = await stripe.subscriptions.retrieve(invoice.subscription);
        const items    = sub.metadata?.items || 'your monthly box';
        const siteUrl  = process.env.SITE_URL || 'https://heartoftexasorganics.onrender.com';
        const amount   = invoice.amount_due;
        const chargeTs = invoice.next_payment_attempt || sub.current_period_end;
        const chargeDate = new Date(chargeTs * 1000).toLocaleDateString('en-US', {
          timeZone: 'America/Chicago', dateStyle: 'full',
        });

        await sendEmailTo(email,
          `Reminder: ${formatMoney(amount)} charge coming up`,
          `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
            <h2 style="color:#2C3E2D;margin:0 0 16px;">Your box is almost here</h2>
            <p style="color:#3d3d3d;line-height:1.8;">Your monthly Heart of Texas Organics box is coming up. Here's what to expect:</p>
            <table style="width:100%;border-collapse:collapse;margin:24px 0;background:#fff;padding:24px;">
              <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2C3E2D;">Items</td><td style="padding:10px 16px;border-bottom:1px solid #eee;">${items}</td></tr>
              <tr><td style="padding:10px 16px;border-bottom:1px solid #eee;font-weight:600;color:#2C3E2D;">Amount</td><td style="padding:10px 16px;border-bottom:1px solid #eee;">${formatMoney(amount)}</td></tr>
              <tr><td style="padding:10px 16px;font-weight:600;color:#2C3E2D;">Charge date</td><td style="padding:10px 16px;">${chargeDate}</td></tr>
            </table>
            <p style="color:#3d3d3d;">Need to make changes before the charge? <a href="${siteUrl}/subscription-dashboard.html" style="color:#2C3E2D;">Visit your dashboard</a> to skip, modify, or cancel.</p>
          </div>`
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
  if (/\.(css|js|html)$/.test(req.path) || req.path === '/' || !req.path.includes('.')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});

app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// =========================================
// MAGAZINE SUBSCRIPTION  ($6.99 / month)
// =========================================

let _magazinePriceId = process.env.STRIPE_MAGAZINE_PRICE_ID || null;

async function getMagazinePriceId() {
  if (_magazinePriceId) return _magazinePriceId;
  const product = await stripe.products.create({
    name: 'Best Medicines Magazine',
    description: 'Monthly digital magazine — Heart of Texas Organics',
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: 699,
    currency: 'usd',
    recurring: { interval: 'month' },
  });
  _magazinePriceId = price.id;
  console.log('Magazine price created:', _magazinePriceId, '— add STRIPE_MAGAZINE_PRICE_ID to env to persist');
  return _magazinePriceId;
}

app.post('/create-magazine-subscription', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const priceId = await getMagazinePriceId();
    const origin  = `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/magazine.html?subscribed=1`,
      cancel_url:  `${origin}/magazine.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Magazine subscription error:', err.message);
    res.status(500).json({ error: 'Could not start subscription' });
  }
});

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
// CART SUBSCRIPTION  (Subscribe & Save 20%)
// =========================================

app.post('/create-cart-subscription', async (req, res) => {
  try {
    const { items } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    if (!items?.length) return res.status(400).json({ error: 'No items' });

    const weeklyTotal  = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const monthlyAmount = weeklyTotal * 4;
    const itemsLabel   = items.map(i => `${i.quantity}× ${i.name}`).join(', ');

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Heart of Texas Organics Monthly Box',
            description: itemsLabel,
          },
          unit_amount: monthlyAmount,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],
      subscription_data: { metadata: { items: itemsLabel } },
      allow_promotion_codes: true,
      success_url: `${origin}/subscription-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offerings.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Cart subscription error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/subscription-info', async (req, res) => {
  try {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id required' });

    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ['subscription'],
    });
    const sub = session.subscription;
    if (!sub) return res.status(404).json({ error: 'No subscription found' });

    res.json({
      subscriptionId: sub.id,
      customerId: sub.customer,
      status: sub.status,
      amount: sub.items.data[0]?.price?.unit_amount,
      nextCharge: sub.current_period_end,
      items: sub.metadata?.items || '',
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  } catch (err) {
    console.error('Subscription info error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/subscription-portal', async (req, res) => {
  try {
    const { customerId } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    if (!customerId) return res.status(400).json({ error: 'customerId required' });

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/subscription-dashboard.html`,
    });
    res.json({ url: portalSession.url });
  } catch (err) {
    console.error('Portal error:', err.message);
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
// SUBSTACK RSS FEED
// =========================================

const SUBSTACK_FEED = 'https://bestmedicinesmagazine.substack.com/feed';

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function extractCDATA(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function parseRSS(xml) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const raw   = match[1];
    const title   = extractCDATA(raw, 'title')       || extractTag(raw, 'title');
    const link    = extractTag(raw, 'link');
    const pubDate = extractTag(raw, 'pubDate');
    const desc    = extractCDATA(raw, 'description') || extractTag(raw, 'description') || '';

    let image = null;
    const enc   = raw.match(/<enclosure[^>]+url="([^"]+)"/);
    const media = raw.match(/<media:content[^>]+url="([^"]+)"/);
    const img   = desc.match(/<img[^>]+src="([^"]+)"/);
    if (enc)        image = enc[1];
    else if (media) image = media[1];
    else if (img)   image = img[1];

    const plain   = desc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const excerpt = plain.length > 200 ? plain.slice(0, 200).trimEnd() + '...' : plain;

    let dateStr = '';
    if (pubDate) {
      try { dateStr = new Date(pubDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
      catch { dateStr = pubDate; }
    }

    if (title && link) items.push({ title, link, date: dateStr, excerpt, image });
  }
  return items.slice(0, 12);
}

app.get('/substack-feed', async (req, res) => {
  try {
    const response = await fetch(SUBSTACK_FEED);
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const xml = await response.text();
    const articles = parseRSS(xml);
    res.setHeader('Cache-Control', 'public, max-age=900');
    res.json({ articles });
  } catch (err) {
    console.error('Substack feed error:', err.message);
    res.status(500).json({ error: 'Could not load feed', articles: [] });
  }
});

// =========================================
// CONTACT FORM
// =========================================

app.post('/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const subjectLabel = {
    order: 'Order Question',
    product: 'Product Question',
    subscription: 'Subscription',
    wholesale: 'Wholesale Inquiry',
    classes: 'Baking Classes',
    other: 'General',
  }[subject] || 'General';

  try {
    await sendEmail(
      `Contact Form: ${subjectLabel} from ${name}`,
      `<h2 style="color:#2C3E2D;">New Contact Form Submission</h2>
       <p><strong>Name:</strong> ${name}</p>
       <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
       <p><strong>Subject:</strong> ${subjectLabel}</p>
       <p><strong>Message:</strong></p>
       <p style="background:#F5F0E8;padding:16px;border-radius:4px;white-space:pre-wrap;">${message}</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Contact form email error:', err.message);
    res.status(500).json({ error: 'Email failed' });
  }
});

// =========================================
// INVENTORY MANAGEMENT
// =========================================

// --- Auth (in-memory sessions, 24h expiry) ---
const sessions = new Map();
function mkToken() { return crypto.randomBytes(32).toString('hex'); }
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const exp = sessions.get(token);
  if (!exp || Date.now() > exp) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// --- Stock map: Stripe product name → internal product ID ---
const PRODUCT_MAP = {
  'Japanese Milk Loaf':          'japanese-milk-loaf',
  'Cinnamon Rolls':              'cinnamon-rolls',
  'Whole Wheat Loaf':            'whole-wheat-loaf',
  'Yeast Rolls':                 'yeast-rolls',
  'Focaccia Loaf':               'focaccia-loaf',
  'Sourdough':                   'sourdough',
  'Challah':                     'challah',
  'Pasture-Raised Eggs':         'farm-eggs',
  'Real Cream Butter':           'cultured-butter',
  'Seasonal Preserves':          'seasonal-preserves',
  'Garlic Chili Crunch':         'garlic-chili-crunch',
  'Tuscany Herb Dipping Oil':    'herb-dipping-oil',
  'Tuscany Herb Bread Dipping Oil': 'herb-dipping-oil',
};

function deductStockForOrder(lineItems, orderId) {
  for (const item of lineItems) {
    const pid = PRODUCT_MAP[item.description] || PRODUCT_MAP[item.name];
    if (!pid) continue;
    const qty = item.quantity || 1;
    const result = db.adjustStock(pid, -qty);
    const before = result ? result.before : null;
    const after  = result ? result.after  : null;
    db.addTransaction(pid, 'sale', -qty, null, orderId, 'Stripe checkout', 'online', before, after);
  }
}

// --- Admin auth routes ---
app.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  const token = mkToken();
  sessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
  res.json({ token });
});

app.post('/admin/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  sessions.delete(token);
  res.json({ ok: true });
});

app.get('/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// --- Public stock endpoint (for website sold-out indicators) ---
app.get('/api/stock', (req, res) => {
  const rows = db.getAll().map(p => ({ id: p.id, name: p.name, stock: p.stock, reorder_level: p.reorder_level, allow_preorder: p.allow_preorder }));
  res.json(rows);
});

// --- Inventory CRUD ---
app.get('/admin/inventory', requireAdmin, (req, res) => {
  res.json(db.getAll());
});

app.put('/admin/inventory/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { reorder_level, price_cents, cost_cents, unit, allow_preorder } = req.body || {};
  const product = db.getProduct(id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const fields = {};
  if (reorder_level  != null) fields.reorder_level  = parseInt(reorder_level);
  if (price_cents    != null) fields.price_cents     = parseInt(price_cents);
  if (cost_cents     != null) fields.cost_cents      = parseInt(cost_cents);
  if (unit           != null) fields.unit            = unit;
  if (allow_preorder != null) fields.allow_preorder  = allow_preorder ? 1 : 0;
  db.updateProduct(id, fields);
  res.json({ ok: true });
});

app.post('/admin/inventory/:id/adjust', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { quantity, notes, channel } = req.body || {};
  if (quantity == null || isNaN(parseInt(quantity))) return res.status(400).json({ error: 'quantity required' });
  const qty = parseInt(quantity);
  if (!db.getProduct(id)) return res.status(404).json({ error: 'Product not found' });
  const result = db.adjustStock(id, qty);
  db.addTransaction(id, 'adjustment', qty, null, null, notes || null, channel || null, result.before, result.after);
  res.json({ ok: true, stock: result.after });
});

app.post('/admin/inventory/:id/restock', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { quantity, batch_number, notes, channel, prod_date, expiry_date, batch_cost_cents } = req.body || {};
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });
  if (!db.getProduct(id)) return res.status(404).json({ error: 'Product not found' });
  const result = db.adjustStock(id, qty);
  const extra = {};
  if (prod_date)         extra.prod_date        = prod_date;
  if (expiry_date)       extra.expiry_date       = expiry_date;
  if (batch_cost_cents != null) extra.batch_cost_cents = Math.round(parseFloat(batch_cost_cents) * 100);
  db.addTransaction(id, 'restock', qty, batch_number || null, null, notes || null, channel || null, result.before, result.after, extra);
  res.json({ ok: true, stock: result.after });
});

// --- Transaction history ---
app.get('/admin/transactions', requireAdmin, (req, res) => {
  const { product_id, date_from, date_to } = req.query;
  res.json(db.getTransactions(product_id || null, 150, date_from || null, date_to || null));
});

// --- Reports ---
app.get('/admin/reports/weekly', requireAdmin, (req, res) => {
  const sales = db.getSales(7);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

app.get('/admin/reports/monthly', requireAdmin, (req, res) => {
  const sales = db.getSales(30);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

app.get('/admin/reports/range', requireAdmin, (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to required (YYYY-MM-DD)' });
  const sales = db.getSales(0, date_from, date_to);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

// --- CSV export ---
app.get('/admin/export/csv', requireAdmin, (req, res) => {
  const { products, transactions: txns } = db.getAllForCSV();

  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  let csv = 'PRODUCTS\n';
  csv += 'name,category,stock,reorder_level,unit,price_cents,cost_cents\n';
  for (const p of products) {
    csv += [p.name, p.category, p.stock, p.reorder_level, p.unit, p.price_cents, p.cost_cents || 0].map(esc).join(',') + '\n';
  }

  csv += '\nTRANSACTIONS\n';
  csv += 'created_at,product_name,type,quantity,stock_before,stock_after,channel,batch_number,order_id,notes\n';
  for (const t of txns) {
    csv += [t.created_at, t.product_name, t.type, t.quantity, t.stock_before, t.stock_after, t.channel, t.batch_number, t.order_id, t.notes].map(esc).join(',') + '\n';
  }

  const filename = `inventory-export-${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// --- Send weekly report email on demand ---
app.post('/admin/reports/send-weekly', requireAdmin, async (req, res) => {
  try {
    const report = buildWeeklyReport();
    await sendEmail('Weekly Inventory Report — Heart of Texas Organics', report);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send weekly report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

function buildWeeklyReport() {
  const sales    = db.getSales(7);
  const products = db.getAll().sort((a, b) => a.stock - b.stock);
  const lowStock = products.filter(p => p.stock <= p.reorder_level);
  const totalRev = sales.reduce((s, r) => s + (r.revenue_cents || 0), 0);

  const salesRows = sales.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${r.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${r.units_sold}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">$${((r.revenue_cents || 0)/100).toFixed(2)}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="padding:8px 12px;color:#888;">No sales this week</td></tr>';

  const lowRows = lowStock.map(p => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">${p.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:${p.stock === 0 ? '#e74c3c' : '#e67e22'};font-weight:600;">${p.stock}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${p.reorder_level}</td>
    </tr>`).join('') || '<tr><td colspan="3" style="padding:8px 12px;color:#27ae60;">All products adequately stocked</td></tr>';

  return `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:32px;background:#F5F0E8;">
      <h2 style="color:#2C3E2D;margin:0 0 8px;">Weekly Inventory Report</h2>
      <p style="color:#888;margin:0 0 24px;">Week ending ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', dateStyle: 'full' })}</p>

      <h3 style="color:#2C3E2D;border-bottom:2px solid #2C3E2D;padding-bottom:8px;">Sales This Week</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;margin-bottom:8px;">
        <thead><tr style="background:#2C3E2D;color:#F5F0E8;">
          <th style="padding:8px 12px;text-align:left;">Product</th>
          <th style="padding:8px 12px;text-align:center;">Units Sold</th>
          <th style="padding:8px 12px;text-align:right;">Revenue</th>
        </tr></thead>
        <tbody>${salesRows}</tbody>
        <tfoot><tr style="background:#F5F0E8;font-weight:600;">
          <td style="padding:8px 12px;" colspan="2">Total Revenue</td>
          <td style="padding:8px 12px;text-align:right;">$${(totalRev/100).toFixed(2)}</td>
        </tr></tfoot>
      </table>

      <h3 style="color:#8B4A2F;border-bottom:2px solid #8B4A2F;padding-bottom:8px;margin-top:32px;">Low / Out of Stock</h3>
      <table style="width:100%;border-collapse:collapse;background:#fff;">
        <thead><tr style="background:#8B4A2F;color:#F5F0E8;">
          <th style="padding:8px 12px;text-align:left;">Product</th>
          <th style="padding:8px 12px;text-align:center;">Current Stock</th>
          <th style="padding:8px 12px;text-align:center;">Reorder At</th>
        </tr></thead>
        <tbody>${lowRows}</tbody>
      </table>
    </div>`;
}

// --- Weekly cron: Sundays 8am CT ---
if (cron) {
  cron.schedule('0 8 * * 0', async () => {
    try {
      console.log('[Cron] Sending weekly inventory report');
      const report = buildWeeklyReport();
      await sendEmail('Weekly Inventory Report — Heart of Texas Organics', report);
    } catch (err) {
      console.error('[Cron] Weekly report error:', err.message);
    }
  }, { timezone: 'America/Chicago' });
  console.log('[Cron] Weekly inventory report scheduled (Sundays 8am CT)');
}

// =========================================
// SHIPPING ESTIMATOR
// =========================================

const SHIPPING_CSV = path.join(__dirname, 'shipping-products.csv');
const OBSIDIAN_SHIPPING = '/Users/deborahsmith/Documents/collab/BehindHappyFaces/shipping-estimates';

const STANDARD_BOXES = [
  { name: 'Small',  l: 8,  w: 6,  h: 4  },
  { name: 'Medium', l: 12, w: 10, h: 6  },
  { name: 'Large',  l: 16, w: 12, h: 8  },
  { name: 'XL',     l: 20, w: 16, h: 12 },
  { name: 'XXL',    l: 24, w: 18, h: 18 },
  { name: '2XL',    l: 30, w: 20, h: 20 },
];

function readShippingProducts() {
  if (!fs.existsSync(SHIPPING_CSV)) return [];
  const lines = fs.readFileSync(SHIPPING_CSV, 'utf8').trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).filter(Boolean).map(line => {
    const [name, product_weight_lbs, packaging_weight_lbs, length_in, width_in, height_in] = line.split(',');
    return {
      name: name.trim(),
      product_weight_lbs:   parseFloat(product_weight_lbs)   || 0,
      packaging_weight_lbs: parseFloat(packaging_weight_lbs) || 0,
      length_in:  parseFloat(length_in),
      width_in:   parseFloat(width_in),
      height_in:  parseFloat(height_in),
    };
  });
}

function writeShippingProducts(products) {
  const header = 'name,product_weight_lbs,packaging_weight_lbs,length_in,width_in,height_in';
  const rows   = products.map(p =>
    `${p.name},${p.product_weight_lbs},${p.packaging_weight_lbs},${p.length_in},${p.width_in},${p.height_in}`
  );
  fs.writeFileSync(SHIPPING_CSV, [header, ...rows, ''].join('\n'));
}

function calcShipment(items) {
  const totalWeight = items.reduce((s, i) => s + ((i.product_weight_lbs || 0) + (i.packaging_weight_lbs || 0)) * i.qty, 0);
  const totalVolume = items.reduce((s, i) => s + i.length_in * i.width_in * i.height_in * i.qty, 0);
  const buffered    = Math.ceil(totalVolume * 1.3);
  const maxDim      = Math.max(...items.map(i => Math.max(i.length_in, i.width_in, i.height_in)));
  const gelPacks    = Math.max(1, Math.ceil(totalWeight / 5));
  let box = STANDARD_BOXES[STANDARD_BOXES.length - 1];
  for (const b of STANDARD_BOXES) {
    if (b.l * b.w * b.h >= buffered && Math.max(b.l, b.w, b.h) >= maxDim) { box = b; break; }
  }
  return { totalWeight: parseFloat(totalWeight.toFixed(1)), totalVolume: Math.round(totalVolume), buffered, gelPacks, box };
}

app.get('/admin/shipping/products', requireAdmin, (req, res) => {
  res.json(readShippingProducts());
});

app.post('/admin/shipping/products', requireAdmin, (req, res) => {
  const { name, product_weight_lbs, packaging_weight_lbs, length_in, width_in, height_in } = req.body;
  if (!name || [product_weight_lbs, length_in, width_in, height_in].some(v => isNaN(parseFloat(v)))) {
    return res.status(400).json({ error: 'Name, product weight, and dimensions are required' });
  }
  const products = readShippingProducts();
  if (products.find(p => p.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: 'Product already exists' });
  }
  const product = {
    name: name.trim(),
    product_weight_lbs:   parseFloat(product_weight_lbs),
    packaging_weight_lbs: parseFloat(packaging_weight_lbs) || 0,
    length_in:  parseFloat(length_in),
    width_in:   parseFloat(width_in),
    height_in:  parseFloat(height_in),
  };
  products.push(product);
  writeShippingProducts(products);
  res.json(product);
});

app.put('/admin/shipping/products/:idx', requireAdmin, (req, res) => {
  const products = readShippingProducts();
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= products.length) return res.status(404).json({ error: 'Not found' });
  const { name, product_weight_lbs, packaging_weight_lbs, length_in, width_in, height_in } = req.body;
  products[idx] = {
    name: name.trim(),
    product_weight_lbs:   parseFloat(product_weight_lbs)   || 0,
    packaging_weight_lbs: parseFloat(packaging_weight_lbs) || 0,
    length_in:  parseFloat(length_in),
    width_in:   parseFloat(width_in),
    height_in:  parseFloat(height_in),
  };
  writeShippingProducts(products);
  res.json(products[idx]);
});

app.put('/admin/shipping/reorder', requireAdmin, (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products)) return res.status(400).json({ error: 'products array required' });
  writeShippingProducts(products);
  res.json({ ok: true });
});

app.delete('/admin/shipping/products/:idx', requireAdmin, (req, res) => {
  const products = readShippingProducts();
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= products.length) return res.status(404).json({ error: 'Not found' });
  const [removed] = products.splice(idx, 1);
  writeShippingProducts(products);
  res.json(removed);
});

app.post('/admin/shipping/estimate', requireAdmin, (req, res) => {
  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'No items provided' });
  const result = calcShipment(items);
  res.json(result);
});

app.post('/admin/shipping/save-estimate', requireAdmin, (req, res) => {
  const { items, result } = req.body;
  if (!items?.length || !result) return res.status(400).json({ error: 'Missing data' });

  const now     = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 5);
  const productRows = items.map(i => {
    const vol      = Math.round(i.length_in * i.width_in * i.height_in * i.qty);
    const prodWt   = ((i.product_weight_lbs   || 0) * i.qty).toFixed(1);
    const pkgWt    = ((i.packaging_weight_lbs || 0) * i.qty).toFixed(1);
    const totalWt  = (((i.product_weight_lbs || 0) + (i.packaging_weight_lbs || 0)) * i.qty).toFixed(1);
    return `| ${i.name} | ${i.qty} | ${prodWt} | ${pkgWt} | ${totalWt} | ${vol} |`;
  }).join('\n');

  const markdown = `---
title: Shipment Estimate — ${dateStr}
date: ${dateStr}
tags: [shipping, bhf, estimate]
---

# Shipment Estimate — ${dateStr} ${timeStr}

## Products

| Product | Qty | Product Wt (lbs) | Pkg Wt (lbs) | Total Wt (lbs) | Volume (cu in) |
|---------|-----|-----------------|-------------|----------------|----------------|
${productRows}

## Totals

| | |
|---|---|
| **Total Weight** | ${result.totalWeight} lbs |
| **Total Volume** | ${result.totalVolume} cu in (${result.buffered} cu in with 30% buffer) |
| **Gel Packs Needed** | ${result.gelPacks} |
| **Recommended Box** | ${result.box.name} — ${result.box.l}×${result.box.w}×${result.box.h} in |

## Notes

<!-- Add carrier, tracking, recipient, etc. -->
`;

  try {
    if (!fs.existsSync(OBSIDIAN_SHIPPING)) fs.mkdirSync(OBSIDIAN_SHIPPING, { recursive: true });
    const ts       = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `estimate-${ts}.md`;
    fs.writeFileSync(path.join(OBSIDIAN_SHIPPING, filename), markdown);
    res.json({ saved: true, filename });
  } catch (err) {
    res.status(500).json({ error: 'Could not write to Obsidian: ' + err.message });
  }
});

// =========================================
// EASYPOST — RATES, LABELS, PICKUP
// =========================================

app.get('/admin/shipping/pickup-location', requireAdmin, (req, res) => {
  res.json(PICKUP_LOCATION);
});

// POST /admin/shipping/rates
// body: { to:{name,street1,city,state,zip,phone?}, weight_lbs, length, width, height }
app.post('/admin/shipping/rates', requireAdmin, async (req, res) => {
  if (!easypost) return res.status(503).json({ error: 'EasyPost not configured — set EASYPOST_API_KEY in environment variables' });
  try {
    const { to, weight_lbs, length, width, height } = req.body;
    const shipment = await easypost.Shipment.create({
      from_address: BHF_FROM_ADDRESS,
      to_address:   to,
      parcel: {
        length,
        width,
        height,
        weight: Math.ceil((weight_lbs || 0.1) * 16), // EasyPost uses ounces
      },
    });
    const rates = (shipment.rates || [])
      .map(r => ({
        id:            r.id,
        carrier:       r.carrier,
        service:       r.service,
        rate:          r.rate,
        currency:      r.currency,
        delivery_days: r.delivery_days,
        delivery_date: r.delivery_date,
      }))
      .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
    res.json({ shipment_id: shipment.id, rates });
  } catch (e) {
    res.status(500).json({ error: e.message || 'EasyPost error' });
  }
});

// POST /admin/shipping/buy-label
// body: { shipment_id, rate_id }
app.post('/admin/shipping/buy-label', requireAdmin, async (req, res) => {
  if (!easypost) return res.status(503).json({ error: 'EasyPost not configured' });
  try {
    const { shipment_id, rate_id } = req.body;
    const purchased = await easypost.Shipment.buy(shipment_id, rate_id);
    res.json({
      tracking_code: purchased.tracking_code,
      label_url:     purchased.postage_label?.label_url,
      carrier:       purchased.selected_rate?.carrier,
      service:       purchased.selected_rate?.service,
      price:         purchased.selected_rate?.rate,
    });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not purchase label' });
  }
});

// =========================================
// START
// =========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Heart of Texas Organics running at http://localhost:${PORT}`);
});
