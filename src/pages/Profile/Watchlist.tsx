import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Link, useNavigate } from 'react-router-dom';
import { Star, TrendingUp, TrendingDown, ArrowRight, RefreshCw, Trash2 } from 'lucide-react';

const formatMoney = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

export default function Watchlist() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const risingCount = useMemo(
    () => watchlist.filter((item) => typeof item.changePercent === 'number' && item.changePercent >= 0).length,
    [watchlist],
  );
  const fallingCount = Math.max(watchlist.length - risingCount, 0);

  useEffect(() => {
    if (!user) return;
    fetchWatchlist(false);

    const timer = window.setInterval(() => {
      fetchWatchlist(true);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [user?.id]);

  const fetchWatchlist = async (silent: boolean) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch(`/api/stock/watchlist/${user?.id}`);
      const data = await response.json();
      if (data.success) {
        setWatchlist(data.watchlist || []);
      }
    } catch (error) {
      console.error('Failed to fetch watchlist', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/stock/watchlist/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success) {
        fetchWatchlist(true);
      }
    } catch (error) {
      console.error('Failed to delete watchlist item', error);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看自选股</h2>
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

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
          <Star className="h-8 w-8 text-yellow-500 fill-yellow-500" /> 我的自选股
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchWatchlist(true)}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-xl border border-blue-200 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
          <Link to="/" className="text-blue-600 font-medium hover:text-blue-700 flex items-center gap-1">
            添加股票 <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">自选总数</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{watchlist.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">上涨家数</p>
          <p className="mt-2 text-3xl font-bold text-red-500">{risingCount}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">下跌家数</p>
          <p className="mt-2 text-3xl font-bold text-green-500">{fallingCount}</p>
        </div>
      </div>

      {watchlist.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl shadow-sm border border-slate-100 text-center">
          <Star className="h-16 w-16 text-slate-200 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-700 mb-2">您的自选股列表为空</h2>
          <p className="text-slate-500 mb-6">搜索股票并将其添加到您的自选股中以跟踪其表现。</p>
          <Link to="/" className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors">
            发现股票
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="grid grid-cols-[1.2fr_1.3fr_0.8fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-4 text-sm font-medium text-slate-500">
            <div>股票</div>
            <div>名称 / 状态</div>
            <div className="text-right">现价</div>
            <div className="text-right">涨跌额</div>
            <div className="text-right">涨跌幅</div>
            <div className="text-center">板块</div>
            <div className="text-center">操作</div>
          </div>
          {watchlist.map((stock) => (
            <div
              key={stock.code} 
              onClick={() => navigate(`/stock/${stock.code}`)}
              className="grid cursor-pointer grid-cols-[1.2fr_1.3fr_0.8fr_0.8fr_0.8fr_0.9fr_0.8fr] gap-4 border-b border-slate-100 px-5 py-4 transition-all hover:bg-slate-50/80 group"
            >
              <div>
                <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors text-lg">{stock.stock_code || stock.code}</h3>
              </div>
              <div>
                <p className="font-medium text-slate-900">{stock.stock_name || stock.name}</p>
                <p className="mt-1 text-xs text-slate-500">{stock.marketStateLabel || '--'}</p>
              </div>
              <div className="text-right font-semibold text-slate-900">
                ¥{formatMoney(stock.price)}
              </div>
              <div className={`text-right font-medium ${stock.change >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                {stock.change >= 0 ? '+' : ''}{formatMoney(stock.change)}
              </div>
              <div className={`text-right font-medium ${stock.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                <span className="inline-flex items-center justify-end gap-1">
                  {stock.changePercent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {stock.changePercent >= 0 ? '+' : ''}{stock.changePercent?.toFixed(2)}%
                </span>
              </div>
              <div className="text-center">
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  {stock.boardName || '--'}
                </span>
              </div>
              <div className="flex items-center justify-center">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDelete(stock.id);
                  }}
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="移除自选"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
