import { endpoint, rows, one, found, id } from '../utils/api.js';
import { creditDto } from '../utils/dto.js';
import * as service from '../services/credit.service.js';
export const getCreditProfile = endpoint(async req => creditDto(found(await one('SELECT * FROM credit_profiles WHERE user_id=$1', [req.user.user_id]))));
export const recalculate = endpoint(async req => creditDto(await service.recalculate(req.user.user_id)));
export const getCreditReports = endpoint(async req => (await rows('SELECT * FROM credit_reports WHERE user_id=$1 ORDER BY generated_at DESC', [req.user.user_id])).map(creditDto));
export const getCreditReportDetail = endpoint(async req => creditDto(found(await one('SELECT * FROM credit_reports WHERE report_id=$1 AND user_id=$2', [id(req.params.id), req.user.user_id]))));
export const generateCreditReport = endpoint(async req => creditDto(await service.generateReport(req.user.user_id, req.body.report_period)), 201);
export const deleteCreditReport = endpoint(async req => found(await one('DELETE FROM credit_reports WHERE report_id=$1 AND user_id=$2 RETURNING report_id', [id(req.params.id), req.user.user_id])));
