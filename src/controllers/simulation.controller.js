import { endpoint, rows, one, found, insert, number, text, choice, id } from '../utils/api.js';
import { ownedLoan } from '../services/loan.service.js';
import { simulationDto } from '../utils/dto.js';
const ALLOWED_SIMULATION_TYPES = [
  'EXTRA_PAYMENT',
  'CHANGE_PAYMENT',
  'CHANGE_INTEREST_RATE',
  'EARLY_PAYOFF',
  'EXTRA_MONTHLY',
  'LUMP_SUM',
  'REFINANCE',
];

export const getSimulations = endpoint(async req => (await rows('SELECT * FROM simulations WHERE user_id=$1 ORDER BY created_at DESC', [req.user.user_id])).map(simulationDto));
export const createSimulation = endpoint(async req => {
  const b = req.body; await ownedLoan(req.user.user_id, b.loan_id);
  const rawType = String(b.simulation_type ?? b.scenario_type ?? 'EXTRA_PAYMENT').trim().toUpperCase();
  return simulationDto(await insert('simulations', { user_id: req.user.user_id, loan_id: b.loan_id,
    scenario_name: b.scenario_name ? text(b.scenario_name, 'scenario_name', 150) : null,
    scenario_type: choice(rawType, 'simulation_type', ALLOWED_SIMULATION_TYPES),
    extra_payment: number(b.extra_monthly_payment ?? b.extra_payment ?? 0, 'extra_monthly_payment'),
    lump_sum_payment: number(b.lump_sum_payment ?? 0, 'lump_sum_payment'),
    estimated_interest_saved: number(b.saved_interest ?? b.estimated_interest_saved ?? 0, 'saved_interest'),
    months_reduced: number(b.time_saved_months ?? b.months_reduced ?? 0, 'time_saved_months', 0, 600, true),
    early_payment_fee: number(b.early_payment_fee ?? 0, 'early_payment_fee'), estimated_interest: number(b.estimated_interest ?? 0, 'estimated_interest'),
    total_saving: number(b.total_saving ?? 0, 'total_saving') }));
}, 201);
export const deleteSimulation = endpoint(async req => found(await one('DELETE FROM simulations WHERE simulation_id=$1 AND user_id=$2 RETURNING simulation_id', [id(req.params.simulationId), req.user.user_id])));
