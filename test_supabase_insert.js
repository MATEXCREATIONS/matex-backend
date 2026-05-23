import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const orderId = `TEST-${Date.now()}`;
  const payload = {
    order_id: orderId,
    service_name: 'Test Service',
    amount: 1234.56,
    payment_status: 'PAID',
    order_status: 'Pending',
    payment_reference: `TESTREF-${Date.now()}`,
    created_at: new Date().toISOString()
  };

  console.log('Attempting to insert payload into Supabase matex_orders table:');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const { data, error } = await supabase.from('matex_orders').insert([payload]);
    console.log('Supabase response data:', JSON.stringify(data, null, 2));
    console.log('Supabase response error:', JSON.stringify(error, null, 2));
    if (error) process.exit(2);
    console.log('Insert successful');
  } catch (err) {
    console.error('Insert exception:', err.message || err);
    process.exit(3);
  }
}

run();
