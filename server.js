import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import config from './lib/config.js';
import { createAdminToken, adminAuth, verifyAdminToken } from './lib/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration loaded from ./lib/config.js (which already reads .env)

const app = express();
// Use PORT from configuration module (which loads environment variables)
const PORT = config.PORT;

const configValidation = config.validateConfig();
if (configValidation.warnings.length > 0) {
  console.warn('⚠️ Backend configuration warnings:');
  configValidation.warnings.forEach((warning) => console.warn(`  - ${warning}`));
}
if (configValidation.errors.length > 0) {
  console.error('❌ Backend configuration errors:');
  configValidation.errors.forEach((error) => console.error(`  - ${error}`));
}

// Middleware
app.use(cors({
  origin: true,
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization','Accept']
}));
app.options('*', cors());
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

// Paystack Configuration
const PAYSTACK_SECRET_KEY = config.PAYSTACK_SECRET_KEY;
const PAYSTACK_API_URL = config.PAYSTACK_API_URL;

// Service Pricing Configuration - SINGLE SOURCE OF TRUTH
const SERVICE_PRICING = config.SERVICE_PRICING;
const ADMIN_TOKEN_TTL_MS = config.ADMIN_TOKEN_TTL_MS;

// Email Configuration
let emailTransporter = null;
let smtpTransporterVerified = false;
const DESIGNER_EMAIL = config.DESIGNER_EMAIL;
const NOREPLY_EMAIL = config.NOREPLY_EMAIL;
const SMTP_HOST = config.SMTP_HOST;
const SMTP_PORT = config.SMTP_PORT;
const SMTP_SECURE = config.SMTP_SECURE;
const SMTP_USER = config.SMTP_USER;
const SMTP_PASS = config.SMTP_PASS;
const SENDGRID_API_KEY = config.SENDGRID_API_KEY;
const EMAIL_PROVIDER = config.EMAIL_PROVIDER;
const isSendGridProvider = EMAIL_PROVIDER === 'sendgrid' && Boolean(SENDGRID_API_KEY);
const hasSMTPPass = Boolean(SMTP_PASS);

const smtpConfig = config.smtpConfig;

function getSmtpConfigurationCause() {
  return config.getSmtpConfigurationCause();
}

if (EMAIL_PROVIDER === 'sendgrid') {
  if (!SENDGRID_API_KEY) {
    console.warn('⚠️ SendGrid is selected as the email provider but SENDGRID_API_KEY is not configured.');
  } else {
    try {
      sgMail.setApiKey(SENDGRID_API_KEY);
      console.log('✅ SendGrid provider configured');
      console.log(`   EMAIL_PROVIDER: ${EMAIL_PROVIDER}`);
      console.log(`   SENDGRID_API_KEY: ${SENDGRID_API_KEY ? '<set>' : '<unset>'}`);
    } catch (err) {
      console.error('❌ Failed to configure SendGrid provider:', err);
      emailTransporter = null;
    }
  }
} else {
  if (SMTP_USER && SMTP_PASS) {
    try {
      emailTransporter = nodemailer.createTransport(smtpConfig);
      emailTransporter.on('error', (err) => {
        console.error('⚠️ SMTP transporter connection error:', err);
      });
      console.log('✅ SMTP email service configured');
      console.log(`   SMTP_HOST: ${SMTP_HOST}`);
      console.log(`   SMTP_PORT: ${SMTP_PORT}`);
      console.log(`   SMTP_SECURE: ${SMTP_SECURE}`);
      console.log(`   requireTLS: ${smtpConfig.requireTLS}`);
      console.log(`   SMTP_USER: ${SMTP_USER || '(not set)'}`);
      console.log(`   SMTP_FROM: ${config.SMTP_FROM}`);
      console.log(`   hasSMTPPass: ${hasSMTPPass}`);
      const configCheck = getSmtpConfigurationCause();
      if (configCheck.cause !== 'ok') {
        console.warn(`   SMTP configuration warning: ${configCheck.cause} - ${configCheck.message}`);
      }
    } catch (err) {
      console.error('❌ Failed to create SMTP email transporter:', err);
      console.warn('⚠️ Email notifications will be disabled');
      emailTransporter = null;
    }
  } else {
    console.warn('⚠️ SMTP configuration incomplete or disabled; email notifications disabled for SMTP');
    if (!SMTP_USER) console.warn('   Missing: SMTP_USER');
    if (!SMTP_PASS) console.warn('   Missing: SMTP_PASS');
  }
}

if (isSendGridProvider) {
  smtpTransporterVerified = true;
}

async function ensureTransporterVerified() {
  const isSendGrid = EMAIL_PROVIDER === 'sendgrid' && Boolean(SENDGRID_API_KEY);
  if (!isSendGrid && !emailTransporter) {
    smtpTransporterVerified = false;
    return {
      success: false,
      cause: 'Missing Environment Variable',
      diagnosis: 'Email transporter is not configured because SMTP_USER or SMTP_PASS is missing.',
      reason: 'Set SMTP_USER and SMTP_PASS in your environment. For Gmail, use an app password.'
    };
  }

  if (smtpTransporterVerified) {
    return { success: true };
  }

  const configCause = getSmtpConfigurationCause();
  if (configCause.cause !== 'ok') {
    smtpTransporterVerified = false;
    return {
      success: false,
      cause: configCause.cause,
      diagnosis: configCause.message,
      reason: configCause.message
    };
  }

  if (isSendGrid) {
    smtpTransporterVerified = true;
    return { success: true };
  }

  try {
    const verifyPromise = emailTransporter.verify();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP verification timeout (>60s)')), 60000)
    );
    
    await Promise.race([verifyPromise, timeoutPromise]);
    smtpTransporterVerified = true;
    return { success: true };
  } catch (err) {
    smtpTransporterVerified = false;
    const classification = classifySmtpError(err);
    return {
      success: false,
      cause: classification.cause,
      diagnosis: classification.diagnosis,
      reason: classification.reason,
      error: err?.message || String(err),
      errorFull: serializeSmtpError(err),
      errorCode: err?.code || null,
      command: err?.command || null
    };
  }
}

// Helper: Send email with retry logic
async function sendEmail(to, subject, html, fromEmail, retries = 2) {
  const normalizedTo = typeof to === 'string' ? to.trim() : '';
  if (!normalizedTo) {
    logEmailEvent('email_send_skipped', {
      reason: 'empty_recipient',
      subject
    });
    return false;
  }

  const fromAddress = fromEmail || config.SMTP_FROM || NOREPLY_EMAIL;
  const isSendGrid = EMAIL_PROVIDER === 'sendgrid' && Boolean(SENDGRID_API_KEY);

  if (!isSendGrid && !emailTransporter) {
    logEmailEvent('email_send_failed', {
      reason: 'transporter_not_configured',
      recipient: normalizedTo,
      subject
    });
    return false;
  }

  const configCause = getSmtpConfigurationCause();
  if (configCause.cause !== 'ok') {
    logEmailEvent('email_send_failed', {
      reason: 'invalid_email_configuration',
      recipient: normalizedTo,
      subject,
      cause: configCause.cause,
      diagnosis: configCause.message
    });
    return false;
  }

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      logEmailEvent('email_send_attempt', {
        recipient: normalizedTo,
        subject,
        attempt,
        totalAttempts: retries + 1,
        from: fromAddress,
        provider: EMAIL_PROVIDER
      });

      let sendPromise;
      if (EMAIL_PROVIDER === 'sendgrid' && Boolean(SENDGRID_API_KEY)) {
        const mailData = {
          from: fromAddress,
          to: normalizedTo,
          subject,
          html
        };
        sendPromise = sgMail.send(mailData);
      } else {
        sendPromise = emailTransporter.sendMail({
          from: fromAddress,
          to: normalizedTo,
          subject,
          html
        });
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP send timeout (>60s)')), 60000)
      );
      const result = await Promise.race([sendPromise, timeoutPromise]);
      smtpTransporterVerified = true;
      logEmailEvent('email_send_success', {
        recipient: normalizedTo,
        subject,
        attempt,
        provider: EMAIL_PROVIDER,
        messageId: result?.[0]?.messageId || result?.messageId || null,
        response: result?.[0]?.headers || result?.headers || null
      });
      return true;
    } catch (err) {
      smtpTransporterVerified = false;
      const classification = classifySmtpError(err);
      const isLastAttempt = attempt === retries + 1;
      logEmailEvent('email_send_failed', {
        recipient: normalizedTo,
        subject,
        attempt,
        totalAttempts: retries + 1,
        cause: classification.cause,
        diagnosis: classification.diagnosis,
        reason: classification.reason,
        error: serializeSmtpError(err)
      });

      if (isLastAttempt) {
        return false;
      }

      const delay = attempt * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return false;
}

function classifySmtpError(err) {
  const message = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();

  if (code === 'EAUTH' || message.includes('authentication failed') || message.includes('invalid login') || message.includes('username and password not accepted')) {
    return {
      cause: 'Gmail Authentication Failure',
      diagnosis: 'SMTP authentication failed.',
      reason: 'The username/password or app password is invalid.'
    };
  }

  if (code === 'ENOTFOUND' || message.includes('getaddrinfo') || message.includes('host not found')) {
    return {
      cause: 'Wrong Host',
      diagnosis: 'SMTP host could not be resolved.',
      reason: 'The configured SMTP_HOST is invalid or unreachable.'
    };
  }

  if (code === 'ECONNREFUSED' || message.includes('refused') || message.includes('wrong port')) {
    return {
      cause: 'Wrong Port',
      diagnosis: 'The SMTP server rejected the connection or the port is blocked.',
      reason: 'Check SMTP_PORT and network firewall rules.'
    };
  }

  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || message.includes('timed out') || message.includes('timeout')) {
    return {
      cause: 'Render outbound connection issue',
      diagnosis: 'The SMTP connection timed out.',
      reason: 'The environment could not establish a connection to the SMTP server.'
    };
  }

  if (message.includes('ssl') || message.includes('tls') || message.includes('secure')) {
    return {
      cause: 'Wrong Secure Setting',
      diagnosis: 'Secure/TLS settings appear invalid for the configured SMTP port.',
      reason: 'Check SMTP_SECURE and SMTP_PORT for your SMTP provider.'
    };
  }

  return {
    cause: 'Unknown SMTP Issue',
    diagnosis: 'SMTP verification failed for an unclassified reason.',
    reason: 'Inspect logs and SMTP configuration for additional details.'
  };
}

async function runSmtpDiagnostics(targetEmail) {
  const configStatus = getSmtpConfigurationCause();
  const diagnostics = {
    smtpHost: SMTP_HOST,
    smtpPort: SMTP_PORT,
    smtpSecure: SMTP_SECURE,
    smtpUser: SMTP_USER || null,
    smtpFrom: config.SMTP_FROM || null,
    hasSMTPPass,
    configCause: configStatus.cause,
    configMessage: configStatus.message,
    connectionSuccess: false,
    authenticationSuccess: false,
    realSendAttempted: false,
    realSendSuccess: false,
    diagnosis: configStatus.cause,
    reason: configStatus.message,
    targetEmail: typeof targetEmail === 'string' ? targetEmail.trim() : ''
  };

  if (configStatus.cause !== 'ok') {
    return diagnostics;
  }

  const isSendGrid = EMAIL_PROVIDER === 'sendgrid' && Boolean(SENDGRID_API_KEY);
  const transporter = isSendGrid
    ? null
    : emailTransporter || nodemailer.createTransport(Object.assign({}, smtpConfig, { tls: { rejectUnauthorized: false } }));
  const testAddress = diagnostics.targetEmail || SMTP_USER || DESIGNER_EMAIL || null;
  if (!testAddress) {
    diagnostics.diagnosis = 'No valid target email address for test send.';
    diagnostics.reason = 'Set SMTP_USER, DESIGNER_EMAIL, or provide a target email when running diagnostics.';
    return diagnostics;
  }

  try {
    if (isSendGrid) {
      diagnostics.connectionSuccess = true;
      diagnostics.authenticationSuccess = true;
      diagnostics.diagnosis = 'SendGrid provider configured. No SMTP handshake required.';
      diagnostics.reason = 'SendGrid API key is configured.';
    } else {
      const verifyPromise = transporter.verify();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP verification timeout (>60s)')), 60000)
      );

      await Promise.race([verifyPromise, timeoutPromise]);
      diagnostics.connectionSuccess = true;
      diagnostics.authenticationSuccess = true;
      diagnostics.diagnosis = 'SMTP connection and authentication succeeded.';
      diagnostics.reason = 'The SMTP server accepted the connection and credentials.';
    }
  } catch (err) {
    const classification = classifySmtpError(err);
    diagnostics.connectionSuccess = false;
    diagnostics.authenticationSuccess = false;
    diagnostics.cause = classification.cause;
    diagnostics.diagnosis = classification.diagnosis;
    diagnostics.reason = classification.reason;
    diagnostics.error = err?.message || String(err);
    diagnostics.errorFull = serializeSmtpError(err);
    diagnostics.errorCode = err?.code || null;
    diagnostics.errorCommand = err?.command || null;
    if (['Render outbound connection issue', 'Wrong Port', 'Wrong Host'].includes(diagnostics.cause)) {
      diagnostics.suggestedAction = 'Verify network egress and SMTP host/port; some hosts block outbound SMTP. Try a transactional email provider or alternate port.';
    }
    return diagnostics;
  }

  diagnostics.realSendAttempted = true;
  try {
    const fromAddress = config.SMTP_FROM || SMTP_USER || NOREPLY_EMAIL;
    const mailOptions = {
      from: fromAddress,
      to: testAddress,
      subject: isSendGrid ? 'Matex SendGrid Connectivity Test' : 'Matex SMTP Connectivity Test',
      text: 'This is a connectivity test message sent by the Matex backend. If you receive this, email is working.',
      html: `<p>This is a connectivity test message sent by the Matex backend. If you receive this, email is working.</p><p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>`
    };

    let sendPromise;
    if (isSendGrid) {
      sendPromise = sgMail.send(mailOptions);
    } else {
      sendPromise = transporter.sendMail(mailOptions);
    }

    const sendTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP send timeout (>60s)')), 60000)
    );

    const info = await Promise.race([sendPromise, sendTimeout]);
    diagnostics.realSendSuccess = true;
    diagnostics.emailInfo = {
      messageId: info?.[0]?.messageId || info?.messageId || null,
      response: info?.[0]?.headers || info?.headers || null
    };
    diagnostics.diagnosis = isSendGrid
      ? 'SendGrid connectivity test succeeded.'
      : 'SMTP verify and real send succeeded.';
    diagnostics.reason = `Test email sent to ${testAddress}.`;
  } catch (err) {
    const classification = classifySmtpError(err);
    diagnostics.realSendSuccess = false;
    diagnostics.cause = classification.cause;
    diagnostics.diagnosis = classification.diagnosis;
    diagnostics.reason = classification.reason;
    diagnostics.error = err?.message || String(err);
    diagnostics.errorFull = serializeSmtpError(err);
    diagnostics.errorCode = err?.code || null;
    diagnostics.errorCommand = err?.command || null;
    if (diagnostics.cause === 'Render outbound connection issue' || diagnostics.cause === 'Wrong Port' || diagnostics.cause === 'Wrong Host') {
      diagnostics.suggestedAction = 'Real send failed; suspect network connectivity or blocked SMTP egress.';
    }
  }

  return diagnostics;
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

// In-memory chat persistence fallback
const chatConversationsStore = new Map();
const chatMessagesStore = new Map();

// In-memory fallback store for order files when Supabase is not configured
const orderFilesStore = new Map();

function normalizeOrderFile(record) {
  const now = new Date().toISOString();
  return {
    id: String(record.id || crypto.randomUUID()),
    order_id: String(record.order_id),
    file_name: record.file_name || record.name || 'file',
    storage_path: record.storage_path || null,
    bucket_name: record.bucket_name || 'order-deliveries',
    mime_type: record.mime_type || record.contentType || null,
    file_size: typeof record.file_size === 'number' ? record.file_size : (record.file_size ? Number(record.file_size) : null),
    version_label: record.version_label || record.version || null,
    uploaded_by: record.uploaded_by || null,
    uploaded_at: record.uploaded_at || now,
    delivery_status: record.delivery_status || 'Delivered',
    notify_sent: Boolean(record.notify_sent || false),
    metadata: Object.assign({}, record.metadata || {}, { file_type: record.file_type || (record.metadata && record.metadata.file_type) || null })
  };
}

async function persistOrderFile(fileRecord) {
  const record = normalizeOrderFile(fileRecord);
  if (!supabase) {
    const files = orderFilesStore.get(record.order_id) || [];
    files.push(record);
    orderFilesStore.set(record.order_id, files);
    return record;
  }
  try {
    const { data, error } = await supabase.from('matex_order_files').insert([record]).select();
    if (error) {
      console.error('Supabase persistOrderFile error:', error);
      throw error;
    }
    if (Array.isArray(data) && data.length > 0) return data[0];
    return record;
  } catch (err) {
    console.error('persistOrderFile exception:', err.message || err);
    return record;
  }
}

async function loadOrderFiles(orderId) {
  if (!orderId) return [];
  if (!supabase) {
    return orderFilesStore.get(orderId) || [];
  }
  try {
    const { data, error } = await supabase.from('matex_order_files').select('*').eq('order_id', orderId).order('uploaded_at', { ascending: false });
    if (error) {
      console.error('Supabase loadOrderFiles error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('loadOrderFiles exception:', err.message || err);
    return [];
  }
}

async function createSignedUrlForFile(bucket, path, expiresSec = 3600) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresSec);
    if (error) {
      console.error('Supabase createSignedUrl error:', error);
      return null;
    }
    // support both signedURL and signedUrl naming
    return data?.signedUrl || data?.signedURL || null;
  } catch (err) {
    console.error('createSignedUrlForFile exception:', err.message || err);
    return null;
  }
}

function normalizeChatConversation(conversation) {
  const now = new Date().toISOString();
  return {
    id: String(conversation.id || crypto.randomUUID()),
    customer_name: conversation.customer_name || 'Guest',
    customer_email: conversation.customer_email || null,
    customer_phone: conversation.customer_phone || null,
    subject: conversation.subject || 'New conversation',
    status: conversation.status || 'open',
    source: conversation.source || 'website',
    order_id: conversation.order_id || null,
    unread_admin_count: Number(conversation.unread_admin_count || 0),
    unread_customer_count: Number(conversation.unread_customer_count || 0),
    last_message_at: conversation.last_message_at || now,
    created_at: conversation.created_at || now,
    updated_at: conversation.updated_at || now
  };
}

function normalizeChatMessage(message) {
  const now = new Date().toISOString();
  return {
    id: String(message.id || crypto.randomUUID()),
    conversation_id: String(message.conversation_id),
    sender: String(message.sender || 'customer'),
    sender_name: message.sender_name || (message.sender === 'admin' ? 'Admin' : 'Customer'),
    sender_email: message.sender_email || null,
    body: String(message.body || '').trim(),
    metadata: message.metadata || null,
    is_system: Boolean(message.is_system || false),
    created_at: message.created_at || now
  };
}

async function persistChatConversation(conversation) {
  if (!conversation) return conversation;
  const record = normalizeChatConversation(conversation);
  if (!supabase) {
    chatConversationsStore.set(record.id, record);
    try { broadcastAdminEvent('chat_conversation', record); } catch (e) {}
    return record;
  }
  try {
    const { data, error } = await supabase.from('matex_chat_conversations').upsert([record], { onConflict: 'id' }).select();
    if (error) {
      console.error('Supabase persistChatConversation error:', error);
      throw error;
    }
    if (Array.isArray(data) && data.length > 0) {
      try { broadcastAdminEvent('chat_conversation', data[0]); } catch (e) {}
      return data[0];
    }
    try { broadcastAdminEvent('chat_conversation', record); } catch (e) {}
    return record;
  } catch (err) {
    console.error('persistChatConversation exception:', err.message || err);
    return record;
  }
}

async function persistChatMessage(message) {
  if (!message || !message.conversation_id || !message.body) return message;
  const record = normalizeChatMessage(message);
  if (!supabase) {
    const messages = chatMessagesStore.get(record.conversation_id) || [];
    messages.push(record);
    chatMessagesStore.set(record.conversation_id, messages);
    try { broadcastAdminEvent('chat_message', record); } catch (e) {}
    return record;
  }
  try {
    const { data, error } = await supabase.from('matex_chat_messages').insert([record]).select();
    if (error) {
      console.error('Supabase persistChatMessage error:', error);
      throw error;
    }
    if (Array.isArray(data) && data.length > 0) {
      try { broadcastAdminEvent('chat_message', data[0]); } catch (e) {}
      return data[0];
    }
    try { broadcastAdminEvent('chat_message', record); } catch (e) {}
    return record;
  } catch (err) {
    console.error('persistChatMessage exception:', err.message || err);
    return record;
  }
}

const emailReplyStore = new Map();

function extractOrderIdFromEmailSubject(subject) {
  if (!subject) return null;
  const normalized = String(subject || '').trim();
  const match = normalized.match(/(?:order(?: id|#|ref| reference)?[:\s-]*)([A-Za-z0-9\-_]+)/i);
  return match ? match[1] : null;
}

async function persistEmailReply(reply) {
  if (!reply) return null;
  const record = {
    id: String(reply.id || crypto.randomUUID()),
    from_email: String(reply.from_email || reply.from || '').trim() || null,
    subject: String(reply.subject || '').trim() || null,
    body: String(reply.body || reply.text || '').trim() || null,
    html: reply.html || null,
    order_id: String(reply.order_id || extractOrderIdFromEmailSubject(reply.subject) || '').trim() || null,
    message_id: String(reply.message_id || reply['message-id'] || '').trim() || null,
    in_reply_to: String(reply.in_reply_to || reply['in-reply-to'] || '').trim() || null,
    created_at: new Date().toISOString()
  };

  if (!supabase) {
    emailReplyStore.set(record.id, record);
    try { broadcastAdminEvent('email_reply', record); } catch (e) {}
    return record;
  }

  try {
    const { data, error } = await supabase.from('matex_email_replies').insert([record]).select();
    if (error) {
      console.error('Supabase persistEmailReply error:', error);
      throw error;
    }
    const persisted = Array.isArray(data) && data.length > 0 ? data[0] : record;
    try { broadcastAdminEvent('email_reply', persisted); } catch (e) {}
    return persisted;
  } catch (err) {
    console.error('persistEmailReply exception:', err.message || err);
    try { broadcastAdminEvent('email_reply', record); } catch (e) {}
    return record;
  }
}

async function loadChatConversations() {
  if (!supabase) {
    return Array.from(chatConversationsStore.values()).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
  }
  try {
    const { data, error } = await supabase.from('matex_chat_conversations').select('*').order('last_message_at', { ascending: false });
    if (error) {
      console.error('Supabase loadChatConversations error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('loadChatConversations exception:', err.message || err);
    return [];
  }
}

async function loadChatConversationById(conversationId) {
  if (!conversationId) return null;
  if (!supabase) {
    return chatConversationsStore.get(conversationId) || null;
  }
  try {
    const { data, error } = await supabase.from('matex_chat_conversations').select('*').eq('id', conversationId).limit(1).maybeSingle();
    if (error) {
      console.error('Supabase loadChatConversationById error:', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.error('loadChatConversationById exception:', err.message || err);
    return null;
  }
}

async function loadChatConversationByOrderId(orderId) {
  const normalizedOrderId = String(orderId || '').trim();
  if (!normalizedOrderId) return null;
  if (!supabase) {
    return Array.from(chatConversationsStore.values()).find((conversation) => String(conversation.order_id || '') === normalizedOrderId) || null;
  }
  try {
    const { data, error } = await supabase.from('matex_chat_conversations').select('*').eq('order_id', normalizedOrderId).order('last_message_at', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      console.error('Supabase loadChatConversationByOrderId error:', error);
      return null;
    }
    return data || null;
  } catch (err) {
    console.error('loadChatConversationByOrderId exception:', err.message || err);
    return null;
  }
}

async function loadChatMessages(conversationId) {
  if (!conversationId) return [];
  if (!supabase) {
    return (chatMessagesStore.get(conversationId) || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }
  try {
    const { data, error } = await supabase.from('matex_chat_messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
    if (error) {
      console.error('Supabase loadChatMessages error:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error('loadChatMessages exception:', err.message || err);
    return [];
  }
}

async function updateChatConversation(conversationId, patch) {
  if (!conversationId || !patch) return null;
  const existing = await loadChatConversationById(conversationId);
  if (!existing) return null;
  const merged = Object.assign({}, existing, patch, { updated_at: new Date().toISOString() });
  return persistChatConversation(merged);
}

function buildChatNotificationHtml(conversation, message, options = {}) {
  const title = options.forAdmin ? 'New Live Chat Message' : 'Reply from Matex Team';
  return `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; background: #f5f5f5; padding: 24px; border-radius: 12px;">
      <h2 style="color: #8b0000; text-align: center;">${title}</h2>
      <div style="background: white; padding: 20px; border-radius: 10px; margin-top: 18px;">
        <p><strong>Conversation:</strong> ${conversation.subject || 'Live chat'}</p>
        <p><strong>Customer:</strong> ${conversation.customer_name || 'Guest'}</p>
        <p><strong>Email:</strong> ${conversation.customer_email || 'N/A'}</p>
        <p><strong>Phone:</strong> ${conversation.customer_phone || 'N/A'}</p>
        <hr style="margin: 16px 0; border-color: #eee;" />
        <p style="white-space: pre-wrap;">${message.body}</p>
      </div>
      <p style="color: #666; font-size: 13px; margin-top: 20px;">This message was generated by the Matex live messaging system.</p>
    </div>
  `;
}

async function notifyAdminAboutNewChatMessage(conversation, message) {
  if (!DESIGNER_EMAIL || !message || message.sender !== 'customer') return;
  try {
    await sendEmail(
      DESIGNER_EMAIL,
      `New chat message from ${conversation.customer_name || 'a customer'}`,
      buildChatNotificationHtml(conversation, message, { forAdmin: true })
    );
  } catch (err) {
    console.error('Admin chat notification failed:', err.message || err);
  }
}

async function notifyCustomerAboutAdminReply(conversation, message) {
  if (!conversation?.customer_email || !message || message.sender !== 'admin') return;
  try {
    await sendEmail(
      conversation.customer_email,
      `Reply from Matex — ${conversation.subject || 'Live chat'}`,
      buildChatNotificationHtml(conversation, message, { forAdmin: false })
    );
  } catch (err) {
    console.error('Customer chat notification failed:', err.message || err);
  }
}

const SUPABASE_ORDER_FIELDS = [
  'order_id',
  'conversation_id',
  'client_name',
  'client_email',
  'whatsapp_number',
  'service_name',
  'amount',
  'amount_paid',
  'amount_remaining',
  'payment_method',
  'payment_type',
  'payment_status',
  'payment_reference',
  'payment_date',
  'paid_at',
  'download_access',
  'order_status',
  'revision_count',
  'revisions_allowed',
  'revisions_used',
  'revisions_remaining',
  'latest_progress',
  'status_history',
  'metadata',
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

function computeRevisionState(order = {}) {
  const paymentType = String(order.payment_type || order.paymentType || order.paymentMethod || '').toLowerCase();
  const allowed = Number.isFinite(Number(order.revisions_allowed))
    ? Number(order.revisions_allowed)
    : (Number.isFinite(Number(order.revision_count)) ? Number(order.revision_count) : getRevisionCount(paymentType));
  const used = Number.isFinite(Number(order.revisions_used))
    ? Number(order.revisions_used)
    : (Number.isFinite(Number(order.revision_count)) ? Number(order.revision_count) : 0);
  const remaining = Math.max(allowed - used, 0);
  return { allowed, used, remaining };
}

function normalizeOrderRecord(order) {
  if (!order || !order.order_id) return null;
  const amount = typeof order.amount === 'number' ? order.amount : (Number(order.amount) || null);
  const amountPaid = typeof order.amount_paid === 'number' ? order.amount_paid : (Number(order.amount_paid) || 0);
  const paymentStatusNormalized = String(order.payment_status || order.paymentStatus || 'Pending').toUpperCase();
  const paymentTypeValue = order.payment_type || order.paymentType || order.paymentMethod || null;
  const isFullPayment = String(paymentTypeValue || '').toLowerCase().includes('full');

  const record = {
    order_id: String(order.order_id),
    conversation_id: order.conversation_id || order.conversationId || null,
    client_name: order.client_name || order.full_name || null,
    client_email: order.client_email || order.email || null,
    whatsapp_number: order.whatsapp_number || order.client_phone || order.phone || null,
    service_name: order.service_name || order.service || null,
    amount,
    amount_paid: amountPaid || 0,
    amount_remaining: amount !== null ? Math.max(amount - amountPaid, 0) : (typeof order.amount_remaining === 'number' ? order.amount_remaining : null),
    payment_method: order.payment_method || order.paymentMethod || null,
    payment_type: paymentTypeValue,
    payment_status: paymentStatusNormalized === 'FAILED' ? 'FAILED' : (paymentStatusNormalized === 'PAID' ? 'PAID' : 'Pending'),
    payment_reference: order.payment_reference || order.reference || null,
    payment_date: order.payment_date || order.paid_at || null,
    paid_at: order.paid_at || order.payment_date || null,
    download_access: paymentStatusNormalized === 'PAID' && isFullPayment,
    order_status: order.order_status || order.status || 'Pending',
    revision_count: typeof order.revision_count === 'number' ? order.revision_count : getRevisionCount(paymentTypeValue),
    latest_progress: order.latest_progress || order.status || 'Order created',
    metadata: order.metadata || null,
    design_description: order.design_description || order.description || order.metadata?.design_description || null,
    brand_name: order.brand_name || order.brand || null,
    brand_color: order.brand_color || order.brand_colors || null,
    dob: order.dob || null,
    reference_link: order.reference_link || order.referral_link || order.metadata?.reference_link || null,
    additional_note: order.additional_note || order.additional_notes || order.metadata?.additional_notes || null,
    deadline: order.deadline || null,
    created_at: order.created_at || new Date().toISOString()
  };

  const revisionState = computeRevisionState(Object.assign({}, order, record));
  record.revision_count = revisionState.allowed;
  record.revisions_allowed = revisionState.allowed;
  record.revisions_used = revisionState.used;
  record.revisions_remaining = revisionState.remaining;

  if (Object.prototype.hasOwnProperty.call(order, 'status_history')) {
    record.status_history = order.status_history;
  } else if (Object.prototype.hasOwnProperty.call(order, 'statusHistory')) {
    record.status_history = order.statusHistory;
  }

  return record;
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

async function ensureSupabaseSchemaCompatibility() {
  if (!supabase) return { ok: true, checked: false, details: [] };
  const checks = [];
  const tableChecks = [
    { table: 'matex_orders', columns: ['amount_paid', 'revisions_allowed', 'revisions_used', 'revisions_remaining', 'revision_count'] },
    { table: 'matex_chat_conversations', columns: ['order_id', 'unread_admin_count', 'unread_customer_count'] },
    { table: 'matex_chat_messages', columns: ['conversation_id', 'is_system'] },
    { table: 'matex_order_files', columns: ['delivery_status', 'notify_sent'] },
    { table: 'matex_revisions', columns: ['revisions_used', 'revisions_remaining'] }
  ];

  for (const check of tableChecks) {
    try {
      const { data, error } = await supabase.from(check.table).select('*').limit(1);
      if (error) {
        checks.push({ table: check.table, ok: false, error: error.message || String(error) });
        continue;
      }
      checks.push({ table: check.table, ok: true, columns: Array.isArray(data) ? [] : [] });
    } catch (err) {
      checks.push({ table: check.table, ok: false, error: err?.message || String(err) });
    }
  }

  return { ok: checks.every((item) => item.ok), checked: true, details: checks };
}

async function persistOrder(order) {
  if (!order || !order.order_id) return order;
  const record = normalizeOrderRecord(order);
  if (!record) return order;
  if (!supabase) return order;

  const safePayload = buildSupabaseOrderPayload(record);
  if (typeof safePayload.amount_paid === 'undefined') {
    safePayload.amount_paid = 0;
  }
  if (typeof safePayload.revision_count === 'undefined') {
    safePayload.revision_count = record.revision_count;
  }
  if (typeof safePayload.amount_paid === 'undefined') {
    safePayload.amount_paid = 0;
  }
  if (typeof safePayload.revision_count === 'undefined') {
    safePayload.revision_count = record.revision_count;
  }
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

    let persisted = merged;
    try {
      const { data, error } = await supabase.from('matex_orders').upsert([merged], { onConflict: 'order_id' }).select();
      if (error) throw error;
      persisted = Array.isArray(data) && data.length > 0 ? data[0] : merged;
    } catch (upsertErr) {
      console.error('❌ Supabase persistOrder upsert error for', record.order_id, upsertErr && (upsertErr.message || upsertErr));
      // Attempt a sanitized retry to tolerate schema drift (missing optional columns)
      try {
        const sanitized = Object.assign({}, merged);
        ['revisions_allowed', 'revisions_used', 'revisions_remaining', 'revision_count'].forEach(f => { if (Object.prototype.hasOwnProperty.call(sanitized, f)) delete sanitized[f]; });
        const { data: data2, error: error2 } = await supabase.from('matex_orders').upsert([sanitized], { onConflict: 'order_id' }).select();
        if (!error2 && Array.isArray(data2) && data2.length > 0) {
          persisted = data2[0];
          console.log('✅ Supabase persistOrder sanitized upsert succeeded for', record.order_id);
        } else if (error2) {
          console.error('❌ Supabase persistOrder sanitized upsert failed for', record.order_id, error2);
        }
      } catch (e2) {
        console.error('❌ Supabase persistOrder sanitized retry exception for', record.order_id, e2 && (e2.message || e2));
      }
      try { broadcastAdminEvent('order', record); } catch (e) {}
    }
    console.log('✅ Order persisted to Supabase:', record.order_id);
    try { broadcastAdminEvent('order', persisted); } catch (e) {}
    return persisted;
  } catch (err) {
    console.error('❌ Supabase persistOrder exception for', record.order_id, err && (err.message || err));
    try { broadcastAdminEvent('order', record); } catch (e) {}
    return order;
  }
}

async function loadOrderById(orderId) {
  const normalized = String(orderId || '').trim();
  if (!normalized) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('matex_orders').select('*').eq('order_id', normalized).limit(1).maybeSingle();
      if (!error && data) return data;
    } catch (err) {
      console.warn('Supabase loadOrderById warning:', err?.message || err);
    }

    try {
      const fallback = await loadOrderByReference(normalized);
      if (fallback) return fallback;
    } catch (err) {
      console.warn('Supabase loadOrderById fallback warning:', err?.message || err);
    }
  }
  return orderStore.get(normalized) || null;
}

async function loadOrderByReference(reference) {
  const normalized = String(reference || '').trim();
  if (!normalized) return null;
  if (supabase) {
    try {
      const { data, error } = await supabase.from('matex_orders').select('*').or(`payment_reference.eq.${normalized},order_id.eq.${normalized}`).limit(1).maybeSingle();
      if (!error && data) return data;
    } catch (err) {
      console.warn('Supabase loadOrderByReference warning:', err?.message || err);
    }
  }
  return orderStore.get(normalized) || null;
}

// Supabase and admin auth wired via config and lib modules
let supabase = null;
if (config.SUPABASE_URL && config.SUPABASE_KEY) {
  try {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);
    console.log('✅ Supabase client initialized');

    async function initializeRealtimeSubscriptions() {
      if (typeof supabase?.channel !== 'function') {
        console.warn('⚠️ Supabase client does not expose realtime channel API; skipping realtime subscription.');
        return;
      }

      const channel = supabase.channel('matex_realtime_events', {
        config: {
          broadcast: { self: false },
          presence: { key: 'admin' }
        }
      });

      const subscriptions = [
        { table: 'matex_chat_messages', eventName: 'chat_message' },
        { table: 'matex_chat_conversations', eventName: 'chat_conversation' },
        { table: 'matex_orders', eventName: 'order' },
        { table: 'matex_reviews', eventName: 'review' },
        { table: 'matex_notifications', eventName: 'notification' }
      ];

      subscriptions.forEach(({ table, eventName }) => {
        try {
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
            try {
              const record = payload?.new ?? payload?.record ?? payload;
              broadcastAdminEvent(eventName, record);
            } catch (e) {
              console.warn(`⚠️ Failed to broadcast realtime event for ${table}:`, e && (e.message || e));
            }
          });
        } catch (e) {
          console.warn(`⚠️ Failed to attach listener for ${table}:`, e && (e.message || e));
        }
      });

      try {
        const status = await channel.subscribe();
        if (status && status.error) {
          console.warn('⚠️ Supabase realtime subscribe returned error:', status.error);
        } else {
          console.log('✅ Supabase realtime channel subscribed');
        }
      } catch (err) {
        console.warn('⚠️ Supabase realtime subscription failed:', err && (err.message || err));
      }
    }

    initializeRealtimeSubscriptions().catch((err) => {
      console.warn('⚠️ Failed to initialize Supabase realtime channel:', err && (err.message || err));
    });
  } catch (err) {
    console.error('Supabase initialization failed:', err.message);
    supabase = null;
  }
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY not set; running without Supabase persistence.');
}

// Simple Server-Sent Events (SSE) implementation for admin realtime UI
const adminEventClients = new Set();

function sendSse(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // ignore
  }
}

function broadcastAdminEvent(event, payload) {
  for (const res of Array.from(adminEventClients)) {
    try {
      sendSse(res, event, payload);
    } catch (e) {
      try { res.end(); } catch (er) {}
      adminEventClients.delete(res);
    }
  }
}

// SSE endpoint for admin clients to receive realtime updates


app.get('/api/admin/events', (req, res) => {
  // Allow EventSource connections to pass `?token=` since EventSource can't set Authorization header.
  const queryToken = String(req.query?.token || '').trim();
  const authHeader = String(req.headers.authorization || '').trim();
  let ok = false;
  if (queryToken) {
    try { ok = verifyAdminToken(queryToken); } catch (e) { ok = false; }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    try { ok = verifyAdminToken(token); } catch (e) { ok = false; }
  }
  if (!ok) return res.status(401).json({ success: false, message: 'Unauthorized' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  res.write('retry: 10000\n\n');
  adminEventClients.add(res);

  // Send an initial ping so clients know connection is live
  sendSse(res, 'connected', { ts: Date.now() });

  req.on('close', () => {
    adminEventClients.delete(res);
  });
});

app.post('/api/inbound/email/reply', async (req, res) => {
  console.log('📍 POST /api/inbound/email/reply - Incoming email reply webhook');
  try {
    const payload = req.body || {};
    const reply = {
      id: String(payload.id || payload.message_id || crypto.randomUUID()),
      from_email: String(payload.from || payload['from'] || '').trim() || null,
      subject: String(payload.subject || '').trim() || null,
      body: String(payload.text || payload.body || '').trim() || null,
      html: payload.html || null,
      order_id: String(payload.order_id || extractOrderIdFromEmailSubject(payload.subject) || '').trim() || null,
      message_id: String(payload.message_id || payload['message-id'] || '').trim() || null,
      in_reply_to: String(payload.in_reply_to || payload['in-reply-to'] || '').trim() || null,
      created_at: new Date().toISOString()
    };

    const storedReply = await persistEmailReply(reply);
    if (storedReply.order_id) {
      const conversation = await loadChatConversationByOrderId(storedReply.order_id);
      if (conversation) {
        const message = await persistChatMessage({
          conversation_id: conversation.id,
          sender: 'customer',
          sender_name: storedReply.from_email || 'Email customer',
          sender_email: storedReply.from_email,
          body: storedReply.body || 'Email reply received',
          is_system: false
        });
        await updateChatConversation(conversation.id, {
          last_message_at: new Date().toISOString(),
          unread_admin_count: Number(conversation.unread_admin_count || 0) + 1
        }).catch(() => null);
      }
    }

    return res.json({ success: true, reply: storedReply });
  } catch (err) {
    console.error('Inbound email reply error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to process email reply.' });
  }
});

// Use admin auth helpers from ./lib/auth.js

if (!PAYSTACK_SECRET_KEY) {
  console.warn('⚠️ PAYSTACK_SECRET_KEY is not defined in .env; checkout routes will be disabled until configured.');
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
app.get('/health', (req, res) => {
  const smtpConfigured = isSendGridProvider || Boolean(emailTransporter);
  const smtpConfiguration = getSmtpConfigurationCause();

  return res.json({
    success: true,
    message: 'Matex API healthy',
    timestamp: new Date().toISOString(),
    supabaseConfigured: Boolean(supabase),
    supabaseOnline: null,
    supabaseCheck: null,
    smtpConfigured,
    smtpVerified: smtpTransporterVerified,
    smtpConfiguration,
    emailProvider: EMAIL_PROVIDER,
    adminEventsConnected: adminEventClients.size
  });
});

app.get('/api/health', (req, res) => {
  const smtpConfigured = isSendGridProvider || Boolean(emailTransporter);
  const smtpConfiguration = getSmtpConfigurationCause();

  return res.json({
    success: true,
    message: 'Matex API healthy',
    timestamp: new Date().toISOString(),
    supabaseConfigured: Boolean(supabase),
    supabaseOnline: null,
    supabaseCheck: null,
    smtpConfigured,
    smtpVerified: smtpTransporterVerified,
    smtpConfiguration,
    emailProvider: EMAIL_PROVIDER,
    adminEventsConnected: adminEventClients.size
  });
});

/**
 * GET /api/services
 * Get list of all services with pricing
 * Single source of truth for service pricing across the application
 * 
 * Returns:
 * - services (array): List of available services with pricing in Naira and USD
 */
app.get('/api/services', (req, res) => {
  const services = Object.values(SERVICE_PRICING).map(service => ({
    name: service.name,
    description: service.description,
    priceNaira: service.naira,
    priceUSD: service.usd,
    currency: service.currency
  }));
  
  res.json({
    success: true,
    services: services,
    count: services.length
  });
});

app.post('/api/admin/login', (req, res) => {
  console.log('📍 POST /api/admin/login - Admin login attempt');
  if (!config.ADMIN_PASSWORD || !config.ADMIN_SECRET_KEY) {
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

  if (password !== config.ADMIN_PASSWORD) {
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
      const orderSelect = 'order_id, client_name, client_email, whatsapp_number, service_name, amount, amount_paid, amount_remaining, payment_method, payment_type, payment_status, payment_reference, payment_date, paid_at, download_access, order_status, revision_count, latest_progress, status_history, design_description, brand_name, brand_color, dob, deadline, reference_link, additional_note, metadata, created_at';
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

app.get('/api/admin/orders/:orderId', adminAuth, async (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  console.log(`📍 GET /api/admin/orders/${orderId} - Fetch single order`);
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  try {
    let order = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_orders').select('*').eq('order_id', orderId).limit(1).maybeSingle();
      if (!error && data) {
        order = data;
      }
    }
    if (!order) {
      order = orderStore.get(orderId) || null;
    }
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    return res.json({ success: true, order });
  } catch (err) {
    console.error('Admin fetch order error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to fetch order' });
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
    let historyEntry = null;
    if (status) updatePayload.order_status = status;
    if (typeof latest_progress !== 'undefined') {
      const progressText = String(latest_progress || '').trim() || 'Progress update';
      updatePayload.latest_progress = progressText;
      historyEntry = {
        status: status || null,
        message: progressText,
        updated_at: new Date().toISOString()
      };
    }

    let updatedOrder = null;
    if (supabase) {
      // Only update fields that are known to exist in the Supabase schema
      const supaUpdate = {};
      if (updatePayload.order_status) supaUpdate.order_status = updatePayload.order_status;
      if (typeof updatePayload.latest_progress !== 'undefined') {
        supaUpdate.latest_progress = updatePayload.latest_progress;
      }

      try {
        let existing = null;
        if (historyEntry) {
          const existingRes = await supabase
            .from('matex_orders')
            .select('status_history')
            .eq('order_id', orderId)
            .limit(1)
            .maybeSingle();
          if (!existingRes.error && existingRes.data) {
            existing = existingRes.data;
          }
          const existingHistory = Array.isArray(existing?.status_history) ? existing.status_history : [];
          supaUpdate.status_history = [...existingHistory, historyEntry];
        }

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
      if (historyEntry) {
        updatedOrder.status_history = Array.isArray(existing.status_history)
          ? [...existing.status_history, historyEntry]
          : [historyEntry];
      }
      orderStore.set(orderId, updatedOrder);
    }

    if (updatedOrder) {
      if (orderStore.has(orderId)) {
        orderStore.set(orderId, updatedOrder);
      }
      try { broadcastAdminEvent('order', updatedOrder); } catch (e) {}
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
 * POST /api/admin/orders/:orderId/files
 * Admin uploads one or more files (base64 payloads) and links them to an order
 * Body: { files: [{ file_name, mime_type, base64, version_label, file_size }], uploaded_by }
 */
app.post('/api/admin/orders/:orderId/files', adminAuth, upload.array('files'), async (req, res) => {
  console.log(`📍 POST /api/admin/orders/${req.params.orderId}/files - Uploading files`);
  try {
    const orderId = String(req.params.orderId || '').trim();
    const version_label = String(req.body.version_label || req.body.version || '').trim() || null;
    const uploaded_by = String(req.body.uploaded_by || '').trim() || null;
    let files = [];

    if (Array.isArray(req.files) && req.files.length) {
      files = req.files.map(file => ({
        file_name: file.originalname,
        mime_type: file.mimetype || 'application/octet-stream',
        buffer: file.buffer,
        file_size: Number(file.size || 0),
        version_label
      }));
    } else {
      const bodyFiles = Array.isArray(req.body.files) ? req.body.files : [];
      files = bodyFiles.map(f => ({
        file_name: String(f.file_name || f.name || 'file').trim(),
        mime_type: f.mime_type || f.contentType || 'application/octet-stream',
        base64: String(f.base64 || '').trim(),
        file_size: typeof f.file_size === 'number' ? f.file_size : (f.file_size ? Number(f.file_size) : null),
        version_label: String(f.version_label || f.version || version_label || '').trim() || null
      }));
    }

    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });
    if (!Array.isArray(files) || files.length === 0) return res.status(400).json({ success: false, message: 'At least one file is required' });

    const bucket = 'order-deliveries';
    const uploadedRecords = [];

    for (const f of files) {
      const name = String(f.file_name || 'file').trim();
      const mime = f.mime_type || 'application/octet-stream';
      const version_label_value = String(f.version_label || version_label || '').trim() || null;
      const fileSize = typeof f.file_size === 'number' ? f.file_size : (f.file_size ? Number(f.file_size) : null);
      const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const timestamp = Date.now();
      const storagePath = `${orderId}/${timestamp}_${safeName}`;
      let buffer = null;

      if (f.buffer && Buffer.isBuffer(f.buffer)) {
        buffer = f.buffer;
      } else if (f.base64) {
        try {
          buffer = Buffer.from(f.base64, 'base64');
        } catch (err) {
          buffer = null;
        }
      }
      if (!buffer) {
        console.warn('Skipping file upload because content could not be parsed:', name);
        continue;
      }

      // Upload to Supabase storage if configured
      if (supabase) {
        try {
          const { data: uploadData, error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, { contentType: mime, upsert: true });
          if (uploadError) {
            console.error('Supabase storage upload error for', storagePath, uploadError);
          }
        } catch (err) {
          console.error('Supabase upload exception for', storagePath, err.message || err);
        }
      }

      const record = await persistOrderFile({
        order_id: orderId,
        file_name: name,
        storage_path: storagePath,
        bucket_name: bucket,
        mime_type: mime,
        file_type: (version_label_value || '').toLowerCase().includes('final') ? 'final' : 'revision',
        file_size: fileSize,
        version_label: version_label_value,
        uploaded_by,
        uploaded_at: new Date().toISOString()
      });

      uploadedRecords.push(record);
    }

    // Append delivery history to order and notify customer
    try {
      if (supabase) {
        const existingRes = await supabase.from('matex_orders').select('status_history, client_email').eq('order_id', orderId).limit(1).maybeSingle();
        let existing = existingRes && !existingRes.error ? existingRes.data || null : null;
        const existingHistory = Array.isArray(existing?.status_history) ? existing.status_history : [];
        const entry = { status: 'Files Delivered', message: `Admin uploaded ${uploadedRecords.length} file(s)`, uploaded_at: new Date().toISOString() };
        const newHistory = [...existingHistory, entry];
        await supabase.from('matex_orders').update({ status_history: newHistory, latest_progress: 'Files uploaded by admin' }).eq('order_id', orderId);

        const clientEmail = existing?.client_email || null;
        if (clientEmail) {
          await sendEmail(clientEmail, `Files uploaded for ${orderId}`, buildCustomerNotificationHtml({ order_id: orderId, client_name: '', client_email: clientEmail, latest_progress: 'Files uploaded by admin' }, `Admin uploaded ${uploadedRecords.length} file(s). Please check your project files.`));
        }
        try { broadcastAdminEvent('order', { order_id: orderId, latest_progress: 'Files uploaded by admin', status_history: newHistory }); } catch (e) {}
      } else {
        // in-memory order store fallback
        const existing = orderStore.get(orderId) || {};
        const existingHistory = Array.isArray(existing.status_history) ? existing.status_history : [];
        const entry = { status: 'Files Delivered', message: `Admin uploaded ${uploadedRecords.length} file(s)`, uploaded_at: new Date().toISOString() };
        existing.status_history = [...existingHistory, entry];
        existing.latest_progress = 'Files uploaded by admin';
        orderStore.set(orderId, existing);
        if (existing.client_email) {
          await sendEmail(existing.client_email, `Files uploaded for ${orderId}`, buildCustomerNotificationHtml({ order_id: orderId, client_email: existing.client_email }, `Admin uploaded ${uploadedRecords.length} file(s).`));
        }
        try { broadcastAdminEvent('order', existing); } catch (e) {}
      }
      try { broadcastAdminEvent('order_file', { order_id: orderId, files: uploadedRecords }); } catch (e) {}
    } catch (notifyErr) {
      console.error('Order history update / notification failed:', notifyErr.message || notifyErr);
    }

    return res.json({ success: true, files: uploadedRecords });
  } catch (err) {
    console.error('Admin upload files error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to upload files' });
  }
});

/**
 * GET /api/admin/orders/:orderId/files
 * Admin listing of uploaded files for an order
 */
app.get('/api/admin/orders/:orderId/files', adminAuth, async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });
    const files = await loadOrderFiles(orderId);
    return res.json({ success: true, files });
  } catch (err) {
    console.error('Admin list order files error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load files' });
  }
});

/**
 * GET /api/orders/:orderId/files
 * Customer-facing listing of project files and delivery status
 */
app.get('/api/orders/:orderId/files', async (req, res) => {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!orderId) return res.status(400).json({ success: false, message: 'orderId is required' });
    // Load order to determine download access rules
    let order = null;
    if (supabase) {
      const ordRes = await supabase.from('matex_orders').select('*').eq('order_id', orderId).limit(1).maybeSingle();
      if (!ordRes.error) order = ordRes.data || null;
    }
    if (!order) order = orderStore.get(orderId) || null;

    const files = await loadOrderFiles(orderId);
    const isDownloadAllowed = Boolean(order && order.download_access);

    const mapped = await Promise.all(files.map(async f => {
      const downloadAllowed = isDownloadAllowed && ((f.metadata && f.metadata.file_type) ? f.metadata.file_type === 'final' : true);
      let download_url = null;
      let preview_url = null;
      if ((f.metadata && f.metadata.file_type) === 'revision') {
        // For revision uploads, provide preview (no download)
        if (supabase && f.storage_path) {
          preview_url = await createSignedUrlForFile(f.bucket_name || 'order-deliveries', f.storage_path, 3600);
        }
      }
      if (downloadAllowed && supabase && f.storage_path) {
        download_url = await createSignedUrlForFile(f.bucket_name || 'order-deliveries', f.storage_path, 3600);
      }
      return Object.assign({}, f, { download_allowed: downloadAllowed, download_url, preview_url });
    }));

    return res.json({ success: true, files: mapped, download_access: isDownloadAllowed });
  } catch (err) {
    console.error('Customer list order files error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load files' });
  }
});

/**
 * GET /api/orders/:orderId/files/:fileId/download
 * Generate a signed download URL for a specific file if allowed
 */
app.get('/api/orders/:orderId/files/:fileId/download', async (req, res) => {
  try {
    const { orderId, fileId } = req.params;
    if (!orderId || !fileId) return res.status(400).json({ success: false, message: 'orderId and fileId are required' });

    let order = null;
    if (supabase) {
      const ordRes = await supabase.from('matex_orders').select('*').eq('order_id', orderId).limit(1).maybeSingle();
      if (!ordRes.error) order = ordRes.data || null;
    }
    if (!order) order = orderStore.get(orderId) || null;

    const files = await loadOrderFiles(orderId);
    const file = (files || []).find(x => String(x.id) === String(fileId));
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });

    const isDownloadAllowed = Boolean(order && order.download_access);
    if (!isDownloadAllowed) {
      return res.status(403).json({ success: false, message: 'Complete payment to download', download_allowed: false });
    }

    if (!supabase) return res.status(500).json({ success: false, message: 'Storage not configured' });
    const url = await createSignedUrlForFile(file.bucket_name || 'order-deliveries', file.storage_path, 60 * 60);
    if (!url) return res.status(500).json({ success: false, message: 'Unable to generate download URL' });
    return res.json({ success: true, download_url: url });
  } catch (err) {
    console.error('Generate download url error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to generate download URL' });
  }
});

// Admin download: generate signed URL for a file regardless of payment rules
app.get('/api/admin/orders/:orderId/files/:fileId/download', adminAuth, async (req, res) => {
  try {
    const { orderId, fileId } = req.params;
    if (!orderId || !fileId) return res.status(400).json({ success: false, message: 'orderId and fileId are required' });
    const files = await loadOrderFiles(orderId);
    const file = (files || []).find(x => String(x.id) === String(fileId));
    if (!file) return res.status(404).json({ success: false, message: 'File not found' });
    if (!supabase) return res.status(500).json({ success: false, message: 'Storage not configured' });
    const url = await createSignedUrlForFile(file.bucket_name || 'order-deliveries', file.storage_path, 60 * 60);
    if (!url) return res.status(500).json({ success: false, message: 'Unable to generate download URL' });
    return res.json({ success: true, download_url: url });
  } catch (err) {
    console.error('Admin generate download url error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to generate download URL' });
  }
});

app.post('/api/chat/conversations', async (req, res) => {
  console.log('📍 POST /api/chat/conversations - Creating a new conversation');
  try {
    const { customer_name, customer_email, customer_phone, subject, initial_message, order_id } = req.body || {};
    if (!initial_message || !String(initial_message).trim()) {
      return res.status(400).json({ success: false, message: 'Initial message is required.' });
    }

    const normalizedOrderId = order_id ? String(order_id).trim() : '';
    let conversation = null;
    if (normalizedOrderId) {
      conversation = await loadChatConversationByOrderId(normalizedOrderId);
    }

    const conversationData = {
      customer_name: String(customer_name || 'Guest'),
      customer_email: customer_email ? String(customer_email).trim() : null,
      customer_phone: customer_phone ? String(customer_phone).trim() : null,
      subject: String(subject || 'Live chat inquiry'),
      status: 'open',
      source: 'website',
      order_id: normalizedOrderId || null,
      unread_admin_count: conversation ? Number(conversation.unread_admin_count || 0) + 1 : 1,
      unread_customer_count: conversation?.unread_customer_count || 0,
      last_message_at: new Date().toISOString(),
      created_at: conversation?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (!conversation) {
      conversation = await persistChatConversation(conversationData);
    } else {
      conversation = await updateChatConversation(conversation.id, {
        customer_name: conversationData.customer_name,
        customer_email: conversationData.customer_email,
        customer_phone: conversationData.customer_phone,
        subject: conversationData.subject,
        order_id: normalizedOrderId || conversation.order_id || null,
        status: conversation.status || 'open',
        source: conversation.source || 'website',
        updated_at: conversationData.updated_at
      });
    }

    if (normalizedOrderId) {
      try {
        const existingOrder = orderStore.get(normalizedOrderId) || null;
        const nextOrder = existingOrder ? Object.assign({}, existingOrder, { conversation_id: conversation.id, order_id: normalizedOrderId }) : { order_id: normalizedOrderId, conversation_id: conversation.id };
        orderStore.set(normalizedOrderId, nextOrder);
        if (supabase) {
          await persistOrder(nextOrder);
        }
      } catch (orderErr) {
        console.warn('Failed to link chat conversation to order:', orderErr?.message || orderErr);
      }
    }

    const message = await persistChatMessage({
      conversation_id: conversation.id,
      sender: 'customer',
      sender_name: conversation.customer_name,
      sender_email: conversation.customer_email,
      body: String(initial_message).trim(),
      is_system: false
    });

    // Record timeline event: Message Sent
    try {
      const entry = { event: 'Message Sent', message: String(initial_message).trim(), ts: new Date().toISOString() };
      const existingHistory = Array.isArray(conversation.status_history) ? conversation.status_history : [];
      const newHistory = [...existingHistory, entry];
      await updateChatConversation(conversation.id, { status_history: newHistory, latest_progress: 'Customer sent a message' });
      await updateChatConversation(conversation.id, { status_history: newHistory, latest_progress: 'Customer sent a message' });
    } catch (e) { console.warn('Failed to append message timeline to conversation', e); }

    await notifyAdminAboutNewChatMessage(conversation, message);

    return res.json({ success: true, conversation, message });
  } catch (err) {
    console.error('Create conversation error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to create conversation.' });
  }
});

app.get('/api/chat/conversations/:conversationId', async (req, res) => {
  console.log(`📍 GET /api/chat/conversations/${req.params.conversationId} - Fetching conversation`);
  try {
    const conversation = await loadChatConversationById(String(req.params.conversationId).trim());
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const messages = await loadChatMessages(conversation.id);
    return res.json({ success: true, conversation, messages });
  } catch (err) {
    console.error('Fetch conversation error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to fetch conversation.' });
  }
});

app.post('/api/chat/conversations/:conversationId/messages', async (req, res) => {
  console.log(`📍 POST /api/chat/conversations/${req.params.conversationId}/messages - Adding chat message`);
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    const { sender = 'customer', sender_name, sender_email, body } = req.body || {};
    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'Conversation id is required.' });
    }
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Message body is required.' });
    }
    
    // Input validation: sanitize body length and sender values
    const bodyStr = String(body).trim();
    if (bodyStr.length > 5000) {
      return res.status(400).json({ success: false, message: 'Message is too long (max 5000 characters).' });
    }
    const normalizedSender = String(sender || 'customer').toLowerCase();
    if (!['customer', 'admin'].includes(normalizedSender)) {
      return res.status(400).json({ success: false, message: 'Invalid sender type.' });
    }

    const conversation = await loadChatConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    const message = await persistChatMessage({
      conversation_id: conversationId,
      sender: normalizedSender,
      sender_name: String(sender_name || (normalizedSender === 'admin' ? 'Admin' : conversation.customer_name || 'Customer')).trim().slice(0, 100), 
      sender_email: sender_email ? String(sender_email).trim().slice(0, 255) : (normalizedSender === 'customer' ? conversation.customer_email : null),
      body: bodyStr,
      is_system: false
    });

    const updatePatch = {
      updated_at: new Date().toISOString(),
      last_message_at: new Date().toISOString()
    };
    if (message.sender === 'customer') {
      updatePatch.unread_admin_count = Number(conversation.unread_admin_count || 0) + 1;
    } else if (message.sender === 'admin') {
      updatePatch.unread_customer_count = Number(conversation.unread_customer_count || 0) + 1;
    }

    const updatedConversation = await updateChatConversation(conversationId, updatePatch);

    if (message.sender === 'customer') {
      await notifyAdminAboutNewChatMessage(updatedConversation || conversation, message);
      // append to timeline on order if linked
      try {
        if (updatedConversation?.order_id) {
          const entry = { event: 'Message Sent', message: bodyStr.slice(0, 200), ts: new Date().toISOString() };
          // update order status_history
          if (supabase) {
            const ordRes = await supabase.from('matex_orders').select('status_history').eq('order_id', updatedConversation.order_id).limit(1).maybeSingle();
            const existing = ordRes && !ordRes.error && Array.isArray(ordRes.data?.status_history) ? ordRes.data.status_history : [];
            const newHist = [...existing, entry];
            await supabase.from('matex_orders').update({ status_history: newHist, latest_progress: 'Customer message' }).eq('order_id', updatedConversation.order_id);
            await supabase.from('matex_orders').update({ status_history: newHist, latest_progress: 'Customer message' }).eq('order_id', updatedConversation.order_id);
          } else {
            const existing = orderStore.get(updatedConversation.order_id) || {};
            const hist = Array.isArray(existing.status_history) ? existing.status_history : [];
            existing.status_history = [...hist, entry];
            existing.latest_progress = 'Customer message';
            orderStore.set(updatedConversation.order_id, existing);
          }
        }
      } catch (e) { console.warn('Failed to append order timeline for message', e); }
    }
    if (message.sender === 'admin') {
      await notifyCustomerAboutAdminReply(updatedConversation || conversation, message);
    }

    return res.json({ success: true, conversation: updatedConversation, message });
  } catch (err) {
    console.error('Add chat message error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to add message.' });
  }
});

app.get('/api/admin/chat/conversations', adminAuth, async (req, res) => {
  console.log('📍 GET /api/admin/chat/conversations - Listing conversations');
  try {
    const conversations = await loadChatConversations();
    return res.json({ success: true, conversations });
  } catch (err) {
    console.error('Admin load conversations error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load conversations.' });
  }
});

app.get('/api/admin/chat/conversations/:conversationId/messages', adminAuth, async (req, res) => {
  console.log(`📍 GET /api/admin/chat/conversations/${req.params.conversationId}/messages - Loading messages`);
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    const messages = await loadChatMessages(conversationId);
    return res.json({ success: true, messages });
  } catch (err) {
    console.error('Admin conversation messages error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load messages.' });
  }
});

app.post('/api/admin/chat/conversations/:conversationId/messages', adminAuth, async (req, res) => {
  console.log(`📍 POST /api/admin/chat/conversations/${req.params.conversationId}/messages - Admin reply`);
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    const { body, sender_name } = req.body || {};
    if (!conversationId || !body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: 'Conversation id and body are required.' });
    }
    
    // Input validation: sanitize body length
    const bodyStr = String(body).trim();
    if (bodyStr.length > 5000) {
      return res.status(400).json({ success: false, message: 'Message is too long (max 5000 characters).' });
    }
    
    const conversation = await loadChatConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }

    const message = await persistChatMessage({
      conversation_id: conversationId,
      sender: 'admin',
      sender_name: String(sender_name || 'Admin').trim().slice(0, 100),
      sender_email: DESIGNER_EMAIL || null,
      body: bodyStr,
      is_system: false
    });

    const updatedConversation = await updateChatConversation(conversationId, {
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      unread_customer_count: Number(conversation.unread_customer_count || 0) + 1
    });

    await notifyCustomerAboutAdminReply(updatedConversation || conversation, message);
    // append to order timeline
    try {
      if (updatedConversation?.order_id) {
        const entry = { event: 'Message Sent (admin)', message: bodyStr.slice(0, 200), ts: new Date().toISOString() };
        if (supabase) {
          const ordRes = await supabase.from('matex_orders').select('status_history').eq('order_id', updatedConversation.order_id).limit(1).maybeSingle();
          const existing = ordRes && !ordRes.error && Array.isArray(ordRes.data?.status_history) ? ordRes.data.status_history : [];
          const newHist = [...existing, entry];
          await supabase.from('matex_orders').update({ status_history: newHist, latest_progress: 'Admin replied' }).eq('order_id', updatedConversation.order_id);
          await supabase.from('matex_orders').update({ status_history: newHist, latest_progress: 'Admin replied' }).eq('order_id', updatedConversation.order_id);
        } else {
          const existing = orderStore.get(updatedConversation.order_id) || {};
          const hist = Array.isArray(existing.status_history) ? existing.status_history : [];
          existing.status_history = [...hist, entry];
          existing.latest_progress = 'Admin replied';
          orderStore.set(updatedConversation.order_id, existing);
        }
      }
    } catch (e) { console.warn('Failed to append order timeline for admin reply', e); }
    return res.json({ success: true, conversation: updatedConversation, message });
  } catch (err) {
    console.error('Admin reply error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to post admin reply.' });
  }
});

app.put('/api/admin/chat/conversations/:conversationId/status', adminAuth, async (req, res) => {
  console.log(`📍 PUT /api/admin/chat/conversations/${req.params.conversationId}/status - Updating status`);
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    const { status } = req.body || {};
    if (!conversationId || !status || !['open', 'closed', 'pending'].includes(String(status))) {
      return res.status(400).json({ success: false, message: 'Valid status is required.' });
    }
    const conversation = await loadChatConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const updatedConversation = await updateChatConversation(conversationId, { status: String(status), updated_at: new Date().toISOString() });
    return res.json({ success: true, conversation: updatedConversation });
  } catch (err) {
    console.error('Update conversation status error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to update conversation status.' });
  }
});

app.post('/api/admin/chat/conversations/:conversationId/read', adminAuth, async (req, res) => {
  console.log(`📍 POST /api/admin/chat/conversations/${req.params.conversationId}/read - Mark as read`);
  try {
    const conversationId = String(req.params.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'Conversation id is required.' });
    }
    const conversation = await loadChatConversationById(conversationId);
    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found.' });
    }
    const updatedConversation = await updateChatConversation(conversationId, {
      unread_admin_count: 0,
      updated_at: new Date().toISOString()
    });
    return res.json({ success: true, conversation: updatedConversation });
  } catch (err) {
    console.error('Mark conversation as read error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to mark conversation as read.' });
  }
});

app.post('/api/assistant/query', async (req, res) => {
  console.log('📍 POST /api/assistant/query - Assistant query received');
  try {
    const { query } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ success: false, message: 'Query text is required.' });
    }

    const normalized = String(query).trim().toLowerCase();
    const response = {
      text: 'I can help with templates, ordering, or live chat. Ask me to show examples or prefill an order request.',
      suggestions: ['Show Flyer templates', 'Guide me to order a Logo', 'Open Live DM'],
      actions: []
    };

    if (/(flyer|flyers|flyer templates)/.test(normalized)) {
      response.text = 'I recommend starting with our Flyer templates. Search by category or ask me for design options.';
      response.suggestions = ['Show Flyer templates', 'Show Logo templates', 'Guide me to order a Flyer'];
    } else if (/(logo|logos|logo templates)/.test(normalized)) {
      response.text = 'I can show you logo templates and help place a customization order.';
      response.suggestions = ['Show Logo templates', 'Open Live DM', 'Order a Logo design'];
    } else if (/(video|reel|youtube|endscreen)/.test(normalized)) {
      response.text = 'Video templates are available for reels, intros, and ads. Tell me the style you need.';
      response.suggestions = ['Show Video templates', 'Guide me to order a video', 'Open Live DM'];
    } else if (/order|customize|customization|package/.test(normalized)) {
      response.text = 'I can prefill a live DM for you, open WhatsApp, or create an order request. What would you like?';
      response.actions = [{ type: 'open_live_dm', label: 'Open Live DM' }];
    }

    return res.json({ success: true, assistant: response });
  } catch (err) {
    console.error('Assistant query error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to process query.' });
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
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(503).json({
      success: false,
      message: 'Paystack is not configured. Set PAYSTACK_SECRET_KEY in the environment.'
    });
  }

  try {
    const { order_id, email, amount, amount_kobo, service_name, payment_type, callback_url } = req.body;

    // Validation: accept either `amount` (Naira) or `amount_kobo` (integer)
    if (!order_id || !email || (!(amount || amount_kobo)) || !service_name || !payment_type) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: order_id, email, amount, service_name, payment_type'
      });
    }

    console.log('🔧 Payment initialization requested for order:', order_id);
    if (callback_url) {
      console.log('🔗 Using Paystack callback_url:', callback_url);
    }

    // Determine amount in kobo: prefer explicit amount_kobo from client (unambiguous), otherwise convert Naira->kobo
    let amountInKobo;
    if (amount_kobo != null && !isNaN(Number(amount_kobo))) {
      amountInKobo = Math.round(Number(amount_kobo));
      console.log('🔍 Payment amount debug - incoming amount_kobo provided by client:', amount_kobo, 'using amountInKobo:', amountInKobo);
    } else {
      amountInKobo = Math.round(Number(amount) * 100);
      console.log('🔍 Payment amount debug - incoming amount (Naira):', amount, 'typeof:', typeof amount, 'amountInKobo:', amountInKobo);
    }
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
    console.log('🔧 Paystack initialize payload:', JSON.stringify(initializePayload));

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
      // Log amount returned by Paystack (if present) to cross-check unit conversions
      try {
        console.log('🔔 Paystack initialize response:', {
          reference: payload.reference,
          access_code: payload.access_code,
          authorization_url: payload.authorization_url,
          amount_from_paystack: payload.amount || null
        });
      } catch (e) {
        console.log('🔔 Paystack initialize response (partial):', { reference: payload.reference, access_code: payload.access_code, authorization_url: payload.authorization_url });
      }
      const existingOrder = orderStore.get(order_id) || {};
      const orderData = Object.assign({}, existingOrder, {
        order_id,
        email,
        amount: amountInKobo / 100,
        service_name,
        payment_method: 'Paystack',
        payment_type,
        amount_paid: 0,
        amount_remaining: amountInKobo / 100,
        payment_reference: payload.reference,
        payment_date: null,
        paid_at: null,
        download_access: false,
        reference: payload.reference,
        access_code: payload.access_code,
        authorization_url: payload.authorization_url,
        status: 'Payment Pending',
        payment_status: 'Pending',
        // New orders must default to Pending for order lifecycle consistency
        order_status: 'Pending',
        latest_progress: 'Payment initialized and awaiting completion',
        created_at: existingOrder.created_at || new Date().toISOString()
      });
      orderStore.set(payload.reference, orderData);
      orderStore.set(order_id, orderData);
      await persistOrder(orderData);
      console.log('✅ Payment initialization persisted for order:', order_id, 'reference:', payload.reference);

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
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(503).json({
      success: false,
      message: 'Paystack is not configured. Set PAYSTACK_SECRET_KEY in the environment.'
    });
  }

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
    const paymentTypeRaw = metadata.payment_type || storedOrder?.payment_type || storedOrder?.paymentType || storedOrder?.paymentMethod || 'Unknown';
    const isSuccess = String(transaction.status || '').toLowerCase() === 'success';
    const amountPaid = Number(transaction.amount || 0) / 100;
    const paymentDate = transaction.paid_at || transaction.created_at || new Date().toISOString();
    const paymentStatus = isSuccess ? 'PAID' : (String(transaction.status || '').toLowerCase() === 'failed' ? 'FAILED' : 'Pending');
    const orderStatus = isSuccess ? 'Payment Verified' : (String(transaction.status || '').toLowerCase() === 'failed' ? 'Failed' : 'Pending');
    const revisionCount = getRevisionCount(paymentTypeRaw);
    const amountRemaining = typeof storedOrder?.amount === 'number'
      ? Math.max(storedOrder.amount - amountPaid, 0)
      : 0;
    const downloadAccess = paymentStatus === 'PAID' && String(paymentTypeRaw || '').toLowerCase().includes('full');

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
      amount: storedOrder?.amount ?? (transaction.amount / 100),
      amount_paid: amountPaid,
      amount_remaining: amountRemaining,
      payment_method: 'Paystack',
      payment_type: paymentTypeRaw,
      payment_status: paymentStatus,
      payment_reference: transaction.reference,
      reference: transaction.reference,
      payment_date: paymentDate,
      paid_at: paymentDate,
      download_access: downloadAccess,
      order_status: orderStatus,
      status: orderStatus,
      revision_count: revisionCount,
      latest_progress: isSuccess ? 'Payment received — awaiting admin confirmation' : `Payment ${transaction.status || 'pending'}`,
      email: transaction.customer?.email || storedOrder?.email || null,
      customer_id: transaction.customer?.id || storedOrder?.customer_id || null,
      created_at: storedOrder?.created_at || transaction.created_at || new Date().toISOString(),
      metadata
    };

    orderStore.set(transaction.reference, updatedOrder);
    if (orderId) {
      orderStore.set(orderId, updatedOrder);
    }

    await persistOrder(updatedOrder);
    console.log('✅ Payment verification persisted for reference:', transaction.reference, 'order_id:', finalOrderId, 'status:', paymentStatus);

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
          try {
            await sendEmail(DESIGNER_EMAIL, `New Order - ${updatedOrder.order_id}`, designerHtml);
          } catch (err) {
            try {
              await sendEmail(DESIGNER_EMAIL, `New Order - ${updatedOrder.order_id}`, designerHtml);
            } catch (err2) {
              console.error('Designer notification failed:', err2?.message || err2);
            }
          }
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
 * POST /api/payment/webhook
 * Paystack webhook receiver (expects raw body for signature verification)
 */
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log('📍 POST /api/payment/webhook - Webhook received');
  try {
    if (!PAYSTACK_SECRET_KEY) {
      console.warn('⚠️ PAYSTACK_SECRET_KEY not configured; rejecting webhook for safety');
      return res.status(400).send('missing paystack secret');
    }
    if (!PAYSTACK_SECRET_KEY) {
      console.warn('⚠️ PAYSTACK_SECRET_KEY not configured; rejecting webhook for safety');
      return res.status(400).send('missing paystack secret');
    }
    const signature = String(req.headers['x-paystack-signature'] || req.headers['X-Paystack-Signature'] || '');
    // Support both raw Buffer (when express.raw runs) and parsed JSON (when express.json runs)
    let rawForSig = null;
    if (Buffer.isBuffer(req.body)) {
      rawForSig = req.body;
    } else if (typeof req.body === 'string') {
      rawForSig = Buffer.from(req.body, 'utf8');
    } else {
      rawForSig = Buffer.from(JSON.stringify(req.body), 'utf8');
    }

    // Verify signature
    try {
      const expected = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawForSig).digest('hex');
      if (!signature || signature !== expected) {
        console.warn('⚠️ Invalid Paystack signature');
        return res.status(400).send('invalid signature');
      }
    } catch (sigErr) {
      console.warn('⚠️ Paystack signature verification failed:', sigErr && (sigErr.message || sigErr));
    }

    const event = (Buffer.isBuffer(req.body) || typeof req.body === 'string') ? JSON.parse(rawForSig.toString('utf8')) : req.body;
    console.log('🔔 Paystack webhook event:', event.event || '(no event)', 'reference:', event.data?.reference || 'n/a');

    const data = event.data || {};
    const reference = String(data.reference || '');
    const metadata = data.metadata || {};
    const orderId = (metadata.order_id || metadata.orderId || '').trim() || null;
    const statusRaw = String(data.status || event.event || '').toLowerCase();
    const isSuccess = statusRaw.includes('success') || statusRaw === 'success' || String(event.event || '').toLowerCase() === 'charge.success';
    const amountPaid = Number(data.amount || data.paid_amount || 0) / 100;
    const paidAt = data.paid_at || data.created_at || new Date().toISOString();
    const paymentTypeRaw = metadata.payment_type || null;
    const paymentStatus = isSuccess ? 'PAID' : (statusRaw === 'failed' ? 'FAILED' : 'Pending');
    const orderStatus = isSuccess ? 'Payment Verified' : (statusRaw === 'failed' ? 'Failed' : 'Pending');
    const downloadAccess = paymentStatus === 'PAID' && String(paymentTypeRaw || '').toLowerCase().includes('full');

    // Build update payload reusing existing columns
    const updatePayload = {
      amount: isNaN(amountPaid) ? null : amountPaid,
      amount_paid: isNaN(amountPaid) ? null : amountPaid,
      amount_remaining: null,
      payment_method: 'Paystack',
      payment_type: paymentTypeRaw || 'Unknown',
      payment_status: paymentStatus,
      order_status: orderStatus,
      payment_reference: reference,
      payment_date: paidAt,
      paid_at: paidAt,
      download_access: downloadAccess,
      latest_progress: isSuccess ? 'Payment received via Paystack webhook' : `Payment ${statusRaw}`,
      metadata: Object.assign({}, metadata, { raw_event: event })
    };

    console.log('🔄 Webhook processing payload:', { orderId, reference, amountPaid, paymentStatus });

    // Persist to Supabase (prefer order_id, else fallback to payment_reference)
    try {
      let existing = null;
      if (supabase) {
        try {
          if (orderId) {
            const lookup = await supabase.from('matex_orders').select('*').eq('order_id', orderId).limit(1).maybeSingle();
            if (!lookup.error) existing = lookup.data || null;
          }
          if (!existing && reference) {
            const lookup2 = await supabase.from('matex_orders').select('*').eq('payment_reference', reference).limit(1).maybeSingle();
            if (!lookup2.error) existing = lookup2.data || null;
          }
        } catch (lookupErr) {
          console.warn('Supabase lookup warning during webhook:', lookupErr.message || lookupErr);
        }

        const amountValue = (existing && typeof existing.amount === 'number')
          ? existing.amount
          : (isNaN(amountPaid) ? null : amountPaid);

        const merged = Object.assign({}, existing || {}, updatePayload, {
          amount: amountValue
        });
        if (typeof merged.amount === 'number' && typeof merged.amount_paid === 'number') {
          merged.amount_remaining = Math.max(merged.amount - merged.amount_paid, 0);
        }
        if (!merged.order_id) merged.order_id = orderId || reference || merged.order_id || reference;

        const persistedOrder = await persistOrder(merged);
        if (persistedOrder && persistedOrder.order_id) {
          console.log('✅ Supabase persistOrder (webhook) completed for:', persistedOrder.order_id);
        } else {
          console.warn('⚠️ Supabase persistOrder (webhook) did not return persisted order for:', merged.order_id || reference);
          console.warn('⚠️ Supabase persistOrder (webhook) did not return persisted order for:', merged.order_id || reference);
        }
      }

      // Update in-memory store for immediate admin/dashboard visibility
      const inMemKey = orderId || reference;
      const existingMem = orderStore.get(inMemKey) || {};
      const mergedMem = Object.assign({}, existingMem, updatePayload, { order_id: orderId || existingMem.order_id || reference });
      if (typeof mergedMem.amount === 'number' && typeof mergedMem.amount_paid === 'number') {
        mergedMem.amount_remaining = Math.max(mergedMem.amount - mergedMem.amount_paid, 0);
      }
      orderStore.set(inMemKey, mergedMem);
      if (reference && inMemKey !== reference) orderStore.set(reference, mergedMem);

      console.log('✅ In-memory orderStore updated (webhook):', inMemKey);
    } catch (dbErr) {
      console.error('❌ Error persisting webhook update:', dbErr.message || dbErr);
    }

    // Acknowledge webhook quickly
    res.status(200).send('ok');
  } catch (err) {
    console.error('❌ Webhook processing error:', err && (err.message || err));
    try { res.status(500).send('error'); } catch(e){}
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

  try {
    const order = await loadOrderById(normalizedOrderId);
    if (order) {
      return res.json({ success: true, order });
    }
  } catch (err) {
    console.error('Track order error:', err.message || err);
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

app.get('/api/orders/:orderId', async (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  console.log(`📍 GET /api/orders/${orderId} - Fetch order`);
  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }
  const order = await loadOrderById(orderId);
  if (!order) {
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

    const amountValue = typeof payload.amount === 'number' ? payload.amount : (Number(payload.amount) || null);
    const amountPaidValue = typeof payload.amount_paid === 'number' ? payload.amount_paid : 0;
    const upsertData = {
      order_id,
      client_name: payload.client_name || payload.full_name || null,
      client_email: payload.client_email || payload.email || null,
      whatsapp_number: payload.whatsapp_number || payload.client_phone || payload.phone || null,
      service_name: payload.service_name || payload.service || null,
      payment_method: payload.payment_method || payload.paymentMethod || null,
      payment_type: payload.payment_type || null,
      payment_status: payload.payment_status || 'Pending',
      amount: amountValue,
      amount_paid: amountPaidValue,
      amount_remaining: amountValue !== null ? Math.max(amountValue - amountPaidValue, 0) : null,
      payment_reference: payload.payment_reference || null,
      payment_date: payload.payment_date || payload.paid_at || null,
      paid_at: payload.paid_at || payload.payment_date || null,
      download_access: false,
      // Ensure new briefs still set lifecycle to Pending until admin confirmation
      order_status: payload.order_status || 'Pending',
      latest_progress: payload.latest_progress || 'Brief submitted',
      revision_count: typeof payload.revision_count === 'number' ? payload.revision_count : getRevisionCount(payload.payment_type || payload.paymentMethod),
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
    
    // Create or reuse a chat conversation for this order
    let conversation_id = merged.conversation_id;
    if (!conversation_id) {
      try {
        const existingConversation = await loadChatConversationByOrderId(order_id);
        const conversationData = {
          customer_name: merged.client_name || 'Customer',
          customer_email: merged.client_email || null,
          customer_phone: merged.whatsapp_number || null,
          subject: `Order ${order_id}: ${merged.service_name || 'Project'}`,
          status: 'open',
          source: 'website',
          order_id: order_id,
          unread_admin_count: existingConversation?.unread_admin_count || 0,
          unread_customer_count: existingConversation?.unread_customer_count || 0,
          last_message_at: existingConversation?.last_message_at || new Date().toISOString(),
          created_at: existingConversation?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        const createdConversation = existingConversation
          ? await updateChatConversation(existingConversation.id, conversationData)
          : await persistChatConversation(conversationData);
        if (createdConversation && createdConversation.id) {
          conversation_id = createdConversation.id;
          merged.conversation_id = conversation_id;
          
          // Update the order with conversation_id
          const updatePayload = { ...upsertData, conversation_id };
          if (supabase) {
            await persistOrder(updatePayload);
          }
          orderStore.set(order_id, merged);
          console.log('✅ Chat conversation linked to order:', order_id, 'conversation_id:', conversation_id);
        }
      } catch (convErr) {
        console.warn('⚠️ Failed to create or reuse conversation for order:', convErr.message || convErr);
        // Continue even if conversation creation fails - it's not critical
      }
    }
    
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

    console.log('[status-update] request payload:', JSON.stringify({ orderId, status, message }, null, 2));

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
          .select('order_status, latest_progress, status_history, client_email, service_name, order_id')
          .eq('order_id', orderId)
          .limit(1)
          .single();

        if (!existingError && existingData) {
          existingOrder = existingData;
        }
      } catch (err) {
        console.warn('Supabase existing order fetch warning:', err.message || err);
      }

      const existingHistory = Array.isArray(existingOrder?.status_history) ? existingOrder.status_history : [];
      const newHistoryEntry = { status, message: statusNote, updated_at: new Date().toISOString() };
      const updatedHistory = [...existingHistory, newHistoryEntry];

      try {
        const updatedData = await persistOrder({
          order_id: orderId,
          order_status: status,
          latest_progress: statusNote,
          status_history: updatedHistory
        });
        if (updatedData) {
          updatedOrder = updatedData;
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
      const newHistoryEntry = { status, message: statusNote, updated_at: new Date().toISOString() };
      updatedOrder = {
        ...order,
        status,
        order_status: status,
        latest_progress: statusNote,
        status_history: Array.isArray(order.status_history)
          ? [...order.status_history, newHistoryEntry]
          : [newHistoryEntry]
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

    const responseOrder = {
      order_id: orderId,
      status,
      order_status: status,
      latest_progress: updatedOrder?.latest_progress || statusNote,
      status_history: Array.isArray(updatedOrder?.status_history) ? updatedOrder.status_history : [],
      updated_at: updatedOrder?.updated_at || new Date().toISOString()
    };

    console.log('[status-update] backend response:', JSON.stringify({ success: true, message: 'Order status updated successfully.', order: responseOrder }, null, 2));

    return res.json({ success: true, message: 'Order status updated successfully.', order: responseOrder });
  } catch (err) {
    console.error('Update order status error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update order status', error: err.message });
  }
});

app.post('/api/admin/email-test', adminAuth, async (req, res) => {
  try {
    const { email, diagnostics = false } = req.body || {};

    if (diagnostics === true) {
      const diagnosticsResult = await runSmtpDiagnostics(typeof email === 'string' ? email.trim() : '');
      return res.json({
        success: diagnosticsResult.connectionSuccess && diagnosticsResult.authenticationSuccess,
        diagnostics: diagnosticsResult,
        message: diagnosticsResult.connectionSuccess && diagnosticsResult.authenticationSuccess
          ? 'SMTP diagnostics passed.'
          : 'SMTP diagnostics failed.'
      });
    }

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
      const diagnosticsResult = await runSmtpDiagnostics(sanitizedEmail);
      return res.status(500).json({
        success: false,
        message: 'Unable to send test email',
        diagnostics: diagnosticsResult
      });
    }

    return res.json({ success: true, message: `Test email sent to ${sanitizedEmail}` });
  } catch (err) {
    console.error('Admin email test error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Failed to send test email', error: err.message });
  }
});

/**
 * POST /api/admin/smtp-diagnostic
 * Detailed SMTP diagnostic endpoint with full configuration check
 */
app.post('/api/admin/smtp-diagnostic', adminAuth, async (req, res) => {
  console.log('📍 POST /api/admin/smtp-diagnostic - Running SMTP diagnostics');
  try {
    const { testEmail } = req.body || {};
    const targetEmail = (testEmail && String(testEmail).trim()) || DESIGNER_EMAIL || SMTP_USER || '';

    const configCheck = getSmtpConfigurationCause();
    const result = {
      timestamp: new Date().toISOString(),
      configuration: {
        smtpHost: SMTP_HOST,
        smtpPort: SMTP_PORT,
        smtpSecure: SMTP_SECURE,
        smtpUserConfigured: !!SMTP_USER,
        smtpPassConfigured: hasSMTPPass,
        configCause: configCheck.cause,
        configMessage: configCheck.message,
        designerEmail: DESIGNER_EMAIL,
        noreplyEmail: NOREPLY_EMAIL,
        transporterExists: !!emailTransporter
      },
      environmentVariables: {
        SMTP_HOST: SMTP_HOST ? '✅ Set' : '❌ Not set',
        SMTP_PORT: SMTP_PORT ? '✅ Set' : '❌ Not set',
        SMTP_USER: SMTP_USER ? '✅ Set' : '❌ Not set',
        SMTP_PASS: SMTP_PASS ? '✅ Set' : '❌ Not set',
        DESIGNER_EMAIL: DESIGNER_EMAIL ? '✅ Set' : '❌ Not set',
        DESINGER_EMAIL: config.DESIGNER_EMAIL ? '✅ Set' : '❌ Not set',
        NOREPLY_EMAIL: NOREPLY_EMAIL ? '✅ Set' : '❌ Not set'
      },
      smtpVerification: {
        connectionSuccess: false,
        authenticationSuccess: false,
        cause: configCheck.cause,
        diagnosis: configCheck.message,
        message: configCheck.message,
        errorDetails: null
      }
    };

    if (configCheck.cause !== 'ok') {
      return res.status(500).json({ success: false, diagnostics: result });
    }

    const emailProviderConfigured = isSendGridProvider || Boolean(emailTransporter);
    if (!emailProviderConfigured) {
      result.smtpVerification.cause = 'Missing Environment Variable';
      result.smtpVerification.diagnosis = EMAIL_PROVIDER === 'sendgrid'
        ? 'SendGrid provider is selected but SENDGRID_API_KEY is not configured.'
        : 'Email transporter is not configured. Check SMTP_USER and SMTP_PASS in your environment.';
      result.smtpVerification.message = result.smtpVerification.diagnosis;
      return res.status(500).json({ success: false, diagnostics: result });
    }

    const diagnostics = await runSmtpDiagnostics(typeof targetEmail === 'string' ? targetEmail : '');
    result.smtpVerification = {
      connectionSuccess: diagnostics.connectionSuccess,
      authenticationSuccess: diagnostics.authenticationSuccess,
      cause: diagnostics.cause,
      diagnosis: diagnostics.diagnosis,
      message: diagnostics.reason,
      errorDetails: diagnostics.errorFull || diagnostics.error || null,
      realSendAttempted: diagnostics.realSendAttempted,
      realSendSuccess: diagnostics.realSendSuccess,
      suggestedAction: diagnostics.suggestedAction || null
    };

    return res.json({ success: diagnostics.connectionSuccess && diagnostics.authenticationSuccess, diagnostics: result });
  } catch (err) {
    console.error('SMTP diagnostic error:', err);
    return res.status(500).json({ success: false, message: 'Diagnostic failed', error: err.message });
  }
});

app.get('/api/admin/storage-diagnostic', adminAuth, async (req, res) => {
  console.log('📍 GET /api/admin/storage-diagnostic - Running Supabase storage diagnostics');
  const diagnostics = {
    supabaseConfigured: Boolean(supabase),
    bucket: 'order-deliveries',
    database: { connected: false, error: null, latencyMs: null },
    storage: { accessible: false, error: null, sampleItems: null }
  };

  if (!supabase) {
    diagnostics.database.error = 'Supabase is not configured.';
    diagnostics.storage.error = 'Supabase is not configured.';
    return res.status(500).json({ success: false, diagnostics, message: 'Supabase is not configured.' });
  }

  try {
    const start = Date.now();
    const { error: dbError } = await supabase.from('matex_orders').select('order_id').limit(1).maybeSingle();
    diagnostics.database.connected = !Boolean(dbError);
    diagnostics.database.latencyMs = Date.now() - start;
    diagnostics.database.error = dbError ? (dbError.message || String(dbError)) : null;
  } catch (err) {
    diagnostics.database.connected = false;
    diagnostics.database.error = err?.message || String(err);
  }

  try {
    const { data: storageData, error: storageError } = await supabase.storage.from(diagnostics.bucket).list('', { limit: 5 });
    diagnostics.storage.accessible = !Boolean(storageError);
    diagnostics.storage.error = storageError ? (storageError.message || String(storageError)) : null;
    diagnostics.storage.sampleItems = Array.isArray(storageData) ? storageData : null;
  } catch (err) {
    diagnostics.storage.accessible = false;
    diagnostics.storage.error = err?.message || String(err);
  }

  const success = diagnostics.database.connected && diagnostics.storage.accessible;
  return res.status(success ? 200 : 500).json({ success, diagnostics });
});

/**
 * POST /api/email/inbound
 * Ingest inbound email payloads (webhook) and persist as chat messages.
 * Expected JSON: { order_id, from_name, from_email, subject, body, source }
 */
app.post('/api/email/inbound', async (req, res) => {
  try {
    const { order_id, from_name, from_email, subject, body, source } = req.body || {};
    if (!body || (!order_id && !from_email)) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    // Try to find or create a conversation linked to the order
    let conversation = null;
    if (order_id) {
      conversation = await loadChatConversationByOrderId(order_id).catch(() => null);
    }
    if (!conversation) {
      // create a minimal conversation record
      const convo = {
        order_id: order_id || null,
        subject: subject || `Email from ${from_name || from_email}`,
        created_by: 'email_inbound',
        status: 'open',
        client_name: from_name || null,
        client_email: from_email || null
      };
      conversation = await persistChatConversation(convo).catch(() => null);
    }

    if (!conversation) return res.status(500).json({ success: false, message: 'Unable to create conversation' });

    const message = {
      conversation_id: conversation.id,
      sender: 'customer',
      sender_name: from_name || from_email || 'Customer',
      sender_email: from_email || null,
      body: String(body || ''),
      metadata: { source: source || 'email' }
    };

    const stored = await persistChatMessage(message).catch(() => null);
    if (!stored) return res.status(500).json({ success: false, message: 'Unable to persist inbound message' });

    return res.json({ success: true, conversation, message: stored });
  } catch (err) {
    console.error('Inbound email webhook error:', err && (err.message || err));
    return res.status(500).json({ success: false, message: 'Inbound processing failed' });
  }
});

/**
 * GET /api/reviews-status
 * Public endpoint to check approved reviews status in the database
 */
app.get('/api/reviews-status', async (req, res) => {
  console.log('📍 GET /api/reviews-status - Checking reviews database status');
  try {
    if (!supabase) {
      return res.json({
        success: false,
        status: 'no-supabase',
        message: 'Supabase not configured',
        reviews: {
          inMemoryCount: reviewStore.size,
          inMemoryApproved: Array.from(reviewStore.values()).filter(r => r.status === 'Approved').length
        }
      });
    }

    const { data: allReviews, error: allError } = await supabase.from('matex_reviews').select('*').order('created_at', { ascending: false });
    const { data: approvedReviews, error: approvedError } = await supabase.from('matex_reviews').select('*').eq('status', 'Approved').order('created_at', { ascending: false });

    if (allError || approvedError) {
      console.error('Reviews status check error:', allError || approvedError);
      return res.status(500).json({
        success: false,
        status: 'database-error',
        message: 'Unable to query reviews table',
        error: (allError || approvedError).message
      });
    }

    const statusBreakdown = {};
    (allReviews || []).forEach(r => {
      const s = r.status || 'Unknown';
      statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
    });

    return res.json({
      success: true,
      status: 'ok',
      message: 'Reviews status retrieved',
      summary: {
        totalReviews: (allReviews || []).length,
        approvedReviews: (approvedReviews || []).length,
        statusBreakdown
      },
      recentApproved: (approvedReviews || []).slice(0, 5).map(r => ({
        id: r.id,
        name: r.full_name,
        rating: r.rating,
        status: r.status,
        created_at: r.created_at
      }))
    });
  } catch (err) {
    console.error('Reviews status error:', err);
    return res.status(500).json({ success: false, message: 'Status check failed', error: err.message });
  }
});

/**
 * POST /api/designer/notify
 * Send designer notification for an order
 */
app.post('/api/designer/notify', async (req, res) => {
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
      try {
        await sendEmail(DESIGNER_EMAIL, `Order Details - ${orderId}`, designerEmailHtml);
      } catch (err) {
      try {
        await sendEmail(DESIGNER_EMAIL, `Order Details - ${orderId}`, designerEmailHtml);
      } catch (err) {
        console.error('Designer notification failed:', err?.message || err);
      }
      }

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

// Public: get approved reviews (with caching and fallback)
app.get('/api/reviews', async (req, res) => {
  console.log('📍 GET /api/reviews - Fetching approved reviews');
  try {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('matex_reviews').select('*').eq('status', 'Approved').order('created_at', { ascending: false });
        if (error) {
          console.error('Supabase fetch reviews error:', error);
          console.warn('Falling back to in-memory store');
        } else {
          const reviews = data || [];
          console.log(`✅ Fetched ${reviews.length} approved reviews from Supabase`);
          return res.json({ success: true, reviews, source: 'supabase' });
        }
      } catch (supabaseErr) {
        console.error('Supabase query exception:', supabaseErr.message);
        console.warn('Falling back to in-memory store due to Supabase error');
      }
    }

    // Fallback to in-memory approved reviews
    const reviews = Array.from(reviewStore.values()).filter(r => r.status === 'Approved').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`✅ Fetched ${reviews.length} approved reviews from in-memory store`);
    return res.json({ success: true, reviews, source: 'memory' });
  } catch (err) {
    console.error('Get reviews error:', err.message || err);
    return res.status(500).json({ success: false, message: 'Unable to load reviews', source: 'error' });
  }
});

// Admin: list all reviews (pending/approved/rejected)
app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  console.log('📍 GET /api/admin/reviews - Admin fetching all reviews');
  try {
    if (supabase) {
      try {
        const { data, error } = await supabase.from('matex_reviews').select('*').order('created_at', { ascending: false });
        if (error) {
          console.error('Supabase admin fetch reviews error:', error);
          console.warn('Falling back to in-memory store');
        } else {
          console.log(`✅ Admin fetched ${(data || []).length} reviews from Supabase`);
          return res.json({ success: true, reviews: data || [], source: 'supabase' });
        }
      } catch (supabaseErr) {
        console.error('Supabase query exception:', supabaseErr.message);
        console.warn('Falling back to in-memory store due to Supabase error');
      }
    }
    const reviews = Array.from(reviewStore.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    console.log(`✅ Admin fetched ${reviews.length} reviews from in-memory store`);
    return res.json({ success: true, reviews, source: 'memory' });
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

    console.log(`📍 Updating review ${id} status to ${status}`);

    if (supabase) {
      try {
        const { data, error } = await supabase.from('matex_reviews').update({ status }).eq('id', id).select().limit(1).single();
        if (error) {
          console.error('Supabase update review error:', error);
          console.warn('Falling back to in-memory store');
        } else {
          console.log(`✅ Review ${id} updated to ${status} in Supabase`);
          return res.json({ success: true, review: data, updated: true });
        }
      } catch (supabaseErr) {
        console.error('Supabase update exception:', supabaseErr.message);
        console.warn('Falling back to in-memory store due to Supabase error');
      }
    }

    const existing = reviewStore.get(id);
    if (!existing) return res.status(404).json({ success: false, message: 'Review not found' });
    existing.status = status;
    reviewStore.set(id, existing);
    console.log(`✅ Review ${id} updated to ${status} in memory store`);
    return res.json({ success: true, review: existing, updated: true });
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

// ==================== REVISION REQUEST SYSTEM ====================

/**
 * POST /api/revisions/request
 * Submit a revision request for an order
 */
app.post('/api/revisions/request', async (req, res) => {
  const { order_id, customer_message } = req.body;
  console.log(`📍 POST /api/revisions/request - Order ${order_id}`);

  if (!order_id || !customer_message || !String(customer_message).trim()) {
    return res.status(400).json({ success: false, message: 'order_id and customer_message are required' });
  }

  try {
    let order = await loadOrderById(order_id);
    if (!order) {
      order = orderStore.get(order_id);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const revisionState = computeRevisionState(order);
    const revisionsAllowed = revisionState.allowed;
    const revisionsUsed = revisionState.used;
    const revisionsRemaining = revisionState.remaining;

    if (revisionsRemaining <= 0) {
      return res.status(403).json({ success: false, message: 'No revisions remaining for this order' });
    }

    const nextUsed = revisionsUsed + 1;
    const nextRemaining = Math.max(revisionsAllowed - nextUsed, 0);
    const revisionRecord = {
      order_id,
      customer_message: String(customer_message).trim(),
      admin_reply: null,
      status: 'Pending',
      revisions_used: nextUsed,
      revisions_remaining: nextRemaining,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      approved_at: null,
      rejected_at: null,
      completed_at: null
    };

    const timelineEntry = { event: 'Revision Requested', message: String(customer_message).trim(), updated_at: new Date().toISOString() };
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions').insert([revisionRecord]).select();
      if (error) {
        console.error('Supabase create revision error:', error);
        return res.status(500).json({ success: false, message: 'Failed to save revision request' });
      }
      revisionRecord.id = data[0].id;

      const existingRes = await supabase.from('matex_orders').select('status_history').eq('order_id', order_id).limit(1).maybeSingle();
      const history = existingRes && !existingRes.error && Array.isArray(existingRes.data?.status_history) ? existingRes.data.status_history : [];
      const orderUpdate = {
        order_id,
        revisions_used: nextUsed,
        revisions_remaining: nextRemaining,
        revision_count: revisionsAllowed,
        latest_progress: 'Revision requested by customer',
        status_history: [...history, timelineEntry]
      };
      await persistOrder(orderUpdate).catch((updateErr) => {
        console.warn('Supabase revision request order update warning:', updateErr?.message || updateErr);
      });
    } else {
      revisionRecord.id = `rev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const existingOrder = orderStore.get(order_id) || {};
      existingOrder.revisions_used = nextUsed;
      existingOrder.revisions_remaining = nextRemaining;
      existingOrder.revision_count = revisionsAllowed;
      existingOrder.latest_progress = 'Revision requested by customer';
      const history = Array.isArray(existingOrder.status_history) ? existingOrder.status_history : [];
      existingOrder.status_history = [...history, timelineEntry];
      orderStore.set(order_id, existingOrder);
    }

    const conversation = await loadChatConversationByOrderId(order_id).catch(() => null);
    if (conversation?.id) {
      await persistChatMessage({
        conversation_id: conversation.id,
        sender: 'system',
        sender_name: 'System',
        sender_email: null,
        body: `Revision requested: ${String(customer_message).trim()}`,
        is_system: true
      }).catch(() => null);
      await updateChatConversation(conversation.id, { unread_admin_count: Number(conversation.unread_admin_count || 0) + 1, last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() }).catch(() => null);
    }

    try {
      await sendEmail(DESIGNER_EMAIL, `Revision requested for ${order_id}`, buildCustomerNotificationHtml({ order_id, client_name: order.client_name || 'Customer', client_email: order.client_email || '', latest_progress: 'Revision requested by customer' }, `A revision was requested for ${order_id}.`));
    } catch (err) {
      console.warn('Failed to send revision notification email:', err?.message || err);
    }
    try {
      await sendEmail(DESIGNER_EMAIL, `Revision requested for ${order_id}`, buildCustomerNotificationHtml({ order_id, client_name: order.client_name || 'Customer', client_email: order.client_email || '', latest_progress: 'Revision requested by customer' }, `A revision was requested for ${order_id}.`));
    } catch (err) {
      console.warn('Failed to send revision notification email:', err?.message || err);
    }

    console.log('✅ Revision request created:', revisionRecord.id);
    res.json({ success: true, message: 'Revision request submitted', revision: revisionRecord });
  } catch (err) {
    console.error('❌ Revision request error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to process revision request' });
  }
});

/**
 * GET /api/revisions/:orderId
 * Get all revision requests for an order
 */
app.get('/api/revisions/:orderId', async (req, res) => {
  const { orderId } = req.params;
  console.log(`📍 GET /api/revisions/${orderId}`);

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  try {
    let revisions = [];
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });
      
      if (error) {
        console.warn('Supabase fetch revisions error:', error);
      } else {
        revisions = data || [];
      }
    }

    res.json({ success: true, revisions });
  } catch (err) {
    console.error('❌ Fetch revisions error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to fetch revisions' });
  }
});

/**
 * GET /api/revisions/:orderId/summary
 * Get revision summary (counts) for order tracker display
 */
app.get('/api/revisions/:orderId/summary', async (req, res) => {
  const { orderId } = req.params;
  console.log(`📍 GET /api/revisions/${orderId}/summary`);

  if (!orderId) {
    return res.status(400).json({ success: false, message: 'orderId is required' });
  }

  try {
    let order = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_orders')
        .select('revision_count, revisions_used')
        .eq('order_id', orderId)
        .limit(1)
        .maybeSingle();
      
      if (!error) {
        order = data;
      }
    }

    if (!order) {
      order = orderStore.get(orderId);
    }

    const revisionState = computeRevisionState(order || {});
    const revisionsAllowed = revisionState.allowed;
    const revisionsUsed = revisionState.used;
    const revisionsRemaining = revisionState.remaining;

    // Get pending revision count
    let pendingCount = 0;
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('id')
        .eq('order_id', orderId)
        .eq('status', 'Pending');
      
      if (!error && data) {
        pendingCount = data.length;
      }
    }

    res.json({ 
      success: true, 
      summary: {
        revisions_allowed: revisionsAllowed,
        revisions_used: revisionsUsed,
        revisions_remaining: revisionsRemaining,
        pending_requests: pendingCount
      }
    });
  } catch (err) {
    console.error('❌ Fetch revision summary error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to fetch revision summary' });
  }
});

/**
 * PUT /api/revisions/:revisionId/approve
 * Admin approve a revision request
 */
app.put('/api/revisions/:revisionId/approve', adminAuth, async (req, res) => {
  const { revisionId } = req.params;
  console.log(`📍 PUT /api/revisions/${revisionId}/approve - Admin approve`);

  try {
    let revision = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('*')
        .eq('id', revisionId)
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Supabase fetch revision error:', error);
      } else {
        revision = data;
      }
    }

    if (!revision) {
      return res.status(404).json({ success: false, message: 'Revision not found' });
    }

    const updatedRevision = {
      ...revision,
      status: 'Approved',
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      revisions_used: (revision.revisions_used || 0) + 1,
      revisions_remaining: Math.max(0, (revision.revisions_remaining || 1) - 1)
    };

    if (supabase) {
      const { error } = await supabase.from('matex_revisions')
        .update(updatedRevision)
        .eq('id', revisionId);
      
      if (error) {
        console.error('Supabase update revision error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update revision' });
      }

      const existingOrder = await loadOrderById(revision.order_id);
      const history = Array.isArray(existingOrder?.status_history) ? existingOrder.status_history : [];
      const timelineEntry = { event: 'Revision Approved', message: 'Revision approved by admin', updated_at: new Date().toISOString() };

      await persistOrder({
        order_id: revision.order_id,
        revisions_used: updatedRevision.revisions_used,
        revisions_remaining: updatedRevision.revisions_remaining,
        latest_progress: 'Revision approved by admin',
        status_history: [...history, timelineEntry]
      }).catch((persistErr) => {
        console.warn('Supabase revision approval order update warning:', persistErr?.message || persistErr);
      });
    } else {
      const existingOrder = orderStore.get(revision.order_id) || {};
      existingOrder.revisions_used = updatedRevision.revisions_used;
      existingOrder.revisions_remaining = updatedRevision.revisions_remaining;
      existingOrder.latest_progress = 'Revision approved by admin';
      const history = Array.isArray(existingOrder.status_history) ? existingOrder.status_history : [];
      existingOrder.status_history = [...history, { event: 'Revision Approved', message: 'Revision approved by admin', updated_at: new Date().toISOString() }];
      orderStore.set(revision.order_id, existingOrder);
    }

    console.log('✅ Revision approved:', revisionId);
    res.json({ success: true, message: 'Revision approved', revision: updatedRevision });
  } catch (err) {
    console.error('❌ Approve revision error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to approve revision' });
  }
});

/**
 * PUT /api/revisions/:revisionId/reject
 * Admin reject a revision request
 */
app.put('/api/revisions/:revisionId/reject', adminAuth, async (req, res) => {
  const { revisionId } = req.params;
  const { reason } = req.body;
  console.log(`📍 PUT /api/revisions/${revisionId}/reject - Admin reject`);

  try {
    let revision = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('*')
        .eq('id', revisionId)
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Supabase fetch revision error:', error);
      } else {
        revision = data;
      }
    }

    if (!revision) {
      return res.status(404).json({ success: false, message: 'Revision not found' });
    }

    const updatedRevision = {
      ...revision,
      status: 'Rejected',
      rejected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      admin_reply: reason || 'Revision request rejected'
    };

    if (supabase) {
      const { error } = await supabase.from('matex_revisions')
        .update(updatedRevision)
        .eq('id', revisionId);
      
      if (error) {
        console.error('Supabase update revision error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update revision' });
      }
    }

    console.log('✅ Revision rejected:', revisionId);
    res.json({ success: true, message: 'Revision rejected', revision: updatedRevision });
  } catch (err) {
    console.error('❌ Reject revision error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to reject revision' });
  }
});

/**
 * PUT /api/revisions/:revisionId/reply
 * Admin reply to a revision request
 */
app.put('/api/revisions/:revisionId/reply', adminAuth, async (req, res) => {
  const { revisionId } = req.params;
  const { admin_reply } = req.body;
  console.log(`📍 PUT /api/revisions/${revisionId}/reply - Admin reply`);

  if (!admin_reply || !String(admin_reply).trim()) {
    return res.status(400).json({ success: false, message: 'admin_reply is required' });
  }

  try {
    let revision = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('*')
        .eq('id', revisionId)
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Supabase fetch revision error:', error);
      } else {
        revision = data;
      }
    }

    if (!revision) {
      return res.status(404).json({ success: false, message: 'Revision not found' });
    }

    const updatedRevision = {
      ...revision,
      admin_reply: String(admin_reply).trim(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      const { error } = await supabase.from('matex_revisions')
        .update(updatedRevision)
        .eq('id', revisionId);
      
      if (error) {
        console.error('Supabase update revision error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update revision' });
      }
    }

    console.log('✅ Revision reply sent:', revisionId);
    res.json({ success: true, message: 'Reply sent', revision: updatedRevision });
  } catch (err) {
    console.error('❌ Reply revision error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to send reply' });
  }
});

/**
 * PUT /api/revisions/:revisionId/complete
 * Admin mark revision as completed
 */
app.put('/api/revisions/:revisionId/complete', adminAuth, async (req, res) => {
  const { revisionId } = req.params;
  console.log(`📍 PUT /api/revisions/${revisionId}/complete - Admin complete`);

  try {
    let revision = null;
    if (supabase) {
      const { data, error } = await supabase.from('matex_revisions')
        .select('*')
        .eq('id', revisionId)
        .limit(1)
        .maybeSingle();
      
      if (error) {
        console.error('Supabase fetch revision error:', error);
      } else {
        revision = data;
      }
    }

    if (!revision) {
      return res.status(404).json({ success: false, message: 'Revision not found' });
    }

    const updatedRevision = {
      ...revision,
      status: 'Completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (supabase) {
      const { error } = await supabase.from('matex_revisions')
        .update(updatedRevision)
        .eq('id', revisionId);
      
      if (error) {
        console.error('Supabase update revision error:', error);
        return res.status(500).json({ success: false, message: 'Failed to update revision' });
      }
    }

    console.log('✅ Revision completed:', revisionId);
    res.json({ success: true, message: 'Revision completed', revision: updatedRevision });
  } catch (err) {
    console.error('❌ Complete revision error:', err && (err.message || err));
    res.status(500).json({ success: false, message: 'Failed to complete revision' });
  }
});

/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: config.NODE_ENV === 'development' ? err.message : undefined
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
    console.log(`🔐 Environment: ${config.NODE_ENV}\n`);
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

async function startApp() {
  if (emailTransporter) {
    console.log('⚠️ SMTP transporter configured; startup verification is skipped in production to avoid disabling email on transient network failures.');
  } else {
    console.warn('⚠️ SMTP transporter is not configured at startup. Email delivery is disabled until SMTP_USER and SMTP_PASS are set.');
  }

  startServer(PORT);
}

startApp().catch((err) => {
  console.error('❌ Startup initialization failed:', err?.message || err);
  process.exit(1);
});
