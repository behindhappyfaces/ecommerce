require('dotenv').config({ path: process.env.DOTENV_PATH || '/etc/secrets/.env' });
if (!process.env.STRIPE_SECRET_KEY) require('dotenv').config();
const express  = require('express');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const db       = require('./db');
let cron;
try { cron = require('node-cron'); } catch(e) { console.log('[Cron] node-cron not available'); }

// =========================================
// GOOGLE SHEETS CRM
// =========================================
const SHEETS_SPREADSHEET_ID = '1rJhUBYaDROIzL_plpLLffnAUv-dyy-4VvAIOjSY0pXY';
const SHEETS_SOURCES = ['BNI','Instagram','Facebook','Farmers Market','Word of Mouth','Website','Email / Newsletter','Referral','Text Message','Other'];

let sheetsClient = null;
(function initSheets() {
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!creds) { console.log('[Sheets] GOOGLE_SERVICE_ACCOUNT_JSON not set — CRM logging disabled'); return; }
  try {
    const { google } = require('googleapis');
    const key = JSON.parse(Buffer.from(creds, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClient = google.sheets({ version: 'v4', auth });
    console.log('[Sheets] Google Sheets CRM ready');
  } catch(e) { console.warn('[Sheets] Init failed:', e.message); }
})();

async function sheetsEnsureTab(tabName) {
  if (!sheetsClient) return;
  const meta = await sheetsClient.spreadsheets.get({ spreadsheetId: SHEETS_SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheetsClient.spreadsheets.batchUpdate({
      spreadsheetId: SHEETS_SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    // Add header row
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEETS_SPREADSHEET_ID,
      range: `${tabName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Date', 'Name', 'Email', 'Phone', 'Items', 'Total', 'Source', 'Notes', 'Cart Link']] },
    });
  }
}

async function sheetsRecordCustomer({ name, email, phone, source, items = [], total, note, cartUrl }) {
  if (!sheetsClient) return false;
  const date    = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago' });
  const itemStr = items.map(i => `${i.name} ${i.qty} ${i.price}`).join(' | ');
  const row     = [date, name || '', email || '', phone || '', itemStr, total || '', source || '', note || '', cartUrl || ''];
  const tabs    = ['All Customers', source && SHEETS_SOURCES.includes(source) ? source : null].filter(Boolean);
  for (const tab of tabs) {
    await sheetsEnsureTab(tab);
    await sheetsClient.spreadsheets.values.append({
      spreadsheetId: SHEETS_SPREADSHEET_ID,
      range: `${tab}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] },
    });
  }
  return true;
}

// Twilio — loads only when credentials are configured
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('[Twilio] SMS client ready');
  } catch(e) { console.warn('[Twilio] Failed to load:', e.message); }
} else {
  console.log('[Twilio] Credentials not set — SMS reminders disabled');
}

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

const { Resend } = require('resend');
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'operations@heartoftexasorganics.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || FROM_EMAIL;

// Nodemailer SMTP transporter — used when RESEND_API_KEY is not set
let smtpTransporter = null;
if (!resendClient && process.env.OUTLOOK_USER && process.env.OUTLOOK_PASSWORD &&
    !process.env.OUTLOOK_PASSWORD.includes('your_')) {
  smtpTransporter = nodemailer.createTransport({
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
    auth: { user: process.env.OUTLOOK_USER, pass: process.env.OUTLOOK_PASSWORD },
    tls: { ciphers: 'SSLv3' },
  });
  console.log('[Email] Using SMTP via Outlook');
} else if (resendClient) {
  console.log('[Email] Using Resend');
} else {
  console.warn('[Email] No email transport configured — set RESEND_API_KEY or OUTLOOK_PASSWORD in .env');
}

async function sendEmailViaSmtp(to, subject, html, attachments = []) {
  const msg = {
    from: `Heart of Texas Organics <${process.env.OUTLOOK_USER}>`,
    to,
    subject,
    html,
  };
  if (attachments.length) {
    msg.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
  }
  await smtpTransporter.sendMail(msg);
}

async function sendEmail(subject, html) {
  if (resendClient) {
    const { error } = await resendClient.emails.send({
      from: `Heart of Texas Organics <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    if (error) throw new Error(error.message);
  } else if (smtpTransporter) {
    await sendEmailViaSmtp(ADMIN_EMAIL, subject, html);
  } else {
    console.log('[Email skipped — no transport configured]\nSubject:', subject);
    return;
  }
  console.log('Admin email sent:', subject);
}

async function sendEmailTo(to, subject, html, attachments = [], text = '') {
  if (resendClient) {
    const payload = {
      from: `Heart of Texas Organics <${FROM_EMAIL}>`,
      reply_to: FROM_EMAIL,
      to,
      subject,
      html,
      ...(text && { text }),
    };
    if (attachments.length) {
      payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    const { error } = await resendClient.emails.send(payload);
    if (error) throw new Error(error.message);
  } else if (smtpTransporter) {
    const msg = {
      from: `Heart of Texas Organics <${process.env.OUTLOOK_USER}>`,
      replyTo: FROM_EMAIL,
      to,
      subject,
      html,
      ...(text && { text }),
    };
    if (attachments.length) {
      msg.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    await smtpTransporter.sendMail(msg);
  } else {
    console.log('[Customer email skipped — no transport configured]\nTo:', to, '\nSubject:', subject);
    return;
  }
  console.log('Customer email sent:', to, subject);
}

function generateReceiptPDF(order) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const green  = '#2C3E2D';
    const rust   = '#8B4A2F';
    const gray   = '#555555';
    const lgray  = '#888888';
    const lgreen = '#D4EDDA';

    // Header
    doc.fontSize(20).fillColor(green).text('Heart of Texas Organics', { align: 'center' });
    doc.fontSize(10).fillColor(lgray).text('heartoftexasorganics.com  ·  orders@heartoftexasorganics.com', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor(green).stroke();
    doc.moveDown(0.8);

    // Receipt title
    doc.fontSize(15).fillColor(rust).text('Order Receipt', { align: 'center' });
    doc.moveDown(0.5);

    // Order meta
    const orderDate = order.created
      ? new Date(order.created).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'long', timeStyle: 'short' })
      : 'N/A';
    doc.fontSize(10).fillColor(gray);
    doc.text(`Date: ${orderDate}`);
    doc.text(`Order Ref: ${order.sessionId || 'N/A'}`);
    doc.text(`Customer: ${order.customerName || 'N/A'}`);
    if (order.customerEmail) doc.text(`Email: ${order.customerEmail}`);
    doc.moveDown(0.8);

    // Items table header
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(green).font('Helvetica-Bold');
    doc.text('Item', 56, doc.y, { width: 300, continued: true });
    doc.text('Qty', 356, doc.y, { width: 60, align: 'center', continued: true });
    doc.text('Price', 416, doc.y, { width: 140, align: 'right' });
    doc.moveDown(0.3);
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.3);

    // Items rows
    doc.font('Helvetica').fillColor(gray);
    const items = order.items || [];
    for (const item of items) {
      const rowY = doc.y;
      doc.text(item.name || '', 56, rowY, { width: 300 });
      const textH = doc.y - rowY;
      doc.text(String(item.qty || item.quantity || 1), 356, rowY, { width: 60, align: 'center' });
      if (item.price != null) {
        doc.text('$' + (item.price / 100).toFixed(2), 416, rowY, { width: 140, align: 'right' });
      }
      doc.y = rowY + Math.max(textH, 16);
      doc.moveDown(0.2);
    }

    doc.moveDown(0.3);
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.4);

    // Total
    doc.font('Helvetica-Bold').fillColor(green).fontSize(11);
    const totalStr = order.total != null ? '$' + (order.total / 100).toFixed(2) : 'N/A';
    doc.text('Total', 56, doc.y, { width: 300 + 60, continued: true });
    doc.text(totalStr, 416, doc.y, { width: 140, align: 'right' });
    doc.moveDown(1.2);

    // Delivery info
    doc.font('Helvetica-Bold').fillColor(rust).fontSize(10).text('Delivery Information');
    doc.font('Helvetica').fillColor(gray);
    if (order.deliveryMethod === 'pickup') {
      doc.text(`Method: Local Pick-up${order.pickupLocation ? ' — ' + order.pickupLocation : ''}`);
      if (order.pickupAddress) doc.text(`Address: ${order.pickupAddress}`);
      if (order.pickupPhone)   doc.text(`Phone: ${order.pickupPhone}`);
      if (order.pickupEmail)   doc.text(`Contact Email: ${order.pickupEmail}`);
      if (order.pickupCommPref) {
        const prefs = order.pickupCommPref.split(',').map((v, i) => `${i === 0 ? '1st' : '2nd'}: ${v.charAt(0).toUpperCase() + v.slice(1)}`).join(' · ');
        doc.text(`Preferred Contact: ${prefs}`);
      }
      doc.moveDown(0.4);
      doc.fillColor(rust).text('We will reach out to confirm your pick-up time and location.');
    } else if (order.shippingAddress) {
      const sa = order.shippingAddress;
      doc.text(`Method: Shipped`);
      doc.text(`Ship to: ${sa.name || ''}, ${sa.street || ''}, ${sa.city || ''}, ${sa.state || ''} ${sa.zip || ''}`);
    }
    doc.moveDown(1.2);

    // Footer
    doc.moveTo(56, doc.y).lineTo(556, doc.y).strokeColor(green).stroke();
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor(lgray).text(
      'Thank you for supporting Heart of Texas Organics! Questions? Reply to this email or visit heartoftexasorganics.com.',
      { align: 'center' }
    );

    doc.end();
  });
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

const ORDERS_FILE        = path.join(__dirname, 'orders.json');
const PENDING_CARTS_FILE = path.join(__dirname, 'pending-carts.json');

// ── Pending carts — PostgreSQL-backed so tokens survive Render redeploys ──
const { Pool: PgPool } = require('pg');
let _pcPool = null;
function getPcPool() {
  if (!_pcPool && process.env.DATABASE_URL) {
    _pcPool = new PgPool({ connectionString: process.env.DATABASE_URL });
  }
  return _pcPool;
}
async function ensurePcTable() {
  const pg = getPcPool();
  if (!pg) return;
  await pg.query(`CREATE TABLE IF NOT EXISTS pending_carts (
    token TEXT PRIMARY KEY,
    data  JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}
ensurePcTable().catch(e => console.warn('[PendingCarts] table init failed:', e.message));

// ── Delivery Promo Codes ─────────────────────────────────────────────────────
async function ensureDeliveryPromosTable() {
  const pg = getPcPool();
  if (!pg) return;
  await pg.query(`CREATE TABLE IF NOT EXISTS delivery_promos (
    code      TEXT PRIMARY KEY,
    pct_off   INT  NOT NULL CHECK (pct_off > 0 AND pct_off <= 100),
    active    BOOL NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}
ensureDeliveryPromosTable().catch(e => console.warn('[DeliveryPromos] table init failed:', e.message));

async function ensureRecipeAccessCodesTable() {
  const pg = getPcPool();
  if (!pg) return;
  await pg.query(`CREATE TABLE IF NOT EXISTS recipe_access_codes (
    code             TEXT PRIMARY KEY,
    name             TEXT NOT NULL DEFAULT '',
    email            TEXT NOT NULL,
    paid             BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_session_id TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )`);
}
ensureRecipeAccessCodesTable().catch(e => console.warn('[RecipeCodes] table init failed:', e.message));

async function ensureWaitlistTable() {
  const pg = getPcPool();
  if (!pg) return;
  await pg.query(`CREATE TABLE IF NOT EXISTS product_waitlist (
    id           SERIAL PRIMARY KEY,
    product_id   TEXT NOT NULL,
    product_name TEXT NOT NULL,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL,
    phone        TEXT,
    contacted    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW()
  )`);
  // Table may already exist from before the `contacted` column was added
  await pg.query(`ALTER TABLE product_waitlist ADD COLUMN IF NOT EXISTS contacted BOOLEAN NOT NULL DEFAULT FALSE`);
}
ensureWaitlistTable().catch(e => console.warn('[Waitlist] table init failed:', e.message));

// --- Social media content calendar ---
const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'substack'];

async function ensureSocialPostsTable() {
  const pg = getPcPool();
  if (!pg) return;
  await pg.query(`CREATE TABLE IF NOT EXISTS social_posts (
    id            SERIAL PRIMARY KEY,
    platforms     TEXT[] NOT NULL,
    caption       TEXT NOT NULL,
    image_url     TEXT,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    status        TEXT NOT NULL DEFAULT 'scheduled',
    posted_at     TIMESTAMPTZ,
    error         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`);
}
ensureSocialPostsTable().catch(e => console.warn('[SocialPosts] table init failed:', e.message));

// No platform has an approved auto-posting integration yet (Meta App Review /
// TikTok audit pending, Substack has no official API). Until credentials for a
// given platform are wired in below, every post falls back to emailing the
// admin the ready-to-publish content so nothing blocks on that approval.
// When a platform's API access comes through, add a real branch here (e.g.
// call the Instagram Graph API) and only fall back to email for the rest.
async function publishSocialPost(post) {
  const platformList = post.platforms.join(', ');
  await sendEmail(
    `Ready to post: ${post.caption.slice(0, 60)}${post.caption.length > 60 ? '…' : ''}`,
    `<p><strong>Scheduled for:</strong> ${new Date(post.scheduled_at).toLocaleString()}</p>
     <p><strong>Platforms:</strong> ${escHtml(platformList)}</p>
     ${post.image_url ? `<p><img src="${escHtml(post.image_url)}" style="max-width:400px;display:block;margin:8px 0;" /></p>` : ''}
     <p><strong>Caption:</strong></p>
     <p style="white-space:pre-wrap;">${escHtml(post.caption)}</p>
     <p style="color:#888;font-size:0.85rem;">Copy this into each platform above to publish it &mdash; auto-posting isn't live yet for any of them.</p>`
  );
  return { ok: true, mode: 'email_fallback' };
}

if (cron) {
  // Every 15 minutes — send any due social posts for manual publishing
  cron.schedule('*/15 * * * *', async () => {
    const pg = getPcPool();
    if (!pg) return;
    try {
      const { rows } = await pg.query(
        `SELECT * FROM social_posts WHERE status = 'scheduled' AND scheduled_at <= NOW()`
      );
      for (const post of rows) {
        try {
          await publishSocialPost(post);
          await pg.query(
            `UPDATE social_posts SET status = 'sent_for_review', posted_at = NOW() WHERE id = $1`,
            [post.id]
          );
        } catch (e) {
          await pg.query(
            `UPDATE social_posts SET status = 'failed', error = $2 WHERE id = $1`,
            [post.id, e.message]
          );
        }
      }
    } catch (e) {
      console.warn('[SocialPosts] cron check failed:', e.message);
    }
  });
}

async function readPendingCartsDB() {
  const pg = getPcPool();
  if (!pg) return readPendingCarts(); // fallback to file
  const { rows } = await pg.query('SELECT token, data FROM pending_carts');
  const obj = {};
  rows.forEach(r => { obj[r.token] = r.data; });
  return obj;
}
async function getPendingCartDB(token) {
  const pg = getPcPool();
  if (!pg) return readPendingCarts()[token] || null;
  const { rows } = await pg.query('SELECT data FROM pending_carts WHERE token = $1', [token]);
  return rows[0] ? rows[0].data : null;
}
async function setPendingCartDB(token, data) {
  const pg = getPcPool();
  if (!pg) {
    const carts = readPendingCarts();
    carts[token] = data;
    writePendingCarts(carts);
    return;
  }
  await pg.query(
    `INSERT INTO pending_carts (token, data) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET data = EXCLUDED.data`,
    [token, JSON.stringify(data)]
  );
}
async function updatePendingCartDB(token, updates) {
  const existing = await getPendingCartDB(token);
  if (!existing) return;
  await setPendingCartDB(token, { ...existing, ...updates });
}


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

function readPendingCarts() {
  try { return JSON.parse(fs.readFileSync(PENDING_CARTS_FILE, 'utf8')); }
  catch { return {}; }
}

function writePendingCarts(carts) {
  fs.writeFileSync(PENDING_CARTS_FILE, JSON.stringify(carts, null, 2));
}

// Normalize any phone format → E.164 (+1XXXXXXXXXX)
function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  return null;
}

const SITE_URL_BASE = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';

const SMS_MESSAGES = [
  // reminder 0 — 1 hour
  (cart) => `Hey! 🌾 Your Heart of Texas cart is waiting — ${cart.itemSummary} and more, made fresh with zero shortcuts. You're SO close to something real! Grab it here: ${SITE_URL_BASE}/offerings.html?rc=${cart.token} · Reply STOP to opt out`,
  // reminder 1 — 4 hours
  (cart) => `Psst... 🍞✨ Those ${cart.itemSummary} in your Heart of Texas cart won't bake themselves! Real food, raised right here in Texas — finish your order before the batch is gone: ${SITE_URL_BASE}/offerings.html?rc=${cart.token} · Reply STOP to opt out`,
  // reminder 2 — 24 hours
  (cart) => `Last nudge, we promise! 🌻 Your Heart of Texas goodies are still waiting. Handmade, farm-fresh, no shortcuts EVER — but they do go fast. Don't miss out: ${SITE_URL_BASE}/offerings.html?rc=${cart.token} · Reply STOP to opt out`,
];

async function sendAbandonedCartSMS(cart, reminderIndex) {
  if (!twilioClient || !process.env.TWILIO_FROM_NUMBER) return false;
  const to = cart.phone;
  if (!to) return false;
  const body = SMS_MESSAGES[reminderIndex](cart);
  try {
    await twilioClient.messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body });
    console.log(`[SMS] Reminder ${reminderIndex + 1} sent to ${to.slice(0,6)}***`);
    return true;
  } catch(e) {
    console.warn('[SMS] Send failed:', e.message);
    return false;
  }
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
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET_ORDERS || process.env.STRIPE_WEBHOOK_SECRET);
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

        const customerEmail  = session.customer_details?.email;
        const customerName   = session.customer_details?.name || 'Valued Customer';
        const deliveryMethod = session.metadata?.delivery_method || 'ship';
        const shippingAddr   = session.shipping_details?.address;
        const siteUrl        = process.env.SITE_URL || 'https://heartoftexasorganics.com';

        // Track bundle sales
        if (session.metadata?.type === 'bundle' && isPaid) {
          const sales = getBundleSales();
          sales.sold = Math.min(BUNDLE_TOTAL, sales.sold + 1);
          const processing = session.metadata?.processing || 'no';
          const bread = session.metadata?.bread || 'challah';

          // Full order details captured for the backend / inventory system
          const dMethod  = session.metadata?.delivery_method || 'pickup';
          const dAddr    = [
            session.metadata?.delivery_street,
            session.metadata?.delivery_city,
            session.metadata?.delivery_state,
            session.metadata?.delivery_zip,
          ].filter(Boolean).join(', ');
          const dMiles   = session.metadata?.delivery_miles || '';
          const dPhone   = session.customer_details?.phone || '';
          const dNotes   = (session.custom_fields || []).find(f => f.key === 'order_notes')?.text?.value || '';
          const dFeeCents = (items.find(li => li.description === 'Local Delivery Fee')?.amount_total) || 0;

          sales.orders.push({
            name: customerName, email: customerEmail, phone: dPhone, date,
            sessionId: session.id, channel: 'online', processing, bread,
            deliveryMethod: dMethod,
            deliveryAddress: dAddr,
            deliveryMiles: dMiles,
            deliveryFeeCents: dFeeCents,
            total: session.amount_total,
            notes: dNotes,
          });
          saveBundleSales(sales);
          console.log(`[Bundle] Sale #${sales.sold} — ${customerName} (${customerEmail}) · ${dMethod}${dAddr ? ' → ' + dAddr : ''}`);

          // Log to inventory system for dashboard reporting
          try {
            const inv = await db.getProduct('bundle-4th-july');
            const stockBefore = inv ? inv.stock : 25;
            const stockAfter  = Math.max(0, stockBefore - 1);
            await db.adjustStock('bundle-4th-july', -1);
            const deliveryNote = dMethod === 'delivery'
              ? `Delivery to ${dAddr}${dMiles ? ` (${dMiles}mi, $${(dFeeCents / 100).toFixed(2)} fee)` : ''}`
              : 'Local pickup';
            await db.addTransaction(
              'bundle-4th-july', 'sale', -1,
              null, session.id,
              `${deliveryNote} · Bread: ${bread} · ${customerName} <${customerEmail}>${dPhone ? ' · ' + dPhone : ''}${dNotes ? ' · Notes: ' + dNotes : ''}`,
              'online', stockBefore, stockAfter
            );
          } catch (e) {
            console.error('[Bundle] Inventory log error:', e.message);
          }
        }

        // Product items only (exclude the shipping line item for display)
        const productItems   = items.filter(li => !li.description?.startsWith('Shipping —'));
        const shippingItem   = items.find(li => li.description?.startsWith('Shipping —'));

        // Customer-entered notes / delivery instructions (Stripe custom field)
        const customerNotes  = (session.custom_fields || [])
          .find(f => f.key === 'order_notes')?.text?.value || '';
        const notesHtml = customerNotes
          ? `<div style="background:#f0ede4;border-left:4px solid #2C3E2D;padding:12px 20px;margin:16px 0;font-size:0.9rem;">
               <strong>📝 Order Notes</strong>
               <p style="margin:6px 0 0;color:#555;">${escHtml(customerNotes)}</p>
             </div>`
          : '';

        const pickupLoc      = session.metadata?.pickup_location || '';
        const pickupPhone    = session.metadata?.pickup_phone   || '';
        const pickupEmail    = session.metadata?.pickup_email   || '';
        const pickupStreet1  = session.metadata?.pickup_street1 || '';
        const pickupStreet2  = session.metadata?.pickup_street2 || '';
        const pickupCity     = session.metadata?.pickup_city    || '';
        const pickupState    = session.metadata?.pickup_state   || '';
        const pickupZip      = session.metadata?.pickup_zip     || '';
        const pickupAddress  = [pickupStreet1, pickupStreet2, pickupCity, pickupState, pickupZip].filter(Boolean).join(', ');
        const pickupCommPref = session.metadata?.pickup_comm    || '';

        // Local delivery address (collected on our page, stored in metadata)
        const deliveryAddrStr = [
          session.metadata?.delivery_street,
          session.metadata?.delivery_city,
          session.metadata?.delivery_state,
          session.metadata?.delivery_zip,
        ].filter(Boolean).join(', ');
        const deliveryMiles = session.metadata?.delivery_miles || '';
        const customerPhone = session.customer_details?.phone || '';

        // Local-delivery address as a structured object (mirrors Stripe shippingAddr shape)
        const deliveryAddrObj = session.metadata?.delivery_street ? {
          name:   customerName,
          street: session.metadata.delivery_street,
          city:   session.metadata.delivery_city  || '',
          state:  session.metadata.delivery_state || '',
          zip:    session.metadata.delivery_zip   || '',
          phone:  customerPhone,
          miles:  deliveryMiles,
        } : null;

        // Delivery fee charged (from the Stripe line item), in cents
        const deliveryFeeCents = (items.find(li => li.description === 'Local Delivery Fee')?.amount_total) || 0;

        const addrLine = shippingAddr
          ? `${shippingAddr.line1}${shippingAddr.line2 ? ', ' + shippingAddr.line2 : ''}, ${shippingAddr.city}, ${shippingAddr.state} ${shippingAddr.postal_code}`
          : deliveryAddrStr
            ? deliveryAddrStr
            : (deliveryMethod === 'pickup'
                ? `Local pick-up${pickupLoc ? ' — ' + pickupLoc : ''} (details to follow)`
                : '');

        // Gift + billing metadata
        const isGift   = session.metadata?.is_gift === 'true';
        const giftOcc  = session.metadata?.gift_occasion || '';
        const giftMsg  = session.metadata?.gift_msg      || '';
        const billName = session.metadata?.bill_name     || '';

        // Exit-intent "keep my cart" free-gift offer
        const freeGiftEligible = session.metadata?.free_gift_eligible === 'true';
        const freeGiftHtml = freeGiftEligible
          ? `<div style="background:#fff8f0;border-left:4px solid #2a7a2a;padding:12px 20px;margin:16px 0;font-size:0.9rem;">
               <strong style="color:#2a7a2a;">🎁 Free Gift Eligible</strong>
               <p style="margin:4px 0 0;color:#555;">This customer kept their cart after the exit prompt — include a free gift with their order.</p>
             </div>`
          : '';

        const occasionLabel = giftOcc
          ? giftOcc.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          : '';

        const giftHtml = isGift
          ? `<div style="background:#fff8f0;border-left:4px solid #8B4A2F;padding:12px 20px;margin:16px 0;font-size:0.9rem;">
               <strong>🎁 Gift Order${occasionLabel ? ' — ' + escHtml(occasionLabel) : ''}</strong>
               ${giftMsg ? `<p style="margin:6px 0 0;color:#555;font-style:italic;">&ldquo;${escHtml(giftMsg)}&rdquo;</p>` : '<p style="margin:4px 0 0;color:#888;font-size:0.85rem;">No message included.</p>'}
             </div>`
          : '';

        const billHtml = billName
          ? `<p style="color:#3d3d3d;font-size:0.9rem;margin-top:8px;">
               <strong>Billing Address:</strong> ${escHtml(billName)}, ${escHtml(session.metadata.bill_street)}, ${escHtml(session.metadata.bill_city)}, ${escHtml(session.metadata.bill_state)} ${escHtml(session.metadata.bill_zip)}
             </p>`
          : '';

        function orderConfirmEmail(statusNote) {
          const deliveryBlock = deliveryMethod === 'pickup'
            ? `<p style="margin:0;color:#3d3d3d;line-height:1.8;"><strong>Delivery:</strong> Local Pick-up — we'll be in touch soon to confirm your pick-up time and location.</p>`
            : addrLine
              ? `<p style="margin:0;color:#3d3d3d;line-height:1.8;"><strong>${deliveryMethod === 'delivery' ? 'Local Delivery to' : 'Shipping to'}:</strong> ${addrLine}${deliveryMiles ? ` <span style="color:#888;">(${deliveryMiles} mi)</span>` : ''}</p>`
              : '';

          return `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">

            <img src="${siteUrl}/images/logo.png" alt="Heart of Texas Organics" style="height:52px;margin-bottom:28px;filter:brightness(0.3);" />

            <h2 style="color:#2C3E2D;font-size:1.6rem;margin:0 0 20px;">Your order is confirmed! 🌾</h2>

            <p style="color:#3d3d3d;line-height:1.9;margin:0 0 24px;">
              Hi ${customerName},<br><br>
              Your order just came through and we are so glad you're here. Every item in your box
              was made with intention — no shortcuts, no fillers, just real food raised the way
              food is supposed to be raised.
            </p>

            <div style="background:#fff;border-radius:4px;overflow:hidden;margin-bottom:24px;">
              <div style="background:#2C3E2D;padding:12px 16px;">
                <p style="color:#F5F0E8;font-family:sans-serif;font-size:0.75rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:0;">Your Order</p>
              </div>
              <table style="width:100%;border-collapse:collapse;">
                ${productItems.map(li => `
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #f0ebe0;color:#3d3d3d;">${li.description}</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #f0ebe0;text-align:right;color:#3d3d3d;">×${li.quantity}</td>
                </tr>`).join('')}
                ${shippingItem ? `
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #f0ebe0;color:#888;">${shippingItem.description}</td>
                  <td style="padding:12px 16px;border-bottom:1px solid #f0ebe0;text-align:right;color:#888;">${formatMoney(shippingItem.amount_total)}</td>
                </tr>` : ''}
                <tr style="background:#F5F0E8;">
                  <td style="padding:12px 16px;font-weight:700;color:#2C3E2D;">Total</td>
                  <td style="padding:12px 16px;font-weight:700;text-align:right;color:#2C3E2D;">${total}</td>
                </tr>
              </table>
            </div>

            ${deliveryBlock}
            ${billHtml}
            ${notesHtml}
            ${giftHtml}
            ${statusNote ? `<p style="color:#8B4A2F;font-size:0.85rem;margin-top:16px;line-height:1.7;">${statusNote}</p>` : ''}

            <p style="color:#3d3d3d;line-height:1.9;margin:28px 0 0;">
              If you have any questions, just reply to this email — we actually read these.
            </p>

            <div style="border-top:2px solid #2C3E2D;margin-top:32px;padding-top:24px;">
              <p style="color:#3d3d3d;line-height:1.8;margin:0 0 4px;font-size:1rem;">Welcome to the family. 🌿</p>
              <p style="color:#2C3E2D;font-weight:700;margin:0 0 2px;font-size:0.95rem;">Deborah</p>
              <p style="color:#555;font-size:0.85rem;margin:0 0 2px;">Head Hen in Charge</p>
              <p style="color:#8B4A2F;font-size:0.85rem;margin:0;">❤️ of Texas Organics</p>
            </div>

            <p style="color:#aaa;font-size:11px;margin-top:28px;line-height:1.7;">
              Order ref: ${session.id}<br>
              You're receiving this because you placed an order at heartoftexasorganics.com.
            </p>

          </div>`;
        }

        if (isPaid) {
          // Card money cleared immediately
          saveOrder(piId, {
            sessionId: session.id,
            status: 'READY_TO_SHIP',
            source: 'website',
            total: session.amount_total,
            items: items.map(li => ({ name: li.description, qty: li.quantity })),
            paymentMethod: 'card',
            created: new Date().toISOString(),
            customerName: customerName,
            customerEmail: customerEmail || '',
            deliveryMethod: deliveryMethod,
            pickupLocation: pickupLoc || '',
            pickupPhone:    pickupPhone,
            pickupEmail:    pickupEmail,
            pickupAddress:  pickupAddress,
            pickupCommPref: pickupCommPref,
            shippingAddress: shippingAddr ? {
              name: customerName,
              street: shippingAddr.line1 + (shippingAddr.line2 ? ' ' + shippingAddr.line2 : ''),
              city: shippingAddr.city,
              state: shippingAddr.state,
              zip: shippingAddr.postal_code,
              phone: customerPhone,
            } : deliveryAddrObj,
            deliveryFeeCents: deliveryFeeCents,
            deliveryMiles: deliveryMiles,
            customerPhone: customerPhone,
            isGift: isGift,
            giftOccasion: giftOcc || '',
            giftMsg: giftMsg || '',
            freeGiftEligible: freeGiftEligible,
            customerNotes: customerNotes || '',
          });
          const _invId = session.metadata?.inventory_id;
          if (_invId) {
            const _r = await db.adjustStock(_invId, -1);
            await db.addTransaction(_invId, 'sale', -1, null, session.id, 'Reservation checkout', 'online', _r?.before, _r?.after);
          } else {
            await deductStockForOrder(items, session.id);
          }

          // Mark the cart link as completed — try precise token match first, then email/phone
          try {
            const rcToken = session.metadata?.cart_link_token;
            if (rcToken) {
              await updatePendingCartDB(rcToken, { completed: true, completedAt: new Date().toISOString() });
            } else {
              const phone = normalizePhone(session.metadata?.pickup_phone || '');
              const email = session.customer_details?.email || '';
              const allCarts = await readPendingCartsDB();
              await Promise.all(
                Object.keys(allCarts)
                  .filter(k => !allCarts[k].completed && (allCarts[k].phone === phone || allCarts[k].email === email))
                  .map(k => updatePendingCartDB(k, { completed: true, completedAt: new Date().toISOString() }))
              );
            }
          } catch (e) { console.error('[cart-link complete]', e.message); }

          // Customer confirmation with PDF receipt
          if (customerEmail) {
            const orderDataForPdf = {
              sessionId: session.id,
              created: new Date().toISOString(),
              customerName,
              customerEmail,
              deliveryMethod,
              pickupLocation: pickupLoc,
              pickupPhone,
              pickupEmail,
              pickupAddress,
              pickupCommPref,
              shippingAddress: shippingAddr ? {
                name: customerName,
                street: shippingAddr.line1 + (shippingAddr.line2 ? ' ' + shippingAddr.line2 : ''),
                city: shippingAddr.city, state: shippingAddr.state, zip: shippingAddr.postal_code,
              } : deliveryAddrObj,
              items: productItems.map(li => ({ name: li.description, qty: li.quantity, price: li.price?.unit_amount })),
              total: session.amount_total,
            };
            let pdfAttachments = [];
            try {
              const pdfBuf = await generateReceiptPDF(orderDataForPdf);
              pdfAttachments = [{ filename: 'HOTO-Receipt.pdf', content: pdfBuf, contentType: 'application/pdf' }];
            } catch (pdfErr) {
              console.error('PDF generation error:', pdfErr.message);
            }
            await sendEmailTo(customerEmail,
              'Your Heart of Texas Organics Order is Confirmed 🌾',
              orderConfirmEmail(null),
              pdfAttachments
            );
          }

          // Admin notification
          await sendEmail(
            `✅ New Order ${total} Ready to Ship${isGift ? ' 🎁 GIFT' : ''}${freeGiftEligible ? ' 🎁 FREE GIFT' : ''}`,
            `<h2 style="color:#2C3E2D;">New Order Payment Cleared</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Customer:</strong> ${customerEmail || 'unknown'}</p>
             <p><strong>Delivery:</strong> ${deliveryMethod}${addrLine ? ' — ' + addrLine : ''}</p>
             ${billHtml}
             <p><strong>Phone:</strong> ${session.customer_details?.phone || 'not provided'}</p>
             <p><strong>Payment:</strong> Card (cleared immediately)</p>
             ${lineItemsHtml(items)}
             ${notesHtml}
             ${giftHtml}
             ${freeGiftHtml}
             ${fulfillmentBadge('READY_TO_SHIP')}
             <p style="color:#888;font-size:12px;">Reference: ${session.id}</p>`
          );

        } else {
          // ACH bank info submitted — money not yet transferred
          saveOrder(piId, {
            sessionId: session.id,
            status: 'AWAITING_PAYMENT',
            source: 'website',
            total: session.amount_total,
            items: items.map(li => ({ name: li.description, qty: li.quantity })),
            paymentMethod: 'us_bank_account',
            created: new Date().toISOString(),
            customerName: customerName,
            customerEmail: customerEmail || '',
            deliveryMethod: deliveryMethod,
            pickupLocation: pickupLoc || '',
            pickupPhone:    pickupPhone,
            pickupEmail:    pickupEmail,
            pickupAddress:  pickupAddress,
            pickupCommPref: pickupCommPref,
            shippingAddress: shippingAddr ? {
              name: customerName,
              street: shippingAddr.line1 + (shippingAddr.line2 ? ' ' + shippingAddr.line2 : ''),
              city: shippingAddr.city,
              state: shippingAddr.state,
              zip: shippingAddr.postal_code,
              phone: customerPhone,
            } : deliveryAddrObj,
            deliveryFeeCents: deliveryFeeCents,
            deliveryMiles: deliveryMiles,
            customerPhone: customerPhone,
            isGift: isGift,
            giftOccasion: giftOcc || '',
            giftMsg: giftMsg || '',
            freeGiftEligible: freeGiftEligible,
            customerNotes: customerNotes || '',
          });
          await deductStockForOrder(items, session.id);

          // Mark the cart link as completed — try precise token match first, then email/phone
          try {
            const rcToken = session.metadata?.cart_link_token;
            if (rcToken) {
              await updatePendingCartDB(rcToken, { completed: true, completedAt: new Date().toISOString() });
            } else {
              const phone = normalizePhone(session.metadata?.pickup_phone || '');
              const email = session.customer_details?.email || '';
              const allCarts = await readPendingCartsDB();
              await Promise.all(
                Object.keys(allCarts)
                  .filter(k => !allCarts[k].completed && (allCarts[k].phone === phone || allCarts[k].email === email))
                  .map(k => updatePendingCartDB(k, { completed: true, completedAt: new Date().toISOString() }))
              );
            }
          } catch (e) { console.error('[cart-link complete]', e.message); }

          // Customer confirmation (note: not shipped until ACH clears)
          if (customerEmail) {
            const orderDataForPdf = {
              sessionId: session.id,
              created: new Date().toISOString(),
              customerName,
              customerEmail,
              deliveryMethod,
              pickupLocation: pickupLoc,
              pickupPhone,
              pickupEmail,
              pickupAddress,
              pickupCommPref,
              shippingAddress: shippingAddr ? {
                name: customerName,
                street: shippingAddr.line1 + (shippingAddr.line2 ? ' ' + shippingAddr.line2 : ''),
                city: shippingAddr.city, state: shippingAddr.state, zip: shippingAddr.postal_code,
              } : deliveryAddrObj,
              items: productItems.map(li => ({ name: li.description, qty: li.quantity, price: li.price?.unit_amount })),
              total: session.amount_total,
            };
            let pdfAttachments = [];
            try {
              const pdfBuf = await generateReceiptPDF(orderDataForPdf);
              pdfAttachments = [{ filename: 'HOTO-Receipt.pdf', content: pdfBuf, contentType: 'application/pdf' }];
            } catch (pdfErr) {
              console.error('PDF generation error:', pdfErr.message);
            }
            await sendEmailTo(customerEmail,
              'Your Heart of Texas Organics Order is Received 🌾',
              orderConfirmEmail('Note: ACH bank transfers take 3–5 business days to settle. We\'ll be in touch once payment clears and your order is on its way.'),
              pdfAttachments
            );
          }

          // Admin notification
          await sendEmail(
            `⏳ New ACH Order ${total} DO NOT SHIP YET${isGift ? ' 🎁 GIFT' : ''}${freeGiftEligible ? ' 🎁 FREE GIFT' : ''}`,
            `<h2 style="color:#8B4A2F;">New ACH Order Awaiting Bank Settlement</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Customer:</strong> ${customerEmail || 'unknown'}</p>
             <p><strong>Delivery:</strong> ${deliveryMethod}${addrLine ? ' — ' + addrLine : ''}</p>
             ${billHtml}
             <p><strong>Phone:</strong> ${session.customer_details?.phone || 'not provided'}</p>
             <p><strong>Payment:</strong> ACH Bank Transfer (3–5 business days to clear)</p>
             ${lineItemsHtml(items)}
             ${notesHtml}
             ${giftHtml}
             ${freeGiftHtml}
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

        // Phone (MOTO) orders are created directly as PaymentIntents — no
        // checkout.session.completed will ever fire for them — so handle here.
        if (pi.metadata?.type === 'phone-order') {
          await handlePhoneOrderSucceeded(pi);
          break;
        }

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

// ── RECIPE GUIDE PAYWALL ────────────────────────────────────────────

// Block direct .html access — the file must be served through the auth route only
app.use((req, res, next) => {
  if (/^\/recipe-guide\.html?$/i.test(req.path)) return res.redirect(302, '/magazine.html#recipe-guide');
  next();
});

// Signed session cookie helpers — code never stays in URL after first visit
const _RG_SECRET = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'hoto-rg-fallback';
const RG_COOKIE = 'hoto_rg';

function signRgCookie(code) {
  const payload = `${code}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', _RG_SECRET()).update(payload).digest('hex').slice(0, 24);
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyRgCookie(val) {
  try {
    if (!val) return null;
    const dot = val.lastIndexOf('.');
    const b64 = val.slice(0, dot);
    const sig = val.slice(dot + 1);
    const payload = Buffer.from(b64, 'base64url').toString();
    const expected = crypto.createHmac('sha256', _RG_SECRET()).update(payload).digest('hex').slice(0, 24);
    if (sig !== expected) return null;
    const [code, ts] = payload.split(':');
    if (!code || !ts || Date.now() - parseInt(ts, 10) > 30 * 24 * 60 * 60 * 1000) return null; // 30-day expiry
    return code;
  } catch { return null; }
}

function getRgCookie(req) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').find(c => c.trim().startsWith(RG_COOKIE + '='));
  return part ? decodeURIComponent(part.split('=').slice(1).join('=').trim()) : null;
}

function setRgCookie(res, code) {
  const val = signRgCookie(code);
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  res.setHeader('Set-Cookie',
    `${RG_COOKIE}=${encodeURIComponent(val)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

function servePersonalizedGuide(name, email, res, download = false) {
  let html = fs.readFileSync(path.join(__dirname, 'recipe-guide.html'), 'utf8');
  const display = escHtml(name || email);
  const watermark = display
    ? `<div class="buyer-watermark">Prepared for: <strong>${display}</strong> &nbsp;&middot;&nbsp; heartoftexasorganics.com &nbsp;&middot;&nbsp; For personal use only.</div>`
    : '';
  html = html.replace('<!--BUYER_WATERMARK-->', watermark);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (download) res.setHeader('Content-Disposition', 'attachment; filename="HOTO-Farm-to-Table-Recipe-Guide.html"');
  res.send(html);
}

// Stripe checkout — $25 one-time payment
app.post('/create-recipe-guide-checkout', express.json(), async (req, res) => {
  try {
    const { name = '', email = '' } = req.body || {};
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    const origin = SITE_URL_BASE;
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email.trim(),
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Farm to Table Recipe Guide',
            description: '14 recipes — pasture-raised chicken, honey challah, garlic chili crunch, seasonal preserves & farm kitchen basics',
          },
          unit_amount: 2500,
        },
        quantity: 1,
      }],
      success_url: `${origin}/recipe-guide-access?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/magazine.html#recipe-guide`,
      metadata: { buyer_name: name.trim(), buyer_email: email.trim() },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[recipe-guide-checkout]', err);
    res.status(500).json({ error: err.message });
  }
});

// Post-Stripe redirect — create access code, redirect to guide
app.get('/recipe-guide-access', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/magazine.html#recipe-guide');
  try {
    const pg = getPcPool();
    if (pg) {
      const existing = await pg.query(
        'SELECT code FROM recipe_access_codes WHERE stripe_session_id = $1', [session_id]
      );
      if (existing.rows[0]) return res.redirect(`/recipe-guide?code=${existing.rows[0].code}`);
    }
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.payment_status !== 'paid') return res.redirect('/magazine.html#recipe-guide');
    const name  = session.metadata?.buyer_name || session.customer_details?.name || '';
    const email = session.customer_details?.email || session.metadata?.buyer_email || '';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 10; i++) code += chars[crypto.randomInt(0, chars.length)];
    if (pg) {
      await pg.query(
        'INSERT INTO recipe_access_codes (code, name, email, paid, stripe_session_id) VALUES ($1,$2,$3,TRUE,$4) ON CONFLICT DO NOTHING',
        [code, name, email, session_id]
      );
    }
    res.redirect(`/recipe-guide?code=${code}`);
  } catch (err) {
    console.error('[recipe-guide-access]', err);
    res.redirect('/magazine.html#recipe-guide');
  }
});

// Shared helper — resolves code from URL param (first visit) or cookie (return visit)
async function resolveRgAccess(req, res) {
  const urlCode = req.query.code;
  const cookieCode = verifyRgCookie(getRgCookie(req));
  const code = urlCode || cookieCode;
  if (!code) return null;
  const pg = getPcPool();
  if (!pg) return null;
  const result = await pg.query(
    'SELECT name, email FROM recipe_access_codes WHERE code = $1', [code]
  );
  if (!result.rows[0]) return null;
  // First visit via URL code: exchange for HttpOnly cookie, strip code from URL
  if (urlCode && !cookieCode) {
    setRgCookie(res, urlCode);
    return 'redirect'; // caller must redirect to clean URL
  }
  return result.rows[0];
}

// View guide — code-in-URL on first visit only; cookie session on return visits
app.get('/recipe-guide', async (req, res) => {
  try {
    const row = await resolveRgAccess(req, res);
    if (!row) return res.redirect('/magazine.html#recipe-guide');
    if (row === 'redirect') return res.redirect(302, '/recipe-guide');
    res.setHeader('Referrer-Policy', 'no-referrer');
    servePersonalizedGuide(row.name || '', row.email || '', res, false);
  } catch (err) {
    console.error('[recipe-guide]', err);
    res.redirect('/magazine.html#recipe-guide');
  }
});

// Download guide — same auth, triggers file download
app.get('/download-recipe-guide', async (req, res) => {
  try {
    const row = await resolveRgAccess(req, res);
    if (!row) return res.redirect('/magazine.html#recipe-guide');
    if (row === 'redirect') return res.redirect(302, '/download-recipe-guide');
    res.setHeader('Referrer-Policy', 'no-referrer');
    servePersonalizedGuide(row.name || '', row.email || '', res, true);
  } catch (err) {
    console.error('[download-recipe-guide]', err);
    res.redirect('/magazine.html#recipe-guide');
  }
});

// Admin: list recipe access codes
app.get('/admin/recipe-guide-codes', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.json([]);
  const { rows } = await pg.query(
    'SELECT code, name, email, paid, created_at FROM recipe_access_codes ORDER BY created_at DESC'
  );
  res.json(rows);
});

// Admin: generate free code (for bundle buyers)
app.post('/admin/recipe-guide-codes', requireAdmin, express.json(), async (req, res) => {
  const { name = '', email = '' } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 10; i++) code += chars[crypto.randomInt(0, chars.length)];
  await pg.query(
    'INSERT INTO recipe_access_codes (code, name, email, paid) VALUES ($1,$2,$3,FALSE)',
    [code, name.trim(), email.trim()]
  );
  res.json({ code, name: name.trim(), email: email.trim(), paid: false });
});

// Admin: revoke a code
app.delete('/admin/recipe-guide-codes/:code', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query('DELETE FROM recipe_access_codes WHERE code = $1', [req.params.code]);
  res.json({ ok: true });
});

// --- Product waitlist (sold-out items) ---
const WAITLIST_PRODUCTS = {
  'sampler-box':           'The Farm Sampler Box',
  'harvest-subscription':  'The Supper Starter Box',
  'whole-chicken':         'Whole Chicken',
};
app.post('/api/waitlist', express.json(), async (req, res) => {
  const { productId = '', name = '', email = '', phone = '' } = req.body || {};
  const productName = WAITLIST_PRODUCTS[productId];
  if (!productName || !name.trim() || !email.trim() || !email.includes('@') || !phone.trim()) {
    return res.status(400).json({ error: 'Full name, valid email, phone number, and a recognized product are required' });
  }
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query(
    'INSERT INTO product_waitlist (product_id, product_name, name, email, phone) VALUES ($1,$2,$3,$4,$5)',
    [productId, productName, name.trim(), email.trim(), phone.trim()]
  );
  sendEmail(
    `Waitlist signup: ${productName}`,
    `<p><strong>${escHtml(name.trim())}</strong> joined the waitlist for <strong>${escHtml(productName)}</strong>.</p>
     <p>Email: ${escHtml(email.trim())}${phone.trim() ? '<br>Phone: ' + escHtml(phone.trim()) : ''}</p>`
  ).catch(e => console.warn('[Waitlist] admin email failed:', e.message));
  res.json({ ok: true });
});

// Admin: list waitlist entries, grouped by product
app.get('/admin/waitlist', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.json([]);
  const { rows } = await pg.query(
    'SELECT id, product_id, product_name, name, email, phone, contacted, created_at FROM product_waitlist ORDER BY product_name, created_at DESC'
  );
  res.json(rows);
});

// Admin: remove a waitlist entry (e.g. after contacting them)
app.delete('/admin/waitlist/:id', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query('DELETE FROM product_waitlist WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

function parseWaitlistIds(body) {
  const ids = Array.isArray(body?.ids) ? body.ids.map(n => parseInt(n, 10)).filter(Number.isInteger) : [];
  return ids;
}

// Admin: bulk delete waitlist entries
app.post('/admin/waitlist/bulk-delete', requireAdmin, express.json(), async (req, res) => {
  const ids = parseWaitlistIds(req.body);
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query('DELETE FROM product_waitlist WHERE id = ANY($1::int[])', [ids]);
  res.json({ ok: true, count: ids.length });
});

// Admin: bulk mark waitlist entries contacted/uncontacted
app.post('/admin/waitlist/bulk-contacted', requireAdmin, express.json(), async (req, res) => {
  const ids = parseWaitlistIds(req.body);
  const contacted = !!req.body?.contacted;
  if (!ids.length) return res.status(400).json({ error: 'ids array required' });
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query('UPDATE product_waitlist SET contacted = $2 WHERE id = ANY($1::int[])', [ids, contacted]);
  res.json({ ok: true, count: ids.length });
});

// --- Social media content calendar (admin) ---
app.get('/admin/social-posts', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.json([]);
  const { rows } = await pg.query('SELECT * FROM social_posts ORDER BY scheduled_at DESC');
  res.json(rows);
});

app.post('/admin/social-posts', requireAdmin, express.json(), async (req, res) => {
  const { platforms = [], caption = '', imageUrl = '', scheduledAt = '' } = req.body || {};
  const cleanPlatforms = Array.isArray(platforms) ? platforms.filter(p => SOCIAL_PLATFORMS.includes(p)) : [];
  const when = new Date(scheduledAt);
  if (!cleanPlatforms.length || !caption.trim() || isNaN(when.getTime())) {
    return res.status(400).json({ error: 'At least one platform, a caption, and a valid scheduled date/time are required' });
  }
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  const { rows } = await pg.query(
    `INSERT INTO social_posts (platforms, caption, image_url, scheduled_at) VALUES ($1,$2,$3,$4) RETURNING *`,
    [cleanPlatforms, caption.trim(), imageUrl.trim() || null, when]
  );
  res.json(rows[0]);
});

app.put('/admin/social-posts/:id', requireAdmin, express.json(), async (req, res) => {
  const { platforms = [], caption = '', imageUrl = '', scheduledAt = '' } = req.body || {};
  const cleanPlatforms = Array.isArray(platforms) ? platforms.filter(p => SOCIAL_PLATFORMS.includes(p)) : [];
  const when = new Date(scheduledAt);
  if (!cleanPlatforms.length || !caption.trim() || isNaN(when.getTime())) {
    return res.status(400).json({ error: 'At least one platform, a caption, and a valid scheduled date/time are required' });
  }
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  const { rows } = await pg.query(
    `UPDATE social_posts SET platforms = $2, caption = $3, image_url = $4, scheduled_at = $5, status = 'scheduled', error = NULL
     WHERE id = $1 RETURNING *`,
    [req.params.id, cleanPlatforms, caption.trim(), imageUrl.trim() || null, when]
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

app.delete('/admin/social-posts/:id', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  await pg.query('DELETE FROM social_posts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Manually fire the "ready to post" email right now, regardless of scheduled_at
app.post('/admin/social-posts/:id/send-now', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'DB unavailable' });
  const { rows } = await pg.query('SELECT * FROM social_posts WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  try {
    await publishSocialPost(rows[0]);
    await pg.query(`UPDATE social_posts SET status = 'sent_for_review', posted_at = NOW(), error = NULL WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    await pg.query(`UPDATE social_posts SET status = 'failed', error = $2 WHERE id = $1`, [req.params.id, e.message]);
    res.status(500).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

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
      allow_promotion_codes: true,
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

// POST /api/shipping-rates — public, no auth required
app.post('/api/shipping-rates', async (req, res) => {
  if (!easypost) return res.status(503).json({ error: 'Shipping rates temporarily unavailable' });
  try {
    const { to, weight_lbs, length, width, height } = req.body;
    const shipment = await easypost.Shipment.create({
      from_address: BHF_FROM_ADDRESS,
      to_address:   to,
      parcel: {
        length: length || 12,
        width:  width  || 10,
        height: height || 6,
        weight: Math.ceil((parseFloat(weight_lbs) || 1) * 16),
      },
    });
    // Return all available rates sorted cheapest first
    const rates = (shipment.rates || [])
      .map(r => ({ id: r.id, carrier: r.carrier, service: r.service, rate: r.rate, delivery_days: r.delivery_days }))
      .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));
    res.json({ shipment_id: shipment.id, rates });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Could not calculate shipping rates' });
  }
});

// POST /api/verify-address — verify + standardize address via EasyPost, returns ZIP+4
app.post('/api/verify-address', async (req, res) => {
  if (!easypost) return res.json({ success: false, error: 'Verification unavailable' });
  try {
    const { name, street1, city, state, zip } = req.body;
    if (!street1 || !city || !state || !zip) {
      return res.status(400).json({ success: false, error: 'street1, city, state, zip required' });
    }
    const address = await easypost.Address.create({
      verify: ['delivery'],
      name: name || '',
      street1,
      city,
      state,
      zip,
      country: 'US',
    });
    const success = address.verifications?.delivery?.success ?? false;
    const rawZip   = address.zip || zip;
    const digits   = rawZip.replace(/\D/g, '');
    const zip5     = digits.slice(0, 5);
    const zip4     = digits.length > 5 ? digits.slice(5, 9) : (address.zip4 || '');
    res.json({
      success,
      standardized: {
        street1: address.street1 || street1,
        city:    address.city    || city,
        state:   address.state   || state,
        zip:     zip5,
        zip4:    zip4,
      },
      errors: address.verifications?.delivery?.errors || [],
    });
  } catch (e) {
    console.error('Address verify error:', e.message);
    // Non-fatal: client silently skips comparison modal on error
    res.json({ success: false, error: e.message });
  }
});

// State name → abbreviation for geocode response
const US_STATE_ABBR = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC',
};

// GET /api/zip-lookup?zip=78701
// Primary auto-fill: uses Zippopotam.us (USPS-sourced) to return city + state from a ZIP code.
// Triggered the instant the customer finishes typing 5 digits — most reliable path.
app.get('/api/zip-lookup', async (req, res) => {
  const { zip } = req.query;
  if (!zip || !/^\d{5}$/.test(zip)) return res.status(400).json({ error: 'valid 5-digit zip required' });
  try {
    const response = await fetch(`https://api.zippopotam.us/us/${zip}`, {
      headers: { 'User-Agent': 'HeartOfTexasOrganics/1.0' },
    });
    if (!response.ok) return res.json({}); // unknown ZIP — let user fill in manually
    const data = await response.json();
    const place = data.places?.[0];
    if (!place) return res.json({});
    res.json({
      city:  place['place name']       || '',
      state: place['state abbreviation'] || '',
    });
  } catch (e) {
    console.error('ZIP lookup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/geocode?city=Austin&street=123+Main+St
// Fallback only — used to guess state from city name via Nominatim.
// NOTE: city-level geocoding reliably returns state but NOT zip (one city = many ZIPs),
// so we only use this for state auto-fill when zip is not yet entered.
app.get('/api/geocode', async (req, res) => {
  const { street, city } = req.query;
  if (!city) return res.status(400).json({ error: 'city required' });
  try {
    const params = new URLSearchParams({
      city, country: 'US', format: 'json', addressdetails: '1', limit: '1',
    });
    if (street) params.set('street', street);
    const url = 'https://nominatim.openstreetmap.org/search?' + params;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HeartOfTexasOrganics/1.0 (heartoftexasorganics.com)' },
    });
    const data = await response.json();
    if (!data.length) return res.json({});
    const addr      = data[0].address || {};
    const stateFull = addr.state || '';
    const stateAbbr = US_STATE_ABBR[stateFull] || '';
    // Only return state — zip from city geocoding is unreliable (omitted intentionally)
    res.json({ state: stateAbbr });
  } catch (e) {
    console.error('Geocode error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TURKEY_ITEM_IDS = new Set(['thanksgiving-turkey']);

// =========================================
// DELIVERY FEE CALCULATOR
// Origin coordinates stored only in env vars — never in code or client
// Set HOTO_ORIGIN_LAT and HOTO_ORIGIN_LNG in Render environment
// =========================================

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const DELIVERY_MIN_ORDER_CENTS = 3500; // $35 minimum order required for delivery

function calcDeliveryFeeCents(distanceMiles, orderTotalCents) {
  if (orderTotalCents >= 7500) {
    // $75+ orders
    if (distanceMiles <= 10) return 0;                                          // FREE
    if (distanceMiles <= 20) return 999;                                        // $9.99
    return 999 + Math.round((distanceMiles - 20) * 70);                        // $9.99 + $0.70/mi over 20
  } else {
    // $35–$74.99 orders
    if (distanceMiles <= 10) return 999;                                        // $9.99
    if (distanceMiles <= 20) return 1500;                                       // $15.00
    return 1500 + Math.round((distanceMiles - 20) * 100);                      // $15 + $1.00/mi over 20
  }
}

async function geocodeAddress(street, city, state, zip) {
  const q = encodeURIComponent(`${street}, ${city}, ${state} ${zip}, USA`);
  const r = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`,
    { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'HeartOfTexasOrganics/1.0 (operations@heartoftexasorganics.com)' } }
  );
  const data = await r.json();
  if (data?.[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  // Retry with ZIP + city only if full address fails
  const q2 = encodeURIComponent(`${city}, ${state} ${zip}, USA`);
  const r2 = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${q2}&format=json&limit=1`,
    { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'HeartOfTexasOrganics/1.0 (operations@heartoftexasorganics.com)' } }
  );
  const data2 = await r2.json();
  if (data2?.[0]) return { lat: parseFloat(data2[0].lat), lng: parseFloat(data2[0].lon) };
  throw new Error('Address not found');
}

// Bundle-specific delivery fee:
//   ≤ 10 mi  → FREE
//   ≤ 20 mi  → $15 flat
//   > 20 mi  → $15 + $0.70 per mile beyond 20
// Origin: 100 Commons Rd, Dripping Springs, TX 78620
function calcBundleDeliveryFeeCents(distanceMiles) {
  if (distanceMiles <= 10) return 0;
  if (distanceMiles <= 20) return 1500;
  return 1500 + Math.round((distanceMiles - 20) * 0.70 * 100);
}

const BUNDLE_ORIGIN_LAT = parseFloat(process.env.BUNDLE_ORIGIN_LAT) || 30.191784;
const BUNDLE_ORIGIN_LNG = parseFloat(process.env.BUNDLE_ORIGIN_LNG) || -98.084784;

// POST /api/sampler-delivery-fee — FREE ≤10 mi, $15 flat 10–20 mi, $15 + $0.70/mi after 20
// Origin: 100 Commons Rd, Dripping Springs TX 78620
function calcSamplerDeliveryFeeCents(miles) {
  if (miles <= 10) return 0;
  if (miles <= 20) return 1500;
  return 1500 + Math.round((miles - 20) * 70);
}
app.post('/api/sampler-delivery-fee', express.json(), async (req, res) => {
  const { street, city, state, zip, order_total_cents } = req.body || {};
  if (!street || !city || !state || !zip) return res.status(400).json({ error: 'Please fill in all address fields.' });
  const totalCents = parseInt(order_total_cents, 10) || 0;
  const FREE_THRESHOLD = 9900; // $99
  const DISCOUNT_AMT   = 500;  // $5 off when ≥$99 outside free zone
  try {
    const { lat, lng } = await geocodeAddress(street, city, state, zip);
    const miles = haversineMiles(BUNDLE_ORIGIN_LAT, BUNDLE_ORIGIN_LNG, lat, lng);
    const roundedMiles = Math.round(miles * 10) / 10;
    const withinFreeZone = miles <= 10;
    const baseFee = calcSamplerDeliveryFeeCents(miles);
    const qualifiesForDiscount = !withinFreeZone && totalCents >= FREE_THRESHOLD;
    let feeCents = baseFee;
    let discountCents = 0;
    if (qualifiesForDiscount) { discountCents = DISCOUNT_AMT; feeCents = Math.max(0, baseFee - discountCents); }
    const centsToThreshold = Math.max(0, FREE_THRESHOLD - totalCents);
    console.log(`[sampler-delivery-fee] ${roundedMiles}mi, base $${(baseFee/100).toFixed(2)}, fee $${(feeCents/100).toFixed(2)}, order $${(totalCents/100).toFixed(2)}`);
    res.json({ ok: true, miles: roundedMiles, fee_cents: feeCents, original_fee_cents: baseFee,
               discount_cents: discountCents, free: feeCents === 0,
               within_free_zone: withinFreeZone, cents_to_threshold: centsToThreshold });
  } catch (e) {
    console.error('[sampler-delivery-fee] geocode failed, using flat fee fallback:', e.message);
    const qualifiesForDiscount = totalCents >= FREE_THRESHOLD;
    const baseFee = 1500;
    const feeCents = qualifiesForDiscount ? baseFee - DISCOUNT_AMT : baseFee;
    res.json({ ok: true, miles: null, fee_cents: feeCents, original_fee_cents: baseFee,
               discount_cents: qualifiesForDiscount ? DISCOUNT_AMT : 0, free: false,
               within_free_zone: false, cents_to_threshold: Math.max(0, FREE_THRESHOLD - totalCents), fallback: true });
  }
});

// POST /api/bundle-delivery-fee — quotes the bundle delivery fee for an address
app.post('/api/bundle-delivery-fee', express.json(), async (req, res) => {
  const { street, city, state, zip } = req.body || {};
  if (!street || !city || !state || !zip) return res.status(400).json({ error: 'Please fill in street, city, state, and ZIP.' });
  try {
    const { lat, lng } = await geocodeAddress(street, city, state, zip);
    const miles = haversineMiles(BUNDLE_ORIGIN_LAT, BUNDLE_ORIGIN_LNG, lat, lng);
    const feeCents = calcBundleDeliveryFeeCents(miles);
    res.json({ ok: true, miles: Math.round(miles * 10) / 10, fee_cents: feeCents, free: feeCents === 0 });
  } catch (e) {
    console.error('[bundle-delivery-fee] geocode failed, using flat fee fallback:', e.message);
    res.json({ ok: true, miles: null, fee_cents: 1500, free: false, fallback: true });
  }
});

app.post('/api/calculate-delivery-fee', express.json(), async (req, res) => {
  const { street, city, state, zip, order_total_cents } = req.body || {};
  if (!street || !city || !state || !zip) return res.status(400).json({ error: 'Address fields required' });

  const originLat = 30.191784; // 100 Commons Rd, Dripping Springs TX 78620
  const originLng = -98.084784;

  try {
    const { lat, lng } = await geocodeAddress(street, city, state, zip);
    const miles = haversineMiles(originLat, originLng, lat, lng);
    const feeCents = calcDeliveryFeeCents(miles, parseInt(order_total_cents, 10) || 0);
    res.json({ ok: true, miles: Math.round(miles * 10) / 10, fee_cents: feeCents });
  } catch (e) {
    console.error('[delivery-fee]', e.message);
    res.status(422).json({ error: 'Could not calculate delivery distance. Please verify your address.' });
  }
});

// Validate a promo code without redeeming it
app.post('/api/validate-promo', express.json(), async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, error: 'No code provided' });
  try {
    const results = await stripe.promotionCodes.list({ code: code.trim().toUpperCase(), limit: 1, active: true });
    const promo = results.data[0];
    if (!promo) return res.json({ valid: false, error: 'Code not found or expired' });
    const coupon = promo.coupon;
    if (!coupon.valid) return res.json({ valid: false, error: 'Coupon is no longer valid' });
    if (!coupon.percent_off) return res.json({ valid: false, error: 'Only percent-off codes are supported' });
    res.json({ valid: true, percent_off: coupon.percent_off, promo_id: promo.id });
  } catch (e) {
    console.error('[validate-promo]', e.message);
    res.status(500).json({ valid: false, error: 'Validation error' });
  }
});

// ── Delivery promo — public validate ────────────────────────────────────────
app.post('/api/validate-delivery-promo', express.json(), async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, error: 'No code' });
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ valid: false, error: 'Service unavailable' });
  const { rows } = await pg.query(
    'SELECT pct_off FROM delivery_promos WHERE code = $1 AND active = TRUE',
    [code.trim().toUpperCase()]
  );
  if (!rows[0]) return res.json({ valid: false, error: 'Code not found or expired' });
  res.json({ valid: true, pct_off: rows[0].pct_off });
});

// ── Delivery promo — admin CRUD ─────────────────────────────────────────────
app.get('/admin/delivery-promos', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json([]);
  const { rows } = await pg.query('SELECT code, pct_off, active, created_at FROM delivery_promos ORDER BY created_at DESC');
  res.json(rows);
});

app.post('/admin/delivery-promos', requireAdmin, express.json(), async (req, res) => {
  const { code, pct_off } = req.body || {};
  if (!code || !pct_off) return res.status(400).json({ error: 'code and pct_off required' });
  if (!/^[A-Z0-9_-]{1,32}$/.test((code || '').trim().toUpperCase()))
    return res.status(400).json({ error: 'Code must be 1–32 characters: letters, numbers, - or _' });
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'Service unavailable' });
  await pg.query(
    'INSERT INTO delivery_promos (code, pct_off) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET pct_off = $2, active = TRUE',
    [code.trim().toUpperCase(), parseInt(pct_off, 10)]
  );
  res.json({ ok: true });
});

app.delete('/admin/delivery-promos/:code', requireAdmin, async (req, res) => {
  const pg = getPcPool();
  if (!pg) return res.status(503).json({ error: 'Service unavailable' });
  await pg.query('UPDATE delivery_promos SET active = FALSE WHERE code = $1', [req.params.code.toUpperCase()]);
  res.json({ ok: true });
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, shipping, delivery_method, billing, gift, pickup_location, pickup_contact,
            delivery_address, delivery_promo_code,
            promo_code, promo_discount_cents, tax_rate_pct, free_gift_eligible,
            cart_link_token } = req.body;
    // delivery_fee_cents from client is intentionally not destructured — fee is always
    // recomputed server-side to prevent price tampering
    const origin = `${req.protocol}://${req.get('host')}`;
    const isShip = delivery_method !== 'pickup';

    if (delivery_method === 'delivery' && !cart_link_token) {
      const itemsSubtotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
      if (itemsSubtotal < DELIVERY_MIN_ORDER_CENTS) {
        return res.status(400).json({ error: `Delivery requires a $${(DELIVERY_MIN_ORDER_CENTS / 100).toFixed(0)} minimum order.` });
      }
    }

    const hasTurkey = items.some(i => TURKEY_ITEM_IDS.has(i.id));

    // Negative-price items (e.g. "5% Savings") cannot be sent to Stripe as
    // line items. Collect discount items separately, but cap to the actual
    // positive subtotal to prevent price manipulation.
    let cartDiscountCents = 0;
    const lineItems = [];
    for (const item of items) {
      if (item.price < 0) {
        // Collect discount — will be validated against subtotal below
        cartDiscountCents += Math.abs(Math.round(item.price || 0)) * (item.quantity || 1);
      } else {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: item.name },
            unit_amount: Math.round(item.price || 0),
          },
          quantity: item.quantity,
        });
      }
    }
    // Cap cart-level discounts to the actual subtotal so a tampered request
    // can never reduce the charge below $0.
    const positiveSubtotal = lineItems.reduce((s, li) => s + li.price_data.unit_amount * li.quantity, 0);
    cartDiscountCents = Math.min(cartDiscountCents, positiveSubtotal);

    // Sales tax — only applied to items the admin/cart marked as taxable;
    // free items already carry unit_amount 0 so they contribute nothing here.
    // Bundle/box products are always tax-exempt regardless of the taxable flag.
    const BUNDLE_IDS = new Set(['sampler-box','bread-box','harvest-subscription','farm-box','bundle-farm','bundle-turkey','bundle-4th-july','chicken-dinner-roll-bundle']);
    const taxPct = parseFloat(tax_rate_pct) || 0;
    if (taxPct > 0) {
      const taxableSubtotal = items.reduce(
        (s, i) => s + (i.taxable && !BUNDLE_IDS.has(i.id) ? (i.price || 0) * (i.quantity || 1) : 0), 0
      );
      const taxCents = Math.round(taxableSubtotal * taxPct / 100);
      if (taxCents > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: `Sales Tax (${taxPct}%)` },
            unit_amount: taxCents,
          },
          quantity: 1,
        });
      }
    }

    // HOTO- welcome codes are subscription-only — reject silently on one-time checkout
    const isWelcomeCode = (promo_code || '').toUpperCase().startsWith('HOTO-');

    // Add local delivery fee — always recalculated server-side to prevent tampering.
    // Fee structure: free ≤10mi, $15 flat 10–20mi, $15+$0.70/mi >20mi.
    // Orders ≥$99 earn a $5 delivery discount, shown as a separate coupon line.
    let deliveryDiscountCents = 0;
    if (delivery_method === 'delivery' && delivery_address?.street) {
      const originLat = 30.191784; // 100 Commons Rd, Dripping Springs TX 78620
      const originLng = -98.084784;
      try {
        const { lat, lng } = await geocodeAddress(
          delivery_address.street, delivery_address.city,
          delivery_address.state,  delivery_address.zip
        );
        const miles = haversineMiles(originLat, originLng, lat, lng);
        const milesRounded = Math.round(miles * 10) / 10;
        const orderTotal = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
        const authoritative_fee = calcSamplerDeliveryFeeCents(miles);

        // $5 delivery discount for orders ≥$99 outside the free zone
        if (orderTotal >= 9900 && miles > 10 && authoritative_fee > 0) {
          deliveryDiscountCents = Math.min(500, authoritative_fee);
          cartDiscountCents += deliveryDiscountCents;
        }

        // Delivery promo code: stacks on top of the $5 discount
        if (delivery_promo_code && authoritative_fee > 0) {
          const pg = getPcPool();
          if (pg) {
            const { rows: promoRows } = await pg.query(
              'SELECT pct_off FROM delivery_promos WHERE code = $1 AND active = TRUE',
              [delivery_promo_code.trim().toUpperCase()]
            );
            if (promoRows[0]) {
              cartDiscountCents += Math.round(authoritative_fee * promoRows[0].pct_off / 100);
            }
          }
        }

        if (authoritative_fee > 0) {
          lineItems.push({
            price_data: {
              currency: 'usd',
              product_data: { name: `Local Delivery Fee (${milesRounded} mi)`, description: `Distance from farm: ${milesRounded} miles` },
              unit_amount: authoritative_fee,
            },
            quantity: 1,
          });
        }
      } catch (geoErr) {
        console.error('[checkout] delivery geocode failed:', geoErr.message);
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: 'Local Delivery Fee' },
            unit_amount: 1500,
          },
          quantity: 1,
        });
      }
    }

    // Add shipping as a line item when a rate was selected
    if (isShip && shipping?.rate) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Shipping — ${shipping.carrier} ${shipping.service}` },
          unit_amount: Math.round(parseFloat(shipping.rate) * 100),
        },
        quantity: 1,
      });
    }

    // Build metadata (Stripe limits: 50 keys, values ≤ 500 chars)
    const metadata = { delivery_method: delivery_method || 'ship' };
    if (delivery_address) {
      metadata.delivery_street = (delivery_address.street || '').slice(0, 200);
      metadata.delivery_city   = (delivery_address.city   || '').slice(0, 100);
      metadata.delivery_state  = (delivery_address.state  || '').slice(0, 10);
      metadata.delivery_zip    = (delivery_address.zip    || '').slice(0, 10);
    }
    if (pickup_location) metadata.pickup_location = pickup_location;
    if (pickup_contact) {
      metadata.pickup_phone   = (pickup_contact.phone   || '').slice(0, 100);
      metadata.pickup_email   = (pickup_contact.email   || '').slice(0, 200);
      metadata.pickup_street1 = (pickup_contact.street1 || '').slice(0, 200);
      metadata.pickup_street2 = (pickup_contact.street2 || '').slice(0, 100);
      metadata.pickup_city    = (pickup_contact.city    || '').slice(0, 100);
      metadata.pickup_state   = (pickup_contact.state   || '').slice(0, 10);
      metadata.pickup_zip     = (pickup_contact.zip     || '').slice(0, 10);
      metadata.pickup_comm    = (pickup_contact.commPref || 'text').slice(0, 50);
    }
    if (billing) {
      metadata.bill_name   = billing.name   || '';
      metadata.bill_street = billing.street || '';
      metadata.bill_city   = billing.city   || '';
      metadata.bill_state  = billing.state  || '';
      metadata.bill_zip    = billing.zip    || '';
    }
    if (gift) {
      metadata.is_gift        = 'true';
      metadata.gift_occasion  = gift.occasion || '';
      metadata.gift_msg       = (gift.message || '').slice(0, 500);
    }
    if (free_gift_eligible) {
      metadata.free_gift_eligible = 'true';
    }
    if (cart_link_token) {
      metadata.cart_link_token = cart_link_token.slice(0, 500);
    }

    // Allow Stripe's promo code box only when no turkey in cart and no discount already applied
    const allowPromoCodes = !hasTurkey && !(promo_code && promo_discount_cents);

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      allow_promotion_codes: allowPromoCodes,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/offerings.html`,
      metadata,
    };

    if (isShip) {
      sessionParams.shipping_address_collection = { allowed_countries: ['US'] };
      sessionParams.phone_number_collection     = { enabled: true };
    }

    // For pickup orders: pre-attach customer by email so Stripe skips the email field
    if (!isShip && pickup_contact?.email) {
      const email = pickup_contact.email.trim();
      const existing = await stripe.customers.list({ email, limit: 1 });
      const customer = existing.data.length
        ? existing.data[0]
        : await stripe.customers.create({ email });
      sessionParams.customer = customer.id;
    }

    // Combine all discounts into one Stripe coupon (Stripe allows only one).
    // cartDiscountCents already includes: negative cart items + delivery promo.
    const promoDiscountCents = !isWelcomeCode && promo_discount_cents > 0
      ? Math.abs(Math.round(promo_discount_cents)) : 0;
    const totalDiscountCents = cartDiscountCents + promoDiscountCents;
    if (totalDiscountCents > 0) {
      // Build a label that lists every active discount so the customer sees
      // exactly what's been applied.
      const labelParts = [];
      if (promoDiscountCents > 0 && promo_code && !isWelcomeCode)
        labelParts.push(`${promo_code} (loyalty)`);
      if (delivery_promo_code)
        labelParts.push(`${delivery_promo_code} (delivery)`);
      if (deliveryDiscountCents > 0)
        labelParts.push('$5 Delivery Discount');
      if (!labelParts.length) labelParts.push('Savings');
      const coupon = await stripe.coupons.create({
        amount_off: totalDiscountCents,
        currency:   'usd',
        duration:   'once',
        name:       labelParts.join(' + '),
      });
      sessionParams.discounts = [{ coupon: coupon.id }];
      delete sessionParams.allow_promotion_codes;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/create-subscription-session', async (req, res) => {
  try {
    const { item, delivery_method, pickup_location } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    const isShip = delivery_method !== 'pickup';

    const subMeta = { delivery_method: delivery_method || 'ship' };
    if (pickup_location) subMeta.pickup_location = pickup_location;

    const sessionParams = {
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
      subscription_data: { metadata: subMeta },
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offerings.html#subscriptions`,
    };

    if (isShip) {
      sessionParams.shipping_address_collection = { allowed_countries: ['US'] };
      sessionParams.phone_number_collection = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('Subscription error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// CART SUBSCRIPTION  (Subscribe & Save 10%)
// =========================================

app.post('/create-cart-subscription', async (req, res) => {
  try {
    const { items, delivery_method, pickup_location } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    if (!items?.length) return res.status(400).json({ error: 'No items' });

    const weeklyTotal   = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const monthlyAmount = weeklyTotal * 4;
    const itemsLabel    = items.map(i => `${i.quantity}× ${i.name}`).join(', ');
    const isShip        = delivery_method !== 'pickup';

    const cartSubMeta = { items: itemsLabel, delivery_method: delivery_method || 'ship' };
    if (pickup_location) cartSubMeta.pickup_location = pickup_location;

    const sessionParams = {
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
      subscription_data: { metadata: cartSubMeta },
      allow_promotion_codes: false, // 15% Subscribe & Save already applied — no stacking
      success_url: `${origin}/subscription-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offerings.html`,
    };

    if (isShip) {
      sessionParams.shipping_address_collection = { allowed_countries: ['US'] };
      sessionParams.phone_number_collection = { enabled: true };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
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

// In-memory rate limiter for contact form: max 5 per IP per hour
const contactRateLimits = new Map();
function contactAllowed(ip) {
  const now = Date.now();
  const entry = contactRateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    contactRateLimits.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// Returns true if a string looks like random characters (no spaces, high consonant ratio, no common words)
function looksLikeRandom(str) {
  if (!str || str.length < 10) return false;
  if (/\s/.test(str.trim())) return false; // has spaces → probably a real sentence
  const vowels = (str.match(/[aeiouAEIOU]/g) || []).length;
  const ratio = vowels / str.length;
  return ratio < 0.15 || ratio > 0.75; // natural English is 0.25-0.55
}

app.post('/contact', async (req, res) => {
  const { name, email, subject, message, website, form_ts } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // 1. Honeypot — bots fill the hidden website field, humans never see it
  if (website && website.trim().length > 0) {
    console.log('[Spam] Honeypot triggered:', email);
    return res.json({ ok: true }); // silent drop
  }

  // 2. Timing check — real users take at least 4 seconds to fill a form
  const elapsed = form_ts ? Date.now() - parseInt(form_ts, 10) : 99999;
  if (elapsed < 4000) {
    console.log('[Spam] Submitted too fast (' + elapsed + 'ms):', email);
    return res.json({ ok: true }); // silent drop
  }

  // 3. Rate limiting — max 5 per IP per hour
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
  if (!contactAllowed(ip)) {
    console.log('[Spam] Rate limit hit from', ip);
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  // 4. Content check — reject random-character names or messages
  if (looksLikeRandom(name) || looksLikeRandom(message)) {
    console.log('[Spam] Random content detected from:', email);
    return res.json({ ok: true }); // silent drop
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
// RESERVATION CHECKOUT
app.post('/reserve-checkout', async (req, res) => {
  const { name, email, phone, bundle, notes } = req.body;
  if (!name || !email || !bundle) return res.status(400).json({ error: 'Missing required fields' });

  const bundles = {
    bundle1: { name: 'Farm Bundle',                 inventoryId: 'bundle-farm',   amount: 12500 },
    bundle2: { name: 'Thanksgiving Turkey Bundle',  inventoryId: 'bundle-turkey', amount: 10000 },
  };
  const chosen = bundles[bundle];
  if (!chosen) return res.status(400).json({ error: 'Invalid bundle' });

  // Check inventory
  const product = await db.getProduct(chosen.inventoryId);
  if (product && product.stock <= 0) {
    return res.status(400).json({ error: 'sold_out' });
  }

  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'usd', product_data: { name: chosen.name }, unit_amount: chosen.amount }, quantity: 1 }],
      customer_email: email,
      metadata: { reservation_name: name, reservation_phone: phone || '', reservation_notes: notes || '', bundle, inventory_id: chosen.inventoryId },
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/reserve.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Reserve checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// RESERVATION FORM
app.post('/reserve', async (req, res) => {
  const { name, email, phone, items, notes } = req.body;

  if (!name || !email || !items || items.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const itemList = items.map(i => `<li>${i}</li>`).join('');
  try {
    await sendEmail(
      `New Reservation from ${name}`,
      `<h2 style="color:#2C3E2D;">New Reservation Request</h2>
       <p><strong>Name:</strong> ${name}</p>
       <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
       <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
       <p><strong>Items:</strong></p>
       <ul>${itemList}</ul>
       <p><strong>Notes:</strong> ${notes || 'None'}</p>`
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Reservation email error:', err.message);
    res.status(500).json({ error: 'Email failed' });
  }
});

// =========================================
// INVENTORY MANAGEMENT
// =========================================

// --- Auth (stateless HMAC token — survives server restarts) ---
function makeAdminToken() {
  return crypto.createHmac('sha256', process.env.ADMIN_PASSWORD || 'no-password-set')
    .update('hoto-admin-v1')
    .digest('hex');
}
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token || token !== makeAdminToken()) return res.status(401).json({ error: 'Not authenticated' });
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
  'Farm Eggs (1 dozen)':         'farm-eggs',
  'Whole Chicken':               'whole-chicken',
  'Real Cream Butter':           'cultured-butter',
  'Seasonal Preserves':          'seasonal-preserves',
  'Garlic Chili Crunch':         'garlic-chili-crunch',
  'Tuscany Herb Dipping Oil':    'herb-dipping-oil',
  'Tuscany Herb Bread Dipping Oil': 'herb-dipping-oil',
  'Farm Bundle':                    'bundle-farm',
  'Thanksgiving Turkey Bundle':     'bundle-turkey',
  'Farm Sampler Box':               'sampler-box',
  'Chicken & Dinner Roll Bundle':   'chicken-dinner-roll-bundle',
  'Chicken and Dinner Roll Bundle': 'chicken-dinner-roll-bundle',
};

async function deductStockForOrder(lineItems, orderId, orderDate = null) {
  for (const item of lineItems) {
    // Variant items (e.g. "Real Cream Butter — 1/2 lb, Sea Salt") carry extra detail
    // after " — " — strip it so the base product still matches PRODUCT_MAP.
    const desc = item.description || '';
    const name = item.name || '';
    const pid = PRODUCT_MAP[desc] || PRODUCT_MAP[name]
             || PRODUCT_MAP[desc.split(' — ')[0]] || PRODUCT_MAP[name.split(' — ')[0]];
    if (!pid) continue;
    // Skip if this order+product was already logged (prevents double-deduction on re-sync)
    if (await db.hasTransaction(orderId, pid)) continue;
    const qty = item.quantity || 1;
    const result = await db.adjustStock(pid, -qty);
    const before = result ? result.before : null;
    const after  = result ? result.after  : null;
    const extra  = orderDate ? { created_at: orderDate } : {};
    await db.addTransaction(pid, 'sale', -qty, null, orderId, 'Stripe checkout', 'online', before, after, extra);
  }
}

// =========================================
// EMAIL SIGNUP & WELCOME DISCOUNT
// =========================================

const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');
const WELCOME_COUPON_ID = 'HOTO_WELCOME_10PCT';

function readSubscribers() {
  try { return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')); }
  catch { return []; }
}

// Ensure the base 10% coupon exists — promo codes are created per-customer
async function ensureWelcomeCoupon() {
  try {
    await stripe.coupons.retrieve(WELCOME_COUPON_ID);
    console.log('[Stripe] Welcome coupon already exists');
  } catch {
    await stripe.coupons.create({
      id:              WELCOME_COUPON_ID,
      name:            '10% Off First Subscription Box',
      percent_off:     10,
      duration:        'once',
      applies_to:      { products: [] }, // subscription checkout enforced in code
    });
    console.log('[Stripe] Welcome coupon created');
  }
}

// Generate a unique readable promo code e.g. HOTO-A3K9X2R4
function generateUniqueCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HOTO-';
  for (let i = 0; i < 8; i++) code += chars[crypto.randomInt(0, chars.length)];
  return code;
}

app.post('/subscribe', express.json(), async (req, res) => {
  const { email, source } = req.body || {};
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  const normalizedEmail = email.toLowerCase().trim();
  const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';

  // Check if already subscribed — never send a second code
  const subs = readSubscribers();
  const existing = subs.find(s => s.email.toLowerCase() === normalizedEmail);
  if (existing) {
    console.log('[Subscribe] Already subscribed:', normalizedEmail);
    return res.json({ ok: true, already: true });
  }

  // Check if they've already placed an order in Stripe
  let hasOrdered = false;
  try {
    const customers = await stripe.customers.list({ email: normalizedEmail, limit: 1 });
    if (customers.data.length > 0) {
      const charges = await stripe.charges.list({ customer: customers.data[0].id, limit: 1 });
      hasOrdered = charges.data.some(c => c.paid && !c.refunded);
    }
  } catch(e) { console.warn('[Subscribe] Stripe check failed:', e.message); }

  // Create a unique one-time promo code in Stripe
  let promoCode = null;
  try {
    await ensureWelcomeCoupon();
    const code = generateUniqueCode();
    const promo = await stripe.promotionCodes.create({
      coupon:          WELCOME_COUPON_ID,
      code,
      max_redemptions: 1,  // single use — cannot be shared or reused
    });
    promoCode = promo.code;
  } catch(e) {
    console.warn('[Subscribe] Could not create promo code:', e.message);
  }

  // Save subscriber with their unique code
  subs.push({
    email: normalizedEmail,
    source: source || 'popup',
    promoCode: promoCode || null,
    hasOrdered,
    subscribedAt: new Date().toISOString(),
  });
  try { fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subs, null, 2)); }
  catch(e) { console.warn('[Subscribe] Could not save subscriber:', e.message); }

  // Send welcome email — different message if they've already ordered
  try {
    if (hasOrdered) {
      await sendEmailTo(normalizedEmail,
        'Welcome to the Heart of Texas Organics Family 🌾',
        `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
          <img src="${siteUrl}/images/logo.png" alt="Heart of Texas Organics" style="height:52px;margin-bottom:28px;filter:brightness(0.3);" />
          <h2 style="color:#2C3E2D;font-size:1.6rem;margin:0 0 12px;">We're glad you're sticking around.</h2>
          <p style="color:#3d3d3d;line-height:1.9;margin:0 0 24px;">
            You're already part of the family — thank you for your support. We'll keep you
            in the loop on new products, farm stories, and seasonal offerings.
          </p>
          <a href="${siteUrl}/offerings.html"
             style="display:inline-block;background:#8B4A2F;color:#F5F0E8;padding:14px 32px;text-decoration:none;font-family:sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:3px;">
            Shop the Pantry →
          </a>
          <div style="border-top:2px solid #2C3E2D;margin-top:32px;padding-top:24px;">
            <p style="color:#2C3E2D;font-weight:700;margin:0 0 2px;">Deborah</p>
            <p style="color:#555;font-size:0.85rem;margin:0 0 2px;">Head Hen in Charge</p>
            <p style="color:#8B4A2F;font-size:0.85rem;margin:0;">❤️ of Texas Organics</p>
          </div>
        </div>`
      );
    } else if (promoCode) {
      await sendEmailTo(
        normalizedEmail,
        'Welcome — here is something from us',
        `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
          <img src="${siteUrl}/images/logo.png" alt="Heart of Texas Organics" style="height:52px;margin-bottom:28px;filter:brightness(0.3);" />
          <h2 style="color:#2C3E2D;font-size:1.6rem;margin:0 0 12px;">Welcome to the farm family.</h2>
          <p style="color:#3d3d3d;line-height:1.9;margin:0 0 24px;">
            We're so glad you're here. Real food, raised with intention — that's the only way we know how to do it.
            As a thank you for joining us, here's a little something for your first order:
          </p>
          <div style="background:#2C3E2D;padding:28px;text-align:center;border-radius:4px;margin-bottom:28px;">
            <p style="color:#B89B6E;font-family:sans-serif;font-size:0.75rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin:0 0 10px;">Your Personal Code</p>
            <p style="color:#F5F0E8;font-family:sans-serif;font-size:2rem;font-weight:700;letter-spacing:0.12em;margin:0;">${promoCode}</p>
            <p style="color:#B89B6E;font-family:sans-serif;font-size:0.7rem;margin:10px 0 0;">One-time use · Your account only</p>
          </div>
          <p style="color:#3d3d3d;line-height:1.9;margin:0 0 8px;">
            Enter this code at checkout on your first order.
            No shortcuts, no fillers — just real food made by real people right here in the heart of Texas.
          </p>
          <a href="${siteUrl}/offerings.html"
             style="display:inline-block;margin-top:20px;background:#8B4A2F;color:#F5F0E8;padding:14px 32px;text-decoration:none;font-family:sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:3px;">
            See What's Available →
          </a>
          <div style="border-top:2px solid #2C3E2D;margin-top:32px;padding-top:24px;">
            <p style="color:#2C3E2D;font-weight:700;margin:0 0 2px;">Deborah</p>
            <p style="color:#555;font-size:0.85rem;margin:0 0 2px;">Head Hen in Charge</p>
            <p style="color:#8B4A2F;font-size:0.85rem;margin:0;">Heart of Texas Organics</p>
          </div>
          <p style="color:#aaa;font-size:0.75rem;line-height:1.7;margin-top:24px;">
            You're receiving this because you signed up at heartoftexasorganics.com.
            Reply anytime — we actually read these.
          </p>
        </div>`,
        [],
        `Hi,

Welcome to the Heart of Texas Organics family. We're glad you're here.

Here is your personal code for your first order:

  ${promoCode}

Enter it at checkout at ${siteUrl}/offerings.html

Real food, raised with intention — that's the only way we know how to do it.

— Deborah
Head Hen in Charge
Heart of Texas Organics

You're receiving this because you signed up at heartoftexasorganics.com. Reply anytime — we actually read these.`
      );
    }
  } catch(e) {
    console.warn('[Subscribe] Email send failed:', e.message);
  }

  res.json({ ok: true, promoCode: promoCode || null });
});

// --- Test email endpoint ---
app.post('/admin/test-email', requireAdmin, async (req, res) => {
  try {
    await sendEmail(
      'Test Email — Heart of Texas Organics',
      `<div style="font-family:Georgia,serif;padding:32px;background:#F5F0E8;">
        <h2 style="color:#2C3E2D;">Email is working! ✅</h2>
        <p>Sent at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
      </div>`
    );
    res.json({ ok: true, sentTo: ADMIN_EMAIL });
  } catch (err) {
    console.error('[Test email] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Builds the "your custom order is ready" email shared by send + resend
function cartLinkEmailHtml({ name, note, items = [], total, discount, cartUrl }) {
  const greeting = name ? `Hi ${name},` : 'Hello,';
  const noteBlock = note ? `<p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">${note}</p>` : '';

  const itemRows = items.map(r =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e8e2d6;font-size:14px;color:#2C3E2D;">${r.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8e2d6;font-size:14px;color:#888;text-align:center;">${r.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8e2d6;font-size:14px;color:#2C3E2D;text-align:right;">${r.price}</td>
    </tr>`
  ).join('');

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ebe4;font-family:Georgia,serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ebe4;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr><td style="background:#2C3E2D;padding:32px 36px;">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(245,240,232,0.6);">Heart of Texas Organics</p>
          <h1 style="margin:0;font-size:22px;color:#F5F0E8;font-weight:400;">Your Farm Order is Ready 🌿</h1>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 16px;font-size:16px;color:#2C3E2D;">${greeting}</p>
          <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.6;">
            Review your items below and click the button to complete your purchase — it only takes a minute!
          </p>
          ${noteBlock}
          <p style="margin:0 0 24px;font-size:15px;color:#444;line-height:1.8;">
            ~Deborah<br>
            Head Hen in Charge<br>
            ❤️ of Texas's Organics!
          </p>

          ${items.length ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e2d6;border-radius:10px;overflow:hidden;margin-bottom:24px;">
            <thead>
              <tr style="background:#F5F0E8;">
                <th style="padding:10px 12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8B4A2F;text-align:left;font-weight:600;">Item</th>
                <th style="padding:10px 12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8B4A2F;text-align:center;font-weight:600;">Qty</th>
                <th style="padding:10px 12px;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8B4A2F;text-align:right;font-weight:600;">Price</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
            ${discount ? `<tr>
              <td colspan="2" style="padding:8px 12px;font-size:14px;color:#2a7a2a;">${discount.label || 'Discount'}</td>
              <td style="padding:8px 12px;font-size:14px;color:#2a7a2a;text-align:right;">-${discount.type === 'percent' ? discount.amount + '%' : '$' + discount.amount}</td>
            </tr>` : ''}
            ${total ? `<tfoot><tr>
              <td colspan="2" style="padding:12px;font-weight:700;font-size:14px;color:#2C3E2D;border-top:2px solid #e8e2d6;">Total</td>
              <td style="padding:12px;font-weight:700;font-size:16px;color:#8B4A2F;text-align:right;border-top:2px solid #e8e2d6;">${total}</td>
            </tr></tfoot>` : ''}
          </table>` : ''}

          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-bottom:28px;">
            <a href="${cartUrl}" style="display:inline-block;padding:16px 36px;background:#2C3E2D;color:#F5F0E8;font-size:14px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;text-decoration:none;border-radius:10px;">
              Complete My Order →
            </a>
          </td></tr></table>

          <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
            Or copy this link into your browser:<br>
            <a href="${cartUrl}" style="color:#8B4A2F;word-break:break-all;">${cartUrl}</a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F5F0E8;padding:20px 36px;text-align:center;">
          <p style="margin:0;font-size:12px;color:#888;">Questions? Reply to this email or reach us at <a href="mailto:operations@heartoftexasorganics.com" style="color:#8B4A2F;">operations@heartoftexasorganics.com</a></p>
          <p style="margin:6px 0 0;font-size:11px;color:#aaa;">Heart of Texas Organics · Dripping Springs, TX</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return html;
}

// Extracts the rc= token from a cart link URL
function tokenFromCartUrl(cartUrl) {
  try { return new URL(cartUrl).searchParams.get('rc'); }
  catch { return null; }
}

// Send a cart link email to a customer
app.post('/admin/send-cart-link-email', requireAdmin, express.json(), async (req, res) => {
  const { to, name, phone, source, cartUrl, note, items = [], total, discount } = req.body || {};
  if (!to || !cartUrl) return res.status(400).json({ error: 'Missing to or cartUrl' });

  const html = cartLinkEmailHtml({ name, note, items, total, discount, cartUrl });

  try {
    await sendEmailTo(to, 'Your custom order from Heart of Texas Organics 🌿', html);

    // Send a copy to the admin inbox so it's visible in Outlook
    const copyHtml = `
      <div style="background:#2C3E2D;color:#F5F0E8;font-family:Georgia,serif;font-size:12px;padding:10px 18px;margin-bottom:0;">
        📋 <strong>Copy of cart link email</strong> sent to ${name ? `<strong>${name}</strong> (${to})` : `<strong>${to}</strong>`}
      </div>
      ${html}`;
    sendEmailTo(ADMIN_EMAIL, `📋 Copy: Cart link → ${name || to}`, copyHtml).catch(e =>
      console.warn('[CartLink copy email]', e.message)
    );

    // Persist customer details + reminder count back onto the saved cart link
    // so it can be found later in the Sent Cart Links list, resent, or duplicated.
    const token = tokenFromCartUrl(cartUrl);
    if (token) {
      try {
        const existing = await getPendingCartDB(token);
        if (existing) {
          await updatePendingCartDB(token, {
            name:           name  || existing.name  || '',
            email:          to,
            phone:          phone || existing.phone || null,
            source:         source || existing.source || '',
            remindersSent:  (existing.remindersSent || 0) + 1,
            lastReminderAt: new Date().toISOString(),
          });
        }
      } catch (pcErr) {
        console.warn('[CartLink] Could not update pending cart record:', pcErr.message);
      }
    }

    let sheetRecorded = false;
    try {
      sheetRecorded = await sheetsRecordCustomer({ name, email: to, phone, source, items, total, note, cartUrl });
    } catch(sheetErr) {
      console.warn('[Sheets] Record failed (non-fatal):', sheetErr.message);
    }
    res.json({ ok: true, sheetRecorded });
  } catch (err) {
    console.error('[send-cart-link-email]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// List all admin-created cart links (for resending / duplicating)
app.get('/admin/cart-links', requireAdmin, async (req, res) => {
  try {
    const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';
    const carts = await readPendingCartsDB();
    const list = Object.values(carts)
      .filter(c => c.adminCreated && !c.isPhoneOrder)
      .map(c => ({ ...c, url: `${siteUrl}/offerings.html?rc=${c.token}` }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json(list);
  } catch (e) {
    console.error('[cart-links list]', e.message);
    res.status(500).json({ error: 'Could not load cart links' });
  }
});

// Resend the order email for an existing cart link
app.post('/admin/cart-links/:token/resend', requireAdmin, express.json(), async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).json({ error: 'Cart link not found' });
    if (!cart.email) return res.status(400).json({ error: 'This cart link has no customer email on file' });

    const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';
    const cartUrl = `${siteUrl}/offerings.html?rc=${cart.token}`;
    const itemRows = (cart.items || []).map(i => ({
      name: i.name + (i.free ? ' (FREE)' : ''),
      qty: 'x' + (i.quantity || 1),
      price: i.free ? 'FREE' : (i.price ? '$' + (i.price / 100).toFixed(2) : '—'),
    }));
    const totalCents = (cart.items || []).reduce((s, i) => s + (i.free ? 0 : (i.price || 0) * (i.quantity || 1)), 0);
    const html = cartLinkEmailHtml({
      name: cart.name, note: cart.note, items: itemRows,
      total: '$' + (totalCents / 100).toFixed(2), discount: cart.discount, cartUrl,
    });

    await sendEmailTo(cart.email, 'Your custom order from Heart of Texas Organics 🌿', html);
    await updatePendingCartDB(cart.token, {
      remindersSent:  (cart.remindersSent || 0) + 1,
      lastReminderAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('[cart-link resend]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete a cart link permanently
app.delete('/admin/cart-links/:token', requireAdmin, async (req, res) => {
  try {
    const pg = getPcPool();
    if (pg) {
      await pg.query('DELETE FROM pending_carts WHERE token = $1', [req.params.token]);
    } else {
      const carts = readPendingCarts();
      delete carts[req.params.token];
      writePendingCarts(carts);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[cart-link delete]', e.message);
    res.status(500).json({ error: 'Could not delete cart link' });
  }
});

// Preview the email HTML for a cart link — auth via Authorization header only (no query param)
function buildCartPreviewHtml(cart, noteOverride) {
  const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';
  const cartUrl = `${siteUrl}/offerings.html?rc=${cart.token}`;
  const itemRows = (cart.items || []).map(i => ({
    name: i.name + (i.free ? ' (FREE)' : ''),
    qty: 'x' + (i.quantity || 1),
    price: i.free ? 'FREE' : (i.price ? '$' + (i.price / 100).toFixed(2) : '—'),
  }));
  const totalCents = (cart.items || []).reduce((s, i) => s + (i.free ? 0 : (i.price || 0) * (i.quantity || 1)), 0);
  const note = noteOverride !== undefined ? noteOverride : cart.note;
  const emailHtml = cartLinkEmailHtml({
    name: cart.name, note, items: itemRows,
    total: '$' + (totalCents / 100).toFixed(2), discount: cart.discount, cartUrl,
  });
  return emailHtml;
}

// GET — opens a standalone preview page (used for popups)
app.get('/admin/cart-links/:token/preview', requireAdmin, async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).send('<h1>Cart link not found</h1>');
    const emailHtml = buildCartPreviewHtml(cart);
    const escHtml = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const toLine = cart.email
      ? '&nbsp;&middot;&nbsp; To: <strong>' + escHtml(cart.email) + '</strong>'
      : '&nbsp;&middot;&nbsp; <em style="color:#f2994a;">No email on file</em>';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;");
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Email Preview</title>
      <style>body{margin:0;background:#f0f0f0;display:flex;flex-direction:column;align-items:center;padding:20px;font-family:sans-serif;}
      .preview-bar{background:#2C3E2D;color:#F5F0E8;padding:10px 20px;border-radius:8px;margin-bottom:20px;font-size:14px;width:100%;max-width:640px;box-sizing:border-box;}
      </style></head><body>
      <div class="preview-bar">&#128231; <strong>Email Preview</strong> &mdash; This is exactly what the customer will receive.
        Subject: <em>Your custom order from Heart of Texas Organics</em>
        ${toLine}
      </div>
      ${emailHtml}
    </body></html>`);
  } catch (e) {
    console.error('[cart-link preview]', e.message);
    res.status(500).send('<h1>Preview failed</h1>');
  }
});

// POST — returns just the rendered email body HTML with a live note override (does not save)
app.post('/admin/cart-links/:token/preview', requireAdmin, express.json(), async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).json({ error: 'Not found' });
    const emailHtml = buildCartPreviewHtml(cart, req.body.note);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(emailHtml);
  } catch (e) {
    console.error('[cart-link preview post]', e.message);
    res.status(500).send('');
  }
});

// Manually mark a cart link as paid (when Stripe webhook didn't fire)
app.post('/admin/cart-links/:token/mark-paid', requireAdmin, async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).json({ error: 'Cart link not found' });
    await updatePendingCartDB(req.params.token, { completed: true, completedAt: new Date().toISOString() });
    res.json({ ok: true });
  } catch (e) {
    console.error('[cart-link mark-paid]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Update note/email on an existing cart link before sending
app.patch('/admin/cart-links/:token', requireAdmin, express.json(), async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).json({ error: 'Cart link not found' });
    const allowed = ['note', 'email', 'name', 'phone', 'source'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    await updatePendingCartDB(req.params.token, updates);
    res.json({ ok: true });
  } catch (e) {
    console.error('[cart-link patch]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Duplicate an existing cart link into a brand-new link (same items/customer, fresh token)
app.post('/admin/cart-links/:token/duplicate', requireAdmin, async (req, res) => {
  try {
    const cart = await getPendingCartDB(req.params.token);
    if (!cart) return res.status(404).json({ error: 'Cart link not found' });

    const token = crypto.randomBytes(20).toString('hex');
    const newCart = {
      ...cart,
      token,
      createdAt:      new Date().toISOString(),
      remindersSent:  0,
      lastReminderAt: null,
      completed:      false,
    };
    await setPendingCartDB(token, newCart);

    const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';
    res.json({ ok: true, token, url: `${siteUrl}/offerings.html?rc=${token}` });
  } catch (e) {
    console.error('[cart-link duplicate]', e.message);
    res.status(500).json({ error: 'Could not duplicate cart link' });
  }
});

// ─── Phone (MOTO) payments ────────────────────────────────────────────────
// Lets the admin key in a customer's card over the phone. Raw card data is
// entered into a Stripe Elements iframe in the browser and goes straight to
// Stripe — it never touches our server. We only ever see a PaymentIntent id.

app.get('/admin/stripe-publishable-key', requireAdmin, (req, res) => {
  res.json({ key: process.env.STRIPE_PUBLISHABLE_KEY || '' });
});

app.post('/admin/charge/create-intent', requireAdmin, express.json(), async (req, res) => {
  try {
    const { items, customerName, customerEmail, customerPhone, note, taxRate } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'At least one item is required' });

    const subtotalCents = items.reduce((s, i) => s + Math.round(i.price || 0) * (i.quantity || 1), 0);
    const _bundleIds = new Set(['sampler-box','bread-box','harvest-subscription','farm-box','bundle-farm','bundle-turkey','bundle-4th-july','chicken-dinner-roll-bundle']);
    const taxableSubtotal = items.reduce((s, i) => s + (i.taxable && !_bundleIds.has(i.id) ? Math.round(i.price || 0) * (i.quantity || 1) : 0), 0);
    const taxPct = parseFloat(taxRate) || 0;
    const taxCents = taxPct > 0 ? Math.round(taxableSubtotal * taxPct / 100) : 0;
    const totalCents = subtotalCents + taxCents;
    if (totalCents <= 0) return res.status(400).json({ error: 'Total must be greater than $0' });

    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      payment_method_types: ['card'],
      payment_method_options: { card: { moto: true, request_three_d_secure: 'any' } },
      description: `Phone order — ${customerName || 'customer'}`,
      receipt_email: customerEmail || undefined,
      metadata: { type: 'phone-order' },
    });

    // Persisted under the PaymentIntent id so the webhook can find full order
    // details on success (Stripe metadata is too small to hold a full item list).
    await setPendingCartDB(intent.id, {
      token: intent.id, isPhoneOrder: true, adminCreated: true,
      name: customerName || '', email: customerEmail || null, phone: customerPhone || null,
      items, note: note || '', taxRate: taxPct, totalCents,
      itemSummary: items.slice(0, 2).map(i => i.name).join(' & ') + (items.length > 2 ? ` (+${items.length - 2} more)` : ''),
      createdAt: new Date().toISOString(), completed: false, remindersSent: 0, lastReminderAt: null,
    });

    res.json({ ok: true, clientSecret: intent.client_secret, totalCents, taxCents, subtotalCents });
  } catch (e) {
    console.error('[charge/create-intent]', e.message);
    res.status(500).json({ error: e.message || 'Could not start payment' });
  }
});

// Persisted phone order, looked up by the webhook once the PaymentIntent succeeds
async function handlePhoneOrderSucceeded(pi) {
  const order = await getPendingCartDB(pi.id);
  if (!order) { console.error('[phone-order] No pending record for', pi.id); return; }

  const total = formatMoney(pi.amount_received);
  saveOrder(pi.id, {
    sessionId:       pi.id,
    status:          'READY_TO_SHIP',
    source:          'phone',
    total:           pi.amount_received,
    items:           order.items.map(i => ({ name: i.name, qty: i.quantity })),
    paymentMethod:   'card',
    created:         new Date().toISOString(),
    customerName:    order.name  || '',
    customerEmail:   order.email || '',
    customerPhone:   order.phone || '',
    deliveryMethod:  'phone-order',
    customerNotes:   order.note || '',
  });

  try {
    await deductStockForOrder(order.items.map(i => ({ description: i.name, quantity: i.quantity })), pi.id);
  } catch (e) { console.error('[phone-order] stock deduction error:', e.message); }

  await updatePendingCartDB(pi.id, { completed: true });

  const itemLines = order.items.map(i =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #e8e2d6;">${i.name}</td>
         <td style="padding:6px 10px;border-bottom:1px solid #e8e2d6;text-align:center;">x${i.quantity}</td></tr>`
  ).join('');

  await sendEmail(
    `📞 Phone Order Charged — ${total}`,
    `<h2 style="color:#2C3E2D;">Phone Order Payment Succeeded</h2>
     <p><strong>Customer:</strong> ${order.name || 'unknown'} ${order.email ? '&lt;' + order.email + '&gt;' : ''} ${order.phone ? '· ' + order.phone : ''}</p>
     <p><strong>Total charged:</strong> ${total}</p>
     <table style="width:100%;border-collapse:collapse;">${itemLines}</table>
     ${order.note ? `<p><strong>Note:</strong> ${order.note}</p>` : ''}
     ${fulfillmentBadge('READY_TO_SHIP')}
     <p style="color:#888;font-size:12px;">PaymentIntent: ${pi.id}</p>`
  );

  if (order.email) {
    await sendEmailTo(order.email,
      'Your Heart of Texas Organics Order is Confirmed 🌾',
      `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
        <h2 style="color:#2C3E2D;">Your order is confirmed! 🌾</h2>
        <p style="color:#3d3d3d;line-height:1.9;">Hi ${order.name || 'there'}, thanks for your order over the phone — here's what we charged:</p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:4px;overflow:hidden;">${itemLines}</table>
        <p style="color:#2C3E2D;font-weight:700;margin-top:16px;">Total: ${total}</p>
        <p style="color:#3d3d3d;line-height:1.9;margin-top:24px;">Questions? Just reply to this email or reach us at operations@heartoftexasorganics.com.</p>
      </div>`
    );
  }
}

// TEMP: create FREE test promo code using this server's Stripe key
app.post('/admin/create-test-promo', requireAdmin, async (req, res) => {
  try {
    const keyPrefix = (process.env.STRIPE_SECRET_KEY || '').slice(0, 12);
    try { await stripe.coupons.del('TEST_FREE'); } catch (_) {}
    const coupon = await stripe.coupons.create({
      id: 'TEST_FREE', name: 'Test — 100% Off',
      percent_off: 100, duration: 'forever', max_redemptions: 50,
    });
    let promoCode;
    try {
      promoCode = await stripe.promotionCodes.create({ coupon: coupon.id, code: 'FREE', max_redemptions: 50 });
    } catch (e) {
      // Already exists — find and return it
      const list = await stripe.promotionCodes.list({ limit: 20 });
      promoCode = list.data.find(p => p.code === 'FREE') || { code: 'FREE (already existed)', active: true };
    }
    res.json({ keyPrefix, coupon: coupon.id, promoCode: promoCode.code, active: promoCode.active });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin auth routes ---
app.post('/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.json({ token: makeAdminToken() });
});

app.post('/admin/logout', (req, res) => {
  // Token is stateless; client drops it from localStorage on logout
  res.json({ ok: true });
});

app.get('/admin/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// --- Cart link builder ---
app.post('/admin/create-cart-link', requireAdmin, express.json(), async (req, res) => {
  try {
    const { items, note, subscription, subPrice, discount, taxRate, custName, custEmail, custPhone, custSource } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items required' });
    if (subscription && (!subPrice || subPrice <= 0)) return res.status(400).json({ error: 'Monthly price required for subscription links' });

    const token       = crypto.randomBytes(20).toString('hex');
    const itemSummary = items.slice(0, 2).map(i => i.name).join(' & ') + (items.length > 2 ? ` (+${items.length - 2} more)` : '');
    const subName     = subscription ? `Monthly Box — ${itemSummary}` : null;

    const cartData = {
      token,
      name:           custName  || '',
      email:          custEmail || null,
      phone:          custPhone || null,
      source:         custSource || '',
      items,
      itemSummary,
      subName,
      note:           note || '',
      location:       '',
      createdAt:      new Date().toISOString(),
      remindersSent:  0,
      lastReminderAt: null,
      completed:      false,
      adminCreated:   true,
      subscription:   subscription || false,
      subPrice:       subscription ? Math.round(subPrice) : null,
      discount:       discount || null,
      taxRate:        taxRate > 0 ? taxRate : 0,
    };

    await setPendingCartDB(token, cartData);

    const siteUrl = process.env.SITE_URL || 'https://www.heartoftexasorganics.com';
    res.json({ ok: true, token, url: `${siteUrl}/offerings.html?rc=${token}` });
  } catch(e) {
    console.error('[CartLink] error:', e.message);
    res.status(500).json({ error: 'Could not create cart link' });
  }
});

// --- Public stock endpoint (for website sold-out indicators) ---
app.get('/api/stock', async (req, res) => {
  const rows = (await db.getAll()).map(p => ({ id: p.id, name: p.name, stock: p.stock, reorder_level: p.reorder_level, allow_preorder: p.allow_preorder }));
  res.json(rows);
});

// --- Inventory CRUD ---
app.get('/admin/inventory', requireAdmin, async (req, res) => {
  res.json(await db.getAll());
});

app.put('/admin/inventory/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reorder_level, price_cents, cost_cents, unit, allow_preorder } = req.body || {};
  const product = await db.getProduct(id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const fields = {};
  if (reorder_level  != null) fields.reorder_level  = parseInt(reorder_level);
  if (price_cents    != null) fields.price_cents     = parseInt(price_cents);
  if (cost_cents     != null) fields.cost_cents      = parseInt(cost_cents);
  if (unit           != null) fields.unit            = unit;
  if (allow_preorder != null) fields.allow_preorder  = allow_preorder ? 1 : 0;
  await db.updateProduct(id, fields);
  res.json({ ok: true });
});

// Legacy link expiry contact form (legacy-farm-arnosky.netlify.app)
app.post('/api/legacy-contact', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://legacy-farm-arnosky.netlify.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  const { name, email, phone } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
  const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const safeMailto = 'mailto:' + encodeURIComponent(email);
  const html = `
    <h2 style="font-family:Georgia,serif;color:#4a3728;">New Link Request — Legacy Farm Arnosky</h2>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;width:160px;"><strong>Name</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(name)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Email</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;"><a href="${safeMailto}">${esc(email)}</a></td></tr>
      <tr><td style="padding:10px;color:#9a7b62;"><strong>Phone</strong></td><td style="padding:10px;">${esc(phone) || 'Not provided'}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#9a7b62;">Submitted from legacy-farm-arnosky.netlify.app</p>
  `;
  try {
    await sendEmail('New Link Request — Legacy Farm Arnosky', html);
    res.json({ ok: true });
  } catch (err) {
    console.error('[legacy-contact error]', err.message);
    res.status(500).json({ error: 'Failed to send' });
  }
});

app.options('/api/legacy-contact', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://legacy-farm-arnosky.netlify.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.post('/api/csa-inquiry', async (req, res) => {
  const { fullName, city, household, frustrations } = req.body || {};
  if (!fullName || !city || !household) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const esc = s => String(s).slice(0, 500).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const frustrationList = Array.isArray(frustrations) && frustrations.length
    ? frustrations.filter(f => typeof f === 'string').map(f => `<li>${esc(f)}</li>`).join('')
    : '<li>None selected</li>';
  const html = `
    <h2 style="font-family:Georgia,serif;color:#4a3728;">New Farm Box &amp; CSA Consultation Request</h2>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;width:200px;"><strong>Full Name</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(fullName)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>City</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(city)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Household Size</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(household)}</td></tr>
      <tr><td style="padding:10px;color:#9a7b62;vertical-align:top;"><strong>Biggest Frustrations</strong></td><td style="padding:10px;"><ul style="margin:0;padding-left:18px;">${frustrationList}</ul></td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#9a7b62;">Submitted from heartoftexasorganics.com/book-a-call.html</p>
  `;
  try {
    await db.createLead('csa', { fullName, city, household, frustrations });
  } catch (err) {
    console.error('[CSA createLead error]', err.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
  sendEmail('New CSA Consultation Request - Heart of Texas Organics', html)
    .catch(err => console.error('[CSA email error]', err.message));
  res.json({ ok: true });
});

app.post('/api/bni-inquiry', async (req, res) => {
  const { fullName, chapter, location, email } = req.body || {};
  if (!fullName || !chapter || !location || !email) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const esc = s => String(s).slice(0, 500).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const html = `
    <h2 style="font-family:Georgia,serif;color:#4a3728;">New BNI 1:1 Booking Request</h2>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;width:180px;"><strong>Full Name</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(fullName)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Email</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>BNI Chapter</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(chapter)}</td></tr>
      <tr><td style="padding:10px;color:#9a7b62;"><strong>BNI Location</strong></td><td style="padding:10px;">${esc(location)}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#9a7b62;">Submitted from heartoftexasorganics.com/book-a-call.html</p>
  `;
  try {
    await db.createLead('bni', { fullName, chapter, location, email });
  } catch (err) {
    console.error('[BNI createLead error]', err.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
  sendEmail('New BNI 1:1 Booking Request - Heart of Texas Organics', html)
    .catch(err => console.error('[BNI email error]', err.message));
  res.json({ ok: true });
});

app.post('/api/wholesale-inquiry', async (req, res) => {
  const { bizName, bizType, products, volume, location, notes } = req.body || {};
  if (!bizName || !bizType || !volume || !location) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const esc = s => String(s).slice(0, 500).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const productList = Array.isArray(products) && products.length
    ? products.filter(p => typeof p === 'string').map(p => `<li>${esc(p)}</li>`).join('')
    : '<li>Not specified</li>';
  const html = `
    <h2 style="font-family:Georgia,serif;color:#4a3728;">New Wholesale Inquiry</h2>
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;width:180px;"><strong>Business Name</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(bizName)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Business Type</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(bizType)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Products Interested In</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;"><ul style="margin:0;padding-left:18px;">${productList}</ul></td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>Monthly Volume</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(volume)}</td></tr>
      <tr><td style="padding:10px;border-bottom:1px solid #ede8df;color:#9a7b62;"><strong>City / Area</strong></td><td style="padding:10px;border-bottom:1px solid #ede8df;">${esc(location)}</td></tr>
      <tr><td style="padding:10px;color:#9a7b62;"><strong>Additional Notes</strong></td><td style="padding:10px;">${esc(notes || '—')}</td></tr>
    </table>
    <p style="margin-top:20px;font-size:12px;color:#9a7b62;">Submitted from heartoftexasorganics.com/book-a-call.html</p>
  `;
  try {
    await db.createLead('wholesale', { bizName, bizType, products, volume, location, notes });
  } catch (err) {
    console.error('[Wholesale createLead error]', err.message);
    return res.status(500).json({ error: 'Failed to save lead' });
  }
  sendEmail('New Wholesale Inquiry - Heart of Texas Organics', html)
    .catch(err => console.error('[Wholesale email error]', err.message));
  res.json({ ok: true });
});

// ── Leads admin routes ────────────────────────────────────────────────────────

app.get('/admin/leads', requireAdmin, async (req, res) => {
  const type = req.query.type || null;
  const leads = await db.getLeads(type);
  res.json(leads);
});

app.patch('/admin/leads/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { contacted, notes, data } = req.body || {};
  const fields = {};
  if (contacted !== undefined) fields.contacted = !!contacted;
  if (notes     !== undefined) fields.notes     = String(notes).slice(0, 1000);
  if (data      !== undefined && typeof data === 'object' && !Array.isArray(data)) fields.data = data;
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  await db.updateLead(id, fields);
  res.json({ ok: true });
});

app.get('/admin/leads/export.csv', requireAdmin, async (req, res) => {
  const leads = await db.getLeads();
  const safeCell = c => {
    const s = String(c == null ? '' : c);
    const escaped = s.replace(/"/g, '""');
    return /^[=+\-@\t\r]/.test(s) ? `"'${escaped}"` : `"${escaped}"`;
  };
  const rows  = [['ID','Type','Name','Date','Contacted','Data','Notes']];
  for (const l of leads) {
    const d    = l.data || {};
    const name = d.fullName || d.bizName || '';
    rows.push([l.id, l.type, name, l.created_at, l.contacted ? 'Yes' : 'No', JSON.stringify(d), l.notes || '']);
  }
  const csv = rows.map(r => r.map(safeCell).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hoto-leads.csv"');
  res.send(csv);
});

app.delete('/admin/leads/:id', requireAdmin, async (req, res) => {
  await db.updateLead(req.params.id, { notes: '__deleted__' });
  res.json({ ok: true });
});

// Convert lead → customer
app.post('/admin/leads/:id/convert', requireAdmin, express.json(), async (req, res) => {
  const { name, email, phone, source } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const customer = await db.createCustomer({ name, email, phone, source, tags: [], notes: null, lead_id: parseInt(req.params.id) });
    const lead = await db.getLead(req.params.id);
    if (lead) {
      const newData = Object.assign({}, lead.data || {}, { converted: true, customer_id: customer.id });
      await db.updateLead(req.params.id, { data: newData });
    }
    res.json(customer);
  } catch (err) {
    console.error('[convert lead error]', err.message);
    res.status(500).json({ error: 'Failed to convert lead' });
  }
});

// ── Customer CRM routes ───────────────────────────────────────────────────────

app.post('/admin/customers', requireAdmin, express.json(), async (req, res) => {
  const { name, email, phone, source, tags, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const customer = await db.createCustomer({ name, email, phone, source, tags: tags || [], notes, lead_id: null });
    res.json(customer);
  } catch (err) {
    console.error('[createCustomer error]', err.message);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

app.get('/admin/customers', requireAdmin, async (req, res) => {
  const customers = await db.getCustomers();
  res.json(customers);
});

app.patch('/admin/customers/:id', requireAdmin, express.json(), async (req, res) => {
  const { name, email, phone, source, tags, notes } = req.body || {};
  const fields = {};
  if (name   !== undefined) fields.name   = String(name).slice(0, 200);
  if (email  !== undefined) fields.email  = email  || null;
  if (phone  !== undefined) fields.phone  = phone  || null;
  if (source !== undefined) fields.source = source || null;
  if (tags   !== undefined && Array.isArray(tags)) fields.tags = tags;
  if (notes  !== undefined) fields.notes  = String(notes).slice(0, 2000);
  if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to update' });
  await db.updateCustomer(req.params.id, fields);
  res.json({ ok: true });
});

app.delete('/admin/customers/:id', requireAdmin, async (req, res) => {
  await db.updateCustomer(req.params.id, { notes: '__deleted__' });
  res.json({ ok: true });
});

// ── Inventory admin routes ────────────────────────────────────────────────────

app.delete('/admin/inventory/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const removed = await db.deleteProduct(id);
  if (!removed) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

app.post('/admin/inventory/:id/adjust', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { quantity, notes, channel } = req.body || {};
  if (quantity == null || isNaN(parseInt(quantity))) return res.status(400).json({ error: 'quantity required' });
  const qty = parseInt(quantity);
  if (!await db.getProduct(id)) return res.status(404).json({ error: 'Product not found' });
  const result = await db.adjustStock(id, qty);
  await db.addTransaction(id, 'adjustment', qty, null, null, notes || null, channel || null, result.before, result.after);
  res.json({ ok: true, stock: result.after });
});

app.post('/admin/inventory/:id/restock', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { quantity, batch_number, notes, channel, prod_date, expiry_date, batch_cost_cents } = req.body || {};
  const qty = parseInt(quantity);
  if (!qty || qty <= 0) return res.status(400).json({ error: 'quantity must be a positive integer' });
  if (!await db.getProduct(id)) return res.status(404).json({ error: 'Product not found' });
  const result = await db.adjustStock(id, qty);
  const extra = {};
  if (prod_date)         extra.prod_date        = prod_date;
  if (expiry_date)       extra.expiry_date       = expiry_date;
  if (batch_cost_cents != null) extra.batch_cost_cents = Math.round(parseFloat(batch_cost_cents) * 100);
  await db.addTransaction(id, 'restock', qty, batch_number || null, null, notes || null, channel || null, result.before, result.after, extra);
  res.json({ ok: true, stock: result.after });
});

// --- Transaction history ---
app.get('/admin/transactions', requireAdmin, async (req, res) => {
  const { product_id, date_from, date_to } = req.query;
  res.json(await db.getTransactions(product_id || null, 150, date_from || null, date_to || null));
});

app.get('/admin/orders', requireAdmin, (req, res) => {
  const orders = readOrders();
  const list = Object.entries(orders)
    .map(([piId, data]) => ({ piId, ...data }))
    .sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));
  res.json(list);
});

app.delete('/admin/orders/:piId', requireAdmin, (req, res) => {
  const { piId } = req.params;
  const orders = readOrders();
  if (!orders[piId]) return res.status(404).json({ error: 'Order not found' });
  delete orders[piId];
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  res.json({ ok: true });
});

app.delete('/admin/orders', requireAdmin, (req, res) => {
  const { piIds } = req.body;
  if (!Array.isArray(piIds) || !piIds.length) return res.status(400).json({ error: 'piIds array required' });
  const orders = readOrders();
  piIds.forEach(id => { delete orders[id]; });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  res.json({ ok: true, deleted: piIds.length });
});

app.put('/admin/orders/:piId/complete', requireAdmin, (req, res) => {
  const { piId } = req.params;
  const orders = readOrders();
  if (!orders[piId]) return res.status(404).json({ error: 'Order not found' });
  orders[piId] = {
    ...orders[piId],
    previousStatus: orders[piId].status,
    status: 'COMPLETED',
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  res.json({ ok: true });
});

app.put('/admin/orders/:piId/uncomplete', requireAdmin, (req, res) => {
  const { piId } = req.params;
  const orders = readOrders();
  if (!orders[piId]) return res.status(404).json({ error: 'Order not found' });
  const revertTo = orders[piId].previousStatus || 'READY_TO_SHIP';
  orders[piId] = {
    ...orders[piId],
    status: revertTo,
    previousStatus: null,
    completedAt: null,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  res.json({ ok: true, status: revertTo });
});

// --- Shared Stripe sync logic (used by startup + manual sync endpoint) ---
async function performStripeSync(limit = 50) {
  let allSessions = [];
  let hasMore = true;
  let startingAfter = undefined;

  while (hasMore && allSessions.length < limit) {
    const params = { limit: 100, expand: ['data.line_items'] };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripe.checkout.sessions.list(params);
    const completed = page.data.filter(s => s.status === 'complete');
    allSessions.push(...completed);
    hasMore = page.has_more;
    if (page.data.length) startingAfter = page.data[page.data.length - 1].id;
    if (allSessions.length >= limit) break;
  }

  const orders = readOrders();
  let synced = 0;
  let skipped = 0;
  const syncedDetails = [];

  for (const session of allSessions.slice(0, limit)) {
    const piId = session.payment_intent || ('sess_' + session.id);
    if (orders[piId]) { skipped++; continue; }

    const items           = session.line_items?.data ?? [];
    const hasWebsiteMeta  = !!session.metadata?.delivery_method;
    const isInPerson      = !hasWebsiteMeta;
    const deliveryMethod  = session.metadata?.delivery_method || 'ship';
    const pickupLoc       = session.metadata?.pickup_location || '';
    const pickupPhone     = session.metadata?.pickup_phone    || '';
    const pickupEmail     = session.metadata?.pickup_email    || '';
    const pickupStreet1   = session.metadata?.pickup_street1  || '';
    const pickupStreet2   = session.metadata?.pickup_street2  || '';
    const pickupCity      = session.metadata?.pickup_city     || '';
    const pickupState     = session.metadata?.pickup_state    || '';
    const pickupZip       = session.metadata?.pickup_zip      || '';
    const pickupAddress   = [pickupStreet1, pickupStreet2, pickupCity, pickupState, pickupZip].filter(Boolean).join(', ');
    const pickupCommPref  = session.metadata?.pickup_comm     || '';
    const customerName    = session.customer_details?.name  || 'Valued Customer';
    const customerEmail   = session.customer_details?.email || '';
    const shippingAddr    = session.shipping_details?.address;
    const isPaid          = session.payment_status === 'paid';
    const isGift          = session.metadata?.is_gift === 'true';

    saveOrder(piId, {
      sessionId:       session.id,
      status:          isInPerson ? 'IN_PERSON_SALE' : (isPaid ? 'READY_TO_SHIP' : 'AWAITING_PAYMENT'),
      source:          isInPerson ? 'in-person' : 'website',
      total:           session.amount_total,
      items:           items.map(li => ({ name: li.description, qty: li.quantity })),
      paymentMethod:   'stripe-sync',
      created:         new Date(session.created * 1000).toISOString(),
      customerName,
      customerEmail,
      deliveryMethod,
      pickupLocation:  pickupLoc,
      pickupPhone,
      pickupEmail,
      pickupAddress,
      pickupCommPref,
      shippingAddress: shippingAddr ? {
        name:   customerName,
        street: shippingAddr.line1 + (shippingAddr.line2 ? ' ' + shippingAddr.line2 : ''),
        city:   shippingAddr.city,
        state:  shippingAddr.state,
        zip:    shippingAddr.postal_code,
        phone:  session.customer_details?.phone || '',
      } : null,
      isGift,
      giftOccasion: session.metadata?.gift_occasion || '',
      giftMsg:      session.metadata?.gift_msg      || '',
    });

    // Only deduct stock for website orders — in-person sales are already fulfilled
    if (!isInPerson && isPaid) {
      const productItems = items.filter(li =>
        li.description && !li.description.startsWith('Shipping')
      );
      const orderDate = new Date(session.created * 1000).toISOString();
      try {
        await deductStockForOrder(productItems, session.id, orderDate);
      } catch(e) {
        console.warn('[Sync] Stock deduction failed for', session.id, ':', e.message);
      }
    }

    synced++;
    syncedDetails.push({
      piId,
      customer: customerName,
      total:    session.amount_total,
      delivery: deliveryMethod,
      pickup:   pickupLoc,
      created:  new Date(session.created * 1000).toISOString(),
    });
  }

  return { synced, skipped, orders: syncedDetails };
}

// --- Clean phantom sync transactions and re-sync with correct dates ---
app.post('/admin/transactions/resync', requireAdmin, async (req, res) => {
  try {
    // Step 1: delete all 'Stripe checkout' transactions and restore stock
    const cleanup = await db.deleteTransactionsByNotes('Stripe checkout');
    console.log(`[Resync] Cleared ${cleanup.deleted} phantom transactions, restored ${cleanup.products} products`);

    // Step 2: re-sync from Stripe with real order dates (dedup now prevents re-importing duplicates from webhooks)
    const limit = Math.min(parseInt(req.body?.limit) || 100, 100);
    const result = await performStripeSync(limit);
    console.log(`[Resync] Re-synced ${result.synced} orders with correct dates`);

    res.json({ ok: true, cleaned: cleanup.deleted, synced: result.synced, skipped: result.skipped });
  } catch (e) {
    console.error('[Resync]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// --- Stripe Order Sync endpoint (manual trigger from dashboard) ---
app.post('/admin/sync-from-stripe', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.body?.limit) || 50, 100);
    const result = await performStripeSync(limit);
    console.log(`[Sync] Synced ${result.synced} orders from Stripe, skipped ${result.skipped}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[Sync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================================
// ABANDONED CART — SAVE & RESTORE
// =========================================

app.post('/api/save-pending-cart', express.json(), (req, res) => {
  try {
    const { phone, email, items, location } = req.body || {};
    const normalized = normalizePhone(phone);
    if (!normalized && !email) return res.status(400).json({ error: 'phone or email required' });

    const token = crypto.randomBytes(20).toString('hex');
    const itemSummary = Array.isArray(items)
      ? items.slice(0, 2).map(i => i.name).join(' & ') + (items.length > 2 ? ` (+${items.length - 2} more)` : '')
      : 'your items';

    const carts = readPendingCarts();

    // Dedupe: remove older pending cart from same phone/email
    Object.keys(carts).forEach(k => {
      if (!carts[k].completed && (carts[k].phone === normalized || carts[k].email === email)) {
        delete carts[k];
      }
    });

    carts[token] = {
      token,
      phone:       normalized || null,
      email:       email || null,
      items:       items || [],
      itemSummary,
      location:    location || '',
      createdAt:   new Date().toISOString(),
      remindersSent: 0,
      lastReminderAt: null,
      completed:   false,
    };
    writePendingCarts(carts);
    res.json({ ok: true, token });
  } catch(e) {
    console.error('[PendingCart] save error:', e.message);
    res.status(500).json({ error: 'Could not save cart' });
  }
});

app.get('/api/restore-cart', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });
    const cart = await getPendingCartDB(token);
    if (!cart) return res.status(404).json({ error: 'Cart not found or expired' });
    res.json({
      ok:           true,
      items:        cart.items,
      location:     cart.location,
      subscription: cart.subscription  || false,
      subPrice:     cart.subPrice      || null,
      subName:      cart.subName       || null,
      discount:     cart.discount      || null,
      taxRate:      cart.taxRate       || 0,
    });
  } catch(e) {
    console.error('[restore-cart]', e.message);
    res.status(500).json({ error: 'Could not restore cart' });
  }
});

// Cron: every 30 minutes — send SMS reminders for abandoned carts
if (cron) {
  cron.schedule('*/30 * * * *', async () => {
    if (!twilioClient) return;
    const now = Date.now();
    const carts = readPendingCarts();
    let changed = false;

    // Reminder schedule (ms after createdAt)
    const schedule = [
      60 * 60 * 1000,       // 1 hour  → reminder 0
      4  * 60 * 60 * 1000,  // 4 hours → reminder 1
      24 * 60 * 60 * 1000,  // 24 hours → reminder 2
    ];

    for (const token of Object.keys(carts)) {
      const cart = carts[token];
      if (cart.completed) continue;
      if (cart.remindersSent >= SMS_MESSAGES.length) continue;
      if (!cart.phone) continue;

      const age       = now - new Date(cart.createdAt).getTime();
      const threshold = schedule[cart.remindersSent];
      if (age < threshold) continue;

      const sent = await sendAbandonedCartSMS(cart, cart.remindersSent);
      if (sent) {
        cart.remindersSent++;
        cart.lastReminderAt = new Date().toISOString();
        changed = true;
      }
    }

    // Clean up carts older than 48h
    Object.keys(carts).forEach(k => {
      const age = now - new Date(carts[k].createdAt).getTime();
      if (age > 48 * 60 * 60 * 1000) { delete carts[k]; changed = true; }
    });

    if (changed) writePendingCarts(carts);
  });
  console.log('[Cron] Abandoned cart SMS scheduler running');
}

// --- Webhook health check ---
app.get('/admin/webhook-status', requireAdmin, (req, res) => {
  const hasSecret = !!process.env.STRIPE_WEBHOOK_SECRET_ORDERS;
  const orderCount = Object.keys(readOrders()).length;
  res.json({
    webhook_secret_configured: hasSecret,
    orders_on_file: orderCount,
    webhook_url_should_be: `${process.env.SITE_URL || 'https://heartoftexasorganics.com'}/webhook`,
    tip: hasSecret ? 'Secret is set. If orders are still missing, verify the URL in your Stripe dashboard matches the above.' : 'STRIPE_WEBHOOK_SECRET is not set in your environment variables.',
  });
});

// --- Reports ---
app.get('/admin/reports/weekly', requireAdmin, async (req, res) => {
  const sales = await db.getSales(7);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

app.get('/admin/reports/monthly', requireAdmin, async (req, res) => {
  const sales = await db.getSales(30);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

app.get('/admin/reports/range', requireAdmin, async (req, res) => {
  const { date_from, date_to } = req.query;
  if (!date_from || !date_to) return res.status(400).json({ error: 'date_from and date_to required (YYYY-MM-DD)' });
  const sales = await db.getSales(0, date_from, date_to);
  res.json({ sales, total_revenue: sales.reduce((s, r) => s + r.revenue_cents, 0), total_profit: sales.reduce((s, r) => s + r.profit_cents, 0) });
});

// --- CSV export ---
app.get('/admin/export/csv', requireAdmin, async (req, res) => {
  const { products, transactions: txns } = await db.getAllForCSV();

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
    const report = await buildWeeklyReport();
    await sendEmail('Weekly Inventory Report — Heart of Texas Organics', report);
    res.json({ ok: true });
  } catch (err) {
    console.error('Send weekly report error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function buildWeeklyReport() {
  const sales    = await db.getSales(7);
  const products = (await db.getAll()).sort((a, b) => a.stock - b.stock);
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
      const report = await buildWeeklyReport();
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
// MAGAZINE SUBSCRIBERS
// =========================================

const MAG_SUBS_FILE     = path.join(__dirname, 'magazine-subscribers.json');
const OBSIDIAN_MAG_SUBS = '/Users/deborahsmith/Documents/collab/HOTO/Best Medicines/subscribers';

function readMagSubs() {
  try { return JSON.parse(fs.readFileSync(MAG_SUBS_FILE, 'utf8')); }
  catch { return []; }
}
function saveMagSubs(subs) {
  fs.writeFileSync(MAG_SUBS_FILE, JSON.stringify(subs, null, 2));
}

app.post('/api/magazine-subscribe', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, address } = req.body;
    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const now = new Date();
    const sub = { firstName, lastName, email, phone, address: address || '', agreedToUpdates: true, createdAt: now.toISOString() };
    const subs = readMagSubs();
    subs.push(sub);
    saveMagSubs(subs);

    // Write Obsidian note
    try {
      if (!fs.existsSync(OBSIDIAN_MAG_SUBS)) fs.mkdirSync(OBSIDIAN_MAG_SUBS, { recursive: true });
      const slug = `${now.toISOString().slice(0,10)}-${firstName.toLowerCase()}-${lastName.toLowerCase()}`.replace(/[^a-z0-9-]/g, '-');
      const md = `---\ntitle: "${firstName} ${lastName} — Best Medicines Subscriber"\ndate: ${now.toISOString().slice(0,10)}\ntags: [magazine, subscriber, best-medicines]\n---\n\n# ${firstName} ${lastName}\n\n| Field | Value |\n|-------|-------|\n| **Email** | ${email} |\n| **Phone** | ${phone} |\n| **Address** | ${address || 'Not provided'} |\n| **Signed up** | ${now.toLocaleString('en-US', { timeZone: 'America/Chicago' })} |\n| **Agreed to updates** | Yes |\n`;
      fs.writeFileSync(path.join(OBSIDIAN_MAG_SUBS, slug + '.md'), md);
    } catch (obsErr) {
      console.warn('Obsidian write skipped:', obsErr.message);
    }

    res.json({ success: true, count: subs.length });
  } catch (err) {
    console.error('Magazine subscribe error:', err.message);
    res.status(500).json({ error: 'Could not save subscriber' });
  }
});

app.get('/api/magazine-subscribers', requireAdmin, (req, res) => {
  res.json(readMagSubs());
});

app.get('/api/staples-subscribers', requireAdmin, async (req, res) => {
  try {
    const result = [];
    let startingAfter;
    do {
      const params = {
        limit: 100,
        status: 'active',
        expand: ['data.customer', 'data.items.data.price.product'],
      };
      if (startingAfter) params.starting_after = startingAfter;
      const page = await stripe.subscriptions.list(params);
      for (const sub of page.data) {
        const isMag = sub.items.data.some(item => {
          const name = (item.price?.product?.name || '').toLowerCase();
          return name.includes('magazine') || name.includes('best medicines');
        });
        if (isMag) continue;
        const c = sub.customer;
        const addr = c.address
          ? [c.address.line1, c.address.city, c.address.state, c.address.postal_code]
              .filter(Boolean).join(', ')
          : '';
        result.push({
          customerId: c.id,
          name:       c.name  || '',
          email:      c.email || '',
          phone:      c.phone || '',
          address:    addr,
          items:      sub.metadata?.items || sub.items.data.map(i => i.price?.product?.name || 'Monthly Box').join(', '),
          delivery:   sub.metadata?.delivery_method || '',
          amountCents: sub.items.data.reduce((s, i) => s + (i.price?.unit_amount || 0) * (i.quantity || 1), 0),
          nextCharge: sub.current_period_end,
          status:     sub.status,
          createdAt:  new Date(sub.created * 1000).toISOString(),
        });
      }
      startingAfter = page.has_more ? page.data[page.data.length - 1].id : null;
    } while (startingAfter);
    res.json(result);
  } catch (err) {
    console.error('Staples subscribers error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/magazine-subscribers/csv', requireAdmin, (req, res) => {
  const subs = readMagSubs();
  const header = ['First Name','Last Name','Email','Phone','Address','Agreed to Updates','Date'];
  const rows = [header, ...subs.map(s => [
    s.firstName || s.first || '',
    s.lastName  || s.last  || '',
    s.email     || '',
    s.phone     || '',
    s.address   || '',
    s.agreedToUpdates || s.agreed ? 'Yes' : 'No',
    (s.createdAt || s.date || '').slice(0, 10),
  ])];
  const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="best-medicines-subscribers.csv"');
  res.send(csv);
});

// =========================================
// WORKSHOP INTEREST
// =========================================

const WORKSHOP_INTEREST_FILE = path.join(__dirname, 'workshop-interest.json');

function readWorkshopInterest() {
  try { return JSON.parse(fs.readFileSync(WORKSHOP_INTEREST_FILE, 'utf8')); }
  catch { return []; }
}
function saveWorkshopInterest(list) {
  fs.writeFileSync(WORKSHOP_INTEREST_FILE, JSON.stringify(list, null, 2));
}

app.post('/api/workshop-interest', express.json(), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }
    const list = readWorkshopInterest();
    if (list.some(e => e.email.toLowerCase() === email.toLowerCase())) {
      return res.json({ success: true, alreadyRegistered: true });
    }
    list.push({ email: email.toLowerCase(), createdAt: new Date().toISOString() });
    saveWorkshopInterest(list);
    res.json({ success: true });
  } catch (err) {
    console.error('Workshop interest error:', err.message);
    res.status(500).json({ error: 'Could not save email' });
  }
});

app.get('/admin/workshop-interest', requireAdmin, (req, res) => {
  res.json(readWorkshopInterest());
});

// =========================================
// =========================================
// BUNDLE — 4th of July Homestead Table
// =========================================

const BUNDLE_TOTAL = 25;
const BUNDLE_PRICE_CENTS = 19900;
const bundleSalesFile = path.join(__dirname, 'data', 'bundle-sales.json');

function getBundleSales() {
  try {
    if (fs.existsSync(bundleSalesFile)) return JSON.parse(fs.readFileSync(bundleSalesFile, 'utf8'));
  } catch {}
  return { sold: 0, orders: [] };
}

function saveBundleSales(data) {
  try {
    const dir = path.dirname(bundleSalesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(bundleSalesFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[Bundle] Could not save sales file:', e.message);
  }
}

// GET /bundle-availability
app.get('/bundle-availability', (req, res) => {
  const sales = getBundleSales();
  res.json({ sold: sales.sold, total: BUNDLE_TOTAL, remaining: Math.max(0, BUNDLE_TOTAL - sales.sold) });
});

// GET /bundle-qr — serves QR code image
app.get('/bundle-qr', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const url = `${req.protocol}://${req.get('host')}/bundle.html`;
    const qr = await QRCode.toBuffer(url, { width: 280, margin: 2, color: { dark: '#2C3E2D', light: '#F5F0E8' } });
    res.set('Content-Type', 'image/png');
    res.send(qr);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /flyer — printable one-page flyer with QR codes for the chicken bundle & sampler box
app.get('/flyer', async (req, res) => {
  try {
    const QRCode = require('qrcode');
    const chickenUrl = `${SITE_URL_BASE}/?start=chicken-bundle`;
    const samplerUrl = `${SITE_URL_BASE}/?start=sampler-box`;
    const [chickenQR, samplerQR] = await Promise.all([
      QRCode.toDataURL(chickenUrl, { width: 220, margin: 1, color: { dark: '#2C3E2D', light: '#FFFFFF' } }),
      QRCode.toDataURL(samplerUrl, { width: 220, margin: 1, color: { dark: '#2C3E2D', light: '#FFFFFF' } }),
    ]);

    const host = req.get('host');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Heart of Texas Organics — Fresh This Week</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap');
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:Georgia,serif;background:#eee;color:#2C3E2D;}
  .toolbar{background:#2C3E2D;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;}
  .toolbar-title{color:#F5F0E8;font-family:'Lato',sans-serif;font-size:13px;}
  .toolbar-btns{display:flex;gap:10px;}
  .toolbar-btns a{display:inline-block;padding:9px 20px;border-radius:7px;font-family:'Lato',sans-serif;font-size:12px;font-weight:700;text-decoration:none;letter-spacing:0.06em;cursor:pointer;}
  .btn-pdf{background:#8B3A2A;color:#F5F0E8;}
  .btn-print{background:transparent;color:#F5F0E8;border:1.5px solid rgba(245,240,232,0.4);}
  .page{width:8.5in;min-height:11in;margin:0 auto;display:flex;flex-direction:column;background:#fff;box-shadow:0 4px 30px rgba(0,0,0,0.18);}
  @media print{.toolbar{display:none;}body{background:#fff;}}

  /* Header band */
  .hdr{background:#2C3E2D;color:#F5F0E8;padding:18px 40px;display:flex;align-items:center;justify-content:space-between;}
  .hdr-name{font-size:24px;letter-spacing:0.04em;}
  .hdr-tag{font-family:'Lato',sans-serif;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.9;margin-top:4px;}
  .hdr-right{font-family:'Lato',sans-serif;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.9;text-align:right;}

  /* Rust accent bar */
  .rust-bar{height:6px;background:#8B3A2A;}

  /* Intro section */
  .intro{background:#F5F0E8;padding:28px 40px 24px;}
  .intro-eyebrow{font-family:'Lato',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#8B3A2A;margin-bottom:10px;}
  .intro-headline{font-size:32px;line-height:1.15;color:#2C3E2D;margin-bottom:14px;}
  .intro-headline em{font-style:normal;color:#8B3A2A;}
  .intro-body{font-family:'Lato',sans-serif;font-size:15px;line-height:1.65;color:#2C3E2D;max-width:620px;}
  .intro-body p{margin-bottom:10px;}
  .intro-body strong{color:#2C3E2D;}

  /* Product cards */
  .cards{display:flex;flex-direction:row;gap:0;flex:1;}
  .card{flex:1;padding:28px 30px 24px;display:flex;flex-direction:column;align-items:center;text-align:center;}
  .card:first-child{background:#fff;border-right:2px solid #F5F0E8;}
  .card:last-child{background:#F5F0E8;}

  .card-eyebrow{font-family:'Lato',sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#8B3A2A;margin-bottom:8px;}
  .card-title{font-size:22px;color:#2C3E2D;line-height:1.2;margin-bottom:6px;}
  .card-price{font-family:'Lato',sans-serif;font-size:30px;font-weight:700;color:#8B3A2A;margin-bottom:14px;}
  .card-includes{font-family:'Lato',sans-serif;font-size:13px;color:#2C3E2D;line-height:1.8;margin-bottom:16px;text-align:left;width:100%;}
  .card-includes li{list-style:none;padding-left:0;}
  .card-includes li::before{content:'✓  ';color:#8B3A2A;font-weight:700;}
  .card-addons{font-family:'Lato',sans-serif;font-size:12px;color:#4A5E3A;font-style:italic;margin-bottom:20px;}
  .card-qr{border:3px solid #2C3E2D;border-radius:10px;padding:8px;background:#fff;}
  .card-qr img{display:block;width:140px;height:140px;}
  .card-scan{font-family:'Lato',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8B3A2A;margin-top:8px;}

  /* Footer */
  .ftr{background:#2C3E2D;color:#F5F0E8;padding:12px 40px;display:flex;align-items:center;justify-content:space-between;}
  .ftr-left{font-family:'Lato',sans-serif;font-size:13px;line-height:1.7;}
  .ftr-right{font-family:Georgia,serif;font-size:13px;font-style:italic;opacity:0.9;}

  /* Add-on pricing */
  .addon-table{width:100%;border-collapse:collapse;margin-top:10px;margin-bottom:4px;}
  .addon-table td{font-family:'Lato',sans-serif;font-size:10px;padding:3px 0;color:#2C3E2D;}
  .addon-table .addon-name{text-align:left;}
  .addon-table .addon-orig{text-align:right;text-decoration:line-through;color:#c0392b;padding-right:8px;}
  .addon-table .addon-sale{text-align:right;font-weight:700;color:#2C3E2D;}
  .addon-excl{font-family:'Lato',sans-serif;font-size:9.5px;color:#8B3A2A;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin-top:4px;}

  @media print{
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    body{margin:0;}
    .page{width:100%;min-height:100vh;}
    @page{margin:0;size:8.5in 11in;}
  }
</style>
</head>
<body>
<!-- Toolbar — hidden on print -->
<div class="toolbar">
  <span class="toolbar-title">Heart of Texas Organics Flyer — Preview</span>
  <div class="toolbar-btns">
    <a href="/flyer.pdf" class="btn-pdf">Download PDF</a>
    <a href="#" onclick="window.print();return false;" class="btn-print">Print</a>
  </div>
</div>
<div class="page">

  <!-- Header -->
  <div class="hdr">
    <div>
      <div class="hdr-name">Heart of Texas Organics</div>
      <div class="hdr-tag">Your Local Farm · Dripping Springs, TX</div>
    </div>
    <div class="hdr-right"><a href="https://www.heartoftexasorganics.com" style="color:inherit;text-decoration:none;">heartoftexasorganics.com</a></div>
  </div>
  <div class="rust-bar"></div>

  <!-- Promo copy -->
  <div class="intro">
    <div class="intro-eyebrow">Fresh This Week · Only 10 Available</div>
    <div class="intro-headline"><em>Pasture-Raised &amp; Ready.</em></div>
    <div class="intro-body">
      <p>🗓️ <strong>Delivered Fri (7/10)</strong></p>
      <p>🚚 <strong>FREE delivery within 10 miles.</strong></p>
      <p>Know someone always worried about <em>"What's for dinner?"</em> — send them our way.</p>
      <p><strong>Refer a friend. Earn $5 in Farm Rewards.</strong></p>
    </div>
  </div>

  <!-- Section divider -->
  <div style="background:#8B3A2A;padding:12px 40px;text-align:center;font-family:'Lato',sans-serif;font-size:12px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#F5F0E8;">
    This Week's Offerings
  </div>

  <!-- Product cards -->
  <div class="cards">

    <!-- Chicken Bundle -->
    <div class="card">
      <div class="card-eyebrow">Limited — 10 Available</div>
      <div class="card-title">Chicken &amp; Dinner Roll Bundle</div>
      <div class="card-price">$99</div>
      <ul class="card-includes">
        <li>Whole Pasture-Raised Chicken — 10 Premium Cuts</li>
      </ul>
      <div style="font-family:'Lato',sans-serif;font-size:12px;color:#4A5E3A;line-height:1.7;margin:-10px 0 12px;text-align:left;padding-left:2px;">2 Breasts &nbsp;·&nbsp; 2 Leg Quarters &nbsp;·&nbsp; 2 Tenders &nbsp;·&nbsp; 2 Flats &nbsp;·&nbsp; 2 Drummettes</div>
      <ul class="card-includes">
        <li>1 Dozen Soft Dinner Rolls</li>
      </ul>
      <a href="${SITE_URL_BASE}/?start=chicken-bundle" class="card-addons" style="display:block;text-decoration:underline;cursor:pointer;">+ optional add-ons at checkout — bundle members save 10%</a>
      <div class="card-qr"><img src="${chickenQR}" alt="QR code — Chicken Bundle"/></div>
      <div class="card-scan">Scan to Order</div>
    </div>

    <!-- Sampler Box -->
    <div class="card">
      <div class="card-eyebrow">Customize Your Order</div>
      <div class="card-title">The Farm Sampler Box</div>
      <div class="card-price">$149</div>
      <ul class="card-includes">
        <li>Whole Chicken — 10 Premium Cuts</li>
      </ul>
      <div style="font-family:'Lato',sans-serif;font-size:12px;color:#4A5E3A;line-height:1.7;margin:-10px 0 12px;text-align:left;padding-left:2px;">2 Breasts &nbsp;·&nbsp; 2 Leg Quarters &nbsp;·&nbsp; 2 Tenders &nbsp;·&nbsp; 2 Flats &nbsp;·&nbsp; 2 Drummettes</div>
      <ul class="card-includes">
        <li>Pasture-Raised Eggs — Non-GMO · Soy-Free · 1 Dozen</li>
        <li>Real Cream Butter — Grass-Fed &amp; Finished · ½ lb</li>
        <li>Garlic Chili Crunch</li>
      </ul>
      <a href="${SITE_URL_BASE}/?start=sampler-box" class="card-addons" style="display:block;text-decoration:underline;cursor:pointer;">+ customize your box &amp; add-ons — bundle members save 10%</a>
      <div class="card-qr"><img src="${samplerQR}" alt="QR code — Farm Sampler Box"/></div>
      <div class="card-scan">Scan to Customize &amp; Order</div>
    </div>

  </div>

  <!-- Footer -->
  <div class="ftr" style="flex-direction:column;align-items:center;text-align:center;padding:18px 40px;gap:6px;">
    <div style="font-family:'Lato',sans-serif;font-size:14px;font-weight:700;color:#F5F0E8;line-height:1.6;">
      📸 Take a photo of your order &amp; leave us a 5-star Google review
    </div>
    <div style="font-family:'Lato',sans-serif;font-size:13px;color:rgba(245,240,232,0.85);line-height:1.5;">
      You'll be entered to win a <strong style="color:#D4BA8A;">FREE Thanksgiving Turkey</strong> this year!
    </div>
    <a href="https://g.page/r/CUUfyz-9bw9BEAE/review" style="margin-top:4px;color:#D4BA8A;font-family:'Lato',sans-serif;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;border:1.5px solid rgba(212,186,138,0.5);padding:6px 18px;border-radius:4px;">⭐⭐⭐⭐⭐ Leave a Google Review</a>
  </div>

</div>
</body>
</html>`;

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    console.error('[/flyer]', e);
    res.status(500).send('Error generating flyer: ' + e.message);
  }
});

// GET /flyer.pdf — downloadable / shareable PDF flyer
app.get('/flyer.pdf', async (req, res) => {
  try {
    const QRCode = require('qrcode');

    const [chickenBuf, samplerBuf] = await Promise.all([
      QRCode.toBuffer(`${SITE_URL_BASE}/?start=chicken-bundle`, { width: 300, margin: 2, color: { dark: '#2C3E2D', light: '#FFFFFF' } }),
      QRCode.toBuffer(`${SITE_URL_BASE}/?start=sampler-box`,    { width: 300, margin: 2, color: { dark: '#2C3E2D', light: '#FFFFFF' } }),
    ]);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="hoto-farm-flyer.pdf"',
    });

    const doc = new PDFDocument({ size: 'LETTER', margin: 0 });
    doc.pipe(res);

    // Register a Unicode-capable font for star characters
    const symbolFontPaths = [
      '/System/Library/Fonts/Apple Symbols.ttf',           // macOS
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',   // Debian/Ubuntu
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',            // CentOS/RHEL
    ];
    let symbolFont = null;
    for (const fp of symbolFontPaths) {
      try { require('fs').accessSync(fp); symbolFont = fp; break; } catch {}
    }
    if (symbolFont) doc.registerFont('Symbol', symbolFont);

    const W = 612, MID = 306;
    const GREEN = '#2C3E2D', RUST = '#8B3A2A', CREAM = '#F5F0E8', DARK = '#2A2A2A';

    // ── HEADER  y 0-62 ───────────────────────────────────────────────
    doc.rect(0, 0, W, 62).fill(GREEN);
    doc.fillColor(CREAM).font('Times-Bold').fontSize(22)
       .text('Heart of Texas Organics', 36, 11, { width: 360 });
    doc.fillColor(CREAM).font('Helvetica').fontSize(8)
       .text('YOUR LOCAL FARM', 36, 38, { width: 200 });
    doc.fillColor(CREAM).font('Helvetica').fontSize(8)
       .text('heartoftexasorganics.com', 0, 38, { width: W - 36, align: 'right', link: 'https://www.heartoftexasorganics.com', underline: false });

    // ── RUST ACCENT  y 62-67 ─────────────────────────────────────────
    doc.rect(0, 62, W, 5).fill(RUST);

    // ── INTRO  y 67-196 ──────────────────────────────────────────────
    doc.rect(0, 67, W, 129).fill(CREAM);

    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(7.5)
       .text('FRESH THIS WEEK  -  ONLY 10 AVAILABLE', 36, 80, { width: W - 72, align: 'center' });

    doc.fillColor(RUST).font('Times-BoldItalic').fontSize(24)
       .text('Pasture-Raised & Ready.', 36, 94, { width: W - 72, align: 'center' });

    doc.fillColor(DARK).font('Helvetica-Bold').fontSize(11)
       .text('Delivered Fri (7/10)   |   FREE delivery within 10 miles', 36, 128, { width: W - 72, align: 'center' });

    doc.fillColor(DARK).font('Helvetica').fontSize(10)
       .text('Know someone always worried about dinner? Send them our way.', 60, 148, { width: W - 120, align: 'center' });

    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10)
       .text('Refer a friend. Earn $5 in Farm Rewards.', 36, 168, { width: W - 72, align: 'center' });

    // ── RUST DIVIDER  y 196-212 ──────────────────────────────────────
    doc.rect(0, 196, W, 16).fill(RUST);
    doc.fillColor(CREAM).font('Helvetica-Bold').fontSize(8)
       .text("THIS WEEK'S OFFERINGS", 0, 202, { width: W, align: 'center', characterSpacing: 2.5 });

    // ── PRODUCT CARDS  y 212-726 ─────────────────────────────────────
    const CY = 212, CH = 514;
    doc.rect(0,   CY, MID, CH).fill('#FFFFFF');
    doc.rect(MID, CY, MID, CH).fill(CREAM);
    doc.rect(MID - 1, CY, 1.5, CH).fill('#C8BEB2');

    const PAD = 22, CW = MID - PAD * 2;  // 262px usable per card
    // Shortened cuts so they never wrap on a 262px column
    const CUTS = '2 Breasts  2 Leg Qtrs  2 Tenders  2 Flats  2 Drummettes';
    const QR_W = 180;
    const QR_Y = CY + 300;  // fixed Y for both QR codes

    // ── LEFT CARD: Chicken & Dinner Roll Bundle ───────────────────────
    const LX = PAD;

    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(7)
       .text('LIMITED  -  10 AVAILABLE', LX, CY + 16, { width: CW, align: 'center' });
    doc.fillColor(GREEN).font('Times-Bold').fontSize(16)
       .text('Chicken & Dinner Roll Bundle', LX, CY + 30, { width: CW, align: 'center' });
    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(32)
       .text('$99', LX, CY + 54, { width: CW, align: 'center' });

    doc.rect(LX + 20, CY + 92, CW - 40, 0.75).fill('#C8BEB2');
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(7)
       .text("WHAT'S INCLUDED", LX, CY + 98, { width: CW, align: 'center' });

    // Each item on its own fixed Y — no wrapping possible at 9.5pt/262px
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  Whole Pasture-Raised Chicken  -  10 Premium Cuts', LX + 4, CY + 114, { width: CW - 4, lineBreak: false });
    doc.fillColor('#4A5E3A').font('Helvetica-Oblique').fontSize(8)
       .text(CUTS, LX + 14, CY + 128, { width: CW - 14, lineBreak: false });
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  1 Dozen Soft Dinner Rolls', LX + 4, CY + 146, { width: CW - 4, lineBreak: false });

    doc.fillColor(RUST).font('Helvetica-Oblique').fontSize(8.5)
       .text('+ optional add-ons at checkout', LX, CY + 170, { width: CW, align: 'center', lineBreak: false, link: `${SITE_URL_BASE}/?start=chicken-bundle`, underline: true });
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8.5)
       .text('Bundle members save 10% on every add-on', LX, CY + 184, { width: CW, align: 'center', lineBreak: false });

    const cQR_X = Math.round((MID - QR_W) / 2);
    doc.rect(cQR_X - 4, QR_Y - 4, QR_W + 8, QR_W + 8).fill('#E4DDD6');
    doc.image(chickenBuf, cQR_X, QR_Y, { width: QR_W });
    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(9.5)
       .text('SCAN TO ORDER', LX, QR_Y + QR_W + 12, { width: CW, align: 'center', lineBreak: false, link: `${SITE_URL_BASE}/?start=chicken-bundle`, underline: false });
    doc.link(cQR_X, QR_Y, QR_W, QR_W, `${SITE_URL_BASE}/?start=chicken-bundle`);

    // ── RIGHT CARD: The Farm Sampler Box ─────────────────────────────
    const RX = MID + PAD;

    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(7)
       .text('CUSTOMIZE YOUR ORDER', RX, CY + 16, { width: CW, align: 'center' });
    doc.fillColor(GREEN).font('Times-Bold').fontSize(16)
       .text('The Farm Sampler Box', RX, CY + 30, { width: CW, align: 'center' });
    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(32)
       .text('$149', RX, CY + 54, { width: CW, align: 'center' });

    doc.rect(RX + 20, CY + 92, CW - 40, 0.75).fill('#B8B0A4');
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(7)
       .text("WHAT'S INCLUDED", RX, CY + 98, { width: CW, align: 'center' });

    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  Whole Chicken  -  10 Premium Cuts', RX + 4, CY + 114, { width: CW - 4, lineBreak: false });
    doc.fillColor('#4A5E3A').font('Helvetica-Oblique').fontSize(8)
       .text(CUTS, RX + 14, CY + 128, { width: CW - 14, lineBreak: false });
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  Pasture-Raised Eggs  -  Non-GMO, Soy-Free, 1 Doz', RX + 4, CY + 146, { width: CW - 4, lineBreak: false });
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  Butter  -  Grass-Fed & Finished, 1/2 lb', RX + 4, CY + 162, { width: CW - 4, lineBreak: false });
    doc.fillColor(DARK).font('Helvetica').fontSize(9.5)
       .text('  Garlic Chili Crunch', RX + 4, CY + 178, { width: CW - 4, lineBreak: false });

    doc.fillColor(RUST).font('Helvetica-Oblique').fontSize(8.5)
       .text('+ customize your box & add-ons at checkout', RX, CY + 200, { width: CW, align: 'center', lineBreak: false, link: `${SITE_URL_BASE}/?start=sampler-box`, underline: true });
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(8.5)
       .text('Bundle members save 10% on every add-on', RX, CY + 214, { width: CW, align: 'center', lineBreak: false });

    const sQR_X = MID + Math.round((MID - QR_W) / 2);
    doc.rect(sQR_X - 4, QR_Y - 4, QR_W + 8, QR_W + 8).fill('#D4CAC0');
    doc.image(samplerBuf, sQR_X, QR_Y, { width: QR_W });
    doc.fillColor(RUST).font('Helvetica-Bold').fontSize(9.5)
       .text('SCAN TO CUSTOMIZE & ORDER', RX, QR_Y + QR_W + 12, { width: CW, align: 'center', lineBreak: false, link: `${SITE_URL_BASE}/?start=sampler-box`, underline: false });
    doc.link(sQR_X, QR_Y, QR_W, QR_W, `${SITE_URL_BASE}/?start=sampler-box`);

    // ── FOOTER  y 726-792 ────────────────────────────────────────────
    doc.rect(0, 726, W, 66).fill(GREEN);
    doc.fillColor(CREAM).font('Helvetica-Bold').fontSize(12)
       .text('Take a photo of your order & leave us a 5-star Google review', 36, 738, { width: W - 72, align: 'center' });
    doc.fillColor(CREAM).font('Helvetica').fontSize(10)
       .text("You'll be entered to win a FREE Thanksgiving Turkey this year!", 36, 757, { width: W - 72, align: 'center' });
    if (symbolFont) {
      doc.fillColor('#D4BA8A').font('Symbol').fontSize(13)
         .text('★★★★★', 36, 771, { width: W - 72, align: 'center', link: 'https://g.page/r/CUUfyz-9bw9BEAE/review', underline: false });
    } else {
      doc.fillColor('#D4BA8A').font('Helvetica-Bold').fontSize(11)
         .text('[ 5-STAR GOOGLE REVIEW ]', 36, 773, { width: W - 72, align: 'center', link: 'https://g.page/r/CUUfyz-9bw9BEAE/review', underline: false });
    }
    doc.fillColor('#D4BA8A').font('Helvetica-Bold').fontSize(9)
       .text('Leave a Google Review', 36, 783, { width: W - 72, align: 'center', link: 'https://g.page/r/CUUfyz-9bw9BEAE/review', underline: true });

    doc.end();
  } catch (e) {
    console.error('[/flyer.pdf]', e);
    if (!res.headersSent) res.status(500).send('Error generating PDF: ' + e.message);
  }
});


// POST /admin/bundle-order — manually record an email/phone bundle order
app.post('/admin/bundle-order', requireAdmin, async (req, res) => {
  try {
    const name     = String(req.body.name     || '').slice(0, 120).trim();
    const email    = String(req.body.email    || '').slice(0, 200).trim();
    const channel  = String(req.body.channel  || '').slice(0, 20).trim();
    const processing = String(req.body.processing || '').slice(0, 5).trim();
    const bread    = String(req.body.bread    || '').slice(0, 30).trim();
    const notes    = String(req.body.notes    || '').slice(0, 300).trim();
    if (!name) return res.status(400).json({ error: 'Customer name is required.' });

    const sales = getBundleSales();
    if (sales.sold >= BUNDLE_TOTAL) {
      return res.status(400).json({ error: 'All 25 bundles have been claimed.' });
    }

    const safeChannel = ['email', 'phone', 'text', 'in-person'].includes(channel) ? channel : 'email';
    sales.sold = Math.min(BUNDLE_TOTAL, sales.sold + 1);
    sales.orders.push({
      name,
      email: email || '',
      date: new Date().toISOString(),
      sessionId: null,
      channel: safeChannel,
      processing: processing === 'yes' ? 'yes' : 'no',
      bread: bread || 'challah',
      notes: notes || '',
    });
    saveBundleSales(sales);

    // Log to inventory system
    const inv = await db.getProduct('bundle-4th-july');
    const stockBefore = inv ? inv.stock : 25;
    const stockAfter  = Math.max(0, stockBefore - 1);
    await db.adjustStock('bundle-4th-july', -1);
    await db.addTransaction(
      'bundle-4th-july', 'sale', -1,
      null, null,
      `${processing === 'yes' ? 'Processing add-on · ' : ''}Bread: ${bread || 'challah'} · ${name}${email ? ' <' + email + '>' : ''}${notes ? ' · ' + notes : ''}`,
      safeChannel, stockBefore, stockAfter
    );

    console.log(`[Bundle] Manual order #${sales.sold} — ${name} via ${safeChannel}`);
    res.json({ ok: true, sold: sales.sold, remaining: BUNDLE_TOTAL - sales.sold });
  } catch (e) {
    console.error('[Bundle manual order]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/bundle-orders — list all bundle orders with channel breakdown
app.get('/admin/bundle-orders', requireAdmin, (req, res) => {
  const sales = getBundleSales();
  const byChannel = sales.orders.reduce((acc, o) => {
    const ch = o.channel || 'online';
    if (!acc[ch]) acc[ch] = [];
    acc[ch].push(o);
    return acc;
  }, {});
  res.json({
    total: BUNDLE_TOTAL,
    sold: sales.sold,
    remaining: BUNDLE_TOTAL - sales.sold,
    byChannel,
    orders: sales.orders,
  });
});

// POST /bundle-checkout — creates Stripe checkout session
app.post('/bundle-checkout', async (req, res) => {
  try {
    const sales = getBundleSales();
    if (sales.sold >= BUNDLE_TOTAL) {
      return res.json({ error: 'Sorry — all 25 bundles have been claimed. Thank you for your interest!' });
    }
    const { breadChoice, deliveryMethod, address } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    const isDelivery = deliveryMethod === 'delivery';

    // Contents mirror the bundle page's "What's Inside" — each shown as its own
    // row ($0 / "Free") on the Stripe pay screen so the buyer can scan everything
    // they're getting without a wall of text.
    const includedItems = [
      'Whole Pasture-Raised Chicken — processed into 10 cuts (2 boneless/skinless breasts, 2 leg quarters, 2 tenders, 2 drums, 2 flats)',
      breadChoice === 'yeast-rolls' ? 'Dozen Yeast Rolls' : '3-Braided Challah Loaf',
      'Cinnamon Rolls (6-pack)',
      'Garlic Chili Crunch',
      'Seasonal Preserves',
      'Farm to Table Recipe Guide (digital download)',
    ];

    const lineItems = [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: '4th of July Homestead Table Bundle',
            description: 'Everything below, ready for your table. FREE delivery within a 10-mile radius · Local pick-up Dripping Springs, TX — Friday, July 3rd.',
            images: [`${origin}/images/hero-ingredients.jpg`],
          },
          unit_amount: BUNDLE_PRICE_CENTS,
        },
        quantity: 1,
      },
      // Included items — itemized as their own ($0) rows for easy scanning
      ...includedItems.map(name => ({
        price_data: {
          currency: 'usd',
          product_data: { name: `✓ ${name}` },
          unit_amount: 0,
        },
        quantity: 1,
      })),
    ];

    // Delivery fee — always recomputed server-side from the submitted address
    // (client-supplied amounts are ignored to prevent tampering). Free ≤10 mi.
    const deliveryMeta = {};
    if (isDelivery && address?.street) {
      let feeCents;
      try {
        const { lat, lng } = await geocodeAddress(address.street, address.city, address.state, address.zip);
        const miles = haversineMiles(BUNDLE_ORIGIN_LAT, BUNDLE_ORIGIN_LNG, lat, lng);
        feeCents = calcBundleDeliveryFeeCents(miles);
        deliveryMeta.delivery_miles = String(Math.round(miles * 10) / 10);
      } catch (geoErr) {
        console.error('[bundle checkout] delivery geocode failed:', geoErr.message);
        feeCents = 1500; // fallback flat fee if the address can't be geocoded
      }
      if (feeCents > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: { name: 'Local Delivery Fee' },
            unit_amount: feeCents,
          },
          quantity: 1,
        });
      }
      deliveryMeta.delivery_street = (address.street || '').slice(0, 200);
      deliveryMeta.delivery_city   = (address.city   || '').slice(0, 100);
      deliveryMeta.delivery_state  = (address.state  || '').slice(0, 10);
      deliveryMeta.delivery_zip    = (address.zip    || '').slice(0, 10);
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,
      // Delivery address is collected on our page (needed to price by distance);
      // for pickup we let Stripe collect the address for the customer record.
      ...(isDelivery ? {} : { shipping_address_collection: { allowed_countries: ['US'] } }),
      phone_number_collection: { enabled: true },
      custom_fields: [{
        key: 'order_notes',
        label: { type: 'custom', custom: 'Notes / delivery instructions (optional)' },
        type: 'text',
        optional: true,
      }],
      metadata: {
        type: 'bundle',
        bundle: '4th-july-homestead-table',
        processing: 'no',
        bread: breadChoice || 'challah',
        delivery_method: isDelivery ? 'delivery' : 'pickup',
        ...deliveryMeta,
      },
      success_url: `${origin}/bundle-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/bundle.html`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('[Bundle checkout]', e.message);
    res.status(500).json({ error: 'Checkout error. Please try again.' });
  }
});

// START
// =========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Heart of Texas Organics running at http://localhost:${PORT}`);
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const stripeMode = stripeKey.includes('_test_') ? 'TEST' : stripeKey.includes('_live_') ? 'LIVE' : 'UNKNOWN';
  console.log(`[Stripe] mode=${stripeMode} key=${stripeKey.slice(0,12)}...`);

  // Initialize database (creates tables and seeds products if needed)
  try {
    await db.init();
  } catch (err) {
    console.error('[DB] Init failed:', err.message);
  }

  // Auto-sync orders from Stripe on every startup so orders survive Render restarts
  try {
    const result = await performStripeSync(100);
    console.log(`[Startup] Order sync complete — ${result.synced} new, ${result.skipped} already on file`);
  } catch (err) {
    console.warn('[Startup] Order sync failed (will retry on manual sync):', err.message);
  }

  // Ensure WELCOME10 promo code exists for email signups
  await ensureWelcomeCoupon();

  // Ensure FREE test promo code exists on this account
  try {
    let couponId = 'HOTO_TEST_FREE';
    try {
      await stripe.coupons.retrieve(couponId);
      console.log('[Stripe] TEST coupon already exists');
    } catch {
      await stripe.coupons.create({
        id: couponId, name: 'Test — 100% Off',
        percent_off: 100, duration: 'forever', max_redemptions: 100,
      });
      console.log('[Stripe] TEST coupon created');
    }
    try {
      await stripe.promotionCodes.create({ coupon: couponId, code: 'FREE', max_redemptions: 100 });
      console.log('[Stripe] FREE promo code created');
    } catch (e) {
      if (e.code === 'resource_already_exists') console.log('[Stripe] FREE promo code already exists');
      else console.warn('[Stripe] promo code warning:', e.message);
    }
  } catch (err) {
    console.warn('[Stripe] Could not create test promo:', err.message);
  }
});
