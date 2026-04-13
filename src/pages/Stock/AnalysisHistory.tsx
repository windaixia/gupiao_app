import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { History, ArrowLeft, Target, Brain, TrendingUp } from 'lucide-react';

const formatMoney = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatPercent = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${value.toFixed(2)}%`;
};

export default function AnalysisHistory() {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!user || !code) return;
    fetchHistory();
  }, [user?.id, code]);

  const fetchHistory = async () => {
    try {
      const response = await fetch(`/api/stock/analysis/history/${user?.id}?code=${encodeURIComponent(code || '')}`);
      const result = await response.json();
      if (result.success) {
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch analysis history', error);
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看个股分析历史</h2>
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

  const rows = data?.rows || [];
  const summary = data?.summary || {};
  const periodStats = summary?.periodStats || {};

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <History className="h-8 w-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-slate-900">个股分析历史</h1>
          </div>
          <p className="mt-2 text-slate-500">查看 {code} 的历次 AI 分析结论、当时判断与后续表现。</p>
        </div>
        <Link to={`/stock/${code}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <ArrowLeft className="h-4 w-4" /> 返回行情页
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">分析次数</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{summary.totalAnalyses || 0}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">命中率</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatPercent(summary.overallHitRate)}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">平均置信度</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{formatPercent((summary.averageConfidence || 0) * 100)}</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">建议结构</p>
          <p className="mt-2 text-base font-semibold text-slate-900">
            买 {summary.buyCount || 0} / 持 {summary.holdCount || 0} / 卖 {summary.sellCount || 0}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-bold text-slate-900">多周期回测概览</h2>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Object.values(periodStats).map((item: any) => (
            <div key={item.period} className="rounded-xl bg-slate-50 px-4 py-4">
              <p className="text-sm text-slate-500">{item.period} 日命中率</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{formatPercent(item.hitRate)}</p>
              <p className="mt-1 text-xs text-slate-500">评估 {item.evaluated} 次</p>
              <p className={`mt-2 text-sm font-medium ${(item.avgReturn || 0) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                平均表现 {formatPercent(item.avgReturn)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-slate-500">当前股票还没有 AI 分析历史</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row: any) => (
            <div key={row.id} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                      {new Date(row.analysisDate).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {row.recommendation}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                      row.isHit === true ? 'bg-red-50 text-red-600' : row.isHit === false ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-600'
                    }`}>
                      {row.isHit === true ? '已命中' : row.isHit === false ? '未命中' : '待观察'}
                    </span>
                  </div>
                  <p className="mt-4 text-lg font-semibold text-slate-900">{row.thesis || '暂无核心结论'}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{row.whyNow || '暂无分析理由'}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">分析时价格</p>
                    <p className="mt-1 font-semibold text-slate-900">¥{formatMoney(row.priceAtAnalysis)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">当前价格</p>
                    <p className="mt-1 font-semibold text-slate-900">¥{formatMoney(row.currentPrice)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">后续表现</p>
                    <p className={`mt-1 font-semibold ${row.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {formatPercent(row.changePercent)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">置信度</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatPercent((row.confidence || 0) * 100)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="rounded-xl bg-blue-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-blue-700">
                    <Brain className="h-4 w-4" />
                    <p className="text-sm font-medium">操作建议说明</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{row.actionPlan || '暂无'}</p>
                </div>
                <div className="rounded-xl bg-violet-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-violet-700">
                    <Target className="h-4 w-4" />
                    <p className="text-sm font-medium">盘中快评</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{row.intradayQuickComment || '暂无'}</p>
                </div>
                <div className="rounded-xl bg-amber-50 px-4 py-4">
                  <div className="flex items-center gap-2 text-amber-700">
                    <TrendingUp className="h-4 w-4" />
                    <p className="text-sm font-medium">催化剂 / 风险</p>
                  </div>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {(row.catalysts || []).slice(0, 2).map((item: string) => <p key={item}>- 催化：{item}</p>)}
                    {(row.risks || []).slice(0, 2).map((item: string) => <p key={item}>- 风险：{item}</p>)}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {Object.entries(row.periodBacktests || {}).map(([key, item]: [string, any]) => (
                  <div key={key} className="rounded-xl bg-slate-50 px-4 py-4">
                    <p className="text-xs text-slate-500">{item.period} 日回测</p>
                    <p className={`mt-1 font-semibold ${item.changePercent == null ? 'text-slate-400' : item.changePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {item.changePercent == null ? '--' : formatPercent(item.changePercent)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.isHit === true ? '已命中' : item.isHit === false ? '未命中' : '样本不足'}
                    </p>
                  </div>
                ))}
              </div>

              {row.peerTakeaway && (
                <div className="mt-5 rounded-xl bg-emerald-50 px-4 py-4">
                  <p className="text-sm font-medium text-emerald-700">同板块横向结论</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{row.peerTakeaway}</p>
                </div>
              )}

              {row.portfolioAdvice && (
                <div className="mt-5 rounded-xl bg-violet-50 px-4 py-4">
                  <p className="text-sm font-medium text-violet-700">组合级建议</p>
                  <p className="mt-2 text-sm text-slate-700">
                    {row.portfolioAdvice.suggestedAction} · {row.portfolioAdvice.targetAllocation}
                  </p>
                </div>
              )}

              {(row.evidenceChain || []).length > 0 && (
                <div className="mt-5 rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-700">证据链摘要</p>
                  <div className="mt-2 space-y-2 text-sm text-slate-700">
                    {(row.evidenceChain || []).slice(0, 3).map((item: any, index: number) => (
                      <p key={`${item.title}-${index}`}>- {item.title}：{item.summary}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
