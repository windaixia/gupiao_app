import { Router, type Request, type Response } from 'express';
import { supabase } from '../utils/supabase.js';
import yahooFinance from 'yahoo-finance2';

const router = Router();

// Middleware to initialize portfolio if it doesn't exist
const ensurePortfolio = async (userId: string) => {
  const { data: portfolio } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!portfolio) {
    const { data: newPortfolio } = await supabase
      .from('portfolios')
      .insert([{ user_id: userId, balance: 100000.00, total_value: 100000.00 }])
      .select()
      .single();
    return newPortfolio;
  }
  return portfolio;
};

/**
 * Get user portfolio and positions
 * GET /api/trade/portfolio/:userId
 */
router.get('/portfolio/:userId', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId } = req.params;
    
    // 1. Get or create portfolio
    let portfolio = await ensurePortfolio(userId);
    
    // 2. Get positions
    const { data: positions } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .gt('quantity', 0);

    // 3. Update total value based on current market prices
    let positionsValue = 0;
    const updatedPositions = [];

    if (positions && positions.length > 0) {
      for (const pos of positions) {
        try {
          const quote: any = await yahooFinance.quote(pos.stock_code);
          const currentPrice = quote.regularMarketPrice;
          const currentTotal = currentPrice * pos.quantity;
          const profitLoss = currentTotal - (pos.average_price * pos.quantity);
          const profitLossPercent = (profitLoss / (pos.average_price * pos.quantity)) * 100;
          
          positionsValue += currentTotal;
          updatedPositions.push({
            ...pos,
            current_price: currentPrice,
            current_total: currentTotal,
            profit_loss: profitLoss,
            profit_loss_percent: profitLossPercent
          });
        } catch (e) {
          console.error('Failed to update price for', pos.stock_code);
          // Fallback to average price if fetch fails
          positionsValue += (pos.average_price * pos.quantity);
          updatedPositions.push({
            ...pos,
            current_price: pos.average_price,
            current_total: pos.average_price * pos.quantity,
            profit_loss: 0,
            profit_loss_percent: 0
          });
        }
      }
      
      // Update portfolio total_value
      const newTotalValue = portfolio.balance + positionsValue;
      await supabase
        .from('portfolios')
        .update({ total_value: newTotalValue, updated_at: new Date() })
        .eq('id', portfolio.id);
        
      portfolio.total_value = newTotalValue;
    }

    // 4. Get recent trades
    const { data: trades } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('trade_date', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      portfolio,
      positions: updatedPositions,
      trades: trades || []
    });

  } catch (error) {
    console.error('Portfolio Error:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

/**
 * Execute Trade (BUY/SELL)
 * POST /api/trade/execute
 */
router.post('/execute', async (req: Request, res: Response): Promise<void> => {
  try {
    const { userId, stockCode, stockName, tradeType, quantity, price } = req.body;
    const totalAmount = quantity * price;
    
    if (quantity <= 0) {
      res.status(400).json({ error: 'Quantity must be greater than 0' });
      return;
    }

    const portfolio = await ensurePortfolio(userId);

    if (tradeType === 'BUY') {
      // 1. Check balance
      if (portfolio.balance < totalAmount) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }

      // 2. Deduct balance
      await supabase
        .from('portfolios')
        .update({ balance: portfolio.balance - totalAmount })
        .eq('id', portfolio.id);

      // 3. Update or create position
      const { data: existingPos } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .eq('stock_code', stockCode)
        .single();

      if (existingPos) {
        const newQuantity = existingPos.quantity + quantity;
        const newAveragePrice = ((existingPos.average_price * existingPos.quantity) + totalAmount) / newQuantity;
        await supabase
          .from('positions')
          .update({ quantity: newQuantity, average_price: newAveragePrice, updated_at: new Date() })
          .eq('id', existingPos.id);
      } else {
        await supabase
          .from('positions')
          .insert([{ user_id: userId, stock_code: stockCode, stock_name: stockName, quantity, average_price: price }]);
      }

    } else if (tradeType === 'SELL') {
      // 1. Check position
      const { data: existingPos } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .eq('stock_code', stockCode)
        .single();

      if (!existingPos || existingPos.quantity < quantity) {
        res.status(400).json({ error: 'Insufficient stock quantity to sell' });
        return;
      }

      // 2. Add balance
      await supabase
        .from('portfolios')
        .update({ balance: portfolio.balance + totalAmount })
        .eq('id', portfolio.id);

      // 3. Update position
      const newQuantity = existingPos.quantity - quantity;
      await supabase
        .from('positions')
        .update({ quantity: newQuantity, updated_at: new Date() })
        .eq('id', existingPos.id);
    } else {
      res.status(400).json({ error: 'Invalid trade type' });
      return;
    }

    // 4. Record Trade
    await supabase
      .from('trades')
      .insert([{
        user_id: userId,
        stock_code: stockCode,
        stock_name: stockName,
        trade_type: tradeType,
        quantity,
        price,
        total_amount: totalAmount
      }]);

    res.json({ success: true, message: `Successfully ${tradeType} ${quantity} shares of ${stockCode}` });
  } catch (error) {
    console.error('Trade Execution Error:', error);
    res.status(500).json({ error: 'Trade execution failed' });
  }
});

export default router;
