-- Safe Supabase migration for new matex_orders table
-- Creates a new production-ready order table without touching the legacy orders table.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.matex_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text UNIQUE NOT NULL,
  client_name text,
  client_email text,
  service_name text,
  amount numeric,
  payment_status text,
  order_status text,
  payment_reference text,
  payment_type text,
  revision_count int,
  latest_progress text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_matex_orders_order_id ON public.matex_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_orders_client_email ON public.matex_orders(client_email);
CREATE INDEX IF NOT EXISTS idx_matex_orders_payment_reference ON public.matex_orders(payment_reference);

ALTER TABLE public.matex_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access" ON public.matex_orders;
DROP POLICY IF EXISTS "Allow backend write access" ON public.matex_orders;

CREATE POLICY "Allow public read access"
  ON public.matex_orders FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow backend write access"
  ON public.matex_orders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
