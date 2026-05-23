import axios from 'axios';

const BASE = 'http://localhost:5001';
const ADMIN_PASSWORD = 'MatexAdmin2026'; // matches matex-backend/.env

function log(...args){ console.log('[e2e]', ...args); }

async function run(){
  try{
    log('1) Creating brief (guest)');
    const orderId = 'test-e2e-001';
    const briefResp = await axios.post(`${BASE}/api/orders/brief`, {
      order_id: orderId,
      client_name: 'E2E Tester',
      client_email: 'e2e@example.com',
      service_name: 'Logo Design',
      amount: 4500,
      payment_type: 'full',
      design_description: 'Test order from E2E script'
    }, { timeout: 10000 });
    log('brief saved:', briefResp.data && briefResp.data.order && briefResp.data.order.order_id);

    log('2) Tracking order (should be Pending)');
    const track = await axios.get(`${BASE}/api/orders/track/${orderId}`);
    log('track response status:', track.data && track.data.order && track.data.order.order_status);
    if(String(track.data.order.order_status).toLowerCase() !== 'pending'){
      throw new Error(`Expected order_status 'Pending' but got '${track.data.order.order_status}'`);
    }

    log('3) Attempt admin login');
    const login = await axios.post(`${BASE}/api/admin/login`, { password: ADMIN_PASSWORD });
    if(!login.data || !login.data.token) throw new Error('Admin login failed');
    const token = login.data.token;
    log('admin token obtained');

    log('4) Fetch admin orders and confirm our order exists');
    const adminOrders = await axios.get(`${BASE}/api/admin/orders`, { headers: { Authorization: `Bearer ${token}` } });
    const found = (adminOrders.data.orders || []).find(o => o.order_id === orderId);
    if(!found) throw new Error('Order not present in admin orders');
    log('order found in admin list');

    log('5) Ensure public status update is now protected (attempt without auth should fail)');
    let unauthFailed = false;
    try{
      await axios.put(`${BASE}/api/orders/${orderId}/status`, { status: 'Accepted' }, { timeout: 8000 });
    }catch(err){
      unauthFailed = true;
      log('unauthenticated update failed as expected:', err.response && err.response.status);
    }
    if(!unauthFailed) throw new Error('Public status update unexpectedly succeeded (should be protected)');

    log('6) Update order status as admin via protected route');
    const update = await axios.put(`${BASE}/api/orders/${orderId}/status`, { status: 'Accepted', message: 'Admin accepted order' }, { headers: { Authorization: `Bearer ${token}` } });
    if(!update.data || !update.data.success) throw new Error('Admin status update failed');
    log('admin status update response:', update.data.message || 'ok');

    log('7) Re-check order status (should be Accepted)');
    const track2 = await axios.get(`${BASE}/api/orders/track/${orderId}`);
    log('status after admin update:', track2.data.order.order_status);
    if(String(track2.data.order.order_status).toLowerCase() !== 'accepted'){
      throw new Error('Order status did not change to Accepted');
    }

    log('E2E tests passed');
    process.exit(0);
  }catch(err){
    console.error('[e2e] ERROR', err && (err.response?.data || err.message || err));
    process.exit(2);
  }
}

run();
