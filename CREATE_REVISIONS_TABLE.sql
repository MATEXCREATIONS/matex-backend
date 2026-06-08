-- Create Revisions table for tracking revision requests
CREATE TABLE IF NOT EXISTS matex_revisions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  customer_message TEXT NOT NULL,
  admin_reply TEXT,
  status VARCHAR(50) DEFAULT 'Pending' NOT NULL, -- Pending, Approved, Rejected, Completed
  revisions_used INTEGER DEFAULT 0,
  revisions_remaining INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (order_id) REFERENCES matex_orders(order_id) ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_revisions_order_id ON matex_revisions(order_id);
CREATE INDEX IF NOT EXISTS idx_revisions_status ON matex_revisions(status);
CREATE INDEX IF NOT EXISTS idx_revisions_created_at ON matex_revisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revisions_order_status ON matex_revisions(order_id, status);

-- Add trigger to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_revisions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_revisions_updated_at
  BEFORE UPDATE ON matex_revisions
  FOR EACH ROW
  EXECUTE FUNCTION update_revisions_timestamp();
