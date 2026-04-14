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
  const user = await getUserProfile(userId);
  if (!user) {
    return null;
  }

  const plan = normalizeUserPlan(user.plan);
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

export const buildPlanCatalog = () =>
  Object.entries(PLAN_DEFINITIONS).map(([key, value]) => ({
    key,
    ...value,
  }));
