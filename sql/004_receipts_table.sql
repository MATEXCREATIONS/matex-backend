-- Add receipts table for order receipt management
CREATE TABLE IF NOT EXISTS public.matex_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id text UNIQUE,
  order_id text NOT NULL,
  download_url text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES public.matex_orders(order_id) ON DELETE CASCADE
);

-- Create index on order_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_matex_receipts_order_id ON public.matex_receipts(order_id);
