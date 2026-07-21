import { createClient } from '@supabase/supabase-js';
import config from '../lib/config.js';

async function main() {
  const { SUPABASE_URL, SUPABASE_KEY } = config;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[inspect_schema] SUPABASE_URL or SUPABASE_KEY not configured. Aborting.');
    process.exit(2);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { schema: 'public' });

  try {
    const sql = `SELECT column_name, data_type, is_nullable, column_default, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'matex_orders'
      ORDER BY ordinal_position;`;

    const res = await supabase.rpc('sql', { query: sql }).catch(() => null);

    // Fallback: use REST RPC via from('pg_catalog') if rpc('sql') not available
    if (!res || res.error) {
      // Try using Postgres function via query endpoint
      const { data, error } = await supabase
        .from('information_schema.columns')
        .select('column_name,data_type,is_nullable,column_default,udt_name')
        .eq('table_name', 'matex_orders')
        .order('ordinal_position', { ascending: true });
      if (error) {
        console.error('[inspect_schema] failed to query information_schema:', error.message || error);
        process.exit(3);
      }
      console.log(JSON.stringify(data, null, 2));
      process.exit(0);
    }

    if (res.error) {
      console.error('[inspect_schema] error:', res.error);
      process.exit(3);
    }

    console.log(JSON.stringify(res.data || res, null, 2));
  } catch (err) {
    console.error('[inspect_schema] unexpected error:', err.message || err);
    process.exit(4);
  }
}

main();
