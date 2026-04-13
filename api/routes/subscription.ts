import { Router, type Request, type Response } from 'express';
import { supabase } from '../utils/supabase.js';

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