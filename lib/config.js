/**
 * Matex Backend Configuration Module
 * Handles all environment variable loading and validation
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.resolve(__dirname, '..', '.env'),
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '.env')
];
const resolvedEnvPath = envCandidates.find((candidate) => fs.existsSync(candidate)) || envCandidates[0];
const envResult = dotenv.config({ path: resolvedEnvPath });

if (envResult.error) {
  console.warn(`[config] Unable to load environment from ${path.resolve(resolvedEnvPath)}: ${envResult.error.message}`);
} else {
  console.log(`[config] Loaded environment from ${path.resolve(resolvedEnvPath)}`);
}

/**
 * SERVER & APP CONFIGURATION
 */
export const PORT = process.env.PORT || 5001;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const ADMIN_TOKEN_TTL_MS = Number(process.env.ADMIN_TOKEN_TTL_MS || '1800000');

/**
 * PAYSTACK CONFIGURATION
 */
export const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
export const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
export const PAYSTACK_API_URL = 'https://api.paystack.co';

/**
 * SUPABASE CONFIGURATION
 */
export const SUPABASE_URL = process.env.SUPABASE_URL;
export const SUPABASE_KEY = process.env.SUPABASE_KEY;

/**
 * SMTP EMAIL CONFIGURATION
 */
export const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
export const SMTP_PORT = Number(process.env.SMTP_PORT || '587');
export const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
export const SMTP_USER = process.env.SMTP_USER || '';
export const SMTP_PASS = process.env.SMTP_PASS || '';
export const DESIGNER_EMAIL = process.env.DESIGNER_EMAIL || process.env.DESINGER_EMAIL || 'designer@matexcreations.com';
export const NOREPLY_EMAIL = process.env.NOREPLY_EMAIL || 'noreply@matexcreations.com';
export const SMTP_FROM = process.env.SMTP_FROM || `${NOREPLY_EMAIL}`;
export const SMTP_REQUIRE_TLS = String(process.env.SMTP_REQUIRE_TLS || '').toLowerCase() === 'true' || SMTP_PORT === 587;

/**
 * ADMIN AUTHENTICATION CONFIGURATION
 */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const resolvedAdminSecret = process.env.ADMIN_SECRET || process.env.ADMIN_SECRET_KEY || '';
export const ADMIN_SECRET_KEY = resolvedAdminSecret;
if (resolvedAdminSecret && !process.env.ADMIN_SECRET) {
  process.env.ADMIN_SECRET = resolvedAdminSecret;
}
if (resolvedAdminSecret && !process.env.ADMIN_SECRET_KEY) {
  process.env.ADMIN_SECRET_KEY = resolvedAdminSecret;
}

/**
 * SERVICE PRICING CONFIGURATION - SINGLE SOURCE OF TRUTH
 */
export const SERVICE_PRICING = {
  'Graphic Design': {
    name: 'Graphic Design',
    description: 'Flyers • Posters • Logos',
    naira: 6000,
    usd: 4,
    currency: 'NGN'
  },
  'Video Editing': {
    name: 'Video Editing',
    description: 'YouTube edits • Ad videos • Showreels',
    naira: 9000,
    usd: 6,
    currency: 'NGN'
  },
  'Brand Identity': {
    name: 'Brand Identity',
    description: 'Complete branding packages',
    naira: 15000,
    usd: 10,
    currency: 'NGN'
  }
};

/**
 * SMTP Configuration object for nodemailer
 */
export const smtpConfig = {
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  requireTLS: SMTP_REQUIRE_TLS,
  auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  tls: {
    rejectUnauthorized: false
  },
  connectionTimeout: 60000,
  greetingTimeout: 30000,
  socketTimeout: 60000
};

/**
 * Validate that required production configuration is present
 * @returns {Object} Validation result with warnings array
 */
export function validateConfig() {
  const warnings = [];
  const errors = [];

  // Check Paystack configuration
  if (!PAYSTACK_SECRET_KEY) {
    warnings.push('⚠️ PAYSTACK_SECRET_KEY is not defined; payment routes will be disabled.');
  }

  // Check Supabase configuration
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    warnings.push('⚠️ SUPABASE_URL or SUPABASE_KEY not set; running without database persistence.');
  }

  // Check SMTP configuration
  if (!SMTP_USER) {
    warnings.push('⚠️ SMTP_USER is not configured; email notifications disabled.');
  }
  if (!SMTP_PASS) {
    warnings.push('⚠️ SMTP_PASS is not configured; email notifications disabled.');
  }

  // Check Admin authentication
  if (!ADMIN_PASSWORD || !ADMIN_SECRET_KEY) {
    errors.push('❌ ADMIN_PASSWORD or ADMIN_SECRET/ADMIN_SECRET_KEY is not configured; admin features disabled.');
  }

  return { warnings, errors, isValid: errors.length === 0 };
}

/**
 * Get SMTP configuration diagnostics
 * @returns {Object} SMTP configuration status and recommendations
 */
export function getSmtpConfigurationCause() {
  if (!SMTP_HOST) {
    return { cause: 'Missing Environment Variable', message: 'SMTP_HOST is not configured.' };
  }
  if (!SMTP_PORT) {
    return { cause: 'Missing Environment Variable', message: 'SMTP_PORT is not configured.' };
  }
  if (!SMTP_USER) {
    return { cause: 'Missing Environment Variable', message: 'SMTP_USER is not configured.' };
  }
  if (!SMTP_PASS) {
    return { cause: 'Missing App Password', message: 'SMTP_PASS is not configured. Gmail SMTP requires an app password.' };
  }

  const isGmail = String(SMTP_HOST || '').toLowerCase().includes('gmail.com');
  if (isGmail) {
    if (SMTP_PORT === 465 && !SMTP_SECURE) {
      return { cause: 'Wrong Secure Setting', message: 'Gmail port 465 requires secure=true.' };
    }
    if (SMTP_PORT === 587 && SMTP_SECURE) {
      return { cause: 'Wrong Secure Setting', message: 'Gmail port 587 requires secure=false.' };
    }
    if (![465, 587].includes(SMTP_PORT)) {
      return { cause: 'Wrong Port', message: 'Gmail SMTP should use port 587 (secure=false) or 465 (secure=true).' };
    }
  }

  return { cause: 'ok', message: 'SMTP configuration appears valid.' };
}

/**
 * Export all configuration for convenience
 */
export default {
  PORT,
  NODE_ENV,
  PAYSTACK_SECRET_KEY,
  PAYSTACK_PUBLIC_KEY,
  PAYSTACK_API_URL,
  SUPABASE_URL,
  SUPABASE_KEY,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  SMTP_FROM,
  SMTP_REQUIRE_TLS,
  DESIGNER_EMAIL,
  NOREPLY_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_SECRET_KEY,
  ADMIN_TOKEN_TTL_MS,
  SERVICE_PRICING,
  smtpConfig,
  validateConfig,
  getSmtpConfigurationCause
};
