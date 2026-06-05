-- Production-ready table creation for Matex reviews
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.matex_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company text,
  rating integer NOT NULL DEFAULT 5,
  message text NOT NULL,
  status text DEFAULT 'Pending',
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matex_reviews_status ON public.matex_reviews(status);
CREATE INDEX IF NOT EXISTS idx_matex_reviews_created_at ON public.matex_reviews(created_at);

ALTER TABLE public.matex_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read approved reviews" ON public.matex_reviews;
DROP POLICY IF EXISTS "Allow admin full access" ON public.matex_reviews;

CREATE POLICY "Allow public read approved reviews"
  ON public.matex_reviews FOR SELECT
  TO public
  USING (status = 'Approved');

CREATE POLICY "Allow admin full access"
  ON public.matex_reviews FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.matex_reviews IS 'Customer testimonials and reviews';
COMMENT ON COLUMN public.matex_reviews.full_name IS 'Reviewer full name';
COMMENT ON COLUMN public.matex_reviews.company IS 'Company or business name (optional)';
COMMENT ON COLUMN public.matex_reviews.rating IS 'Star rating from 1-5';
COMMENT ON COLUMN public.matex_reviews.message IS 'Review text/testimonial';
COMMENT ON COLUMN public.matex_reviews.status IS 'Approval status: Pending, Approved, Rejected';
