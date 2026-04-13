-- Paper Trading Schema (模拟盘)

-- 1. Portfolio Table (用户模拟盘资金账户)
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(15,2) DEFAULT 100000.00, -- 默认初始资金10万
  total_value DECIMAL(15,2) DEFAULT 100000.00,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX idx_portfolios_user_id ON portfolios(user_id);

-- 2. Positions Table (当前持仓)
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stock_code VARCHAR(20) NOT NULL,
  stock_name VARCHAR(100) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0, -- 持股数量
  average_price DECIMAL(10,2) NOT NULL DEFAULT 0.00, -- 成本价
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, stock_code)
);

CREATE INDEX idx_positions_user_id ON positions(user_id);
CREATE INDEX idx_positions_stock_code ON positions(stock_code);

-- 3. Trade History Table (交易记录流水)
CREATE TABLE trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stock_code VARCHAR(20) NOT NULL,
  stock_name VARCHAR(100) NOT NULL,
  trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(15,2) NOT NULL,
  trade_date TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_trades_user_id ON trades(user_id);
CREATE INDEX idx_trades_date ON trades(trade_date DESC);

-- Permissions
GRANT ALL PRIVILEGES ON portfolios TO authenticated;
GRANT ALL PRIVILEGES ON positions TO authenticated;
GRANT ALL PRIVILEGES ON trades TO authenticated;
