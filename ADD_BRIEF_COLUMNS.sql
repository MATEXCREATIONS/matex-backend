-- Add missing project brief fields to matex_orders table
-- Run this in Supabase SQL Editor after CREATE_ORDERS_TABLE.sql

ALTER TABLE public.matex_orders
ADD COLUMN IF NOT EXISTS design_description text,
ADD COLUMN IF NOT EXISTS whatsapp_number text,
ADD COLUMN IF NOT EXISTS brand_name text,
ADD COLUMN IF NOT EXISTS brand_color text,
ADD COLUMN IF NOT EXISTS dob text,
ADD COLUMN IF NOT EXISTS deadline text,
ADD COLUMN IF NOT EXISTS reference_link text,
ADD COLUMN IF NOT EXISTS additional_note text;

-- Create indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_matex_orders_whatsapp ON public.matex_orders(whatsapp_number);
CREATE INDEX IF NOT EXISTS idx_matex_orders_design ON public.matex_orders(design_description);

COMMENT ON COLUMN public.matex_orders.design_description IS 'Customer project brief and design requirements';
COMMENT ON COLUMN public.matex_orders.whatsapp_number IS 'Customer WhatsApp contact number';
COMMENT ON COLUMN public.matex_orders.brand_name IS 'Brand or business name';
COMMENT ON COLUMN public.matex_orders.brand_color IS 'Brand color preferences';
COMMENT ON COLUMN public.matex_orders.dob IS 'Customer date of birth';
COMMENT ON COLUMN public.matex_orders.deadline IS 'Project delivery deadline';
COMMENT ON COLUMN public.matex_orders.reference_link IS 'Reference URL or inspiration link';
COMMENT ON COLUMN public.matex_orders.additional_note IS 'Additional project notes or instructions';
