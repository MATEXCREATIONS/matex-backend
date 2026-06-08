-- Migration: Add separate status_history field to matex_orders
-- Run this in Supabase SQL Editor or your database migration runner.

ALTER TABLE IF EXISTS public.matex_orders
  ADD COLUMN IF NOT EXISTS status_history jsonb;

COMMENT ON COLUMN public.matex_orders.status_history IS 'Ordered history of individual status updates and progress notes for the order';
