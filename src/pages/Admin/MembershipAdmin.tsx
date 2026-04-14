import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

type PlanKey = 'free' | 'basic' | 'premium';

interface AdminUserRow {
  id: string;
  email: string;
  name?: string;
  plan: PlanKey;
  created_at: string;
  membership: {
    plan: PlanKey;
    expiresAt: string | null;
    remainingDays: number | null;
    status: string;
  };
}

interface PendingOrder {
  id: string;
  order_no: string;
  plan_type: PlanKey;
  amount: number;
  payer_name?: string | null;
  note?: string | null;
  created_at: string;
  user?: {
    id: string;
    email: string;
    name?: string;
  } | null;
}

export default function MembershipAdmin() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const [durationMap, setDurationMap] = useState<Record<string, number>>({});
  const [planMap, setPlanMap] = useState<Record<string, PlanKey>>({});
  const [submittingKey, setSubmittingKey] = useState('');

  const sortedUsers = useMemo(
    () =>
      [...users].sort((a, b) => {
        const aDays = a.membership.remainingDays ?? -1;
        const bDays = b.membership.remainingDays ?? -1;
        return bDays - aDays;
      }),
    [users],
  );

  const loadDashboard = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError('');
    setAccessDenied(false);
    try {
      const response = await fetch(`/api/subscription/admin/summary?requesterId=${encodeURIComponent(user.id)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        if (response.status === 403) {
          setAccessDenied(true);
        }
        setError(data.error || '加载管理员数据失败');
        return;
      }

      setUsers(data.users || []);
      setPendingOrders(data.pendingOrders || []);
      setDurationMap(
        Object.fromEntries((data.users || []).map((item: AdminUserRow) => [item.id, 30])),
      );
      setPlanMap(
        Object.fromEntries(
          (data.users || []).map((item: AdminUserRow) => [
            item.id,
            item.membership.plan === 'free' ? 'basic' : item.membership.plan,
          ]),
        ),
      );
    } catch (requestError) {
      console.error('Load admin dashboard failed', requestError);
      setError('管理员数据加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const reviewOrder = async (orderId: string, action: 'approve' | 'reject', durationDays = 30) => {
    if (!user?.id) return;
    setSubmittingKey(orderId);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/subscription/admin/orders/${orderId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: user.id,
          action,
          durationDays,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || '审核失败');
        return;
      }
      setSuccess(action === 'approve' ? '订单已审核并开通会员。' : '订单已驳回。');
      await loadDashboard();
    } catch (requestError) {
      console.error('Review order failed', requestError);
      setError('审核失败，请稍后重试。');
    } finally {
      setSubmittingKey('');
    }
  };

  const updateMembership = async (targetUserId: string, action: 'grant' | 'revoke') => {
    if (!user?.id) return;
    setSubmittingKey(targetUserId);
    setError('');
    setSuccess('');
    try {
      const response = await fetch(`/api/subscription/admin/users/${targetUserId}/membership`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterId: user.id,
          action,
          plan: planMap[targetUserId] || 'basic',
          durationDays: durationMap[targetUserId] || 30,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || '会员更新失败');
        return;
      }
      setSuccess(action === 'revoke' ? '已降级为免费用户。' : '会员已开通/续期。');
      await loadDashboard();
    } catch (requestError) {
      console.error('Update membership failed', requestError);
      setError('会员更新失败，请稍后重试。');
    } finally {
      setSubmittingKey('');
    }
  };

  if (!user) {
    return (
      <div className="py-20 text-center">
        <h2 className="mb-4 text-2xl font-bold">请先登录</h2>
        <Link to="/login" className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white">
          去登录
        </Link>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <ShieldCheck className="mx-auto mb-4 h-10 w-10 text-slate-400" />
        <h1 className="mb-2 text-2xl font-bold text-slate-900">无权限访问</h1>
        <p className="text-slate-500">当前账号不是超级管理员，无法查看会员管理后台。</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="rounded-3xl bg-slate-900 px-8 py-10 text-white shadow-lg">
        <h1 className="text-3xl font-bold">超级管理员后台</h1>
        <p className="mt-3 text-sm text-slate-200">审核订单、开通会员、续期会员，并查看每位用户的剩余时长。</p>
      </div>

      {(success || error) && (
        <div className={`rounded-2xl px-5 py-4 text-sm font-medium ${success ? 'border border-green-200 bg-green-50 text-green-700' : 'border border-red-200 bg-red-50 text-red-600'}`}>
          {success || error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">待审核订单</h2>
          <div className="mt-5 space-y-4">
            {loading ? (
              <p className="text-sm text-slate-500">加载中...</p>
            ) : pendingOrders.length === 0 ? (
              <p className="text-sm text-slate-500">暂无待审核订单。</p>
            ) : (
              pendingOrders.map((order) => (
                <div key={order.id} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold text-slate-900">{order.order_no}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        {order.user?.name || '未知用户'} / {order.user?.email || order.user?.id || order.id}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        套餐：{order.plan_type === 'premium' ? '高级会员' : '基础会员'} / ¥{order.amount}
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        备注：{order.payer_name || '未填写'}{order.note ? `，${order.note}` : ''}
                      </p>
                    </div>
                    <div className="w-24">
                      <input
                        type="number"
                        min={1}
                        value={durationMap[order.id] || 30}
                        onChange={(event) =>
                          setDurationMap((prev) => ({ ...prev, [order.id]: Number(event.target.value) || 30 }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      />
                      <p className="mt-1 text-center text-xs text-slate-500">天数</p>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={() => void reviewOrder(order.id, 'approve', durationMap[order.id] || 30)}
                      disabled={submittingKey === order.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      通过并开通
                    </button>
                    <button
                      type="button"
                      onClick={() => void reviewOrder(order.id, 'reject')}
                      disabled={submittingKey === order.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" />
                      驳回
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">会员管理</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="pb-3 pr-4 font-medium">用户</th>
                  <th className="pb-3 pr-4 font-medium">当前等级</th>
                  <th className="pb-3 pr-4 font-medium">到期时间</th>
                  <th className="pb-3 pr-4 font-medium">剩余</th>
                  <th className="pb-3 pr-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="py-6 text-slate-500" colSpan={5}>加载中...</td>
                  </tr>
                ) : (
                  sortedUsers.map((member) => (
                    <tr key={member.id} className="border-b border-slate-100 align-top">
                      <td className="py-4 pr-4">
                        <p className="font-medium text-slate-900">{member.name || '未命名用户'}</p>
                        <p className="text-slate-500">{member.email}</p>
                      </td>
                      <td className="py-4 pr-4">
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                          {member.membership.plan === 'premium'
                            ? '高级会员'
                            : member.membership.plan === 'basic'
                              ? '基础会员'
                              : '免费版'}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-slate-600">
                        {member.membership.expiresAt
                          ? new Date(member.membership.expiresAt).toLocaleString('zh-CN', { hour12: false })
                          : '--'}
                      </td>
                      <td className="py-4 pr-4 text-slate-600">
                        {member.membership.remainingDays != null ? `${member.membership.remainingDays} 天` : '--'}
                      </td>
                      <td className="py-4 pr-0">
                        <div className="flex min-w-[280px] gap-2">
                          <select
                            value={planMap[member.id] || 'basic'}
                            onChange={(event) =>
                              setPlanMap((prev) => ({ ...prev, [member.id]: event.target.value as PlanKey }))
                            }
                            className="rounded-lg border border-slate-300 px-3 py-2"
                          >
                            <option value="basic">基础会员</option>
                            <option value="premium">高级会员</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={durationMap[member.id] || 30}
                            onChange={(event) =>
                              setDurationMap((prev) => ({ ...prev, [member.id]: Number(event.target.value) || 30 }))
                            }
                            className="w-20 rounded-lg border border-slate-300 px-3 py-2"
                          />
                          <button
                            type="button"
                            onClick={() => void updateMembership(member.id, 'grant')}
                            disabled={submittingKey === member.id}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-white disabled:opacity-60"
                          >
                            开通/续期
                          </button>
                          <button
                            type="button"
                            onClick={() => void updateMembership(member.id, 'revoke')}
                            disabled={submittingKey === member.id}
                            className="rounded-lg bg-slate-200 px-3 py-2 text-slate-700 disabled:opacity-60"
                          >
                            设为免费
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
