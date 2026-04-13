-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  plan VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'premium', 'professional')),
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_plan ON users(plan);

-- 分析历史表
CREATE TABLE analysis_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stock_code VARCHAR(20) NOT NULL,
  analysis_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  analysis_type VARCHAR(50) NOT NULL,
  analysis_params JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_analysis_history_user_id ON analysis_history(user_id);
CREATE INDEX idx_analysis_history_stock_code ON analysis_history(stock_code);
CREATE INDEX idx_analysis_history_date ON analysis_history(analysis_date DESC);

-- 分析结果表
CREATE TABLE analysis_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  history_id UUID REFERENCES analysis_history(id) ON DELETE CASCADE,
  analysis_dimension VARCHAR(50) NOT NULL,
  result_data JSONB NOT NULL,
  confidence_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_analysis_results_history_id ON analysis_results(history_id);
CREATE INDEX idx_analysis_results_dimension ON analysis_results(analysis_dimension);

-- 自选股表
CREATE TABLE watchlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  stock_code VARCHAR(20) NOT NULL,
  stock_name VARCHAR(100) NOT NULL,
  alert_price DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, stock_code)
);

-- 创建索引
CREATE INDEX idx_watchlist_user_id ON watchlist(user_id);
CREATE INDEX idx_watchlist_stock_code ON watchlist(stock_code);

-- 订阅表
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  plan_type VARCHAR(20) NOT NULL CHECK (plan_type IN ('basic', 'premium', 'professional')),
  start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  end_date TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  amount DECIMAL(10,2),
  payment_info JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- 权限设置
-- 匿名用户权限
GRANT SELECT ON users TO anon;
GRANT SELECT ON analysis_history TO anon;
GRANT SELECT ON analysis_results TO anon;

-- 认证用户权限
GRANT ALL PRIVILEGES ON users TO authenticated;
GRANT ALL PRIVILEGES ON analysis_history TO authenticated;
GRANT ALL PRIVILEGES ON analysis_results TO authenticated;
GRANT ALL PRIVILEGES ON watchlist TO authenticated;
GRANT ALL PRIVILEGES ON subscriptions TO authenticated;

-- 为匿名用户提供简单的 RLS 策略 (允许查看，在实际应用中需要根据需求限制)
CREATE POLICY "Allow public read access on users" ON users FOR SELECT USING (true);
CREATE POLICY "Allow public read access on history" ON analysis_history FOR SELECT USING (true);
CREATE POLICY "Allow public read access on results" ON analysis_results FOR SELECT USING (true);

-- 允许匿名用户插入、更新和删除数据（测试用，生产环境应通过后端服务执行或基于认证用户的ID）
CREATE POLICY "Allow anon insert on users" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update on users" ON users FOR UPDATE USING (true);
CREATE POLICY "Allow anon insert on history" ON analysis_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon insert on results" ON analysis_results FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon insert on watchlist" ON watchlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update on watchlist" ON watchlist FOR UPDATE USING (true);
CREATE POLICY "Allow anon delete on watchlist" ON watchlist FOR DELETE USING (true);
CREATE POLICY "Allow anon select on watchlist" ON watchlist FOR SELECT USING (true);
CREATE POLICY "Allow anon insert on subscriptions" ON subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon select on subscriptions" ON subscriptions FOR SELECT USING (true);