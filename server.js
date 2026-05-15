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
// START
// =========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Heart of Texas Organics running at http://localhost:${PORT}`);
});
