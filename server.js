import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from matex-backend directory
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

const app = express();
// Use PORT from environment (Render assigns this), fallback to 5001 for local development
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept']
}));
app.options('*', cors());
app.use(express.json());

// Paystack Configuration
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_URL = 'https://api.paystack.co';

// Email Configuration
let emailTransporter = null;
const DESIGNER_EMAIL = process.env.DESIGNER_EMAIL || process.env.DESINGER_EMAIL || 'designer@matexcreations.com';
const NOREPLY_EMAIL = process.env.NOREPLY_EMAIL || 'noreply@matexcreations.com';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || '587');
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

if (SMTP_USER && SMTP_PASS) {
  emailTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false
    }
  });
  console.log('✅ Email service configured');
} else {
  console.warn('⚠️ Email configuration incomplete; email notifications disabled');
}

// Helper: Send email
async function sendEmail(to, subject, html, fromEmail = NOREPLY_EMAIL) {
  if (!emailTransporter) {
    console.warn('⚠️ Email transporter not configured');
    return false;
  }
  try {
    await emailTransporter.sendMail({
      from: fromEmail,
      to,
      subject,
      html
    });
    console.log(`✅ Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to send email to ${to}:`, err);
    return false;
  }
}

function buildCustomerNotificationHtml(order, customMessage = '') {
  const name = order.client_name || order.full_name || 'Valued Customer';
  const service = order.service_name || order.service || 'Your service';
  const status = order.order_status || order.status || 'Pending';
  const paymentStatus = order.payment_status || order.paymentStatus || 'Pending';
  const progress = order.latest_progress || 'No progress update yet.';
  const revisions = typeof order.revision_count !== 'undefined' ? order.revision_count : getRevisionCount(order.payment_type || order.paymentMethod);
  const customerMessageSection = customMessage ? `<p><strong>Message from your admin:</strong> ${customMessage}</p>` : '';

  return `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
      <h2 style="color: #8b0000; text-align: center;">Order Update</h2>
      <div style="background: white; padding: 20px; border-radius: 10px; margin-top: 18px;">
        <p>Hi ${name},</p>
        <p>Your project update is ready. Below are the latest details for your order.</p>
        <p><strong>Order ID:</strong> ${order.order_id || order.id || 'N/A'}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Order Status:</strong> ${status}</p>
        <p><strong>Payment Status:</strong> ${paymentStatus}</p>
        <p><strong>Design Description:</strong> ${order.design_description || 'Not provided'}</p>
        <p><strong>Latest Progress:</strong> ${progress}</p>
        ${customerMessageSection}
      </div>
      <p style="color: #666; font-size: 13px; margin-top: 20px;">Thank you for choosing Matex Creations. We will continue to keep you informed as your project progresses.</p>
    </div>
  `;
}

function buildDesignerNotificationHtml(order) {
  const revisions = typeof order.revision_count !== 'undefined' ? order.revision_count : getRevisionCount(order.payment_type || order.paymentMethod);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
      <h2 style="color: #8b0000; text-align: center;">Order Details</h2>
      <div style="background: white; padding: 20px; border-radius: 10px; margin-top: 18px;">
        <p><strong>Order ID:</strong> ${order.order_id || order.id || 'N/A'}</p>
        <p><strong>Customer Name:</strong> ${order.client_name || order.full_name || 'N/A'}</p>
        <p><strong>Customer Email:</strong> ${order.client_email || order.email || 'N/A'}</p>
        <p><strong>Service:</strong> ${order.service_name || order.service || 'N/A'}</p>
        <p><strong>Payment Type:</strong> ${order.payment_type || order.paymentMethod || 'N/A'}</p>
        <p><strong>Payment Status:</strong> ${order.payment_status || order.paymentStatus || 'N/A'}</p>
        <p><strong>Order Status:</strong> ${order.order_status || order.status || 'N/A'}</p>
        <p><strong>Revision Count:</strong> ${revisions}</p>
        <hr style="margin: 16px 0; border-color: #eee;" />
        <p><strong>Design Description:</strong> ${order.design_description || order.description || 'N/A'}</p>
        <p><strong>Brand Name:</strong> ${order.brand_name || 'N/A'}</p>
        <p><strong>Brand Colors:</strong> ${order.brand_color || order.brand_colors || 'N/A'}</p>
        <p><strong>Reference Link:</strong> ${order.reference_link || 'N/A'}</p>
        <p><strong>Additional Notes:</strong> ${order.additional_note || order.additional_notes || 'N/A'}</p>
      </div>
    </div>
  `;
}

// In-memory order store for payment tracking and verification
const orderStore = new Map();

// In-memory reviews store (fallback when Supabase not configured)
const reviewStore = new Map();

async function persistReview(review) {
  if (!review || !review.id) return review;
  if (!supabase) {
    reviewStore.set(review.id, review);
    return review;
  }
  try {
    const payload = {
      id: review.id,
      full_name: review.full_name,
      company: review.company || null,
      rating: review.rating,
      message: review.message,
      status: review.status || 'Pending',
      created_at: review.created_at || new Date().toISOString()
    };
    const { data, error } = await supabase.from('matex_reviews').upsert([payload], { onConflict: 'id' }).select();
    if (error) {
      console.error('Supabase persistReview error:', error);
      throw error;
    }
    if (Array.isArray(data) && data.length > 0) {
      return data[0];
    }
    return review;
  } catch (err) {
    console.error('persistReview exception:', err.message || err);
    throw err;
  }
}

const SUPABASE_ORDER_FIELDS = [
  'order_id',
  'client_name',
  'client_email',
  'whatsapp_number',
  'service_name',
  'amount',
  'payment_status',
  'order_status',
  'payment_reference',
  'payment_type',
  'revision_count',
  'latest_progress',
  'design_description',
  'brand_name',
  'brand_color',
  'dob',
  'deadline',
  'reference_link',
  'additional_note',
  'created_at'
];

function getRevisionCount(paymentType) {
  const type = String(paymentType || '').toLowerCase();
  if (type.includes('full')) return 4;
  if (type.includes('deposit') || type.includes('50%')) return 2;
  return 1;
}

function normalizeOrderRecord(order) {
  if (!order || !order.order_id) return null;
  return {
    order_id: String(order.order_id),
    client_name: order.client_name || order.full_name || null,
    client_email: order.client_email || order.email || null,
    whatsapp_number: order.whatsapp_number || order.client_phone || order.phone || null,
    service_name: order.service_name || order.service || null,
    amount: typeof order.amount === 'number' ? order.amount : (Number(order.amount) || null),
    payment_type: order.payment_type || order.paymentMethod || null,
    payment_status: order.payment_status || order.paymentStatus || 'Pending',
    order_status: order.order_status || order.status || 'Pending',
    payment_reference: order.payment_reference || order.reference || null,
    revision_count: typeof order.revision_count === 'number' ? order.revision_count : getRevisionCount(order.payment_type || order.paymentMethod),
    latest_progress: order.latest_progress || order.status || 'Order created',
    design_description: order.design_description || order.description || order.metadata?.design_description || null,
    brand_name: order.brand_name || order.brand || null,
    brand_color: order.brand_color || order.brand_colors || null,
    dob: order.dob || null,
    reference_link: order.reference_link || order.referral_link || order.metadata?.reference_link || null,
    additional_note: order.additional_note || order.additional_notes || order.metadata?.additional_notes || null,
    deadline: order.deadline || null,
    created_at: order.created_at || new Date().toISOString()
  };
}

function buildSupabaseOrderPayload(orderRecord) {
  const payload = {};
  for (const field of SUPABASE_ORDER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(orderRecord, field)) {
      payload[field] = orderRecord[field];
    }
  }
  return payload;
}

async function persistOrder(order) {
  if (!order || !order.order_id) return order;
  const record = normalizeOrderRecord(order);
  if (!record) return order;
  if (!supabase) return order;

  const safePayload = buildSupabaseOrderPayload(record);
  try {
    // Fetch existing row to avoid unintentionally nullifying previously-saved fields
    let existing = null;
    try {
      const existingRes = await supabase.from('matex_orders').select('*').eq('order_id', record.order_id).limit(1).maybeSingle();
      if (!existingRes.error) existing = existingRes.data || null;
    } catch (e) {
      console.warn('Supabase fetch existing row warning for', record.order_id, e?.message || e);
    }

    // Merge - prefer new non-null values from record, fall back to existing values
    const merged = Object.assign({}, existing || {});
    for (const key of SUPABASE_ORDER_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        // only overwrite if record has a non-undefined value (allow null to clear intentionally)
        merged[key] = record[key];
      }
    }

    const { data, error } = await supabase.from('matex_orders').upsert([merged], { onConflict: 'order_id' });
    if (error) {
      console.error('❌ Supabase persistOrder error for', record.order_id, JSON.stringify(error, Object.getOwnPropertyNames(error)));
      // keep order in memory and continue, but surface the failure to logs
      return order;
    }
    console.log('✅ Order persisted to Supabase:', record.order_id);
    return order;
  } catch (err) {
    console.error('❌ Supabase persistOrder exception for', record.order_id, err && (err.message || err));
    return order;
  }
}

// Supabase configuration (optional fallback to in-memory store)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client initialized');
  } catch (err) {
    console.error('Supabase initialization failed:', err.message);
    supabase = null;
  }
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY not set; running without Supabase persistence.');
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '';
const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || '1800000');

function createAdminToken() {
  const payload = JSON.stringify({ ts: Date.now() });
  const signature = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

function verifyAdminToken(token) {
  if (!token || !ADMIN_SECRET_KEY) return false;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const [payload, signature] = decoded.split('.');
    if (!payload || !signature) return false;
    const expectedSignature = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(payload).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    if (!crypto.timingSafeEqual(expectedBuffer, signatureBuffer)) return false;
    const parsed = JSON.parse(payload);
    if (!parsed.ts || typeof parsed.ts !== 'number') return false;
    return Date.now() - parsed.ts <= ADMIN_TOKEN_TTL_MS;
  } catch (err) {
    return false;
  }
}

function adminAuth(req, res, next) {
  if (!ADMIN_PASSWORD || !ADMIN_SECRET_KEY) {
    return res.status(503).json({ success: false, message: 'Admin service is not configured.' });
  }
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing Authorization header.' });
  }
  const token = authHeader.slice(7).trim();
  if (!verifyAdminToken(token)) {
    return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
  }
  next();
}

if (!PAYSTACK_SECRET_KEY) {
  console.error('❌ PAYSTACK_SECRET_KEY is not defined in .env');
  process.exit(1);
}

// ==================== ROUTES ====================

/**
 * GET /
 * Health check endpoint
 */
app.get('/', (req, res) => {
  res.json({ message: 'Matex backend running' });
});

// Health check under the /api prefix for consistency with API routes
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Matex API healthy' });
});

app.post('/api/admin/login', (req, res) => {
  console.log('📍 POST /api/admin/login - Admin login attempt');
  if (!ADMIN_PASSWORD || !ADMIN_SECRET_KEY) {
    console.error('❌ Admin login request rejected: ADMIN_PASSWORD or ADMIN_SECRET_KEY is not configured');
    return res.status(503).json({ success: false, message: 'Admin login is not configured.' });
  }

  const { password } = req.body || {};
  if (!password || typeof password !== 'string') {
    console.warn('⚠️ Admin login failed - invalid or missing password payload', {
      contentType: req.headers['content-type'],
      body: req.body
    });
    return res.status(400).json({ success: false, message: 'Password is required.' });
  }

  if (password !== ADMIN_PASSWORD) {
    console.warn('⚠️ Admin login failed - invalid password attempt');
    return res.status(401).json({ success: false, message: 'Invalid password.' });
  }

  const token = createAdminToken();
  console.log('✅ Admin login successful, token issued');
  return res.json({ success: true, token, expires_in: ADMIN_TOKEN_TTL_MS });
});

app.get('/api/admin/validate', adminAuth, (req, res) => {
  console.log('📍 GET /api/admin/validate - Token validation');
  res.json({ success: true });
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
  console.log('📍 GET /api/admin/orders - Fetching all orders');
  try {
    if (supabase) {
      const orderSelect = 'order_id, client_name, client_email, whatsapp_number, service_name, amount, payment_type, payment_status, order_status, revision_count, latest_progress, payment_reference, design_description, brand_name, brand_color, dob, deadline, reference_link, additional_note, created_at';
      try {
        const { data, error } = await supabase
          .from('matex_orders')
          .select(orderSelect)
          .order('created_at', { ascending: false });
        if (error) {
          console.error('Supabase admin orders select error:', error);
        } else {
          return res.json({ success: true, orders: data || [] });
        }
      } catch (err) {
        console.error('Supabase admin orders exception:', err.message || err);
      }
    }

    // Supabase unavailable or schema mismatch: fall back to in-memory store
    const ordersMap = new Map();
    for (const order of orderStore.values()) {
      if (order && order.order_id) {
        if (!ordersMap.has(order.order_id)) {
          ordersMap.set(order.order_id, order);
        }
      }
    }
    return res.json({ success: true, orders: Array.from(ordersMap.values()).sort((a, b) => {
      const aTime = new Date(a.created_at).getTime() || 0;
      const bTime = new Date(b.created_at).getTime() || 0;
      return bTime - aTime;
    }) });
  } catch (err) {
    console.error('Admin orders fetch error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to load orders' });
  }
});

app.put('/api/admin/orders/:orderId', adminAuth, async (req, res) => {
  console.log(`📍 PUT /api/admin/orders/${req.params.orderId} - Updating order`);
  try {
    const { orderId } = req.params;
    const { status, latest_progress } = req.body || {};
    if (!status && typeof latest_progress === 'undefined') {
      return res.status(400).json({ success: false, message: 'At least one value is required to update.' });
    }

    const updatePayload = {};
    if (status) updatePayload.order_status = status;
    if (typeof latest_progress !== 'undefined') updatePayload.latest_progress = latest_progress;

    let updatedOrder = null;
    if (supabase) {
      // Only update fields that are known to exist in the Supabase schema
      const supaUpdate = {};
      if (updatePayload.order_status) supaUpdate.order_status = updatePayload.order_status;
      if (typeof updatePayload.latest_progress !== 'undefined') supaUpdate.latest_progress = updatePayload.latest_progress;

      try {
        const { data, error } = await supabase
          .from('matex_orders')
          .update(supaUpdate)
          .eq('order_id', orderId)
          .select()
          .limit(1)
          .single();
        if (error) {
          console.error('Supabase admin update error:', error);
          throw new Error('Supabase update failure');
        }
        if (data) {
          updatedOrder = data;
        }
      } catch (err) {
        console.warn('Falling back to in-memory update for order', orderId, err.message || err);
      }
    }

    if (!updatedOrder) {
      const existing = orderStore.get(orderId);
      if (!existing || !existing.order_id) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      updatedOrder = Object.assign({}, existing, updatePayload);
      orderStore.set(orderId, updatedOrder);
    }

    if (updatedOrder) {
      if (orderStore.has(orderId)) {
        orderStore.set(orderId, updatedOrder);
      }
      if (updatedOrder.client_email) {
        try {
          const message = updatePayload.latest_progress || `Order status updated to ${updatePayload.order_status || updatedOrder.order_status}`;
          await sendEmail(
            updatedOrder.client_email,
            `Order Update - ${updatedOrder.order_id}`,
            buildCustomerNotificationHtml(updatedOrder, message)
          );
        } catch (emailError) {
          console.error('Admin customer notification failed:', emailError.message || emailError);
        }
      }
    }

    return res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error('Admin order update error:', err.message);
    return res.status(500).json({ success: false, message: 'Unable to update order' });
  }
});

app.post('/api/admin/orders/:orderId/email', adminAuth, async (req, res) => {
  console.log(`📍 POST /api/admin/orders/${req.params.orderId}/email - Send customer email`);
  try {
    const orderId = String(req.params.orderId || '').trim();
    const { message = '' } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'orderId is required' });
    }

    if (!supabase) {
      return res.status(500).json({ success: false, message: 'Supabase not configured' });
    }

    const { data, error } = await supabase
      .from('matex_orders')
      .select('*')
      .eq('order_id', orderId)
      .limit(1);

    if (error) {
      console.error('Supabase email lookup error:', error);
      return res.status(500).json({ success: false, message: 'Unable to retrieve order' });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const order = data[0];
    if (!order.client_email) {
      return res.status(400).json({ success: false, message: 'Customer email is missing for this order' });
    }

    const emailSent = await sendEmail(
      order.client_email,
      `Order Update - ${order.order_id}`,
      buildCustomerNotificationHtml(order, message)
    );

    if (!emailSent) {
      return res.status(500).json({ success: false, message: 'Unable to send email' });
    }

    return res.json({ success: true, message: 'Customer email sent' });
  } catch (err) {
    console.error('Send customer email error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Failed to send customer email' });
  }
});

/**
 * POST /api/payment/initialize
 * Initialize Paystack transaction
 * 
 * Body:
 * - order_id (string): Order identifier
 * - email (string): Customer email
 * - amount (number): Amount in Naira
 * - service_name (string): Service being purchased
 * 
 * Returns:
 * - authorization_url (string): Paystack payment URL
 * - reference (string): Paystack transaction reference
 */
app.post('/api/payment/initialize', async (req, res) => {
  console.log('📍 POST /api/payment/initialize - Payment initialization');
  try {
    const { order_id, email, amount, service_name, payment_type, callback_url } = req.body;

    // Validation
    if (!order_id || !email || !amount || !service_name || !payment_type) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: order_id, email, amount, service_name, payment_type'
      });
    }

    console.log('🔧 Payment initialization requested for order:', order_id);
    if (callback_url) {
      console.log('🔗 Using Paystack callback_url:', callback_url);
    }

    // Ensure amount is a valid number and convert to kobo
    const amountInKobo = Math.round(Number(amount) * 100);
    if (isNaN(amountInKobo) || amountInKobo <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount. Must be a positive number.'
      });
    }

    // Initialize Paystack transaction
    const initializePayload = {
      email,
      amount: amountInKobo,
      metadata: {
        order_id: String(order_id),
        service_name: String(service_name),
        payment_type: String(payment_type)
      }
    };
    if (callback_url) {
      initializePayload.callback_url = callback_url;
    }

    const response = await axios.post(
      `${PAYSTACK_API_URL}/transaction/initialize`,
      initializePayload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.status) {
      const payload = response.data.data;
      const existingOrder = orderStore.get(order_id) || {};
      const orderData = Object.assign({}, existingOrder, {
        order_id,
        email,
        amount: amountInKobo / 100,
        service_name,
        payment_type,
        reference: payload.reference,
        access_code: payload.access_code,
        authorization_url: payload.authorization_url,
        status: 'Payment Pending',
        payment_status: 'Pending',
        // New orders must default to Pending for order lifecycle consistency
        order_status: 'Pending',
        latest_progress: 'Payment initialized and awaiting admin confirmation',
        created_at: existingOrder.created_at || new Date().toISOString()
      });
      orderStore.set(payload.reference, orderData);
      orderStore.set(order_id, orderData);
      await persistOrder(orderData);

      return res.json({
        success: true,
        order_id: order_id,
        authorization_url: payload.authorization_url,
        reference: payload.reference,
        access_code: payload.access_code
      });
    } else {
      return res.status(400).json({
        success: false,
        message: response.data.message || 'Failed to initialize payment'
      });
    }
  } catch (error) {
    console.error('Create payment error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to create payment',
      error: error.message
    });
  }
});

/**
 * GET /api/payment/verify/:reference
 * Verify Paystack transaction status
 * 
 * Params:
 * - reference (string): Paystack transaction reference
 * 
 * Returns:
 * - status (string): 'success', 'pending', or 'failed'
 * - amount (number): Amount in Naira
 * - metadata (object): Transaction metadata
 * - customer (object): Customer info
 */
app.get('/api/payment/verify/:reference', async (req, res) => {
  console.log(`📍 GET /api/payment/verify/:reference - Payment verification`);
  const { reference } = req.params;
  console.log('✅ Verification route hit for reference:', reference);

  if (!reference) {
    return res.status(400).json({
      success: false,
      message: 'Reference is required'
    });
  }

  try {
    const response = await axios.get(
      `${PAYSTACK_API_URL}/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
        }
      }
    );

    console.log('🔎 Paystack verification response for reference:', reference);
    console.log('🔎 Paystack verification raw response:', JSON.stringify(response.data, null, 2));

    if (!response.data.status) {
      return res.status(400).json({
        success: false,
        message: response.data.message || 'Failed to verify payment'
      });
    }

    const transaction = response.data.data;
    const metadata = transaction.metadata || {};
    const orderId = String(metadata.order_id || '').trim() || null;
    const storedOrder = orderStore.get(transaction.reference) || (orderId ? orderStore.get(orderId) : null);
    const finalOrderId = orderId || storedOrder?.order_id || storedOrder?.id || transaction.reference;
    const paymentTypeRaw = metadata.payment_type || storedOrder?.payment_type || storedOrder?.paymentMethod || 'Unknown';
    const isSuccess = String(transaction.status || '').toLowerCase() === 'success';
    const isDeposit = String(paymentTypeRaw).toLowerCase().includes('deposit') || String(paymentTypeRaw).toLowerCase().includes('50%');

    const paymentStatus = isSuccess ? (isDeposit ? 'Partial' : 'PAID') : String(transaction.status || 'Pending');
    // IMPORTANT: business rule — orders should remain in 'Pending' lifecycle until admin confirms
    const orderStatus = 'Pending';
    const revisionCount = getRevisionCount(paymentTypeRaw);

    const updatedOrder = {
      order_id: finalOrderId,
      client_name: storedOrder?.client_name || metadata.client_name || null,
      client_email: transaction.customer?.email || storedOrder?.client_email || null,
      whatsapp_number: storedOrder?.whatsapp_number || storedOrder?.client_phone || metadata.whatsapp_number || metadata.client_phone || storedOrder?.phone || null,
      service_name: metadata.service_name || storedOrder?.service_name || storedOrder?.service || 'Unknown Service',
      design_description: storedOrder?.design_description || metadata.design_description || null,
      brand_name: storedOrder?.brand_name || metadata.brand_name || null,
      brand_color: storedOrder?.brand_color || metadata.brand_color || metadata.brand_colors || null,
      dob: storedOrder?.dob || metadata.dob || null,
      deadline: storedOrder?.deadline || metadata.deadline || null,
      reference_link: storedOrder?.reference_link || metadata.reference_link || null,
      additional_note: storedOrder?.additional_note || metadata.additional_note || metadata.additional_notes || null,
      amount: transaction.amount / 100,
      payment_type: paymentTypeRaw,
      payment_status: paymentStatus,
      order_status: orderStatus,
      payment_reference: transaction.reference,
      status: orderStatus,
      revision_count: revisionCount,
      latest_progress: isSuccess ? (isDeposit ? 'Deposit payment received — awaiting admin confirmation' : 'Payment received — awaiting admin confirmation') : `Payment ${transaction.status || 'pending'}`,
      email: transaction.customer?.email || storedOrder?.email || null,
      customer_id: transaction.customer?.id || storedOrder?.customer_id || null,
      paid_at: transaction.paid_at,
      created_at: storedOrder?.created_at || transaction.created_at || new Date().toISOString(),
      metadata
    };

    orderStore.set(transaction.reference, updatedOrder);
    if (orderId) {
      orderStore.set(orderId, updatedOrder);
    }

    await persistOrder(updatedOrder);

    if (isSuccess) {
      try {
        const customerEmail = updatedOrder.client_email;
        const designerHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
            <h2 style="color: #8b0000; text-align: center;">New Order Received</h2>
            <div style="background: white; padding: 20px; border-radius: 10px; margin-top: 18px;">
              <p><strong>Order ID:</strong> ${updatedOrder.order_id}</p>
              <p><strong>Customer:</strong> ${updatedOrder.client_name || 'Customer'}</p>
              <p><strong>Email:</strong> ${updatedOrder.client_email || 'N/A'}</p>
              <p><strong>WhatsApp:</strong> ${updatedOrder.whatsapp_number || updatedOrder.client_phone || 'N/A'}</p>
              <p><strong>Service:</strong> ${updatedOrder.service_name}</p>
              <p><strong>Payment Type:</strong> ${updatedOrder.payment_type}</p>
              <p><strong>Payment Status:</strong> ${updatedOrder.payment_status}</p>
              <p><strong>Revision Limit:</strong> ${updatedOrder.revision_count}</p>
              <p><strong>Order Status:</strong> ${updatedOrder.order_status}</p>
              <div style="margin-top: 16px; padding: 16px; background: #f7f7f7; border-radius: 8px;">
                <h3 style="margin: 0 0 8px; color: #333;">Design Brief</h3>
                <p><strong>Description:</strong> ${updatedOrder.design_description || 'Not provided'}</p>
                <p><strong>Brand Name:</strong> ${updatedOrder.brand_name || '—'}</p>
                <p><strong>Brand Colors:</strong> ${updatedOrder.brand_color || updatedOrder.brand_colors || '—'}</p>
                <p><strong>Reference Link:</strong> ${updatedOrder.reference_link || '—'}</p>
                <p><strong>Additional Notes:</strong> ${updatedOrder.additional_note || updatedOrder.additional_notes || '—'}</p>
              </div>
            </div>
            <p style="color: #666; font-size: 13px; margin-top: 20px;">This order has been verified and saved in Supabase.</p>
          </div>
        `;

        // Do NOT auto-send confirmation to customer. Admin must manually accept/update order lifecycle.
        if (DESIGNER_EMAIL) {
          sendEmail(DESIGNER_EMAIL, `New Order - ${updatedOrder.order_id}`, designerHtml);
        }
        if (customerEmail) {
          console.log(`ℹ️ Customer confirmation suppressed for ${updatedOrder.order_id}; awaiting admin action`);
        }
      } catch (err) {
        console.error('❌ Post-payment email notification error:', err.message || err);
      }
    }

    return res.json({
      success: true,
      status: transaction.status,
      amount: updatedOrder.amount,
      reference: updatedOrder.reference,
      metadata: updatedOrder.metadata,
      customer: {
        email: updatedOrder.email,
        id: updatedOrder.customer_id
      },
      paid_at: updatedOrder.paid_at,
      created_at: updatedOrder.created_at,
      order: {
        id: finalOrderId,
        service_name: updatedOrder.service_name,
        payment_status: updatedOrder.payment_status,
        status: updatedOrder.status,
        reference: updatedOrder.reference
      }
    });
  } catch (error) {
    console.error('Verify payment error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error.response?.data?.message || 'Failed to verify payment',
      error: error.message
    });
  }
});

/**
 * GET /api/orders/track/:orderId
 * Query Supabase orders table (preferred) and fallback to in-memory store
 */
async function trackOrderHandler(req, res) {
  const { orderId } = req.params;
  const normalizedOrderId = String(orderId || '').trim();
  console.log(`📍 GET ${req.path} - Track order for orderId=${normalizedOrderId}`);
  if (!normalizedOrderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  if (supabase) {
    try {
      const orderSelect = 'order_id, client_name, client_email, whatsapp_number, service_name, amount, payment_type, payment_status, order_status, revision_count, latest_progress, payment_reference, design_description, brand_name, brand_color, dob, deadline, reference_link, additional_note, created_at';
      const result = await supabase
        .from('matex_orders')
        .select(orderSelect)
        .eq('order_id', normalizedOrderId)
        .limit(1);

      if (result.error) {
        console.error('Supabase query error:', result.error);
      } else if (result.data && result.data.length > 0) {
        return res.json({ success: true, order: result.data[0] });
      }
    } catch (err) {
      console.error('Track order error:', err.message || err);
    }

    // Fall back to in-memory store on query failure or missing order
    console.warn('Falling back to in-memory order store for tracking', normalizedOrderId);
  }

  const order = orderStore.get(normalizedOrderId);
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  return res.json({ success: true, order });
}

app.get('/api/orders/track/:orderId', trackOrderHandler);
app.get('/api/track-order/:orderId', trackOrderHandler);
app.get('/track-order/:orderId', trackOrderHandler);

app.get('/api/orders/:orderId', (req, res) => {
  console.log(`📍 GET /api/orders/${req.params.orderId} - Fetch order`);
  const { orderId } = req.params;
  const order = orderStore.get(orderId);
  if(!order){
    return res.status(404).json({ success: false, message: 'Order not found' });
  }
  return res.json({ success: true, order });
});

/**
 * POST /api/orders/brief
 * Accept project brief data and upsert into persistence layer
 */
app.post('/api/orders/brief', async (req, res) => {
  console.log('📍 POST /api/orders/brief - Upsert project brief');
  try {
    const payload = req.body || {};
    console.log('🔎 Request payload keys:', Object.keys(payload));
    console.log('🔎 Full payload:', JSON.stringify(payload, null, 2));
    const order_id = String(payload.order_id || '').trim();
    if (!order_id) {
      return res.status(400).json({ success: false, message: 'order_id is required' });
    }

    const upsertData = {
      order_id,
      client_name: payload.client_name || payload.full_name || null,
      client_email: payload.client_email || payload.email || null,
      whatsapp_number: payload.whatsapp_number || payload.client_phone || payload.phone || null,
      service_name: payload.service_name || payload.service || null,
      payment_type: payload.payment_type || payload.paymentMethod || null,
      payment_status: payload.payment_status || 'Pending',
      // Ensure new briefs still set lifecycle to Pending until admin confirmation
      order_status: payload.order_status || 'Pending',
      latest_progress: payload.latest_progress || 'Brief submitted',
      revision_count: typeof payload.revision_count === 'number' ? payload.revision_count : getRevisionCount(payload.payment_type || payload.paymentMethod),
      amount: typeof payload.amount === 'number' ? payload.amount : (Number(payload.amount) || null),
      payment_reference: payload.payment_reference || null,
      design_description: payload.design_description || payload.description || null,
      brand_name: payload.brand_name || payload.brand || null,
      brand_color: payload.brand_color || payload.brand_colors || null,
      dob: payload.dob || null,
      reference_link: payload.reference_link || payload.referral_link || null,
      additional_note: payload.additional_note || payload.additional_notes || null,
      deadline: payload.deadline || null,
      created_at: payload.created_at || new Date().toISOString()
    };

    console.log('📦 Upsert data being sent to persistence:', JSON.stringify(upsertData, null, 2));

    if (supabase) {
      await persistOrder(upsertData);
    }

    const existing = orderStore.get(order_id) || {};
    const merged = Object.assign({}, existing, upsertData);
    orderStore.set(order_id, merged);
    console.log('✅ Brief saved to in-memory store for', order_id);
    console.log('✅ All brief fields persisted:', Object.keys(merged).filter(k => ['design_description', 'whatsapp_number', 'brand_name', 'brand_color', 'dob', 'deadline', 'reference_link', 'additional_note'].includes(k)));
    return res.json({ success: true, order: merged });
  } catch (err) {
    console.error('Brief upsert error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to save brief', error: err.message });
  }
});

/**
 * PUT /api/admin/orders/:orderId/status
 * Update order status and optionally send notification to customer
 * 
 * Body:
 * - status (string): New order status
 * - message (string, optional): Message to include in notification email
 */
app.put('/api/admin/orders/:orderId/status', adminAuth, async (req, res) => {
  console.log(`📍 PUT /api/admin/orders/${req.params.orderId}/status - Update order status`);
  try {
    const { orderId } = req.params;
    const { status, message } = req.body || {};

    if (!orderId || !status) {
      return res.status(400).json({ success: false, message: 'orderId and status are required' });
    }

    const statusNote = message ? String(message).trim() : `Status updated to ${status}.`;
    let updatedOrder = null;
    let existingOrder = null;

    if (supabase) {
      try {
        const { data: existingData, error: existingError } = await supabase
          .from('matex_orders')
          .select('order_status, latest_progress, client_email, service_name, order_id')
          .eq('order_id', orderId)
          .limit(1)
          .single();

        if (!existingError && existingData) {
          existingOrder = existingData;
        }
      } catch (err) {
        console.warn('Supabase existing order fetch warning:', err.message || err);
      }

      const previousProgress = existingOrder?.latest_progress ? String(existingOrder.latest_progress).trim() : '';
      const newProgress = previousProgress ? `${previousProgress}\n${statusNote}` : statusNote;

      try {
        const { data, error } = await supabase
          .from('matex_orders')
          .update({ order_status: status, latest_progress: newProgress })
          .eq('order_id', orderId)
          .select()
          .limit(1)
          .single();

        if (error) {
          console.error('Supabase update error:', error);
          throw new Error('Failed to update order');
        }
        if (data) {
          updatedOrder = data;
        }
      } catch (err) {
        console.warn('Supabase status update fallback warning:', err.message || err);
      }
    }

    if (!updatedOrder) {
      const order = orderStore.get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      const existingProgress = order.latest_progress ? String(order.latest_progress).trim() : '';
      const newProgress = existingProgress ? `${existingProgress}\n${statusNote}` : statusNote;
      updatedOrder = {
        ...order,
        status,
        order_status: status,
        latest_progress: newProgress,
        status_history: Array.isArray(order.status_history) ? [...order.status_history, { status, message: statusNote, updated_at: new Date().toISOString() }] : [{ status, message: statusNote, updated_at: new Date().toISOString() }]
      };
      orderStore.set(orderId, updatedOrder);
    }

    if (updatedOrder && updatedOrder.client_email) {
      try {
        await sendEmail(
          updatedOrder.client_email,
          `Order Update - ${updatedOrder.order_id}`,
          buildCustomerNotificationHtml(updatedOrder, statusNote)
        );
      } catch (emailError) {
        console.error('Admin customer notification failed:', emailError.message || emailError);
      }
    }

    return res.json({ success: true, message: 'Order status updated', order: { order_id: orderId, status } });
  } catch (err) {
    console.error('Update order status error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update order status', error: err.message });
  }
});

app.post('/api/admin/email-test', adminAuth, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, message: 'A valid email is required' });
    }

    const sanitizedEmail = String(email).trim();
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
        <h2 style="color: #8b0000; text-align: center;">Matex Email Test</h2>
        <div style="background: white; padding: 20px; border-radius: 10px; margin-top: 18px;">
          <p>This is a test email from the Matex admin dashboard.</p>
          <p><strong>Recipient:</strong> ${sanitizedEmail}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        </div>
      </div>
    `;

    const sent = await sendEmail(sanitizedEmail, 'Matex Admin Email Test', html);
    if (!sent) {
      return res.status(500).json({ success: false, message: 'Unable to send test email' });
    }

    return res.json({ success: true, message: `Test email sent to ${sanitizedEmail}` });
  } catch (err) {
    console.error('Admin email test error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Failed to send test email', error: err.message });
  }
});

/**
 * POST /send-designer-notification

  console.log('📍 POST /api/designer/notify - Send designer notification');
  try {
    const { orderId } = req.body;

    if(!orderId){
      return res.status(400).json({
        success: false,
        message: 'orderId is required'
      });
    }

    if(supabase){
      const { data, error } = await supabase
        .from('matex_orders')
        .select('*')
        .eq('order_id', orderId)
        .limit(1);

      if(error || !data || data.length === 0){
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const order = data[0];
      const designerEmailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
          <h2 style="color: #8b0000; text-align: center;">Order Details</h2>
          <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p><strong>Order ID:</strong> ${order.order_id}</p>
            <p><strong>Customer:</strong> ${order.client_name || 'N/A'}</p>
            <p><strong>Email:</strong> ${order.client_email || 'N/A'}</p>
            <p><strong>WhatsApp:</strong> ${order.whatsapp_number || order.client_phone || 'N/A'}</p>
            <p><strong>Service:</strong> ${order.service_name || 'N/A'}</p>
            <p><strong>Amount:</strong> ₦${Number(order.amount || 0).toLocaleString()}</p>
            <p><strong>Payment Type:</strong> ${order.payment_type || 'N/A'}</p>
            <p><strong>Payment Status:</strong> ${order.payment_status || 'N/A'}</p>
            <p><strong>Order Status:</strong> ${order.order_status || 'N/A'}</p>
            <p><strong>Revisions:</strong> ${order.revision_count || getRevisionCount(order.payment_type)}</p>
            <hr style="margin: 16px 0; border-color: #eee;" />
            <p><strong>Design Description:</strong> ${order.design_description || 'N/A'}</p>
            <p><strong>Brand Name:</strong> ${order.brand_name || 'N/A'}</p>
            <p><strong>Brand Colors:</strong> ${order.brand_color || order.brand_colors || 'N/A'}</p>
            <p><strong>Reference Link:</strong> ${order.reference_link || 'N/A'}</p>
            <p><strong>Additional Notes:</strong> ${order.additional_note || order.additional_notes || 'N/A'}</p>
          </div>
        </div>
      `;
      sendEmail(DESIGNER_EMAIL, `Order Details - ${orderId}`, designerEmailHtml);

      return res.json({ success: true, message: 'Designer notification sent' });
    }

    return res.status(400).json({ success: false, message: 'Supabase not configured' });
  } catch(err){
    console.error('Send designer notification error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to send notification',
      error: err.message
    });
  }
});

/**
 * Reviews API
 */

// Public: submit a review
app.post('/api/reviews', async (req, res) => {
  try {
    const { full_name, company, rating, message } = req.body || {};
    if (!full_name || !message || typeof rating === 'undefined') {
      return res.status(400).json({ success: false, message: 'full_name, rating and message are required' });
    }
    const r = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.createHash('sha1').update(Date.now().toString()).digest('hex'),
      full_name: String(full_name).trim(),
      company: company ? String(company).trim() : null,
      rating: Math.max(1, Math.min(5, Number(rating) || 1)),
      message: String(message).trim(),
      status: 'Pending',
      created_at: new Date().toISOString()
    };

    // Persist
    let storedReview = null;
    try {
      storedReview = await persistReview(r);
    } catch (persistError) {
      console.error('Submit review persistence failed:', persistError.message || persistError);
      return res.status(500).json({ success: false, message: 'Failed to save review: ' + (persistError.message || 'Unknown error') });
    }

    return res.json({ success: true, message: 'Review submitted', review: { id: storedReview.id || r.id, status: storedReview.status || r.status } });
  } catch (err) {
    console.error('Submit review error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Failed to submit review' });
  }
});

// Public: get approved reviews
app.get('/api/reviews', async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('matex_reviews').select('*').eq('status', 'Approved').order('created_at', { ascending: false });
      if (error) {
        console.error('Supabase fetch reviews error:', error);
      } else {
        return res.json({ success: true, reviews: data || [] });
      }
    }

    // Fallback to in-memory approved reviews
    const reviews = Array.from(reviewStore.values()).filter(r => r.status === 'Approved').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({ success: true, reviews });
  } catch (err) {
    console.error('Get reviews error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load reviews' });
  }
});

// Admin: list all reviews (pending/approved/rejected)
app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  try {
    if (supabase) {
      const { data, error } = await supabase.from('matex_reviews').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Supabase admin fetch reviews error:', error);
        return res.status(500).json({ success: false, message: 'Unable to load admin reviews' });
      }
      return res.json({ success: true, reviews: data || [] });
    }
    const reviews = Array.from(reviewStore.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return res.json({ success: true, reviews });
  } catch (err) {
    console.error('Admin get reviews error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load reviews' });
  }
});

async function updateAdminReviewStatus(req, res, forcedStatus = null) {
  try {
    const id = String(req.params.id || '').trim();
    const status = forcedStatus || (req.body || {}).status;
    if (!id || !status) return res.status(400).json({ success: false, message: 'id and status are required' });

    if (supabase) {
      const { data, error } = await supabase.from('matex_reviews').update({ status }).eq('id', id).select().limit(1).single();
      if (error) {
        console.error('Supabase update review error:', error);
      } else {
        return res.json({ success: true, review: data });
      }
    }

    const existing = reviewStore.get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Review not found' });
    existing.status = status;
    reviewStore.set(id, existing);
    return res.json({ success: true, review: existing });
  } catch (err) {
    console.error('Admin update review error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to update review' });
  }
}

// Admin: update review status (approve/reject)
app.put('/api/admin/reviews/:id', adminAuth, async (req, res) => updateAdminReviewStatus(req, res));
app.put('/api/admin/reviews/:id/approve', adminAuth, async (req, res) => updateAdminReviewStatus(req, res, 'Approved'));
app.put('/api/admin/reviews/:id/reject', adminAuth, async (req, res) => updateAdminReviewStatus(req, res, 'Rejected'));

// Admin: delete review
app.delete('/api/admin/reviews/:id', adminAuth, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ success: false, message: 'id is required' });
    if (supabase) {
      const { error } = await supabase.from('matex_reviews').delete().eq('id', id);
      if (error) {
        console.error('Supabase delete review error:', error);
      } else {
        return res.json({ success: true });
      }
    }
    reviewStore.delete(id);
    return res.json({ success: true });
  } catch (err) {
    console.error('Admin delete review error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to delete review' });
  }
});

function getRegisteredRoutes() {
  const routes = [];
  if (!app || !app._router || !app._router.stack) return routes;
  app._router.stack.forEach(layer => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods || {}).map(m => m.toUpperCase()).join(', ');
      routes.push(`${methods} ${layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach(subLayer => {
        if (subLayer.route && subLayer.route.path) {
          const methods = Object.keys(subLayer.route.methods || {}).map(m => m.toUpperCase()).join(', ');
          routes.push(`${methods} ${subLayer.route.path}`);
        }
      });
    }
  });
  return routes.sort();
}

app.get('/api/routes', (req, res) => {
  return res.json({ success: true, routes: getRegisteredRoutes() });
});

/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// ==================== SERVER STARTUP ====================

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n✅ Matex backend is running on http://localhost:${port}`);
    console.log(`📦 Paystack integration active`);
    console.log(`🔐 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use. Backend requires port ${PORT} and will exit.`);
      process.exit(1);
    }
    console.error('❌ Server startup error:', err);
    process.exit(1);
  });
}

startServer(PORT);
