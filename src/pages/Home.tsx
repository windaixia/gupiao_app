import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, TrendingUp, TrendingDown, Activity } from 'lucide-react';

const STOCK_NAME_ALIASES: Record<string, string> = {
  '贵州茅台': '600519.SS',
  '茅台': '600519.SS',
  '宁德时代': '300750.SZ',
  '平安银行': '000001.SZ',
  '中国平安': '601318.SS',
  '比亚迪': '002594.SZ',
  '招商银行': '600036.SS',
  '五粮液': '000858.SZ',
  '东方财富': '300059.SZ',
  '隆基绿能': '601012.SS',
};

const normalizeDirectStockCode = (input: string) => {
  const value = input.trim().toUpperCase();
  if (/^6\d{5}$/.test(value)) return `${value}.SS`;
  if (/^(0|3)\d{5}$/.test(value)) return `${value}.SZ`;
  if (/^(4|8)\d{5}$/.test(value)) return `${value}.BJ`;
  if (/^\d{6}\.(SS|SZ|BJ)$/.test(value)) return value;
  return null;
};

export default function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');
  const [marketOverview, setMarketOverview] = useState<any[]>([]);
  const [hotStocks, setHotStocks] = useState<any[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const loadHomeMarket = async () => {
      setMarketLoading(true);
      setMarketError('');
      try {
        const response = await fetch('/api/stock/home');
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || '加载首页行情失败');
        }
        setMarketOverview(data.overview || []);
        setHotStocks(data.hotStocks || []);
      } catch (error) {
        console.error('Load home market failed', error);
        setMarketError('首页行情加载失败，请稍后刷新重试。');
      } finally {
        setMarketLoading(false);
      }
    };

    void loadHomeMarket();
  }, []);

  const prefetchStockSnapshot = (code: string) => {
    void fetch(`/api/stock/${encodeURIComponent(code)}`).catch((error) => {
      console.error('Prefetch stock snapshot failed', error);
    });
  };

  const goToStock = async (input: string, fallbackCode?: string, options?: { immediate?: boolean }) => {
    const normalizedInput = input.trim();
    if (!normalizedInput) return;

    const aliasCode = STOCK_NAME_ALIASES[normalizedInput];
    const directCode = normalizeDirectStockCode(normalizedInput);
    const instantCode = fallbackCode || aliasCode || directCode;

    if (options?.immediate && instantCode) {
      prefetchStockSnapshot(instantCode);
      navigate(`/stock/${instantCode}`);
      return;
    }

    setSearching(true);
    setSearchError('');
    try {
      if (instantCode) {
        prefetchStockSnapshot(instantCode);
        navigate(`/stock/${instantCode}`);
        return;
      }

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
      await goToStock(searchQuery, undefined, { immediate: true });
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
              className="w-full pl-14 pr-32 py-4 rounded-full border-2 border-slate-200 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20 text-lg transition-all"
            />
            <button
              type="submit"
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
          {marketError && <p className="text-sm text-red-500">{marketError}</p>}
          <div className="space-y-4">
            {(marketLoading ? Array.from({ length: 3 }).map((_, index) => ({ name: `skeleton-${index}` })) : marketOverview).map((idx: any) => (
              <div key={idx.name} className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 flex justify-between items-center">
                <div>
                  <h3 className="font-semibold text-slate-700">{marketLoading ? '加载中...' : idx.name}</h3>
                  <p className="text-2xl font-bold text-slate-900">
                    {marketLoading ? '--' : idx.value?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className={`text-right ${marketLoading ? 'text-slate-400' : idx.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  <div className="flex items-center justify-end gap-1 font-medium">
                    {marketLoading ? <Activity className="h-4 w-4" /> : idx.percent >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {marketLoading ? '--' : `${idx.percent > 0 ? '+' : ''}${idx.percent}%`}
                  </div>
                  <div className="text-sm">
                    {marketLoading ? '--' : `${idx.change > 0 ? '+' : ''}${idx.change}`}
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
            {(marketLoading ? Array.from({ length: 6 }).map((_, index) => ({ code: `skeleton-${index}` })) : hotStocks).map((stock: any) => (
              <div 
                key={stock.code} 
                onClick={() => !marketLoading && void goToStock(stock.code, stock.code, { immediate: true })}
                className={`bg-white p-5 rounded-xl shadow-sm border border-slate-100 transition-all flex justify-between items-center group ${marketLoading ? 'opacity-70' : 'hover:shadow-md hover:border-blue-200 cursor-pointer'}`}
              >
                <div>
                  <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">{marketLoading ? '加载中...' : stock.code}</h3>
                  <p className="text-sm text-slate-500 truncate w-32">{marketLoading ? '--' : stock.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900">{marketLoading ? '--' : `¥${Number(stock.price || 0).toFixed(2)}`}</p>
                  <p className={`text-sm font-medium flex items-center justify-end gap-1 ${marketLoading ? 'text-slate-400' : stock.percent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {marketLoading ? <Activity className="h-3 w-3" /> : stock.percent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {marketLoading ? '--' : `${stock.percent > 0 ? '+' : ''}${stock.percent}%`}
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
