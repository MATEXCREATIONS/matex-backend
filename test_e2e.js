import axios from 'axios';
import assert from 'assert';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.E2E_BASE || process.env.BASE_URL || 'http://localhost:5001';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const response = await axios({ url, validateStatus: () => true, timeout: 30000, ...options });
  return response;
}

async function run() {
  console.log(`Starting E2E check against ${BASE_URL}`);

  const health = await request('/api/health');
  console.log('Health status:', health.status, health.data?.message || '(no message)');
  assert.strictEqual(health.status, 200, 'Health endpoint must return 200');
  assert.strictEqual(health.data?.success, true, 'Health endpoint must be successful');

  const services = await request('/api/services');
  console.log('Services status:', services.status);
  assert.strictEqual(services.status, 200, '/api/services must return 200');
  assert.strictEqual(services.data?.success, true, '/api/services must be successful');
  assert.ok(Array.isArray(services.data.services), 'Services response must be an array');

  if (PAYSTACK_SECRET_KEY) {
    console.log('Paystack key found; testing /api/payment/initialize next.');
    const paymentPayload = {
      order_id: `e2e-${Date.now()}`,
      email: 'e2e@example.com',
      amount: 6000,
      service_name: 'Graphic Design',
      payment_type: 'full'
    };
    const payment = await request('/api/payment/initialize', {
      method: 'POST',
      data: paymentPayload,
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Payment init status:', payment.status, payment.data?.message || '(no message)');
    if (payment.status === 401 || payment.status === 403 || payment.status === 503) {
      console.warn('Paystack init check skipped due to auth or config issue. Ensure PAYSTACK_SECRET_KEY is valid.');
    } else {
      assert.strictEqual(payment.status, 200, '/api/payment/initialize should return 200 if Paystack is configured');
      assert.strictEqual(payment.data?.success, true, '/api/payment/initialize should be successful');
      assert.ok(payment.data.authorization_url, 'Paystack initialize must return authorization_url');
    }
  } else {
    console.warn('PAYSTACK_SECRET_KEY is not set; skipping payment initialization check.');
  }

  if (ADMIN_PASSWORD && ADMIN_SECRET_KEY) {
    console.log('Admin credentials found; testing admin login and routes.');
    const login = await request('/api/admin/login', {
      method: 'POST',
      data: { password: ADMIN_PASSWORD },
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('Admin login status:', login.status, login.data?.message || '(no message)');
    assert.strictEqual(login.status, 200, 'Admin login should return 200');
    assert.strictEqual(login.data?.success, true, 'Admin login should succeed');
    assert.ok(login.data?.token, 'Admin login should return a token');

    const token = login.data.token;
    const orders = await request('/api/admin/orders', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    console.log('Admin orders status:', orders.status);
    assert.strictEqual(orders.status, 200, '/api/admin/orders should return 200');
    assert.strictEqual(orders.data?.success, true, '/api/admin/orders should be successful');
    assert.ok(Array.isArray(orders.data.orders), 'Admin orders response should contain an array');

    if (orders.data.orders.length > 0) {
      const sampleOrderId = orders.data.orders[0].order_id;
      const orderFetch = await request(`/api/admin/orders/${encodeURIComponent(sampleOrderId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('Admin single order fetch status:', orderFetch.status);
      assert.strictEqual(orderFetch.status, 200, `/api/admin/orders/${sampleOrderId} should return 200`);
      assert.strictEqual(orderFetch.data?.success, true, 'Single order fetch should succeed');
    }
  } else {
    console.warn('ADMIN_PASSWORD or ADMIN_SECRET_KEY is not set; skipping admin route validation.');
  }

  console.log('E2E script completed. Some checks may have been skipped due to missing env vars.');
}

run().catch((err) => {
  console.error('E2E check failed:', err && err.message ? err.message : err);
  process.exit(1);
});
