import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, TrendingUp, TrendingDown, Activity } from 'lucide-react';

const MOCK_HOT_STOCKS = [
  { code: '600519.SS', name: '贵州茅台', price: 1700.00, change: 12.50, percent: 0.74 },
  { code: '300750.SZ', name: '宁德时代', price: 185.20, change: 5.30, percent: 2.94 },
  { code: '000001.SZ', name: '平安银行', price: 10.50, change: -0.12, percent: -1.13 },
  { code: '601318.SS', name: '中国平安', price: 45.20, change: 0.80, percent: 1.80 },
  { code: '002594.SZ', name: '比亚迪', price: 210.10, change: 3.50, percent: 1.69 },
  { code: '600036.SS', name: '招商银行', price: 32.20, change: -0.40, percent: -1.23 },
];

const MOCK_MARKET_OVERVIEW = [
  { name: '上证指数', value: 3050.50, change: 15.20, percent: 0.50 },
  { name: '深证成指', value: 10000.20, change: 80.50, percent: 0.81 },
  { name: '创业板指', value: 2000.10, change: -10.30, percent: -0.51 },
];

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const navigate = useNavigate();

  const prefetchStockSnapshot = (code: string) => {
    void fetch(`/api/stock/${encodeURIComponent(code)}`).catch((error) => {
      console.error('Prefetch stock snapshot failed', error);
    });
  };

  const goToStock = async (input: string, fallbackCode?: string) => {
    const normalizedInput = input.trim();
    if (!normalizedInput) return;

    setSearching(true);
    setSearchError('');
    try {
      const response = await fetch(`/api/stock/resolve?q=${encodeURIComponent(normalizedInput)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || '无法识别该股票');
      }

      const resolvedCode = data.stock?.code || fallbackCode || normalizedInput.toUpperCase();
      prefetchStockSnapshot(resolvedCode);
      navigate(`/stock/${resolvedCode}`);
    } catch (error) {
      if (fallbackCode) {
        prefetchStockSnapshot(fallbackCode);
        navigate(`/stock/${fallbackCode}`);
        return;
      }
      console.error('Resolve stock failed', error);
      setSearchError(error instanceof Error ? error.message : '未找到对应股票，请换个代码或名称试试');
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      await goToStock(searchQuery);
    }
  };

  return (
    <div className="space-y-10">
      {/* Hero Section with Search */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-10 text-center">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">
          专业的 AI 股票分析
        </h1>
        <p className="text-lg text-slate-500 mb-8 max-w-2xl mx-auto">
          由先进的 AI 大模型驱动，提供全面的技术面、基本面和市场情绪分析，助您做出明智的投资决策。
        </p>
        
        <form onSubmit={handleSearch} className="max-w-2xl mx-auto relative">
          <div className="relative flex items-center">
            <Search className="absolute left-4 text-slate-400 h-6 w-6" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="输入股票代码或名称 (如 600519、000001、贵州茅台)..."
              disabled={searching}
              className="w-full pl-14 pr-32 py-4 rounded-full border-2 border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20 text-lg transition-all"
            />
            <button
              type="submit"
              disabled={searching}
              className="absolute right-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-full font-medium transition-colors"
            >
              {searching ? '查找中...' : '分析'}
            </button>
          </div>
          {searchError && <p className="mt-3 text-sm text-red-500">{searchError}</p>}
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Market Overview */}
        <div className="lg:col-span-1 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600" />
              大盘概览
            </h2>
          </div>
          <div className="space-y-4">
            {MOCK_MARKET_OVERVIEW.map((idx) => (
              <div key={idx.name} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-slate-700">{idx.name}</h3>
                  <p className="text-2xl font-bold text-slate-900">{idx.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
                <div className={`text-right ${idx.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  <div className="flex items-center justify-end gap-1 font-medium">
                    {idx.percent >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {idx.percent > 0 ? '+' : ''}{idx.percent}%
                  </div>
                  <div className="text-sm">
                    {idx.change > 0 ? '+' : ''}{idx.change}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Hot Stocks */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-500" />
              热门股票
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MOCK_HOT_STOCKS.map((stock) => (
              <div 
                key={stock.code} 
                onClick={() => void goToStock(stock.code, stock.code)}
                className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex justify-between items-center group"
              >
                <div>
                  <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{stock.code}</h3>
                  <p className="text-sm text-slate-500 truncate w-32">{stock.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">¥{stock.price.toFixed(2)}</p>
                  <p className={`text-sm font-medium flex items-center justify-end gap-1 ${stock.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {stock.percent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {stock.percent > 0 ? '+' : ''}{stock.percent}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
