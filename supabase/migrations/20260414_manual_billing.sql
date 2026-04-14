CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  order_no VARCHAR(40) UNIQUE NOT NULL,
  plan_type VARCHAR(20) NOT NULL CHECK (plan_type IN ('basic', 'premium')),
  amount DECIMAL(10,2) NOT NULL,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('qq')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'paid', 'cancelled', 'rejected')),
  payer_name VARCHAR(100),
  note TEXT,
  contact_snapshot JSONB,
  paid_at TIMESTAMP WITH TIME ZONE,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);
CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at ON payment_orders(created_at DESC);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

GRANT ALL PRIVILEGES ON payment_orders TO authenticated;

CREATE POLICY "Allow anon insert on payment_orders" ON payment_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select on payment_orders" ON payment_orders FOR SELECT USING (true);
CREATE POLICY "Allow anon update on payment_orders" ON payment_orders FOR UPDATE USING (true);
