-- 003_missing_admin_tables.sql
-- Create missing tables required by admin and backend features.

CREATE TABLE IF NOT EXISTS public.matex_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id text NOT NULL UNIQUE,
  order_id text NOT NULL,
  reference text,
  path text,
  amount_paid numeric DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_receipts_order_id ON public.matex_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_receipts_receipt_id ON public.matex_receipts(receipt_id);

CREATE TABLE IF NOT EXISTS public.matex_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text,
  company text,
  rating integer,
  message text,
  status text DEFAULT 'Pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_reviews_status ON public.matex_reviews(status);
CREATE INDEX IF NOT EXISTS idx_matex_reviews_created_at ON public.matex_reviews(created_at);

CREATE TABLE IF NOT EXISTS public.matex_email_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_email text,
  subject text,
  body text,
  html text,
  order_id text,
  message_id text,
  in_reply_to text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_email_replies_order_id ON public.matex_email_replies(order_id);

CREATE TABLE IF NOT EXISTS public.matex_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  event_type text,
  message text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_notifications_order_id ON public.matex_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_notifications_event_type ON public.matex_notifications(event_type);
