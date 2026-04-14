import { Router, type Request, type Response } from 'express';
import { supabase } from '../utils/supabase.js';
import {
  buildPlanCatalog,
  createPendingPaymentOrder,
  getActiveSubscription,
  getAiQuotaSummary,
  getBillingContacts,
  getRecentPaymentOrders,
  getUserProfile,
  normalizeUserPlan,
  type PaymentChannel,
  type UserPlan,
} from '../utils/billing.js';

const router = Router();

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

    const [user, subscription, aiQuota, orders] = await Promise.all([
      getUserProfile(userId),
      getActiveSubscription(userId),
      getAiQuotaSummary(userId),
      getRecentPaymentOrders(userId),
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
      },
      subscription,
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

    if (!['basic', 'premium', 'professional'].includes(plan)) {
      res.status(400).json({ error: 'Unsupported plan' });
      return;
    }

    if (!['wechat', 'alipay', 'manual'].includes(channel)) {
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
    const amount = plan === 'professional' ? 99.00 : (plan === 'premium' ? 29.00 : 0);

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
