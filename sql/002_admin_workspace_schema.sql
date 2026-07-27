-- 002_admin_workspace_schema.sql
-- Add admin workspace related columns and history table

-- Add download control to orders
ALTER TABLE public.matex_orders
  ADD COLUMN IF NOT EXISTS download_access boolean DEFAULT false;

-- Add customer contact fields and admin-friendly columns
ALTER TABLE public.matex_orders
  ADD COLUMN IF NOT EXISTS whatsapp_number text;

ALTER TABLE public.matex_orders
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';

ALTER TABLE public.matex_orders
  ADD COLUMN IF NOT EXISTS category text;

-- Admin action history table
CREATE TABLE IF NOT EXISTS public.matex_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  admin_name text,
  admin_id text,
  action text,
  notes text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_matex_orders_download_access ON public.matex_orders(download_access);
CREATE INDEX IF NOT EXISTS idx_matex_history_order_id ON public.matex_history(order_id);
