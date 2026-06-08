-- Migration: Add missing columns to matex_orders table for payment tracking
-- Run this in your Supabase SQL Editor if columns are missing
-- Safe to run even if columns already exist (uses ALTER TABLE IF NOT EXISTS)

-- Add missing payment-related columns
ALTER TABLE IF EXISTS public.matex_orders
ADD COLUMN IF NOT EXISTS whatsapp_number text,
ADD COLUMN IF NOT EXISTS design_description text,
ADD COLUMN IF NOT EXISTS brand_name text,
ADD COLUMN IF NOT EXISTS brand_color text,
ADD COLUMN IF NOT EXISTS dob text,
ADD COLUMN IF NOT EXISTS deadline text,
ADD COLUMN IF NOT EXISTS reference_link text,
ADD COLUMN IF NOT EXISTS additional_note text,
ADD COLUMN IF NOT EXISTS customer_id integer,
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS metadata jsonb,
ADD COLUMN IF NOT EXISTS revisions_used integer DEFAULT 0;

-- Create indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_matex_orders_status ON public.matex_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_matex_orders_payment_status ON public.matex_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_matex_orders_created_at ON public.matex_orders(created_at DESC);

-- Update RLS policy to allow service role to insert and update
DROP POLICY IF EXISTS "Allow backend write access" ON public.matex_orders;

CREATE POLICY "Allow backend write access"
  ON public.matex_orders FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE public.matex_orders IS 'Main orders table for Matex Creations - tracks service orders, payments, and customer info';

-- Comment on key columns
COMMENT ON COLUMN public.matex_orders.payment_status IS 'Payment status: PAID, FAILED, Pending, Partial (for deposits)';
COMMENT ON COLUMN public.matex_orders.order_status IS 'Order lifecycle status: Pending, Payment Verified, In Queue, Processing, Revision Requested, Almost Complete, Completed, Delivered';
COMMENT ON COLUMN public.matex_orders.payment_reference IS 'Paystack transaction reference number for payment verification';
