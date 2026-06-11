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

async function sendEmailTo(to, subject, html, attachments = []) {
  if (resendClient) {
    const payload = {
      from: `Heart of Texas Organics <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    };
    if (attachments.length) {
      payload.attachments = attachments.map(a => ({ filename: a.filename, content: a.content }));
    }
    const { error } = await resendClient.emails.send(payload);
    if (error) throw new Error(error.message);
  } else if (smtpTransporter) {
    await sendEmailViaSmtp(to, subject, html, attachments);
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

        // Product items only (exclude the shipping line item for display)
        const productItems   = items.filter(li => !li.description?.startsWith('Shipping —'));
        const shippingItem   = items.find(li => li.description?.startsWith('Shipping —'));

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
        const addrLine = shippingAddr
          ? `${shippingAddr.line1}${shippingAddr.line2 ? ', ' + shippingAddr.line2 : ''}, ${shippingAddr.city}, ${shippingAddr.state} ${shippingAddr.postal_code}`
          : (deliveryMethod === 'pickup'
              ? `Local pick-up${pickupLoc ? ' — ' + pickupLoc : ''} (details to follow)`
              : '');

        // Gift + billing metadata
        const isGift   = session.metadata?.is_gift === 'true';
        const giftOcc  = session.metadata?.gift_occasion || '';
        const giftMsg  = session.metadata?.gift_msg      || '';
        const billName = session.metadata?.bill_name     || '';

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
              ? `<p style="margin:0;color:#3d3d3d;line-height:1.8;"><strong>Delivery:</strong> Shipping to ${addrLine}</p>`
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
              phone: session.customer_details?.phone || '',
            } : null,
            isGift: isGift,
            giftOccasion: giftOcc || '',
            giftMsg: giftMsg || '',
          });
          const _invId = session.metadata?.inventory_id;
          if (_invId) {
            const _r = await db.adjustStock(_invId, -1);
            await db.addTransaction(_invId, 'sale', -1, null, session.id, 'Reservation checkout', 'online', _r?.before, _r?.after);
          } else {
            await deductStockForOrder(items, session.id);
          }

          // Mark any abandoned cart as completed
          try {
            const pc = readPendingCarts();
            const phone = normalizePhone(session.metadata?.pickup_phone || '');
            const email = session.customer_details?.email || '';
            Object.keys(pc).forEach(k => {
              if (!pc[k].completed && (pc[k].phone === phone || pc[k].email === email)) {
                pc[k].completed = true;
              }
            });
            writePendingCarts(pc);
          } catch {}

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
              } : null,
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
            `✅ New Order ${total} Ready to Ship${isGift ? ' 🎁 GIFT' : ''}`,
            `<h2 style="color:#2C3E2D;">New Order Payment Cleared</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Customer:</strong> ${customerEmail || 'unknown'}</p>
             <p><strong>Delivery:</strong> ${deliveryMethod}${addrLine ? ' — ' + addrLine : ''}</p>
             ${billHtml}
             <p><strong>Payment:</strong> Card (cleared immediately)</p>
             ${lineItemsHtml(items)}
             ${giftHtml}
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
              phone: session.customer_details?.phone || '',
            } : null,
            isGift: isGift,
            giftOccasion: giftOcc || '',
            giftMsg: giftMsg || '',
          });
          await deductStockForOrder(items, session.id);

          // Mark any abandoned cart as completed
          try {
            const pc = readPendingCarts();
            const phone = normalizePhone(session.metadata?.pickup_phone || '');
            const email = session.customer_details?.email || '';
            Object.keys(pc).forEach(k => {
              if (!pc[k].completed && (pc[k].phone === phone || pc[k].email === email)) {
                pc[k].completed = true;
              }
            });
            writePendingCarts(pc);
          } catch {}

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
              } : null,
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
            `⏳ New ACH Order ${total} DO NOT SHIP YET${isGift ? ' 🎁 GIFT' : ''}`,
            `<h2 style="color:#8B4A2F;">New ACH Order Awaiting Bank Settlement</h2>
             <p><strong>Date:</strong> ${date}</p>
             <p><strong>Total:</strong> ${total}</p>
             <p><strong>Customer:</strong> ${customerEmail || 'unknown'}</p>
             <p><strong>Delivery:</strong> ${deliveryMethod}${addrLine ? ' — ' + addrLine : ''}</p>
             ${billHtml}
             <p><strong>Payment:</strong> ACH Bank Transfer (3–5 business days to clear)</p>
             ${lineItemsHtml(items)}
             ${giftHtml}
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

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, shipping, delivery_method, billing, gift, pickup_location, pickup_contact } = req.body;
    const origin = `${req.protocol}://${req.get('host')}`;
    const isShip = delivery_method !== 'pickup';

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'usd',
        product_data: { name: item.name },
        unit_amount: item.price,
      },
      quantity: item.quantity,
    }));

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

    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card', 'us_bank_account'],
      line_items: lineItems,
      allow_promotion_codes: true,
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
      allow_promotion_codes: true,
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
  'Real Cream Butter':           'cultured-butter',
  'Seasonal Preserves':          'seasonal-preserves',
  'Garlic Chili Crunch':         'garlic-chili-crunch',
  'Tuscany Herb Dipping Oil':    'herb-dipping-oil',
  'Tuscany Herb Bread Dipping Oil': 'herb-dipping-oil',
  'Farm Bundle':                    'bundle-farm',
  'Thanksgiving Turkey Bundle':     'bundle-turkey',
  'Farm Sampler Box':               'sampler-box',
};

async function deductStockForOrder(lineItems, orderId) {
  for (const item of lineItems) {
    const pid = PRODUCT_MAP[item.description] || PRODUCT_MAP[item.name];
    if (!pid) continue;
    const qty = item.quantity || 1;
    const result = await db.adjustStock(pid, -qty);
    const before = result ? result.before : null;
    const after  = result ? result.after  : null;
    await db.addTransaction(pid, 'sale', -qty, null, orderId, 'Stripe checkout', 'online', before, after);
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
      await sendEmailTo(normalizedEmail,
        'Your 10% Off Code from Heart of Texas Organics 🌾',
        `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;background:#F5F0E8;">
          <img src="${siteUrl}/images/logo.png" alt="Heart of Texas Organics" style="height:52px;margin-bottom:28px;filter:brightness(0.3);" />
          <h2 style="color:#2C3E2D;font-size:1.6rem;margin:0 0 12px;">Welcome to the farm family.</h2>
          <p style="color:#3d3d3d;line-height:1.9;margin:0 0 24px;">
            We're so glad you're here. Real food, raised with intention — that's the only way we know how to do it.
            As a thank you for joining us, here's 10% off your first order:
          </p>
          <div style="background:#2C3E2D;padding:28px;text-align:center;border-radius:4px;margin-bottom:28px;">
            <p style="color:#B89B6E;font-family:sans-serif;font-size:0.75rem;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;margin:0 0 10px;">Your Personal Discount Code</p>
            <p style="color:#F5F0E8;font-family:sans-serif;font-size:2rem;font-weight:700;letter-spacing:0.12em;margin:0;">${promoCode}</p>
            <p style="color:#B89B6E;font-family:sans-serif;font-size:0.7rem;margin:10px 0 0;">One-time use · Your account only</p>
          </div>
          <p style="color:#3d3d3d;line-height:1.9;margin:0 0 8px;">
            Enter this code at checkout to take 10% off your first order.
            No shortcuts, no fillers — just real food made by real people right here in the heart of Texas.
          </p>
          <a href="${siteUrl}/offerings.html"
             style="display:inline-block;margin-top:20px;background:#8B4A2F;color:#F5F0E8;padding:14px 32px;text-decoration:none;font-family:sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;border-radius:3px;">
            Shop Now →
          </a>
          <div style="border-top:2px solid #2C3E2D;margin-top:32px;padding-top:24px;">
            <p style="color:#2C3E2D;font-weight:700;margin:0 0 2px;">Deborah</p>
            <p style="color:#555;font-size:0.85rem;margin:0 0 2px;">Head Hen in Charge</p>
            <p style="color:#8B4A2F;font-size:0.85rem;margin:0;">❤️ of Texas Organics</p>
          </div>
          <p style="color:#aaa;font-size:0.75rem;line-height:1.7;margin-top:24px;">
            You're receiving this because you signed up at heartoftexasorganics.com.
            Reply anytime — we actually read these.
          </p>
        </div>`
      );
    }
  } catch(e) {
    console.warn('[Subscribe] Email send failed:', e.message);
  }

  res.json({ ok: true });
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
      try {
        await deductStockForOrder(productItems, session.id);
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

app.get('/api/restore-cart', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'token required' });
    const carts = readPendingCarts();
    const cart = carts[token];
    if (!cart) return res.status(404).json({ error: 'Cart not found or expired' });
    res.json({ ok: true, items: cart.items, location: cart.location });
  } catch(e) {
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
