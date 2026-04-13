import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Link, useNavigate } from 'react-router-dom';
import { Wallet, TrendingUp, TrendingDown, Clock, ArrowRight } from 'lucide-react';

export default function Portfolio() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [portfolioData, setPortfolioData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchPortfolio();
    }
  }, [user]);

  const fetchPortfolio = async () => {
    try {
      const res = await fetch(`/api/trade/portfolio/${user?.id}`);
      const data = await res.json();
      if (data.success) {
        setPortfolioData(data);
      }
    } catch (error) {
      console.error('Failed to fetch portfolio', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看您的模拟盘</h2>
        <Link to="/login" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium">去登录</Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const { portfolio, positions, trades } = portfolioData || { portfolio: null, positions: [], trades: [] };
  const initialBalance = 100000.00;
  const totalProfitLoss = portfolio ? portfolio.total_value - initialBalance : 0;
  const totalProfitLossPercent = portfolio ? (totalProfitLoss / initialBalance) * 100 : 0;
  const isOverallPositive = totalProfitLoss >= 0;

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Wallet className="h-8 w-8 text-blue-600" /> 我的模拟盘 (Paper Trading)
        </h1>
      </div>

      {/* Account Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-sm text-slate-500 font-medium mb-1">总资产</p>
          <p className="text-3xl font-bold text-slate-900">¥{portfolio?.total_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</p>
          <div className={`mt-2 text-sm font-medium flex items-center gap-1 ${isOverallPositive ? 'text-red-500' : 'text-green-500'}`}>
            {isOverallPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isOverallPositive ? '+' : ''}{totalProfitLoss.toFixed(2)} ({isOverallPositive ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%)
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-sm text-slate-500 font-medium mb-1">可用资金</p>
          <p className="text-3xl font-bold text-slate-900">¥{portfolio?.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}</p>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <p className="text-sm text-slate-500 font-medium mb-1">持仓市值</p>
          <p className="text-3xl font-bold text-slate-900">¥{((portfolio?.total_value || 0) - (portfolio?.balance || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Current Positions */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800">当前持仓</h2>
          <Link to="/" className="text-blue-600 text-sm font-medium hover:text-blue-700 flex items-center gap-1">
            去交易 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        
        {positions.length === 0 ? (
          <div className="p-12 text-center">
            <Wallet className="h-12 w-12 text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500">当前无持仓股票，快去寻找投资机会吧！</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 text-sm">
                <tr>
                  <th className="p-4 font-medium">股票代码</th>
                  <th className="p-4 font-medium">股票名称</th>
                  <th className="p-4 font-medium text-right">持股数量</th>
                  <th className="p-4 font-medium text-right">成本价</th>
                  <th className="p-4 font-medium text-right">现价</th>
                  <th className="p-4 font-medium text-right">持仓市值</th>
                  <th className="p-4 font-medium text-right">浮动盈亏</th>
                  <th className="p-4 font-medium text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {positions.map((pos: any) => {
                  const isPos = pos.profit_loss >= 0;
                  return (
                    <tr key={pos.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 font-medium text-slate-900">{pos.stock_code}</td>
                      <td className="p-4 text-slate-600">{pos.stock_name}</td>
                      <td className="p-4 text-right font-medium">{pos.quantity}</td>
                      <td className="p-4 text-right">¥{pos.average_price.toFixed(2)}</td>
                      <td className="p-4 text-right">¥{pos.current_price.toFixed(2)}</td>
                      <td className="p-4 text-right font-medium">¥{pos.current_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                      <td className={`p-4 text-right font-medium ${isPos ? 'text-red-500' : 'text-green-500'}`}>
                        {isPos ? '+' : ''}{pos.profit_loss.toFixed(2)} ({isPos ? '+' : ''}{pos.profit_loss_percent.toFixed(2)}%)
                      </td>
                      <td className="p-4 text-center">
                        <button 
                          onClick={() => navigate(`/stock/${pos.stock_code}`)}
                          className="text-blue-600 hover:text-blue-800 font-medium text-sm px-3 py-1 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                        >
                          交易
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trade History */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" /> 交易记录 (近10条)
          </h2>
        </div>
        
        {trades.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500">暂无交易记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 text-sm">
                <tr>
                  <th className="p-4 font-medium">时间</th>
                  <th className="p-4 font-medium">股票</th>
                  <th className="p-4 font-medium">方向</th>
                  <th className="p-4 font-medium text-right">成交价</th>
                  <th className="p-4 font-medium text-right">数量</th>
                  <th className="p-4 font-medium text-right">成交额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trades.map((trade: any) => (
                  <tr key={trade.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 text-sm text-slate-500">
                      {new Date(trade.trade_date).toLocaleString('zh-CN', { hour12: false })}
                    </td>
                    <td className="p-4">
                      <span className="font-medium text-slate-900">{trade.stock_name}</span>
                      <span className="text-xs text-slate-500 ml-2">{trade.stock_code}</span>
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        trade.trade_type === 'BUY' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {trade.trade_type === 'BUY' ? '买入' : '卖出'}
                      </span>
                    </td>
                    <td className="p-4 text-right font-medium">¥{trade.price.toFixed(2)}</td>
                    <td className="p-4 text-right">{trade.quantity}</td>
                    <td className="p-4 text-right font-medium">¥{trade.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}