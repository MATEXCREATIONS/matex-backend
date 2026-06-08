-- Create table to store order delivery files and version history
CREATE TABLE IF NOT EXISTS matex_order_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id VARCHAR(255) NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  bucket_name TEXT NOT NULL DEFAULT 'order-deliveries',
  mime_type VARCHAR(255),
  file_size BIGINT,
  version_label VARCHAR(255), -- e.g. Draft V1, Draft V2, Final Design
  uploaded_by VARCHAR(255), -- admin email or id
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  delivery_status VARCHAR(50) DEFAULT 'Delivered' NOT NULL,
  notify_sent BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  FOREIGN KEY (order_id) REFERENCES matex_orders(order_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_files_order_id ON matex_order_files(order_id);
CREATE INDEX IF NOT EXISTS idx_order_files_uploaded_at ON matex_order_files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_files_version_label ON matex_order_files(version_label);
