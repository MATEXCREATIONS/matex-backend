-- Supabase / Postgres schema for reviews used by the Matex backend
-- Run this in Supabase SQL editor (or psql) against your project database

CREATE TABLE IF NOT EXISTS public.matex_reviews (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  company text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'Pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Optional: create an index for status to speed queries
CREATE INDEX IF NOT EXISTS idx_matex_reviews_status ON public.matex_reviews(status);
