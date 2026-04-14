import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Crown, QrCode, ShieldCheck, Sparkles } from 'lucide-react';

type PlanKey = 'free' | 'basic' | 'premium' | 'professional';
type ChannelKey = 'qq' | 'wechat' | 'alipay' | 'manual';

interface PlanDefinition {
  key: PlanKey;
  label: string;
  priceMonthly: number;
  aiDailyLimit: number | null;
  watchlistLimit: number | null;
  features: string[];
}

interface AiQuotaSummary {
  plan: PlanKey;
  planLabel: string;
  dailyLimit: number | null;
  usedToday: number;
  remainingToday: number | null;
  isUnlimited: boolean;
  requiresUpgrade: boolean;
  dateLabel: string;
}

interface PaymentOrder {
  id: string;
  order_no: string;
  plan_type: PlanKey;
  amount: number;
  channel: ChannelKey;
  status: string;
  created_at: string;
  note?: string | null;
}

const channelLabels: Record<ChannelKey, string> = {
  qq: 'QQ 联系开通',
  wechat: '微信收款',
  alipay: '支付宝收款',
  manual: '人工转账',
};

const statusLabels: Record<string, string> = {
  pending_review: '待审核',
  paid: '已确认',
  cancelled: '已取消',
  rejected: '未通过',
};

export default function Subscription() {
  const { user, setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>('qq');
  const [selectedPlan, setSelectedPlan] = useState<PlanKey>('premium');
  const [payerName, setPayerName] = useState('');
  const [note, setNote] = useState('');
  const [plans, setPlans] = useState<PlanDefinition[]>([]);
  const [aiQuota, setAiQuota] = useState<AiQuotaSummary | null>(null);
  const [orders, setOrders] = useState<PaymentOrder[]>([]);
  const [contacts, setContacts] = useState<{ qq?: string; wechat?: string; alipay?: string; note?: string }>({});
  const [activePlan, setActivePlan] = useState<PlanKey>((user?.plan as PlanKey) || 'free');

  if (!user) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold mb-4">请先登录以查看您的订阅</h2>
        <Link to="/login" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium">去登录</Link>
      </div>
    );
  }

  const selectedPlanDefinition = useMemo(
    () => plans.find((item) => item.key === selectedPlan) || null,
    [plans, selectedPlan],
  );

  const loadSummary = async () => {
    setSummaryLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/subscription/summary?userId=${encodeURIComponent(user.id)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || '加载会员信息失败');
        return;
      }

      setPlans(data.plans || []);
      setAiQuota(data.aiQuota || null);
      setOrders(data.orders || []);
      setContacts(data.contacts || {});
      setActivePlan((data.user?.plan || user.plan || 'free') as PlanKey);
      setUser({ ...user, ...(data.user || {}) });
    } catch (requestError) {
      console.error('Load subscription summary failed', requestError);
      setError('会员信息加载失败，请稍后重试。');
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const handleCreateOrder = async (plan: PlanKey) => {
    setLoading(true);
    setSuccess('');
    setError('');
    try {
      const response = await fetch('/api/subscription/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          plan,
          channel: selectedChannel,
          payerName,
          note,
        }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setSuccess(
          `订单 ${data.order.order_no} 已创建，请按页面提示通过${channelLabels[selectedChannel]}联系你并等待人工确认开通。`,
        );
        setNote('');
        await loadSummary();
      } else {
        setError(data.error || '创建订单失败，请稍后重试。');
      }
    } catch (requestError) {
      console.error('Create order failed', requestError);
      setError('创建订单失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (value?: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setSuccess('联系方式已复制，请备注订单号后联系开通。');
    } catch (copyError) {
      console.error('Copy failed', copyError);
      setError('复制失败，请手动记录联系方式。');
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-3xl bg-slate-900 px-8 py-10 text-white shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-blue-100">
              <Crown className="h-4 w-4" />
              收费能力已落地
            </div>
            <h1 className="text-3xl font-bold">会员中心与人工收款</h1>
            <p className="max-w-2xl text-sm text-slate-200">
              先用最轻量的人工闭环跑通收费：用户创建订单 {'->'} 添加站长 QQ {'->'} QQ 转账并备注订单号 {'->'} 人工确认开通会员。
            </p>
          </div>
          <div className="rounded-2xl bg-white/10 p-5 text-sm leading-7">
            <p>当前套餐：<span className="font-semibold">{aiQuota?.planLabel || activePlan}</span></p>
            <p>
              今日 AI 次数：
              <span className="font-semibold">
                {aiQuota?.isUnlimited ? '不限' : `${aiQuota?.usedToday || 0}/${aiQuota?.dailyLimit || 0}`}
              </span>
            </p>
            <p>
              剩余次数：
              <span className="font-semibold">
                {aiQuota?.isUnlimited ? '无限制' : aiQuota?.remainingToday ?? '--'}
              </span>
            </p>
          </div>
        </div>
      </div>

      {(success || error) && (
        <div className={`rounded-2xl px-5 py-4 text-sm font-medium ${success ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-600'}`}>
          {success || error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((plan) => {
              const isCurrent = activePlan === plan.key;
              const highlighted = plan.key === 'premium';
              return (
                <div
                  key={plan.key}
                  className={`rounded-2xl border p-6 shadow-sm transition-colors ${
                    highlighted ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-100 bg-white text-slate-900'
                  }`}
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{plan.label}</h2>
                      <p className={`mt-1 text-sm ${highlighted ? 'text-blue-100' : 'text-slate-500'}`}>
                        {plan.aiDailyLimit == null ? 'AI 分析不限次' : `每日 ${plan.aiDailyLimit} 次 AI 分析`}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${highlighted ? 'bg-yellow-300 text-yellow-900' : 'bg-blue-100 text-blue-700'}`}>
                        当前
                      </span>
                    )}
                  </div>
                  <div className="mb-5 text-4xl font-bold">
                    ¥{plan.priceMonthly}
                    <span className={`ml-1 text-base font-normal ${highlighted ? 'text-blue-100' : 'text-slate-500'}`}>/月</span>
                  </div>
                  <ul className="space-y-3 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${highlighted ? 'text-blue-200' : 'text-green-500'}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {plan.key !== 'free' && (
                    <button
                      type="button"
                      onClick={() => setSelectedPlan(plan.key)}
                      className={`mt-6 w-full rounded-xl px-4 py-3 font-medium transition-colors ${
                        selectedPlan === plan.key
                          ? highlighted
                            ? 'bg-white text-blue-600'
                            : 'bg-slate-900 text-white'
                          : highlighted
                            ? 'bg-blue-500 text-white hover:bg-blue-400'
                            : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {selectedPlan === plan.key ? '已选此套餐' : '选择此套餐'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3">
              <QrCode className="h-6 w-6 text-blue-600" />
              <div>
                <h2 className="text-xl font-bold text-slate-900">创建付款订单</h2>
                <p className="text-sm text-slate-500">先生成订单号，再添加站长 QQ 完成转账，最后人工审核开通。</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {(['qq', 'wechat', 'alipay', 'manual'] as ChannelKey[]).map((channel) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setSelectedChannel(channel)}
                  className={`rounded-2xl border px-4 py-4 text-left transition-colors ${
                    selectedChannel === channel
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  <p className="font-semibold text-slate-900">{channelLabels[channel]}</p>
                  <p className="mt-2 text-sm text-slate-500">
                    {channel === 'qq'
                      ? '推荐先加 QQ，沟通套餐与付款后人工开通。'
                      : channel === 'wechat'
                      ? '推荐微信转账，备注订单号。'
                      : channel === 'alipay'
                        ? '支持支付宝手动付款。'
                        : '支持线下或人工沟通转账。'}
                  </p>
                </button>
              ))}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">付款人备注</span>
                <input
                  type="text"
                  value={payerName}
                  onChange={(event) => setPayerName(event.target.value)}
                  placeholder="例如：张三 / QQ 昵称"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">补充说明</span>
                <input
                  type="text"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="可填付款时间、转账尾号"
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">当前将创建：{selectedPlanDefinition?.label || '--'}</p>
                  <p className="mt-1 text-blue-700">金额：¥{selectedPlanDefinition?.priceMonthly ?? '--'} / 月</p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      selectedChannel === 'qq'
                        ? contacts.qq
                        : selectedChannel === 'wechat'
                          ? contacts.wechat
                          : selectedChannel === 'alipay'
                            ? contacts.alipay
                            : contacts.qq,
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 font-medium text-blue-700 shadow-sm"
                >
                  <Copy className="h-4 w-4" />
                  复制联系方式
                </button>
              </div>
              <p>站长 QQ：{contacts.qq || '待配置'}</p>
              <p>微信收款：{contacts.wechat || '待配置'}</p>
              <p>支付宝收款：{contacts.alipay || '待配置'}</p>
              <p className="text-blue-700">{contacts.note || '创建订单后请把订单号作为付款备注。'}</p>
            </div>

            <button
              type="button"
              onClick={() => handleCreateOrder(selectedPlan)}
              disabled={loading || selectedPlan === 'free'}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles className="h-5 w-5" />
              {loading ? '正在创建订单...' : '创建待联系订单'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-bold text-slate-900">今日额度</h2>
            </div>
            {summaryLoading ? (
              <p className="text-sm text-slate-500">加载中...</p>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-slate-600">统计日期：{aiQuota?.dateLabel || '--'}</p>
                <p className="text-slate-600">当前套餐：{aiQuota?.planLabel || '--'}</p>
                <p className="text-slate-600">
                  AI 分析：
                  <span className="font-semibold text-slate-900">
                    {aiQuota?.isUnlimited ? '不限次' : `${aiQuota?.usedToday || 0}/${aiQuota?.dailyLimit || 0}`}
                  </span>
                </p>
                <p className="text-slate-600">
                  剩余次数：
                  <span className="font-semibold text-slate-900">
                    {aiQuota?.isUnlimited ? '无限制' : aiQuota?.remainingToday ?? '--'}
                  </span>
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">最近订单</h2>
            <div className="mt-4 space-y-3">
              {orders.length === 0 ? (
                <p className="text-sm text-slate-500">还没有付款订单，创建后会显示在这里。</p>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="rounded-xl bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-900">{order.order_no}</p>
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                        {statusLabels[order.status] || order.status}
                      </span>
                    </div>
                    <p className="mt-2 text-slate-600">{channelLabels[order.channel]} / ¥{order.amount}</p>
                    <p className="mt-1 text-slate-500">套餐：{order.plan_type}</p>
                    <p className="mt-1 text-slate-500">{new Date(order.created_at).toLocaleString('zh-CN', { hour12: false })}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
