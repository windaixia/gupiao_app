import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Customized, ReferenceLine, BarChart, Bar } from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Brain,
  Activity,
  BookOpen,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Plus,
  Bell,
  RefreshCw,
  Clock3,
  Newspaper,
  FileText,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const formatMoney = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatVolume = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toString();
};

const formatPercent = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
};

const formatRatio = (value?: number | string | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed.toFixed(2);
    }
    return value;
  }
  return '暂无';
};

const formatPerShareValue = (value?: number | string | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `¥${value.toFixed(2)}`;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return `¥${parsed.toFixed(2)}`;
    }
    return value;
  }
  return '暂无';
};

const truncateText = (value?: string | null, maxLength = 120) => {
  if (!value || !value.trim()) return '';
  const normalized = value.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
};

type ChartMode = 'intraday1m' | 'intraday5m' | 'trend30' | 'dailyK' | 'weeklyK';
type ChartRange = 30 | 60 | 120 | 250;

const CHART_MODE_STORAGE_KEY = 'stock-chart-mode';
const CHART_RANGE_STORAGE_KEY = 'stock-chart-range';

const normalizeChartMode = (value?: string | null): ChartMode => {
  if (value === 'intraday1m' || value === 'intraday5m' || value === 'trend30' || value === 'dailyK' || value === 'weeklyK') {
    return value;
  }
  return 'intraday1m';
};

const normalizeChartRange = (value?: string | null): ChartRange => {
  if (value === '30' || value === '60' || value === '120' || value === '250') {
    return Number(value) as ChartRange;
  }
  return 120;
};

const hasChineseCharacters = (value?: string | null) => Boolean(value && /[\u3400-\u9fff]/.test(value));

const addMovingAverageSeries = (points: any[]) =>
  points.map((point, index) => {
    const calc = (windowSize: number) => {
      if (index + 1 < windowSize) return null;
      const windowPoints = points.slice(index + 1 - windowSize, index + 1);
      const sum = windowPoints.reduce((acc, item) => acc + (item.close ?? 0), 0);
      return Number((sum / windowSize).toFixed(2));
    };

    return {
      ...point,
      ma5: calc(5),
      ma10: calc(10),
      ma20: calc(20),
    };
  });

const aggregateWeeklyChartData = (points: any[]) => {
  const buckets = new Map<string, any>();

  points.forEach((point) => {
    const date = new Date(point.date);
    const dayIndex = (date.getDay() + 6) % 7;
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - dayIndex);
    const key = weekStart.toISOString().slice(0, 10);

    if (!buckets.has(key)) {
      buckets.set(key, {
        date: key,
        label: weekStart.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
        open: point.open,
        close: point.close,
        high: point.high,
        low: point.low,
        volume: point.volume ?? 0,
        price: point.close,
      });
      return;
    }

    const current = buckets.get(key);
    current.close = point.close;
    current.price = point.close;
    current.high = Math.max(current.high ?? point.high, point.high ?? point.close);
    current.low = Math.min(current.low ?? point.low, point.low ?? point.close);
    current.volume = (current.volume ?? 0) + (point.volume ?? 0);
  });

  return Array.from(buckets.values());
};

const DailyCandlestickLayer = ({ points = [], xAxisMap, yAxisMap }: any) => {
  const xAxis = Object.values(xAxisMap || {})[0] as any;
  const yAxis = Object.values(yAxisMap || {})[0] as any;

  if (!xAxis?.scale || !yAxis?.scale || !points.length) return null;

  const bandwidth = xAxis.bandSize || (typeof xAxis.scale.bandwidth === 'function' ? xAxis.scale.bandwidth() : 12);
  const candleWidth = Math.max(4, Math.min(14, bandwidth * 0.55));
  const closeLinePoints = points
    .map((point: any) => {
      const x = xAxis.scale(point.label ?? point.date);
      if (x == null) return null;
      const centerX = x + bandwidth / 2;
      const closeY = yAxis.scale(point.close);
      return `${centerX},${closeY}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <g>
      <polyline fill="none" stroke="#2563eb" strokeOpacity="0.35" strokeWidth={1.5} points={closeLinePoints} />
      {points.map((point: any) => {
        const open = point.open ?? point.close;
        const close = point.close;
        const high = point.high ?? Math.max(open, close);
        const low = point.low ?? Math.min(open, close);
        const x = xAxis.scale(point.label ?? point.date);
        if (x == null) return null;
        const centerX = x + bandwidth / 2;
        const openY = yAxis.scale(open);
        const closeY = yAxis.scale(close);
        const highY = yAxis.scale(high);
        const lowY = yAxis.scale(low);
        const y = Math.min(openY, closeY);
        const candleHeight = Math.max(1, Math.abs(openY - closeY));
        const isUp = close >= open;
        const color = isUp ? '#ef4444' : '#10b981';

        return (
          <g key={point.label ?? point.date}>
            <line x1={centerX} x2={centerX} y1={highY} y2={lowY} stroke={color} strokeWidth={1.5} />
            <rect
              x={centerX - candleWidth / 2}
              y={y}
              width={candleWidth}
              height={candleHeight}
              fill={isUp ? color : '#ffffff'}
              stroke={color}
              strokeWidth={1.5}
              rx={1}
            />
          </g>
        );
      })}
    </g>
  );
};

const KlineCrosshairLayer = ({ activeCoordinate, activePayload, offset, yAxisMap }: any) => {
  const yAxis = Object.values(yAxisMap || {})[0] as any;

  if (!activeCoordinate || !offset || !yAxis?.scale) return null;

  const x = Math.max(offset.left, Math.min(activeCoordinate.x ?? offset.left, offset.left + offset.width));
  const y = Math.max(offset.top, Math.min(activeCoordinate.y ?? offset.top, offset.top + offset.height));
  const activeLabel = activePayload?.[0]?.payload?.label || activePayload?.[0]?.payload?.date || '';
  const invertedPrice = typeof yAxis.scale.invert === 'function' ? yAxis.scale.invert(y) : null;
  const priceLabel = typeof invertedPrice === 'number' && Number.isFinite(invertedPrice) ? `¥${formatMoney(invertedPrice)}` : '';
  const xLabelWidth = Math.max(74, String(activeLabel).length * 8 + 16);
  const xLabelX = Math.min(Math.max(x - xLabelWidth / 2, offset.left), offset.left + offset.width - xLabelWidth);
  const xLabelY = offset.top + offset.height - 24;
  const yLabelWidth = priceLabel.length > 10 ? 84 : 72;
  const yLabelX = offset.left + offset.width - yLabelWidth;
  const yLabelY = Math.min(Math.max(y - 12, offset.top + 4), offset.top + offset.height - 28);

  return (
    <g pointerEvents="none">
      <line x1={x} x2={x} y1={offset.top} y2={offset.top + offset.height} stroke="#94a3b8" strokeDasharray="4 4" />
      <line x1={offset.left} x2={offset.left + offset.width} y1={y} y2={y} stroke="#94a3b8" strokeDasharray="4 4" />
      {activeLabel ? (
        <g>
          <rect x={xLabelX} y={xLabelY} rx={6} ry={6} width={xLabelWidth} height={20} fill="#0f172a" fillOpacity={0.92} />
          <text x={xLabelX + xLabelWidth / 2} y={xLabelY + 14} textAnchor="middle" fontSize={11} fill="#f8fafc">
            {activeLabel}
          </text>
        </g>
      ) : null}
      {priceLabel ? (
        <g>
          <rect x={yLabelX} y={yLabelY} rx={6} ry={6} width={yLabelWidth} height={20} fill="#0f172a" fillOpacity={0.92} />
          <text x={yLabelX + yLabelWidth / 2} y={yLabelY + 14} textAnchor="middle" fontSize={11} fill="#f8fafc">
            {priceLabel}
          </text>
        </g>
      ) : null}
    </g>
  );
};

export default function StockAnalysis() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuthStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stockData, setStockData] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [dailyChartData, setDailyChartData] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [intraday1mChartData, setIntraday1mChartData] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [intraday5mChartData, setIntraday5mChartData] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [aiReport, setAiReport] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [analysisPerformance, setAnalysisPerformance] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [quickComment, setQuickComment] = useState<any>(null);
  const [eventSignals, setEventSignals] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [quickCommentLoading, setQuickCommentLoading] = useState(false);
  const [eventRefreshLoading, setEventRefreshLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState('');
  const [chartMode, setChartMode] = useState<ChartMode>(() =>
    typeof window === 'undefined' ? 'intraday1m' : normalizeChartMode(window.localStorage.getItem(CHART_MODE_STORAGE_KEY)),
  );
  const [chartRange, setChartRange] = useState<ChartRange>(() =>
    typeof window === 'undefined' ? 120 : normalizeChartRange(window.localStorage.getItem(CHART_RANGE_STORAGE_KEY)),
  );
  const [tradeQuantity, setTradeQuantity] = useState(100);
  const [tradeAction, setTradeAction] = useState<'BUY' | 'SELL' | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [isInWatchlist, setIsInWatchlist] = useState(false);
  const [alertTargetPrice, setAlertTargetPrice] = useState('');
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above');
  const [alertLoading, setAlertLoading] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [isCompanySummaryExpanded, setIsCompanySummaryExpanded] = useState(false);
  const [isBusinessScopeExpanded, setIsBusinessScopeExpanded] = useState(false);

  const trend30ChartData = useMemo(() => addMovingAverageSeries(dailyChartData.slice(-30)), [dailyChartData]);
  const rangedDailyChartData = useMemo(() => addMovingAverageSeries(dailyChartData.slice(-chartRange)), [dailyChartData, chartRange]);
  const weeklyChartData = useMemo(() => addMovingAverageSeries(aggregateWeeklyChartData(dailyChartData.slice(-chartRange))), [dailyChartData, chartRange]);
  const chartData =
    chartMode === 'intraday1m'
      ? intraday1mChartData
      : chartMode === 'intraday5m'
        ? intraday5mChartData
        : chartMode === 'trend30'
          ? trend30ChartData
          : chartMode === 'dailyK'
            ? rangedDailyChartData
            : weeklyChartData;
  const isPositive = (stockData?.change || 0) >= 0;
  const klineReferencePrice =
    chartMode === 'dailyK'
      ? stockData?.previousClose ?? rangedDailyChartData[rangedDailyChartData.length - 2]?.close ?? null
      : weeklyChartData[weeklyChartData.length - 2]?.close ?? null;

  const hasDataForMode = (mode: ChartMode) => {
    if (mode === 'intraday1m') return intraday1mChartData.length > 0;
    if (mode === 'intraday5m') return intraday5mChartData.length > 0;
    if (mode === 'trend30') return trend30ChartData.length > 0;
    if (mode === 'dailyK') return dailyChartData.length > 0;
    return weeklyChartData.length > 0;
  };

  const triggeredAlerts = useMemo(() => {
    if (!stockData) return [];
    return alerts.filter((alert) => {
      if (alert.direction === 'above') return stockData.price >= Number(alert.target_price);
      return stockData.price <= Number(alert.target_price);
    });
  }, [alerts, stockData]);
  const conceptTags = useMemo(
    () => (Array.isArray(stockData?.conceptTags) ? stockData.conceptTags.filter(Boolean).slice(0, 8) : []),
    [stockData?.conceptTags],
  );
  const reportTrendChartData = useMemo(
    () =>
      (aiReport?.reportAnalysis?.trend || [])
        .slice()
        .reverse()
        .map((item: any) => ({
          label: item.label,
          revenue: typeof item.revenueValue === 'number' ? Number((item.revenueValue / 1e8).toFixed(2)) : null,
          netProfit: typeof item.netProfitValue === 'number' ? Number((item.netProfitValue / 1e8).toFixed(2)) : null,
          revenueYoY: item.revenueYoY,
          profitYoY: item.profitYoY,
        })),
    [aiReport?.reportAnalysis?.trend],
  );
  const actionDisplay = aiReport?.actionCard?.action || aiReport?.recommendation || '观望';
  const isBuyAction = actionDisplay === '买入' || actionDisplay === 'Buy';
  const isSellAction = actionDisplay === '卖出' || actionDisplay === 'Sell';
  const isHoldAction = actionDisplay === '持有' || actionDisplay === 'Hold';
  const actionPanelClass = isBuyAction
    ? 'bg-red-50 border border-red-100'
    : isSellAction
      ? 'bg-green-50 border border-green-100'
      : isHoldAction
        ? 'bg-blue-50 border border-blue-100'
        : 'bg-amber-50 border border-amber-100';
  const actionTextClass = isBuyAction ? 'text-red-600' : isSellAction ? 'text-green-600' : isHoldAction ? 'text-blue-600' : 'text-amber-600';

  useEffect(() => {
    if (!code) return;

    setAiReport(null);
    setAnalysisPerformance(null);
    setQuickComment(null);
    setEventSignals(null);
    fetchStockData(code, false);
    fetchQuickComment(code);

    const timer = window.setInterval(() => {
      fetchStockData(code, true);
    }, 15000);

    return () => window.clearInterval(timer);
  }, [code, user?.id]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHART_MODE_STORAGE_KEY, chartMode);
    }
  }, [chartMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHART_RANGE_STORAGE_KEY, String(chartRange));
    }
  }, [chartRange]);

  useEffect(() => {
    if (hasDataForMode(chartMode)) return;

    const fallbackMode = (['intraday1m', 'intraday5m', 'trend30', 'dailyK', 'weeklyK'] as ChartMode[]).find((mode) => hasDataForMode(mode));
    if (fallbackMode && fallbackMode !== chartMode) {
      setChartMode(fallbackMode);
    }
  }, [chartMode, intraday1mChartData, intraday5mChartData, trend30ChartData, dailyChartData, weeklyChartData]);

  const fetchAlerts = async (symbol: string) => {
    if (!user) {
      setAlerts([]);
      return;
    }

    try {
      const res = await fetch(`/api/stock/alerts/${user.id}?code=${encodeURIComponent(symbol)}`);
      const data = await res.json();
      if (data.success) {
        setAlerts(data.alerts || []);
      }
    } catch (error) {
      console.error('Failed to fetch alerts', error);
    }
  };

  const fetchQuickComment = async (symbol: string) => {
    setQuickCommentLoading(true);
    try {
      const response = await fetch(`/api/stock/intraday-comment/${encodeURIComponent(symbol)}`);
      const data = await response.json();
      if (data.success) {
        setQuickComment(data.comment);
      }
    } catch (error) {
      console.error('Failed to fetch intraday comment', error);
    } finally {
      setQuickCommentLoading(false);
    }
  };

  const fetchWatchlistStatus = async (symbol: string) => {
    if (!user) {
      setIsInWatchlist(false);
      return;
    }

    try {
      const response = await fetch(`/api/stock/watchlist/${user.id}?code=${encodeURIComponent(symbol)}`);
      const data = await response.json();
      if (data.success) {
        setIsInWatchlist((data.watchlist || []).length > 0);
      }
    } catch (error) {
      console.error('Failed to fetch watchlist status', error);
    }
  };

  const fetchStockData = async (symbol: string, silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/stock/${symbol}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to fetch stock data');

      const displayName = hasChineseCharacters(symbol) ? symbol : data.stock.name;

      setStockData({
        ...data.stock,
        name: displayName,
      });
      setIsCompanySummaryExpanded(false);
      setIsBusinessScopeExpanded(false);
      setDailyChartData(
        (data.stock.dailySeries || []).map((item: any) => ({
          date: item.date,
          label: new Date(item.date).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }),
          open: item.open ?? item.close,
          close: item.close,
          high: item.high ?? item.close,
          low: item.low ?? item.close,
          volume: item.volume ?? 0,
          price: item.close,
        })),
      );
      setIntraday1mChartData(data.stock.intraday1m || []);
      setIntraday5mChartData(data.stock.intraday5m || data.stock.intraday || []);
      setLastUpdated(data.stock.updatedAt || new Date().toISOString());

      // Render the core stock page first, then hydrate secondary user-specific data.
      const resolvedSymbol = data.stock.code || symbol;
      void fetchAlerts(resolvedSymbol);
      void fetchWatchlistStatus(resolvedSymbol);
    } catch (error) {
      console.error('Failed to fetch stock data', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleWatchlistToggle = async () => {
    if (!user || !stockData) {
      alert('请先登录');
      return;
    }

    setWatchlistLoading(true);
    try {
      if (isInWatchlist) {
        const response = await fetch(`/api/stock/watchlist/${user.id}?code=${encodeURIComponent(stockData.code)}`);
        const data = await response.json();
        const item = (data.watchlist || [])[0];
        if (item?.id) {
          const deleteRes = await fetch(`/api/stock/watchlist/${item.id}`, { method: 'DELETE' });
          const deleteData = await deleteRes.json();
          if (deleteData.success) {
            setIsInWatchlist(false);
          }
        }
      } else {
        const response = await fetch('/api/stock/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user.id,
            stockCode: stockData.code,
            stockName: stockData.name,
          }),
        });
        const data = await response.json();
        if (data.success) {
          setIsInWatchlist(true);
        }
      }
    } catch (error) {
      console.error('Failed to update watchlist', error);
    } finally {
      setWatchlistLoading(false);
    }
  };

  const handleAiAnalysis = async () => {
    if (!code) return;
    setAiLoading(true);
    try {
      const response = await fetch('/api/stock/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId: user?.id }),
      });
      const data = await response.json();
      if (data.success) {
        setAiReport(data.analysis);
        setAnalysisPerformance(data.performance || null);
        setEventSignals(data.analysis?.eventSignals || data.eventSignals || null);
        if (data.analysis?.intradayQuickComment) {
          setQuickComment({
            comment: data.analysis.intradayQuickComment,
            bias: data.analysis.recommendation === '买入' ? '多头' : data.analysis.recommendation === '卖出' ? '空头' : '中性',
            keyObservation: data.analysis?.reasoning?.whyNow || 'AI 已基于盘中走势完成快评。',
            caution: data.analysis?.reasoning?.riskFactors?.[0] || '请结合风险承受能力审慎决策。',
          });
        }
      }
    } catch (error) {
      console.error('AI analysis failed', error);
    } finally {
      setAiLoading(false);
    }
  };

  const handleEventRefresh = async () => {
    if (!code) return;
    setEventRefreshLoading(true);
    try {
      const response = await fetch('/api/stock/analysis/event-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, userId: user?.id, force: true }),
      });
      const data = await response.json();
      if (data.success) {
        setEventSignals(data.eventSignals || data.analysis?.eventSignals || null);
        if (data.analysis) {
          setAiReport(data.analysis);
          setAnalysisPerformance(data.performance || null);
          if (data.analysis?.intradayQuickComment) {
            setQuickComment({
              comment: data.analysis.intradayQuickComment,
              bias: data.analysis.recommendation === '买入' ? '多头' : data.analysis.recommendation === '卖出' ? '空头' : '中性',
              keyObservation: data.analysis?.reasoning?.whyNow || '事件驱动重算已完成。',
              caution: data.analysis?.reasoning?.riskFactors?.[0] || '请结合风险承受能力审慎决策。',
            });
          }
        }
      }
    } catch (error) {
      console.error('Event refresh failed', error);
    } finally {
      setEventRefreshLoading(false);
    }
  };

  const handleTrade = async (type: 'BUY' | 'SELL') => {
    if (!user || !stockData) return;
    setTradeLoading(true);
    try {
      const response = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          stockCode: stockData.code,
          stockName: stockData.name,
          tradeType: type,
          quantity: tradeQuantity,
          price: stockData.price,
        }),
      });
      const data = await response.json();
      if (data.success) {
        alert(`${type === 'BUY' ? '买入' : '卖出'}成功！\n成交数量: ${tradeQuantity}\n成交价: ¥${stockData.price}`);
        setTradeAction(null);
      } else {
        alert(`交易失败: ${data.error}`);
      }
    } catch (error) {
      console.error('Trade failed', error);
      alert('交易失败，请稍后重试');
    } finally {
      setTradeLoading(false);
    }
  };

  const handleCreateAlert = async () => {
    if (!user || !stockData || !alertTargetPrice) {
      setAlertMessage('请先登录并填写预警价格');
      return;
    }

    setAlertLoading(true);
    setAlertMessage('');
    try {
      const response = await fetch('/api/stock/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          stockCode: stockData.code,
          stockName: stockData.name,
          targetPrice: Number(alertTargetPrice),
          direction: alertDirection,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setAlertTargetPrice('');
        setAlertMessage('价格预警已创建');
        fetchAlerts(stockData.code);
      } else {
        setAlertMessage(data.error || '创建预警失败');
      }
    } catch (error) {
      console.error('Create alert failed', error);
      setAlertMessage('创建预警失败');
    } finally {
      setAlertLoading(false);
    }
  };

  const handleDeleteAlert = async (id: string) => {
    try {
      const response = await fetch(`/api/stock/alerts/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.success && stockData) {
        fetchAlerts(stockData.code);
      }
    } catch (error) {
      console.error('Delete alert failed', error);
    }
  };

  const summaryAlerts = [
    {
      title: '已触发预警',
      value: triggeredAlerts.length,
      tone: triggeredAlerts.length > 0 ? 'text-amber-600' : 'text-slate-900',
    },
    {
      title: '运行中预警',
      value: alerts.length,
      tone: 'text-slate-900',
    },
    {
      title: '涨停距离',
      value: stockData?.distanceToUpperLimit == null ? '--' : `¥${formatMoney(stockData.distanceToUpperLimit)}`,
      tone: 'text-red-500',
    },
    {
      title: '跌停距离',
      value: stockData?.distanceToLowerLimit == null ? '--' : `¥${formatMoney(stockData.distanceToLowerLimit)}`,
      tone: 'text-green-500',
    },
  ];

  if (loading || !stockData) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {triggeredAlerts.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-800">
          <div className="flex items-center gap-2 font-semibold">
            <Bell className="h-4 w-4" />
            价格预警已触发
          </div>
          <p className="mt-1 text-sm">
            当前价格 ¥{formatMoney(stockData.price)} 已触达您设置的 {triggeredAlerts.length} 条预警条件。
          </p>
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-slate-900">{stockData.name}</h1>
              <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-md font-mono text-sm">{stockData.code}</span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {stockData.marketStateLabel || stockData.marketState || 'REGULAR'}
              </span>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {stockData.boardName}
              </span>
              {stockData.isLimitUp && (
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-600">涨停附近</span>
              )}
              {stockData.isLimitDown && (
                <span className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-600">跌停附近</span>
              )}
            </div>
            <div className="flex items-baseline gap-4">
              <span className="text-4xl font-bold text-slate-900">¥{formatMoney(stockData.price)}</span>
              <span className={`text-lg font-medium flex items-center gap-1 ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
                {isPositive ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                {isPositive ? '+' : ''}{formatMoney(stockData.change)} ({isPositive ? '+' : ''}{formatPercent(stockData.changePercent)})
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">今开</p>
                <p className="mt-1 font-semibold text-slate-900">¥{formatMoney(stockData.open)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">最高</p>
                <p className="mt-1 font-semibold text-red-500">¥{formatMoney(stockData.high)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">最低</p>
                <p className="mt-1 font-semibold text-green-500">¥{formatMoney(stockData.low)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">成交量</p>
                <p className="mt-1 font-semibold text-slate-900">{formatVolume(stockData.volume)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">涨停价</p>
                <p className="mt-1 font-semibold text-red-500">¥{formatMoney(stockData.upperLimit)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">跌停价</p>
                <p className="mt-1 font-semibold text-green-500">¥{formatMoney(stockData.lowerLimit)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock3 className="h-4 w-4" />
              最新更新时间：{new Date(lastUpdated).toLocaleString('zh-CN', { hour12: false })}
              {refreshing && <span className="text-blue-600">刷新中...</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleWatchlistToggle}
              disabled={watchlistLoading}
              className={`flex items-center gap-2 px-4 py-2 border-2 font-medium rounded-xl transition-colors disabled:opacity-70 ${
                isInWatchlist
                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Plus className="h-5 w-5" /> {watchlistLoading ? '处理中...' : isInWatchlist ? '已加入自选' : '加入自选'}
            </button>
            <button
              onClick={() => fetchStockData(stockData.code, true)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 border-2 border-blue-200 text-blue-600 font-medium rounded-xl hover:bg-blue-50 transition-colors disabled:opacity-70"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              刷新行情
            </button>
            <button
              onClick={() => (user ? setTradeAction('BUY') : alert('请先登录'))}
              className="flex items-center gap-2 px-6 py-2 bg-red-500 text-white font-medium rounded-xl hover:bg-red-600 transition-colors"
            >
              买入 (模拟)
            </button>
            <button
              onClick={() => (user ? setTradeAction('SELL') : alert('请先登录'))}
              className="flex items-center gap-2 px-6 py-2 bg-green-500 text-white font-medium rounded-xl hover:bg-green-600 transition-colors"
            >
              卖出 (模拟)
            </button>
            <button
              onClick={handleAiAnalysis}
              disabled={aiLoading}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-70"
            >
              {aiLoading ? (
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Brain className="h-5 w-5" />
              )}
              {aiLoading ? '分析中...' : 'AI 分析'}
            </button>
            <button
              onClick={handleEventRefresh}
              disabled={eventRefreshLoading}
              className="flex items-center gap-2 px-6 py-2 bg-fuchsia-600 text-white font-medium rounded-xl hover:bg-fuchsia-700 transition-colors disabled:opacity-70"
            >
              {eventRefreshLoading ? (
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
              {eventRefreshLoading ? '重算中...' : '事件驱动重算'}
            </button>
            {user && (
              <Link
                to={`/stock/${stockData.code}/history`}
                className="flex items-center gap-2 px-6 py-2 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors"
              >
                <Clock3 className="h-5 w-5" />
                历史分析
              </Link>
            )}
            <button
              onClick={() => code && fetchQuickComment(code)}
              disabled={quickCommentLoading}
              className="flex items-center gap-2 px-6 py-2 bg-violet-600 text-white font-medium rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-70"
            >
              {quickCommentLoading ? (
                <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <Sparkles className="h-5 w-5" />
              )}
              {quickCommentLoading ? '生成中...' : 'AI 盘中快评'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 h-[560px]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800">
              {chartMode === 'intraday1m'
                ? '分时走势'
                : chartMode === 'intraday5m'
                  ? '分时走势 (5分钟)'
                  : chartMode === 'trend30'
                    ? '价格走势 (近30日)'
                    : chartMode === 'dailyK'
                      ? '日K'
                      : '周K'}
            </h2>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setChartMode('intraday1m')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${chartMode === 'intraday1m' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >
                分时
              </button>
              <button
                type="button"
                onClick={() => setChartMode('intraday5m')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${chartMode === 'intraday5m' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >
                5分
              </button>
              <button
                type="button"
                onClick={() => setChartMode('trend30')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${chartMode === 'trend30' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >
                30日
              </button>
              <button
                type="button"
                onClick={() => setChartMode('dailyK')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${chartMode === 'dailyK' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >
                日K
              </button>
              <button
                type="button"
                onClick={() => setChartMode('weeklyK')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${chartMode === 'weeklyK' ? 'bg-white shadow text-slate-900' : 'text-slate-500'}`}
              >
                周K
              </button>
            </div>
          </div>
          {(chartMode === 'dailyK' || chartMode === 'weeklyK') && (
            <div className="mb-4 flex items-center gap-2">
              <span className="text-sm font-medium text-slate-500">跨度</span>
              {[30, 60, 120, 250].map((range) => (
                <button
                  key={range}
                  type="button"
                  onClick={() => setChartRange(range as ChartRange)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
                    chartRange === range ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {range === 250 ? '1年' : `${range}日`}
                </button>
              ))}
            </div>
          )}
          {chartData.length === 0 ? (
            <div className="flex h-[320px] items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">
              暂未获取到走势图数据，正在等待行情源返回...
            </div>
          ) : chartMode === 'dailyK' || chartMode === 'weeklyK' ? (
            <div className="flex h-[440px] flex-col gap-3">
              <div className="h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={chartData}
                    syncId="stock-kline"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" hide />
                    <YAxis
                      domain={['auto', 'auto']}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 12 }}
                      dx={-10}
                    />
                    {typeof klineReferencePrice === 'number' && (
                      <ReferenceLine y={klineReferencePrice} stroke="#94a3b8" strokeDasharray="4 4" ifOverflow="extendDomain" />
                    )}
                    {typeof aiReport?.actionCard?.supportPrice === 'number' && (
                      <ReferenceLine
                        y={aiReport.actionCard.supportPrice}
                        stroke="#16a34a"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                        label={{ value: '支撑', fill: '#16a34a', fontSize: 11, position: 'insideBottomLeft' }}
                      />
                    )}
                    {typeof aiReport?.actionCard?.resistancePrice === 'number' && (
                      <ReferenceLine
                        y={aiReport.actionCard.resistancePrice}
                        stroke="#dc2626"
                        strokeDasharray="4 4"
                        ifOverflow="extendDomain"
                        label={{ value: '阻力', fill: '#dc2626', fontSize: 11, position: 'insideTopLeft' }}
                      />
                    )}
                    {typeof aiReport?.actionCard?.stopLossPrice === 'number' && (
                      <ReferenceLine
                        y={aiReport.actionCard.stopLossPrice}
                        stroke="#f59e0b"
                        strokeDasharray="2 4"
                        ifOverflow="extendDomain"
                        label={{ value: '防守', fill: '#b45309', fontSize: 11, position: 'left' }}
                      />
                    )}
                    <Tooltip
                      cursor={false}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload;
                        if (!point) return null;

                        return (
                          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-lg">
                            <p className="text-sm font-semibold text-slate-900">{point.label}</p>
                            <div className="mt-2 space-y-1 text-xs text-slate-600">
                              <p>开: ¥{formatMoney(point.open)}</p>
                              <p>高: ¥{formatMoney(point.high)}</p>
                              <p>低: ¥{formatMoney(point.low)}</p>
                              <p>收: ¥{formatMoney(point.close)}</p>
                              <p>MA5: {point.ma5 ? `¥${formatMoney(point.ma5)}` : '--'}</p>
                              <p>MA10: {point.ma10 ? `¥${formatMoney(point.ma10)}` : '--'}</p>
                              <p>MA20: {point.ma20 ? `¥${formatMoney(point.ma20)}` : '--'}</p>
                              <p>量: {formatVolume(point.volume)}</p>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Line dataKey="ma5" stroke="#f59e0b" dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls />
                    <Line dataKey="ma10" stroke="#8b5cf6" dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls />
                    <Line dataKey="ma20" stroke="#0ea5e9" dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls />
                    <Line dataKey="close" stroke="transparent" dot={false} activeDot={{ r: 4, fill: '#2563eb' }} isAnimationActive={false} />
                    <Customized component={(props: any) => <DailyCandlestickLayer {...props} points={chartData} />} />
                    <Customized component={(props: any) => <KlineCrosshairLayer {...props} />} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {(typeof aiReport?.actionCard?.supportPrice === 'number' ||
                typeof aiReport?.actionCard?.resistancePrice === 'number' ||
                typeof aiReport?.actionCard?.stopLossPrice === 'number') && (
                <div className="flex flex-wrap items-center gap-3 px-1 text-xs text-slate-500">
                  {typeof aiReport?.actionCard?.supportPrice === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-green-600" />
                      支撑 ¥{formatMoney(aiReport.actionCard.supportPrice)}
                    </span>
                  )}
                  {typeof aiReport?.actionCard?.resistancePrice === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-red-600" />
                      阻力 ¥{formatMoney(aiReport.actionCard.resistancePrice)}
                    </span>
                  )}
                  {typeof aiReport?.actionCard?.stopLossPrice === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      防守 ¥{formatMoney(aiReport.actionCard.stopLossPrice)}
                    </span>
                  )}
                </div>
              )}
              <div className="h-[84px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={chartData}
                    syncId="stock-kline"
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 12 }} dy={10} />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      formatter={(value: number) => [formatVolume(value), '成交量']}
                    />
                    <Bar dataKey="volume" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis
                  dataKey={chartMode === 'trend30' ? 'label' : 'time'}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  dy={10}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  dx={-10}
                />
                <Tooltip
                  formatter={(value: number) => [`¥${formatMoney(value)}`, '价格']}
                  contentStyle={{ borderRadius: '0.5rem', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold' }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={isPositive ? '#ef4444' : '#10b981'}
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 6, fill: isPositive ? '#ef4444' : '#10b981', stroke: '#fff', strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-800">预警中心</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            {summaryAlerts.map((item) => (
              <div key={item.title} className="rounded-xl bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">{item.title}</p>
                <p className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-sm text-slate-500">目标价格</label>
              <input
                value={alertTargetPrice}
                onChange={(e) => setAlertTargetPrice(e.target.value)}
                placeholder="例如 1800"
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <div>
              <label className="text-sm text-slate-500">触发方向</label>
              <select
                value={alertDirection}
                onChange={(e) => setAlertDirection(e.target.value as 'above' | 'below')}
                className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="above">价格上涨到目标值以上</option>
                <option value="below">价格下跌到目标值以下</option>
              </select>
            </div>
            <button
              onClick={handleCreateAlert}
              disabled={alertLoading}
              className="w-full rounded-xl bg-amber-500 px-4 py-3 font-semibold text-white hover:bg-amber-600 transition disabled:opacity-70"
            >
              {alertLoading ? '创建中...' : '创建预警'}
            </button>
            {alertMessage && <p className="text-sm text-slate-500">{alertMessage}</p>}
          </div>

          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">当前预警</h3>
            {alerts.length === 0 ? (
              <div className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
                当前股票还没有预警规则
              </div>
            ) : (
              alerts.map((alert) => {
                const reached =
                  alert.direction === 'above'
                    ? stockData.price >= Number(alert.target_price)
                    : stockData.price <= Number(alert.target_price);
                return (
                  <div key={alert.id} className="rounded-xl border border-slate-200 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">
                          {alert.direction === 'above' ? '上破预警' : '下破预警'} ¥{formatMoney(Number(alert.target_price))}
                        </p>
                        <p className={`mt-1 text-xs ${reached ? 'text-amber-600' : 'text-slate-500'}`}>
                          {reached ? '当前已触发' : '等待触发'}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="text-sm text-slate-400 hover:text-red-500"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {quickComment && (
        <div className="rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-indigo-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-violet-700">
                <Sparkles className="h-5 w-5" />
                <h2 className="text-lg font-bold">AI 盘中快评</h2>
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-violet-700 shadow-sm">
                  {quickComment.providerLabel || 'AI'}
                </span>
              </div>
              <p className="mt-3 text-base leading-7 text-slate-800">{quickComment.comment}</p>
            </div>
            <div className="rounded-xl bg-white/80 px-4 py-3 text-sm shadow-sm">
              <p className="text-slate-500">盘中倾向</p>
              <p className="mt-1 font-semibold text-slate-900">{quickComment.bias || '中性'}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-white/70 px-4 py-4">
              <p className="text-sm font-medium text-slate-500">关键观察</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{quickComment.keyObservation}</p>
            </div>
            <div className="rounded-xl bg-white/70 px-4 py-4">
              <p className="text-sm font-medium text-slate-500">风险提醒</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">{quickComment.caution}</p>
            </div>
          </div>
        </div>
      )}

      {eventSignals && (
        <div className="rounded-2xl border border-fuchsia-100 bg-fuchsia-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-fuchsia-700">
                <Sparkles className="h-5 w-5" />
                <h2 className="text-lg font-bold">事件驱动信号</h2>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                触发分数 {eventSignals.score || 0}，{eventSignals.shouldRerun ? '建议重新分析' : '暂未达到强制重算阈值'}
              </p>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
              <p className="text-slate-500">最近检查</p>
              <p className="mt-1 font-medium text-slate-900">
                {eventSignals.lastCheckedAt ? new Date(eventSignals.lastCheckedAt).toLocaleString('zh-CN', { hour12: false }) : '--'}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {(eventSignals.signals || []).length === 0 ? (
              <div className="rounded-xl bg-white px-4 py-4 text-sm text-slate-500">当前没有明显的事件触发信号</div>
            ) : (
              (eventSignals.signals || []).map((item: any) => (
                <div key={`${item.type}-${item.title}`} className="rounded-xl bg-white px-4 py-4">
                  <p className="font-medium text-slate-900">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {aiReport && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-gradient-to-r from-blue-900 to-indigo-900 rounded-2xl p-8 text-white shadow-lg">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                  <Brain className="h-6 w-6 text-blue-300" /> AI 投资建议
                  <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-blue-100">
                    {aiReport.meta?.aiProviderLabel || 'AI'}
                  </span>
                </h2>
                <p className="text-blue-100">
                  置信度: {((aiReport.confidenceMeta?.score ?? aiReport.confidence ?? 0) * 100).toFixed(0)}% •
                  置信等级: {aiReport.confidenceMeta?.level || '中'} • 风险等级: {aiReport.riskLevel}/5
                </p>
                <p className="mt-3 max-w-3xl text-base font-medium leading-7 text-white">
                  {aiReport.decisionSummary?.headline || aiReport.thesis || '当前分析结果已生成'}
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-blue-100">
                  {aiReport.decisionSummary?.thesis || aiReport.thesis || '建议结合关键价格位、财报与事件信号综合判断。'}
                </p>
              </div>
              <div className="bg-white/10 backdrop-blur-md px-8 py-4 rounded-xl text-center border border-white/20">
                <p className="text-blue-200 text-sm font-medium mb-1">当前动作</p>
                <p
                  className={`text-3xl font-bold ${
                    aiReport.recommendation === '买入' || aiReport.recommendation === 'Buy'
                      ? 'text-red-400'
                      : aiReport.recommendation === '卖出' || aiReport.recommendation === 'Sell'
                        ? 'text-green-400'
                        : 'text-yellow-400'
                  }`}
                >
                  {aiReport.recommendation}
                </p>
                <p className="mt-2 text-xs text-blue-100">{aiReport.decisionSummary?.suitableFor || '以验证后执行为主'}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Sparkles className="h-5 w-5 text-violet-500" />
                <h3 className="text-lg font-bold">投资决策总览</h3>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
                <div className={`rounded-xl px-4 py-4 ${actionPanelClass}`}>
                  <p className="text-xs text-slate-500">当前动作</p>
                  <p className={`mt-2 text-lg font-semibold ${actionTextClass}`}>{aiReport.actionCard?.action || aiReport.recommendation || '暂无'}</p>
                  <p className="mt-1 text-xs text-slate-500">{aiReport.actionCard?.actionStyle || '决策模板'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-xs text-slate-500">建议仓位</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{aiReport.actionCard?.positionSizing || '暂无'}</p>
                  <p className="mt-1 text-xs text-slate-500">按置信度动态调整</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-xs text-slate-500">关键支撑</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {typeof aiReport.actionCard?.supportPrice === 'number' ? `¥${formatMoney(aiReport.actionCard.supportPrice)}` : '暂无'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">回踩承接观察位</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-xs text-slate-500">关键阻力</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {typeof aiReport.actionCard?.resistancePrice === 'number' ? `¥${formatMoney(aiReport.actionCard.resistancePrice)}` : '暂无'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">突破确认观察位</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-xs text-slate-500">防守位</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {typeof aiReport.actionCard?.stopLossPrice === 'number' ? `¥${formatMoney(aiReport.actionCard.stopLossPrice)}` : '暂无'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">失效后优先控风险</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-500">结论</p>
                  <p className="mt-2 text-lg font-semibold text-slate-900">{aiReport.decisionSummary?.headline || aiReport.thesis || '暂无结论'}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.decisionSummary?.thesis || aiReport.thesis || '暂无结论说明'}</p>
                </div>
                <div className="rounded-xl bg-blue-50 px-4 py-4">
                  <p className="text-sm font-medium text-blue-700">执行方案</p>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    <p>- 当前动作：{aiReport.executionPlan?.currentAction || aiReport.reasoning?.actionPlan || '暂无'}</p>
                    <p>- 加仓条件：{aiReport.executionPlan?.addTrigger || '暂无'}</p>
                    <p>- 风险控制：{aiReport.executionPlan?.riskControl || '暂无'}</p>
                    <p>- 观察目标：{aiReport.executionPlan?.targetHint || '暂无'}</p>
                  </div>
                  {aiReport.actionCard?.template && (
                    <div className="mt-3 rounded-lg bg-white/70 px-3 py-3 text-sm text-slate-700">
                      模板：{aiReport.actionCard.template}
                    </div>
                  )}
                </div>
                <div className="rounded-xl bg-emerald-50 px-4 py-4">
                  <p className="text-sm font-medium text-emerald-700">核心依据</p>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {((aiReport.decisionSummary?.coreBasis || aiReport.reasoning?.bullishFactors || []) as string[]).slice(0, 5).map((item) => (
                      <p key={item}>- {item}</p>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-4">
                  <p className="text-sm font-medium text-amber-700">反方风险与失效条件</p>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {[
                      ...((aiReport.decisionSummary?.counterSignals || aiReport.reasoning?.riskFactors || []) as string[]),
                      ...((aiReport.decisionSummary?.invalidationTriggers || []) as string[]),
                    ]
                      .slice(0, 6)
                      .map((item) => (
                        <p key={item}>- {item}</p>
                      ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Activity className="h-5 w-5 text-blue-500" />
                <h3 className="text-lg font-bold">置信度拆解</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {aiReport.confidenceMeta?.summary || '当前置信度基于行情完整度、财报与公告、证据链、事件时效性和信号一致性综合评估。'}
              </p>
              <div className="mt-4 space-y-3">
                {(aiReport.confidenceMeta?.breakdown || []).length > 0 ? (
                  (aiReport.confidenceMeta?.breakdown || []).map((item: any) => {
                    const ratio = item.max ? Math.max(0, Math.min(100, (item.score / item.max) * 100)) : 0;
                    return (
                      <div key={item.label} className="rounded-xl bg-slate-50 px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-900">{item.label}</p>
                          <span className="text-xs text-slate-500">
                            {item.score}/{item.max}
                          </span>
                        </div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${ratio}%` }} />
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">暂无置信度拆解</div>
                )}
              </div>
            </div>
          </div>

          {analysisPerformance && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">历史命中率</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{analysisPerformance.overallHitRate}%</p>
                  <p className="mt-1 text-xs text-slate-500">已评估 {analysisPerformance.totalEvaluated} 次</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">当前股票命中率</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">
                    {analysisPerformance.currentStock ? `${analysisPerformance.currentStock.hitRate}%` : '--'}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {analysisPerformance.currentStock ? `基于 ${analysisPerformance.currentStock.total} 次历史分析` : '暂无足够样本'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                  <p className="text-sm text-slate-500">命中次数</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{analysisPerformance.totalHits}</p>
                  <p className="mt-1 text-xs text-slate-500">用于追踪 AI 结论有效性</p>
                </div>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="flex items-center gap-2 text-slate-900">
                  <Activity className="h-5 w-5 text-blue-500" />
                  <h3 className="text-lg font-bold">多周期命中率回测</h3>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {Object.values(analysisPerformance.periodStats || {}).map((item: any) => (
                    <div key={item.period} className="rounded-xl bg-slate-50 px-4 py-4">
                      <p className="text-sm text-slate-500">{item.period} 日</p>
                      <p className="mt-1 text-2xl font-bold text-slate-900">{formatPercent(item.hitRate)}</p>
                      <p className="mt-1 text-xs text-slate-500">评估 {item.evaluated} 次</p>
                      <p className={`mt-2 text-sm font-medium ${(item.avgReturn || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                        平均表现 {formatPercent(item.avgReturn)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <BookOpen className="h-5 w-5 text-emerald-500" />
                <h3 className="text-lg font-bold">证据链引用</h3>
              </div>
              <div className="mt-4 space-y-3">
                {(aiReport.evidenceChain || []).length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">当前分析暂无证据链条目</div>
                ) : (
                  (aiReport.evidenceChain || []).map((item: any, index: number) => (
                    <div key={`${item.title}-${index}`} className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium text-slate-900">{item.title}</p>
                        <span className="text-xs text-slate-500">{item.sourceType}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.summary}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Brain className="h-5 w-5 text-indigo-500" />
                <h3 className="text-lg font-bold">组合级买卖建议</h3>
              </div>
              {aiReport.portfolioAdvice ? (
                <div className="mt-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <p className="text-sm text-slate-500">适配度</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{aiReport.portfolioAdvice.fit}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <p className="text-sm text-slate-500">建议定位</p>
                      <p className="mt-1 text-xl font-semibold text-slate-900">{aiReport.portfolioAdvice.role}</p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-blue-50 px-4 py-4">
                    <p className="text-sm font-medium text-blue-700">执行建议</p>
                    <p className="mt-2 text-sm text-slate-700">{aiReport.portfolioAdvice.suggestedAction}</p>
                    <p className="mt-1 text-sm text-slate-500">建议仓位：{aiReport.portfolioAdvice.targetAllocation}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-4">
                    <p className="text-sm font-medium text-slate-700">组合视角理由</p>
                    <div className="mt-2 space-y-2 text-sm text-slate-700">
                      {(aiReport.portfolioAdvice.reasoning || []).map((item: string) => <p key={item}>- {item}</p>)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">请先执行一次 AI 分析以生成组合建议</div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <TrendingUp className="h-5 w-5 text-red-500" />
                <h3 className="text-lg font-bold">
                  {aiReport.comparisonGroupLabel ? `${aiReport.comparisonGroupLabel}横向对比` : '同行业横向对比'}
                </h3>
              </div>
              <p className="mt-2 text-sm text-slate-500">{aiReport.peerTakeaway || '暂无横向结论'}</p>
              <div className="mt-4 space-y-3">
                {(aiReport.peerComparison || []).length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">暂无可比标的</div>
                ) : (
                  (aiReport.peerComparison || []).map((peer: any) => (
                    <div key={peer.code} className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-900">{peer.name}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {peer.code} · {peer.industryName || peer.comparisonGroupLabel || peer.boardName}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${(peer.changePercent || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                            {formatPercent(peer.changePercent)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">PE {peer.peRatio ?? '--'}</p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-bold">组合风险控制</h3>
              </div>
              <div className="mt-4 rounded-xl bg-amber-50 px-4 py-4">
                <div className="space-y-2 text-sm text-slate-700">
                  {((aiReport.portfolioAdvice?.riskControl || aiReport.reasoning?.riskFactors || []) as string[]).map((item) => (
                    <p key={item}>- {item}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Sparkles className="h-5 w-5 text-violet-500" />
                <h3 className="text-lg font-bold">可解释买卖理由</h3>
              </div>
              <div className="mt-4 space-y-4">
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-500">为什么现在看这只股票</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.reasoning?.whyNow || '暂无'}</p>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-red-50 px-4 py-4">
                    <p className="text-sm font-medium text-red-600">看多理由</p>
                    <div className="mt-2 space-y-2">
                      {(aiReport.reasoning?.bullishFactors || []).map((item: string) => (
                        <p key={item} className="text-sm text-slate-700">- {item}</p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl bg-amber-50 px-4 py-4">
                    <p className="text-sm font-medium text-amber-700">风险点</p>
                    <div className="mt-2 space-y-2">
                      {(aiReport.reasoning?.riskFactors || []).map((item: string) => (
                        <p key={item} className="text-sm text-slate-700">- {item}</p>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl bg-blue-50 px-4 py-4">
                  <p className="text-sm font-medium text-blue-700">操作建议说明</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.reasoning?.actionPlan || '暂无'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-bold">情景推演</h3>
              </div>
              <div className="mt-4 space-y-4">
                <div className="rounded-xl bg-red-50 px-4 py-4">
                  <p className="text-sm font-medium text-red-600">乐观情景</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.scenario?.bullCase || '暂无'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-600">中性情景</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.scenario?.baseCase || '暂无'}</p>
                </div>
                <div className="rounded-xl bg-green-50 px-4 py-4">
                  <p className="text-sm font-medium text-green-600">悲观情景</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.scenario?.bearCase || '暂无'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <Activity className="h-5 w-5 text-blue-500" /> 技术面分析
              </h3>
              <div className="space-y-3 mb-4">
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">趋势</span>
                  <span className="font-medium text-slate-900">{aiReport.technical.trend}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">支撑位</span>
                  <span className="font-medium text-slate-900">¥{aiReport.technical.support}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">阻力位</span>
                  <span className="font-medium text-slate-900">¥{aiReport.technical.resistance}</span>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg">{aiReport.technical.summary}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <BookOpen className="h-5 w-5 text-indigo-500" /> 基本面分析
              </h3>
              <div className="space-y-3 mb-4">
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">市盈率 (P/E)</span>
                  <span className="font-medium text-slate-900">{formatRatio(stockData.peRatio ?? aiReport.fundamental.peRatio)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">每股收益 (EPS)</span>
                  <span className="font-medium text-slate-900">{formatPerShareValue(stockData.eps ?? aiReport.fundamental.eps)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">市净率 (P/B)</span>
                  <span className="font-medium text-slate-900">{formatRatio(stockData.priceToBook)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">所属行业</span>
                  <span className="font-medium text-slate-900">{stockData.industryName || '暂无'}</span>
                </div>
                <div className="flex justify-between border-b border-slate-50 pb-2">
                  <span className="text-slate-500">所属地域</span>
                  <span className="font-medium text-slate-900">{stockData.regionName || '暂无'}</span>
                </div>
              </div>
              <div className="mb-4 rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">资料概览</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-slate-500">行业</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{stockData.industryName || '暂无'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">地域</p>
                    <p className="mt-1 text-sm font-medium text-slate-800">{stockData.regionName || '暂无'}</p>
                  </div>
                </div>
                <div className="mt-3">
                  <p className="text-xs text-slate-500">概念标签</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {conceptTags.length > 0 ? (
                      conceptTags.map((tag: string) => (
                        <span
                          key={tag}
                          className="rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-600"
                        >
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">暂无概念标签</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-3 mb-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">公司简介</p>
                    {stockData.companySummary && stockData.companySummary.length > 120 && (
                      <button
                        type="button"
                        onClick={() => setIsCompanySummaryExpanded((value) => !value)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {isCompanySummaryExpanded ? '收起' : '展开'}
                        {isCompanySummaryExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {stockData.companySummary
                      ? isCompanySummaryExpanded
                        ? stockData.companySummary
                        : truncateText(stockData.companySummary, 120)
                      : '暂无公司简介'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">经营范围</p>
                    {stockData.businessScope && stockData.businessScope.length > 140 && (
                      <button
                        type="button"
                        onClick={() => setIsBusinessScopeExpanded((value) => !value)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
                      >
                        {isBusinessScopeExpanded ? '收起' : '展开'}
                        {isBusinessScopeExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {stockData.businessScope
                      ? isBusinessScopeExpanded
                        ? stockData.businessScope
                        : truncateText(stockData.businessScope, 140)
                      : '暂无经营范围'}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg">{aiReport.fundamental.summary}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                <MessageSquare className="h-5 w-5 text-purple-500" /> 市场情绪
              </h3>
              <div className="space-y-3 mb-4">
                <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                  <span className="text-slate-500">新闻得分</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500" style={{ width: `${aiReport.sentiment.newsScore}%` }} />
                    </div>
                    <span className="font-medium text-slate-900 text-sm">{aiReport.sentiment.newsScore}</span>
                  </div>
                </div>
                <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                  <span className="text-slate-500">社交得分</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${aiReport.sentiment.socialScore}%` }} />
                    </div>
                    <span className="font-medium text-slate-900 text-sm">{aiReport.sentiment.socialScore}</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg">{aiReport.sentiment.summary}</p>
            </div>
          </div>

          {aiReport.reportAnalysis && (
            <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-slate-900">
                    <FileText className="h-5 w-5 text-emerald-500" />
                    <h3 className="text-lg font-bold">财报解读</h3>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    最新报告：{aiReport.reportAnalysis.latestReportName || '暂无'}{aiReport.reportAnalysis.noticeDate ? ` · 披露日 ${new Date(aiReport.reportAnalysis.noticeDate).toLocaleDateString('zh-CN')}` : ''}
                  </p>
                </div>
                <span className="inline-flex w-fit rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
                  {aiReport.reportAnalysis.verdict || '财报表现待确认'}
                </span>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-5">
                {(aiReport.reportAnalysis.keyMetrics || []).map((item: any) => (
                  <div key={`${item.label}-${item.changeLabel}`} className="rounded-xl bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">{item.label}</p>
                    <p className="mt-2 text-lg font-semibold text-slate-900">{item.value || '暂无'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.changeLabel || '变化'} {item.change || '暂无'}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 px-4 py-4">
                <p className="text-sm leading-7 text-slate-700">{aiReport.reportAnalysis.summary || '暂无财报解读摘要'}</p>
              </div>

              {(aiReport.reportAnalysis.anomalies || []).length > 0 && (
                <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-500" />
                    <p className="text-sm font-medium text-rose-700">同比 / 环比异常项提示</p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {(aiReport.reportAnalysis.anomalies || []).map((item: any) => (
                      <div key={`${item.type}-${item.title}`} className="rounded-lg bg-white px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-slate-900">{item.title}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              item.level === 'danger' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {item.level === 'danger' ? '重点关注' : '需跟踪'}
                          </span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {aiReport.reportAnalysis.cashflowObservation && (
                <div
                  className={`mt-4 rounded-xl px-4 py-4 ${
                    aiReport.reportAnalysis.cashflowObservation.level === 'warning'
                      ? 'bg-amber-50'
                      : aiReport.reportAnalysis.cashflowObservation.level === 'positive'
                        ? 'bg-emerald-50'
                        : 'bg-slate-50'
                  }`}
                >
                  <p className="text-sm font-medium text-slate-900">{aiReport.reportAnalysis.cashflowObservation.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{aiReport.reportAnalysis.cashflowObservation.summary}</p>
                </div>
              )}

              <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
                <div className="rounded-xl bg-emerald-50 px-4 py-4">
                  <p className="text-sm font-medium text-emerald-700">财报亮点</p>
                  <div className="mt-2 space-y-2">
                    {(aiReport.reportAnalysis.highlights || []).length > 0 ? (
                      (aiReport.reportAnalysis.highlights || []).map((item: string) => (
                        <p key={item} className="text-sm leading-6 text-slate-700">- {item}</p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">暂无明确亮点</p>
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-4">
                  <p className="text-sm font-medium text-amber-700">财报风险</p>
                  <div className="mt-2 space-y-2">
                    {(aiReport.reportAnalysis.risks || []).length > 0 ? (
                      (aiReport.reportAnalysis.risks || []).map((item: string) => (
                        <p key={item} className="text-sm leading-6 text-slate-700">- {item}</p>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">当前未识别出明显财报风险项</p>
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-blue-50 px-4 py-4">
                  <p className="text-sm font-medium text-blue-700">近几期对比</p>
                  <div className="mt-3 h-48 rounded-lg bg-white px-2 py-2">
                    {reportTrendChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={reportTrendChartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#dbeafe" />
                          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} width={42} />
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              `${typeof value === 'number' ? value.toFixed(2) : value} 亿`,
                              name === 'revenue' ? '营收' : '归母净利润',
                            ]}
                            labelFormatter={(label) => `${label}`}
                          />
                          <Line type="monotone" dataKey="revenue" name="revenue" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="netProfit" name="netProfit" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-slate-500">暂无趋势图数据</div>
                    )}
                  </div>
                  <div className="mt-3 space-y-3">
                    {(aiReport.reportAnalysis.trend || []).length > 0 ? (
                      (aiReport.reportAnalysis.trend || []).map((item: any) => (
                        <div key={item.label} className="rounded-lg bg-white px-3 py-3">
                          <p className="text-sm font-medium text-slate-900">{item.label}</p>
                          <p className="mt-1 text-xs text-slate-500">营收 {item.revenue || '暂无'}</p>
                          <p className="mt-1 text-xs text-slate-500">归母净利润 {item.netProfit || '暂无'}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            营收同比 {typeof item.revenueYoY === 'number' ? `${item.revenueYoY > 0 ? '+' : ''}${item.revenueYoY.toFixed(2)}%` : '暂无'}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            利润同比 {typeof item.profitYoY === 'number' ? `${item.profitYoY > 0 ? '+' : ''}${item.profitYoY.toFixed(2)}%` : '暂无'}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">暂无趋势对比数据</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Newspaper className="h-5 w-5 text-blue-500" />
                <h3 className="text-lg font-bold">新闻与催化剂摘要</h3>
              </div>
              <div className="mt-4 space-y-3">
                {(aiReport.newsDigest || []).length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">暂无可用新闻摘要</div>
                ) : (
                  (aiReport.newsDigest || []).map((item: any, index: number) => (
                    <div key={`${item.title}-${index}`} className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium text-slate-900">{item.title}</p>
                        {item.sentiment && <span className="text-xs text-slate-500">{item.sentiment}</span>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{item.source || '未知来源'}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.summary || '暂无摘要'}</p>
                    </div>
                  ))
                )}
                {(aiReport.catalysts || []).length > 0 && (
                  <div className="rounded-xl bg-red-50 px-4 py-4">
                    <p className="text-sm font-medium text-red-600">潜在催化剂</p>
                    <div className="mt-2 space-y-2">
                      {(aiReport.catalysts || []).map((item: string) => (
                        <p key={item} className="text-sm text-slate-700">- {item}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <FileText className="h-5 w-5 text-indigo-500" />
                <h3 className="text-lg font-bold">公告与财报重点</h3>
              </div>
              <div className="mt-4 space-y-3">
                {(aiReport.filingsDigest || []).length === 0 ? (
                  <div className="rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">暂无可用公告/文件摘要</div>
                ) : (
                  (aiReport.filingsDigest || []).map((item: any, index: number) => (
                    <div key={`${item.title}-${index}`} className="rounded-xl bg-slate-50 px-4 py-4">
                      <p className="font-medium text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.date ? new Date(item.date).toLocaleDateString('zh-CN') : '暂无日期'}</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{item.summary || '暂无摘要'}</p>
                    </div>
                  ))
                )}
                {(aiReport.financialHighlights || []).length > 0 && (
                  <div className="rounded-xl bg-blue-50 px-4 py-4">
                    <p className="text-sm font-medium text-blue-700">财务亮点</p>
                    <div className="mt-2 space-y-2">
                      {(aiReport.financialHighlights || []).map((item: string) => (
                        <p key={item} className="text-sm text-slate-700">- {item}</p>
                      ))}
                    </div>
                  </div>
                )}
                {(aiReport.risks || []).length > 0 && (
                  <div className="rounded-xl bg-amber-50 px-4 py-4">
                    <p className="text-sm font-medium text-amber-700">主要风险</p>
                    <div className="mt-2 space-y-2">
                      {(aiReport.risks || []).map((item: string) => (
                        <p key={item} className="text-sm text-slate-700">- {item}</p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tradeAction && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-slate-900 mb-4">
              {tradeAction === 'BUY' ? '买入股票' : '卖出股票'} - {stockData.name} ({stockData.code})
            </h3>
            <div className="space-y-4 mb-6">
              <div className="flex justify-between items-center text-slate-600">
                <span>当前价格:</span>
                <span className="font-bold text-slate-900 text-lg">¥{formatMoney(stockData.price)}</span>
              </div>
              <div className="space-y-2">
                <label className="text-slate-600 text-sm font-medium">交易数量 (股)</label>
                <input
                  type="number"
                  min="100"
                  step="100"
                  value={tradeQuantity}
                  onChange={(e) => setTradeQuantity(Number(e.target.value))}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                />
                <p className="text-xs text-slate-400 text-right">
                  预估金额: ¥{formatMoney(stockData.price * tradeQuantity)}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTradeAction(null)}
                className="flex-1 py-3 rounded-xl font-medium border-2 border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleTrade(tradeAction)}
                disabled={tradeLoading}
                className={`flex-1 py-3 rounded-xl font-bold text-white transition-colors disabled:opacity-70 ${
                  tradeAction === 'BUY' ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {tradeLoading ? '处理中...' : `确认${tradeAction === 'BUY' ? '买入' : '卖出'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
