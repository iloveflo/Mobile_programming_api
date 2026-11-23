import { endpoint, rows, one, found, insert, number, choice, id } from '../utils/api.js';
import { strategyDto } from '../utils/dto.js';
import { withTransaction } from '../config/db.js';
export const getStrategies = endpoint(async req => (await rows('SELECT * FROM debt_strategies WHERE user_id=$1 ORDER BY created_at DESC', [req.user.user_id])).map(strategyDto));
export const getActiveStrategy = endpoint(async req => strategyDto(await one("SELECT * FROM debt_strategies WHERE user_id=$1 AND status='ACTIVE'", [req.user.user_id])) || null);
export const applyStrategy = endpoint(async req => {
  const b = req.body;
  const data = { user_id: req.user.user_id, strategy_type: choice(b.strategy_type, 'strategy_type', ['AVALANCHE','SNOWBALL']), extra_payment: number(b.extra_payment ?? 0, 'extra_payment'), estimated_interest_saved: number(b.estimated_interest_saved ?? 0, 'estimated_interest_saved'), estimated_months_saved: number(b.estimated_months_saved ?? 0, 'estimated_months_saved', 0, 600, true) };
  return withTransaction(async db => {
    await db.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [req.user.user_id]);
    await db.query("UPDATE debt_strategies SET status='INACTIVE' WHERE user_id=$1 AND status='ACTIVE'", [req.user.user_id]);
    return strategyDto(await insert('debt_strategies', data, db));
  });
}, 201);
export const cancelStrategy = endpoint(async req => strategyDto(found(await one("UPDATE debt_strategies SET status='CANCELLED' WHERE strategy_id=$1 AND user_id=$2 RETURNING *", [id(req.params.strategyId), req.user.user_id]))));
