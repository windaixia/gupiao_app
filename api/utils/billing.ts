import crypto from 'node:crypto';
import { supabase } from './supabase.js';

export type UserPlan = 'free' | 'basic' | 'premium';
export type PaymentChannel = 'qq';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

export const PLAN_DEFINITIONS: Record<
  UserPlan,
  {
    label: string;
    priceMonthly: number;
    aiDailyLimit: number | null;
    watchlistLimit: number | null;
    features: string[];
  }
> = {
  free: {
    label: '免费版',
    priceMonthly: 0,
    aiDailyLimit: 3,
    watchlistLimit: 5,
    features: ['每日 3 次 AI 分析', '基础行情查看', '最多 5 支自选股'],
  },
  basic: {
    label: '基础会员',
    priceMonthly: 149,
    aiDailyLimit: 10,
    watchlistLimit: 20,
    features: ['每日 10 次 AI 分析', '最多 20 支自选股', '适合轻度使用'],
  },
  premium: {
    label: '高级会员',
    priceMonthly: 199,
    aiDailyLimit: null,
    watchlistLimit: null,
    features: ['不限次 AI 分析', '不限自选股', '分析历史与深度报告'],
  },
};

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  qq: 'QQ 联系开通',
};

export const normalizeUserPlan = (plan?: string | null): UserPlan => {
  if (plan === 'professional') {
    return 'premium';
  }
  if (plan && plan in PLAN_DEFINITIONS) {
    return plan as UserPlan;
  }
  return 'free';
};

export const getPlanDefinition = (plan?: string | null) => PLAN_DEFINITIONS[normalizeUserPlan(plan)];

export const getBillingContacts = () => ({
  qq: process.env.BILLING_CONTACT_QQ || '请在服务器环境变量中设置 BILLING_CONTACT_QQ',
  note:
    process.env.BILLING_CONTACT_NOTE ||
    '创建订单后请添加站长 QQ，备注订单号并完成转账，人工确认后开通会员。',
});

const getSuperAdminEmails = () =>
  String(process.env.SUPER_ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const getSuperAdminUserIds = () =>
  String(process.env.SUPER_ADMIN_USER_IDS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const isSuperAdminEmail = (email?: string | null) =>
  !!email && getSuperAdminEmails().includes(email.trim().toLowerCase());

const getBeijingDayRange = () => {
  const now = Date.now();
  const beijingNow = new Date(now + BEIJING_OFFSET_MS);
  const startBeijing = new Date(beijingNow);
  startBeijing.setUTCHours(0, 0, 0, 0);
  const endBeijing = new Date(startBeijing);
  endBeijing.setUTCDate(endBeijing.getUTCDate() + 1);

  return {
    startIso: new Date(startBeijing.getTime() - BEIJING_OFFSET_MS).toISOString(),
    endIso: new Date(endBeijing.getTime() - BEIJING_OFFSET_MS).toISOString(),
    dateLabel: startBeijing.toISOString().slice(0, 10),
  };
};

export const getUserProfile = async (userId: string) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, plan, usage_count, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

export const getActiveSubscription = async (userId: string) => {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

export const isSuperAdminUser = async (userId?: string | null) => {
  if (!userId) return false;
  if (getSuperAdminUserIds().includes(userId)) return true;
  const user = await getUserProfile(userId);
  return !!user && isSuperAdminEmail(user.email);
};

const toDateOrNull = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const diffDaysCeil = (future?: string | null) => {
  const end = toDateOrNull(future);
  if (!end) return null;
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
};

export const syncMembershipState = async (userId: string) => {
  const user = await getUserProfile(userId);
  if (!user) return null;

  const { data: subscriptions, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('end_date', { ascending: false });

  if (error) {
    throw error;
  }

  const rows = subscriptions || [];
  const now = Date.now();
  const expiredActiveIds = rows
    .filter((row) => row.status === 'active' && toDateOrNull(row.end_date)?.getTime() && toDateOrNull(row.end_date)!.getTime() <= now)
    .map((row) => row.id);

  if (expiredActiveIds.length > 0) {
    await supabase
      .from('subscriptions')
      .update({ status: 'expired' })
      .in('id', expiredActiveIds);
  }

  const activeSubscription =
    rows.find((row) => {
      if (row.status !== 'active') return false;
      const endAt = toDateOrNull(row.end_date);
      return !endAt || endAt.getTime() > now;
    }) || null;

  const normalizedPlan = activeSubscription ? normalizeUserPlan(activeSubscription.plan_type) : 'free';
  if (normalizeUserPlan(user.plan) !== normalizedPlan) {
    await supabase.from('users').update({ plan: normalizedPlan }).eq('id', userId);
    user.plan = normalizedPlan;
  }

  return {
    user: {
      ...user,
      plan: normalizedPlan,
    },
    activeSubscription,
  };
};

export const getMembershipSummary = async (userId: string) => {
  const synced = await syncMembershipState(userId);
  if (!synced) return null;

  const { user, activeSubscription } = synced;
  const plan = normalizeUserPlan(user.plan);
  const definition = getPlanDefinition(plan);
  const expiresAt = activeSubscription?.end_date || null;
  const remainingDays = diffDaysCeil(expiresAt);

  return {
    plan,
    planLabel: definition.label,
    isActive: plan !== 'free',
    expiresAt,
    startAt: activeSubscription?.start_date || null,
    remainingDays,
    subscriptionStatus: activeSubscription?.status || (plan === 'free' ? 'inactive' : 'active'),
  };
};

const isMissingPaymentOrdersTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.message?.includes('payment_orders'));

export const getRecentPaymentOrders = async (userId: string) => {
  const { data, error } = await supabase
    .from('payment_orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (isMissingPaymentOrdersTable(error)) {
    return [];
  }

  if (error) {
    throw error;
  }

  return data || [];
};

export const getTodayAiUsageCount = async (userId: string) => {
  const { startIso, endIso } = getBeijingDayRange();
  const { count, error } = await supabase
    .from('analysis_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('analysis_type', ['comprehensive', 'event_refresh'])
    .gte('analysis_date', startIso)
    .lt('analysis_date', endIso);

  if (error) {
    throw error;
  }

  return count || 0;
};

export const getAiQuotaSummary = async (userId: string) => {
  const membership = await getMembershipSummary(userId);
  if (!membership) {
    return null;
  }

  const plan = membership.plan;
  const definition = getPlanDefinition(plan);
  const usedToday = await getTodayAiUsageCount(userId);
  const remainingToday =
    definition.aiDailyLimit == null ? null : Math.max(definition.aiDailyLimit - usedToday, 0);

  return {
    plan,
    planLabel: definition.label,
    dailyLimit: definition.aiDailyLimit,
    usedToday,
    remainingToday,
    isUnlimited: definition.aiDailyLimit == null,
    requiresUpgrade:
      definition.aiDailyLimit != null ? usedToday >= definition.aiDailyLimit : false,
    dateLabel: getBeijingDayRange().dateLabel,
  };
};

export const ensureAiAccess = async (userId?: string | null) => {
  if (!userId) {
    return {
      allowed: false,
      status: 401,
      error: '请先登录后再使用 AI 分析，登录后可免费试用每日 3 次。',
      aiQuota: null,
    };
  }

  const aiQuota = await getAiQuotaSummary(userId);
  if (!aiQuota) {
    return {
      allowed: false,
      status: 404,
      error: '未找到当前用户信息，请重新登录后再试。',
      aiQuota: null,
    };
  }

  if (aiQuota.requiresUpgrade) {
    return {
      allowed: false,
      status: 403,
      error: '今日免费 AI 分析次数已用完，请升级会员继续使用。',
      aiQuota,
    };
  }

  return { allowed: true, status: 200, aiQuota };
};

export const ensureWatchlistAccess = async (userId: string, stockCode?: string | null) => {
  const user = await getUserProfile(userId);
  if (!user) {
    return {
      allowed: false,
      status: 404,
      error: '未找到当前用户信息，请重新登录后再试。',
    };
  }

  const plan = normalizeUserPlan(user.plan);
  const definition = getPlanDefinition(plan);
  if (definition.watchlistLimit == null) {
    return { allowed: true, status: 200, plan };
  }

  if (stockCode) {
    const { data: existing, error: existingError } = await supabase
      .from('watchlist')
      .select('id')
      .eq('user_id', userId)
      .eq('stock_code', stockCode)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existing) {
      return { allowed: true, status: 200, plan };
    }
  }

  const { count, error } = await supabase
    .from('watchlist')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    throw error;
  }

  if ((count || 0) >= definition.watchlistLimit) {
    return {
      allowed: false,
      status: 403,
      error: `当前套餐最多支持 ${definition.watchlistLimit} 支自选股，请升级会员后继续添加。`,
      plan,
      limit: definition.watchlistLimit,
    };
  }

  return { allowed: true, status: 200, plan };
};

export const generateOrderNo = () => {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `AI${stamp}${suffix}`;
};

export const createPendingPaymentOrder = async ({
  userId,
  plan,
  channel,
  payerName,
  note,
}: {
  userId: string;
  plan: UserPlan;
  channel: PaymentChannel;
  payerName?: string;
  note?: string;
}) => {
  const definition = getPlanDefinition(plan);
  const orderNo = generateOrderNo();
  const contacts = getBillingContacts();

  const { data, error } = await supabase
    .from('payment_orders')
    .insert([
      {
        user_id: userId,
        order_no: orderNo,
        plan_type: plan,
        amount: definition.priceMonthly,
        channel,
        status: 'pending_review',
        payer_name: payerName?.trim() || null,
        note: note?.trim() || null,
        contact_snapshot: contacts,
      },
    ])
    .select()
    .single();

  if (isMissingPaymentOrdersTable(error)) {
    throw new Error('payment_orders table is missing. Please run migration 20260414_manual_billing.sql first.');
  }

  if (error) {
    throw error;
  }

  return {
    order: data,
    contacts,
    planLabel: definition.label,
    channelLabel: PAYMENT_CHANNEL_LABELS[channel],
  };
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const grantMembership = async ({
  userId,
  plan,
  durationDays = 30,
  source,
}: {
  userId: string;
  plan: UserPlan;
  durationDays?: number;
  source: string;
}) => {
  const synced = await syncMembershipState(userId);
  if (!synced) {
    throw new Error('User not found');
  }

  const currentActive = synced.activeSubscription;
  const baseDate =
    currentActive?.end_date && toDateOrNull(currentActive.end_date) && toDateOrNull(currentActive.end_date)!.getTime() > Date.now()
      ? toDateOrNull(currentActive.end_date)!
      : new Date();
  const nextEndDate = addDays(baseDate, durationDays);

  if (currentActive) {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        plan_type: plan,
        end_date: nextEndDate.toISOString(),
        payment_info: {
          ...(currentActive.payment_info || {}),
          lastGrantSource: source,
          durationDays,
        },
      })
      .eq('id', currentActive.id);

    if (error) throw error;
  } else {
    const { error } = await supabase.from('subscriptions').insert([
      {
        user_id: userId,
        plan_type: plan,
        status: 'active',
        start_date: new Date().toISOString(),
        end_date: nextEndDate.toISOString(),
        payment_info: {
          grantSource: source,
          durationDays,
        },
      },
    ]);

    if (error) throw error;
  }

  await supabase.from('users').update({ plan }).eq('id', userId);
  return getMembershipSummary(userId);
};

export const revokeMembership = async (userId: string) => {
  await supabase
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('user_id', userId)
    .eq('status', 'active');
  await supabase.from('users').update({ plan: 'free' }).eq('id', userId);
  return getMembershipSummary(userId);
};

export const reviewPaymentOrder = async ({
  orderId,
  action,
  reviewerId,
  durationDays = 30,
}: {
  orderId: string;
  action: 'approve' | 'reject';
  reviewerId: string;
  durationDays?: number;
}) => {
  const { data: order, error } = await supabase
    .from('payment_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (isMissingPaymentOrdersTable(error)) {
    throw new Error('payment_orders table is missing. Please run migration 20260414_manual_billing.sql first.');
  }
  if (error) throw error;
  if (!order) throw new Error('Order not found');

  if (action === 'approve') {
    const membership = await grantMembership({
      userId: order.user_id,
      plan: normalizeUserPlan(order.plan_type),
      durationDays,
      source: `payment_order:${order.order_no}:${reviewerId}`,
    });

    const { error: updateOrderError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', orderId);
    if (updateOrderError) throw updateOrderError;

    return { orderId, action, membership };
  }

  const { error: rejectError } = await supabase
    .from('payment_orders')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', orderId);
  if (rejectError) throw rejectError;

  return { orderId, action, membership: await getMembershipSummary(order.user_id) };
};

export const getAdminDashboardData = async () => {
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, name, plan, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (usersError) throw usersError;

  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from('subscriptions')
    .select('*')
    .order('end_date', { ascending: false })
    .limit(400);

  if (subscriptionsError) throw subscriptionsError;

  const pendingOrders = await (async () => {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false })
      .limit(100);
    if (isMissingPaymentOrdersTable(error)) return [];
    if (error) throw error;
    return data || [];
  })();

  const userMap = new Map((users || []).map((item) => [item.id, item]));
  const activeSubscriptionMap = new Map<string, any>();
  for (const row of subscriptions || []) {
    const endAt = toDateOrNull(row.end_date);
    if (row.status === 'active' && (!endAt || endAt.getTime() > Date.now()) && !activeSubscriptionMap.has(row.user_id)) {
      activeSubscriptionMap.set(row.user_id, row);
    }
  }

  return {
    users:
      (users || []).map((user) => {
        const activeSubscription = activeSubscriptionMap.get(user.id) || null;
        return {
          ...user,
          plan: normalizeUserPlan(user.plan),
          membership: {
            plan: activeSubscription ? normalizeUserPlan(activeSubscription.plan_type) : 'free',
            expiresAt: activeSubscription?.end_date || null,
            remainingDays: diffDaysCeil(activeSubscription?.end_date || null),
            status: activeSubscription?.status || 'inactive',
          },
        };
      }) || [],
    pendingOrders: pendingOrders.map((order) => ({
      ...order,
      user: userMap.get(order.user_id) || null,
    })),
  };
};

export const buildPlanCatalog = () =>
  Object.entries(PLAN_DEFINITIONS).map(([key, value]) => ({
    key,
    ...value,
  }));
