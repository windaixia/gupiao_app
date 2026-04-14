import { Router, type Request, type Response } from 'express';
import { supabase } from '../utils/supabase.js';
import {
  buildPlanCatalog,
  createPendingPaymentOrder,
  getAdminDashboardData,
  getAiQuotaSummary,
  getBillingContacts,
  getMembershipSummary,
  getRecentPaymentOrders,
  getUserProfile,
  grantMembership,
  isSuperAdminUser,
  normalizeUserPlan,
  reviewPaymentOrder,
  revokeMembership,
  type PaymentChannel,
  type UserPlan,
} from '../utils/billing.js';

const router = Router();

const ensureAdminRequest = async (requesterId?: string) => {
  if (!requesterId) {
    return { ok: false, status: 400, error: 'requesterId is required' } as const;
  }

  const isAdmin = await isSuperAdminUser(requesterId);
  if (!isAdmin) {
    return { ok: false, status: 403, error: '仅超级管理员可执行此操作' } as const;
  }

  return { ok: true } as const;
};

/**
 * Get Subscription
 * GET /api/subscription
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    // In a real app, you would get user_id from auth middleware
    // Here we'll just require it in query for simplicity, or use auth token
    const userId = req.query.userId as string;

    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is no rows returned
      res.status(500).json({ error: 'Error fetching subscription' });
      return;
    }

    res.status(200).json({
      success: true,
      subscription: data || null,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get Billing Summary
 * GET /api/subscription/summary?userId=...
 */
router.get('/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.query.userId as string;
    if (!userId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const [user, membership, aiQuota, orders, isAdmin] = await Promise.all([
      getUserProfile(userId),
      getMembershipSummary(userId),
      getAiQuotaSummary(userId),
      getRecentPaymentOrders(userId),
      isSuperAdminUser(userId),
    ]);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: normalizeUserPlan(user.plan),
        isAdmin,
      },
      membership,
      aiQuota,
      orders,
      plans: buildPlanCatalog(),
      contacts: getBillingContacts(),
    });
  } catch (error) {
    console.error('Billing summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/admin/summary', async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.query.requesterId as string;
    const auth = await ensureAdminRequest(requesterId);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const dashboard = await getAdminDashboardData();
    res.json({
      success: true,
      ...dashboard,
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/orders/:orderId/review', async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.body.requesterId as string | undefined;
    const auth = await ensureAdminRequest(requesterId);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { action, durationDays } = req.body as { action?: 'approve' | 'reject'; durationDays?: number };
    if (!action || !['approve', 'reject'].includes(action)) {
      res.status(400).json({ error: 'action must be approve or reject' });
      return;
    }

    const result = await reviewPaymentOrder({
      orderId: req.params.orderId,
      action,
      reviewerId: requesterId!,
      durationDays: Number.isFinite(durationDays) && durationDays ? durationDays : 30,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Review payment order error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

router.post('/admin/users/:userId/membership', async (req: Request, res: Response): Promise<void> => {
  try {
    const requesterId = req.body.requesterId as string | undefined;
    const auth = await ensureAdminRequest(requesterId);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { plan, durationDays = 30, action } = req.body as {
      plan?: UserPlan;
      durationDays?: number;
      action?: 'grant' | 'revoke';
    };

    if (action === 'revoke') {
      const membership = await revokeMembership(req.params.userId);
      res.json({ success: true, membership });
      return;
    }

    if (!plan || !['basic', 'premium'].includes(plan)) {
      res.status(400).json({ error: 'plan must be basic or premium' });
      return;
    }

    const membership = await grantMembership({
      userId: req.params.userId,
      plan,
      durationDays: Number.isFinite(durationDays) && durationDays ? durationDays : 30,
      source: `admin:${requesterId}`,
    });

    res.json({ success: true, membership });
  } catch (error) {
    console.error('Admin membership update error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
});

/**
 * Create Manual Order (pending review)
 * POST /api/subscription/order
 */
router.post('/order', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, plan, channel, payerName, note } = req.body as {
      userId?: string;
      plan?: UserPlan;
      channel?: PaymentChannel;
      payerName?: string;
      note?: string;
    };

    if (!userId || !plan || !channel) {
      res.status(400).json({ error: 'userId, plan, and channel are required' });
      return;
    }

    if (!['basic', 'premium'].includes(plan)) {
      res.status(400).json({ error: 'Unsupported plan' });
      return;
    }

    if (channel !== 'qq') {
      res.status(400).json({ error: 'Unsupported channel' });
      return;
    }

    const user = await getUserProfile(userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const created = await createPendingPaymentOrder({
      userId,
      plan,
      channel,
      payerName,
      note,
    });

    res.status(201).json({
      success: true,
      ...created,
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({
      error:
        error instanceof Error && error.message.includes('payment_orders table is missing')
          ? '收费订单表尚未初始化，请先在 Supabase 执行 20260414_manual_billing.sql。'
          : 'Internal server error',
    });
  }
});

/**
 * Upgrade Subscription
 * POST /api/subscription/upgrade
 */
router.post('/upgrade', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, plan, paymentMethod } = req.body;

    if (!userId || !plan || !paymentMethod) {
      res.status(400).json({ error: 'userId, plan, and paymentMethod are required' });
      return;
    }

    // Calculate dates
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1); // 1 month subscription

    // Mock payment processing here
    const amount = plan === 'premium' ? 199.0 : 149.0;

    const { data, error } = await supabase
      .from('subscriptions')
      .insert([
        {
          user_id: userId,
          plan_type: plan,
          start_date: startDate.toISOString(),
          end_date: endDate.toISOString(),
          status: 'active',
          amount: amount,
          payment_info: { method: paymentMethod, status: 'success' },
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ error: 'Error processing subscription' });
      return;
    }

    // Update user plan
    const { error: updateError } = await supabase
      .from('users')
      .update({ plan: plan })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user plan:', updateError);
    }

    res.status(200).json({
      success: true,
      subscription: data,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
