-- Add conversation_id column to matex_orders table to link orders to chat conversations
-- This allows customers to have order-linked conversations

ALTER TABLE IF EXISTS matex_orders
ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES matex_chat_conversations(id) ON DELETE SET NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_conversation_id ON matex_orders(conversation_id);

-- Optionally backfill existing orders with default conversation if needed
-- (This would require manual setup in the admin UI)
