import { Router, type Request, type Response } from 'express';
import { supabase } from '../utils/supabase.js';
import { isSuperAdminEmail } from '../utils/billing.js';

const router = Router();

/**
 * User Register
 * POST /api/auth/register
 */
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    // Use Supabase Auth for registration
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      res.status(400).json({ error: authError.message });
      return;
    }

    // Insert into custom users table as defined in architecture
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert([
        {
          id: authData.user?.id, // Link to Supabase Auth ID if possible, or generate new
          email,
          password_hash: 'managed_by_supabase', // Password managed by Supabase Auth
          name,
          plan: 'free',
          usage_count: 0,
        },
      ])
      .select()
      .single();

    if (userError) {
      console.error('Error creating user record:', userError);
      res.status(500).json({ error: 'Error creating user profile' });
      return;
    }

    res.status(201).json({
      success: true,
      user: {
        ...userData,
        isAdmin: isSuperAdminEmail(userData?.email || email),
      },
      session: authData.session,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * User Login
 * POST /api/auth/login
 */
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    // Use Supabase Auth for login
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      res.status(401).json({ error: authError.message });
      return;
    }

    // Fetch custom user profile
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (userError) {
      console.error('Error fetching user record:', userError);
    }

    res.status(200).json({
      success: true,
      user: userData
        ? { ...userData, isAdmin: isSuperAdminEmail(userData.email) }
        : { email: authData.user.email, isAdmin: isSuperAdminEmail(authData.user.email) },
      session: authData.session,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
