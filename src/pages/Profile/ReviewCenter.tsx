import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { Brain, Target, TrendingUp, BarChart3, ArrowRight } from 'lucide-react';

const formatPercent = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
};

export default function ReviewCenter() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    fetchReviewCenter();
  }, [user?.id]);

  const fetchReviewCenter = async () => {
    try {
      const response = await fetch(`/api/stock/analysis/review-center/${user?.id}`);
      const result = await response.json();
      if (result.success) {
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch review center', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看 AI 复盘中心</h2>
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

  const summary = data?.summary || {};
  const performance = data?.performance || {};
  const recentRows = data?.recentRows || [];
  const monthlyTrend = data?.monthlyTrend || [];
  const periodStats = performance?.periodStats || summary?.periodStats || {};

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
            <Brain className="h-8 w-8 text-violet-600" /> AI 复盘中心
          </h1>
          <p className="mt-2 text-slate-500">复盘 AI 历史判断、命中率与分析分布，持续优化投资决策。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">累计分析次数</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{summary.totalAnalyses || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">整体命中率</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatPercent(performance.overallHitRate)}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">平均置信度</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatPercent((summary.averageConfidence || 0) * 100)}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">已评估命中数</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{performance.totalHits || 0}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900">多周期命中率回测</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Object.values(periodStats).map((item: any) => (
            <div key={item.period} className="rounded-xl bg-slate-50 px-4 py-4">
              <p className="text-sm text-slate-500">{item.period} 日周期</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatPercent(item.hitRate)}</p>
              <p className="mt-1 text-xs text-slate-500">评估 {item.evaluated} 次</p>
              <p className={`mt-2 text-sm font-medium ${(item.avgReturn || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                平均表现 {formatPercent(item.avgReturn)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-bold text-slate-900">近 6 个月分析趋势</h2>
          </div>
          {monthlyTrend.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-8 text-sm text-slate-500">暂无足够数据生成趋势</div>
          ) : (
            <div className="space-y-3">
              {monthlyTrend.map((item: any) => (
                <div key={item.month}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-slate-600">{item.month}</span>
                    <span className="font-medium text-slate-900">{item.count} 次</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-violet-500"
                      style={{ width: `${Math.max((item.count / Math.max(...monthlyTrend.map((m: any) => m.count), 1)) * 100, 10)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Target className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-bold text-slate-900">建议分布</h2>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl bg-red-50 px-4 py-4">
              <p className="text-sm text-red-600">买入建议</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.buyCount || 0}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-4">
              <p className="text-sm text-slate-600">持有/观望</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.holdCount || 0}</p>
            </div>
            <div className="rounded-xl bg-green-50 px-4 py-4">
              <p className="text-sm text-green-600">卖出建议</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{summary.sellCount || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-violet-500" />
          <h2 className="text-lg font-bold text-slate-900">最近分析记录</h2>
        </div>
        {recentRows.length === 0 ? (
          <div className="rounded-xl bg-slate-50 px-4 py-8 text-sm text-slate-500">暂无分析记录</div>
        ) : (
          <div className="space-y-3">
            {recentRows.map((row: any) => (
              <Link
                key={row.id}
                to={`/stock/${row.stockCode}/history`}
                className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-4 hover:bg-slate-50"
              >
                <div>
                  <div className="flex items-center gap-3">
                    <p className="font-semibold text-slate-900">{row.stockCode}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{row.recommendation}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{row.thesis || '暂无核心判断'}</p>
                  <p className="mt-1 text-xs text-slate-500">{new Date(row.analysisDate).toLocaleString('zh-CN', { hour12: false })}</p>
                </div>
                <div className="text-right">
                  <p className={`font-semibold ${row.isHit === true ? 'text-red-500' : row.isHit === false ? 'text-green-500' : 'text-slate-500'}`}>
                    {row.isHit === true ? '已命中' : row.isHit === false ? '未命中' : '待观察'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{formatPercent(row.changePercent)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    5日回测 {formatPercent(row.periodBacktests?.['5d']?.changePercent)}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
                    查看详情 <ArrowRight className="h-4 w-4" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
