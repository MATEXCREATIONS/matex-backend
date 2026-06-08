-- Create chat persistence tables for Matex live messaging and admin inbox

CREATE TABLE IF NOT EXISTS matex_chat_conversations (
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
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_chat_conversations_last_message_at
  ON matex_chat_conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS matex_chat_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid REFERENCES matex_chat_conversations(id) ON DELETE CASCADE,
  sender text NOT NULL,
  sender_name text,
  sender_email text,
  body text NOT NULL,
  metadata jsonb,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_chat_messages_conversation_id
  ON matex_chat_messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_matex_chat_messages_created_at
  ON matex_chat_messages(created_at ASC);
