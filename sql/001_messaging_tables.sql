-- Matex messaging and file delivery schema
CREATE TABLE IF NOT EXISTS public.matex_chat_conversations (
  id uuid PRIMARY KEY,
  customer_name text,
  customer_email text,
  customer_phone text,
  subject text,
  status text DEFAULT 'open',
  source text DEFAULT 'website',
  order_id text,
  unread_admin_count integer DEFAULT 0,
  unread_customer_count integer DEFAULT 0,
  last_message_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_chat_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES public.matex_chat_conversations(id) ON DELETE CASCADE,
  sender text,
  sender_name text,
  sender_email text,
  body text,
  metadata jsonb,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matex_order_files (
  id uuid PRIMARY KEY,
  order_id text NOT NULL,
  file_name text,
  storage_path text,
  bucket_name text,
  mime_type text,
  file_size bigint,
  version_label text,
  uploaded_by text,
  uploaded_at timestamptz DEFAULT now(),
  delivery_status text DEFAULT 'Delivered',
  notify_sent boolean DEFAULT false,
  metadata jsonb
);

CREATE TABLE IF NOT EXISTS public.matex_revisions (
  id uuid PRIMARY KEY,
  order_id text NOT NULL,
  customer_message text,
  admin_reply text,
  status text DEFAULT 'Pending',
  revisions_used integer DEFAULT 0,
  revisions_remaining integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_allowed integer DEFAULT 1;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_used integer DEFAULT 0;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revisions_remaining integer DEFAULT 1;
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS revision_count integer DEFAULT 1;
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
ALTER TABLE public.matex_orders ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS unread_admin_count integer DEFAULT 0;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS unread_customer_count integer DEFAULT 0;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS last_message_at timestamptz;
ALTER TABLE public.matex_chat_conversations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.matex_chat_messages ADD COLUMN IF NOT EXISTS conversation_id uuid;
ALTER TABLE public.matex_chat_messages ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false;

ALTER TABLE public.matex_order_files ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'Delivered';
ALTER TABLE public.matex_order_files ADD COLUMN IF NOT EXISTS notify_sent boolean DEFAULT false;
ALTER TABLE public.matex_order_files ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS revisions_used integer DEFAULT 0;
ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS revisions_remaining integer DEFAULT 0;
ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE public.matex_revisions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_matex_chat_messages_conversation_id ON public.matex_chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_matex_order_files_order_id ON public.matex_order_files(order_id);
CREATE INDEX IF NOT EXISTS idx_matex_revisions_order_id ON public.matex_revisions(order_id);
