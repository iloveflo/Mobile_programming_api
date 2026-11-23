import { MAX_LTV_BY_ASSET_TYPE } from '../config/constants.js';

export const assetDto = a => ({
  ...a,
  estimated_value: a.asset_value,
  max_ltv_ratio: a.max_ltv_ratio ?? (MAX_LTV_BY_ASSET_TYPE[a.asset_type] ?? MAX_LTV_BY_ASSET_TYPE.OTHER),
});
export const loanDto = l => {
  const collaterals = (l.collaterals || []).map(assetDto);
  const totalCollateralValue = collaterals.reduce((sum, c) => sum + Number(c.asset_value || 0), 0);
  const ltvRatio = totalCollateralValue > 0 ? Math.round((Number(l.outstanding_amount || 0) / totalCollateralValue) * 10000) / 100 : null;
  return {
    ...l,
    loan_id: String(l.loan_id),
    lender: l.lender_name,
    loan_type_code: l.type_code || l.loan_type,
    remaining_principal: l.outstanding_amount,
    interest_rate: Math.round(Number(l.interest_rate) * 1000000) / 10000,
    interest_calculation_method: l.interest_method,
    due_date: l.end_date,
    remaining_term_months: Number(l.remaining_term_months ?? l.term_months),
    payment_day_of_month: l.payment_day_of_month || new Date(l.start_date).getUTCDate(),
    next_payment_date: l.next_payment_date ?? null,
    next_payment_amount: l.next_payment_amount ?? null,
    collaterals,
    ltv_ratio: ltvRatio,
  };
};
export const scheduleDto = s => ({ ...s, period_number: s.installment_number,
  principal_due: s.principal_amount, interest_due: s.interest_amount, total_due: s.total_amount,
  status: s.status === 'PENDING' ? 'UNPAID' : s.status });
const percent = value => value == null ? null : Math.round(Number(value) * 10000) / 100;
export const creditDto = p => ({ ...p, dti_ratio: percent(p.dti_ratio),
  ltv_ratio: percent(p.ltv_ratio),
  credit_utilization_ratio: percent(p.credit_utilization),
  payment_history_score: percent(p.on_time_payment_rate),
  risk_tier: p.risk_level, calculated_at: p.updated_at || p.generated_at });
export const strategyDto = s => s && ({ ...s, is_active: s.status === 'ACTIVE' });
export const simulationDto = s => ({ ...s, simulation_type: s.scenario_type,
  extra_monthly_payment: s.extra_payment, saved_interest: s.estimated_interest_saved, time_saved_months: s.months_reduced });
