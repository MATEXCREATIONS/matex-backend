/**
 * Matex Backend Authentication Module
 * Handles admin token generation, verification, and middleware
 */

import crypto from 'crypto';
import { ADMIN_PASSWORD, ADMIN_SECRET_KEY, ADMIN_TOKEN_TTL_MS } from './config.js';
/**
 * Create a signed admin token
 * Token format: Base64(payload.signature) where payload is JSON with timestamp
 * @returns {String} Base64-encoded signed token
 */
export function createAdminToken() {
  const payload = JSON.stringify({ ts: Date.now() });
  const signature = crypto.createHmac('sha256', ADMIN_SECRET_KEY).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`).toString('base64url');
}

/**
 * Verify an admin token's authenticity and expiration
 * @param {String} token - The token to verify
 * @returns {Boolean} True if token is valid and not expired
 */
export function verifyAdminToken(token) {
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

    // Check token expiration
    return Date.now() - parsed.ts <= ADMIN_TOKEN_TTL_MS;
  } catch (err) {
    return false;
  }
}

/**
 * Express middleware for protecting admin routes
 * Validates Authorization header contains valid admin token
 */
export function adminAuth(req, res, next) {
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

export default {
  createAdminToken,
  verifyAdminToken,
  adminAuth
};
