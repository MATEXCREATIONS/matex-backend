-- Phase 21 / 22 audit migration for payment workflow and workspace persistence
-- Safe for repeated application: uses IF NOT EXISTS and guarded column additions.

CREATE TABLE IF NOT EXISTS public.matex_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text UNIQUE NOT NULL,
  conversation_id text,
  client_name text,
  client_email text,
  whatsapp_number text,
  service_name text,
  amount numeric(12,2) DEFAULT 0,
  amount_paid numeric(12,2) DEFAULT 0,
  amount_remaining numeric(12,2) DEFAULT 0,
  payment_method text,
  payment_type text,
  payment_plan text,
  payment_status text DEFAULT 'Pending',
  payment_reference text,
  payment_date timestamptz,
  paid_at timestamptz,
  download_access boolean DEFAULT false,
  order_status text DEFAULT 'Pending',
  revision_count integer DEFAULT 0,
  revisions_allowed integer DEFAULT 0,
  revisions_used integer DEFAULT 0,
  revisions_remaining integer DEFAULT 0,
  latest_progress text,
  status_history jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  design_description text,
  brand_name text,
  brand_color text,
  dob text,
  deadline text,
  reference_link text,
  additional_note text,
  currency text DEFAULT 'NGN',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  customer_name text NOT NULL DEFAULT 'Guest',
  customer_email text,
  customer_phone text,
  subject text DEFAULT 'Support inquiry',
  status text DEFAULT 'open',
  priority text DEFAULT 'normal',
  assigned_admin text,
  unread_admin_count integer DEFAULT 0,
  unread_customer_count integer DEFAULT 0,
  source text,
  service text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_message_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.matex_chat_conversations(id) ON DELETE CASCADE,
  sender text NOT NULL,
  sender_name text,
  sender_email text,
  body text NOT NULL,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_order_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  filename text NOT NULL,
  storage_path text,
  public_url text,
  uploaded_by text,
  uploaded_at timestamptz DEFAULT now(),
  delivery_status text DEFAULT 'pending',
  notify_sent boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.matex_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  title text,
  notes text,
  status text DEFAULT 'requested',
  revisions_used integer DEFAULT 0,
  revisions_remaining integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_support_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_name text,
  visitor_email text,
  whatsapp text,
  subject text,
  message text,
  status text DEFAULT 'new',
  priority text DEFAULT 'normal',
  assigned_admin text,
  unread_count integer DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number text UNIQUE,
  customer_name text,
  customer_email text,
  issue_summary text,
  suggested_action text,
  priority text DEFAULT 'normal',
  status text DEFAULT 'unread',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  reference text,
  amount numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'NGN',
  status text DEFAULT 'pending',
  provider text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id text NOT NULL UNIQUE,
  order_id text NOT NULL,
  reference text,
  path text,
  amount_paid numeric(12,2) DEFAULT 0,
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS public.matex_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text,
  type text,
  title text,
  message text,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

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

ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS currency text DEFAULT 'NGN';
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS conversation_id text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS latest_progress text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS status_history jsonb;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS design_description text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS brand_name text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS brand_color text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS dob text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS deadline text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS reference_link text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS additional_note text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS payment_plan text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS amount_remaining numeric(12,2) DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_allowed integer DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_used integer DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_remaining integer DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revision_count integer DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS download_access boolean DEFAULT false;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS order_status text DEFAULT 'Pending';
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'Pending';
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS payment_date timestamptz;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS unread_admin_count integer DEFAULT 0;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS unread_customer_count integer DEFAULT 0;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS service text;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT now();
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.matex_chat_messages ADD COLUMN IF NOT EXISTS sender_email text;
ALTER TABLE public.matex_chat_messages ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;

ALTER TABLE public.matex_order_files ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'pending';
ALTER TABLE public.matex_order_files ADD COLUMN IF NOT EXISTS notify_sent boolean DEFAULT false;

ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS revisions_used integer DEFAULT 0;
ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS revisions_remaining integer DEFAULT 0;

ALTER TABLE public.matex_support_conversations ADD COLUMN IF NOT EXISTS assigned_admin text;
ALTER TABLE public.matex_support_conversations ADD COLUMN IF NOT EXISTS unread_count integer DEFAULT 1;

ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS reference_number text;
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS customer_email text;
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS issue_summary text;
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS suggested_action text;
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal';
ALTER TABLE public.matex_ai_reports ADD COLUMN IF NOT EXISTS status text DEFAULT 'unread';

CREATE INDEX IF NOT EXISTS idx_matex_orders_order_id ON public.matex_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_orders_created_at ON public.matex_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matex_orders_payment_status ON public.matex_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_matex_orders_download_access ON public.matex_orders(download_access);
CREATE INDEX IF NOT EXISTS idx_matex_chat_conversations_order_id ON public.matex_chat_conversations(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_chat_messages_conversation_id ON public.matex_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_matex_order_files_order_id ON public.matex_order_files(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_support_conversations_status ON public.matex_support_conversations(status);
CREATE INDEX IF NOT EXISTS idx_matex_ai_reports_status ON public.matex_ai_reports(status);
CREATE INDEX IF NOT EXISTS idx_matex_receipts_order_id ON public.matex_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_receipts_receipt_id ON public.matex_receipts(receipt_id);
CREATE INDEX IF NOT EXISTS idx_matex_reviews_status ON public.matex_reviews(status);
CREATE INDEX IF NOT EXISTS idx_matex_notifications_order_id ON public.matex_notifications(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_history_order_id ON public.matex_history(order_id);
