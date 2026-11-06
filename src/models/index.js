// src/models/index.js — Barrel Export toàn bộ Models Backend FinCredit
// Khớp chuẩn xác 100% với 21 Models của Flutter Frontend (lib/models/*.dart)

// 1. Nhóm Người dùng & Bảo mật
export * from './user.model.js';                     // khớp user_model.dart
export * from './bank-account.model.js';             // khớp bank_account_model.dart
export * from './refresh-token.model.js';            // khớp refresh_token_model.dart & session_model.dart
export * from './otp-verification.model.js';        // khớp otp_verification_model.dart

// 2. Nhóm Khoản vay & Tài sản
export * from './loan.model.js';                     // khớp loan_model.dart
export * from './loan-type.model.js';                // khớp loan_type_model.dart
export * from './asset.model.js';                    // khớp asset_model.dart & collateral_model.dart
export * from './loan-document.model.js';            // khớp loan_document_model.dart

// 3. Nhóm Phân kỳ, Thanh toán & Thông báo
export * from './payment-schedule.model.js';         // khớp payment_schedule_model.dart
export * from './payment.model.js';                  // khớp payment_model.dart
export * from './notification.model.js';             // khớp notification_model.dart
export * from './notification-preference.model.js';  // khớp notification_preference_model.dart

// 4. Nhóm Sức khỏe Tín dụng & Báo cáo
export * from './credit-profile.model.js';           // khớp credit_profile_model.dart
export * from './credit-report.model.js';            // khớp credit_report_model.dart

// 5. Nhóm Tối ưu Nợ & Mô phỏng
export * from './debt.model.js';                     // khớp debt_strategy_model.dart
export * from './simulation.model.js';               // khớp simulation_model.dart
