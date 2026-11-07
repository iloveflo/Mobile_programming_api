-- =========================================================
-- HÀM TRIGGER CẬP NHẬT UPDATED_AT TỰ ĐỘNG CHO POSTGRESQL
-- =========================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- 1. USERS
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
    user_id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    monthly_income DECIMAL(15,2),
    date_of_birth DATE,

    -- Thông tin hồ sơ định danh, việc làm & tín dụng (khớp UserModel FinCredit)
    avatar_url VARCHAR(500) NULL,
    id_card_number VARCHAR(20) UNIQUE NULL,
    address VARCHAR(255) NULL,
    occupation VARCHAR(100) NULL,
    workplace VARCHAR(150) NULL,
    contract_type VARCHAR(100) NULL,
    is_ekyc_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ekyc_tier VARCHAR(30) NULL,
    membership_tier VARCHAR(30) NOT NULL DEFAULT 'STANDARD',
    cic_score INT NULL,

    -- Bổ sung trường phục vụ bảo mật & quản trị tài khoản
    is_biometric_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_lock_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    lock_until TIMESTAMP NULL,
    failed_login_attempts INT NOT NULL DEFAULT 0,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 2. BANK ACCOUNTS (TÀI KHOẢN NGÂN HÀNG LIÊN KẾT)
-- =========================================================
CREATE TABLE IF NOT EXISTS bank_accounts (
    account_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(50) NOT NULL,
    account_holder_name VARCHAR(100) NOT NULL,
    is_default_disbursal BOOLEAN NOT NULL DEFAULT FALSE,
    is_auto_debit BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_bank_accounts_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT uq_user_bank_account
        UNIQUE (user_id, bank_name, account_number)
);

DROP TRIGGER IF EXISTS trg_bank_accounts_updated_at ON bank_accounts;
CREATE TRIGGER trg_bank_accounts_updated_at
BEFORE UPDATE ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 3. LOAN TYPES
-- =========================================================
CREATE TABLE IF NOT EXISTS loan_types (
    loan_type_id SERIAL PRIMARY KEY,
    type_code VARCHAR(30) NOT NULL UNIQUE, -- Mã chuẩn hóa: MORTGAGE, CAR, CONSUMER, CREDIT_CARD, OTHER
    type_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- 4. LOANS
-- =========================================================
CREATE TABLE IF NOT EXISTS loans (
    loan_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    loan_type_id INT NOT NULL,

    loan_name VARCHAR(150) NOT NULL,
    lender_name VARCHAR(100) NULL, -- Ngân hàng / Tổ chức tín dụng (Techcombank, Vietcombank, MBBank, VIB...)
    loan_type VARCHAR(30) NULL,    -- Khóa định danh loại: MORTGAGE, CAR, CONSUMER, CREDIT_CARD, OTHER

    principal_amount DECIMAL(15,2) NOT NULL,
    interest_rate DECIMAL(7,4) NOT NULL, -- Lãi suất hàng năm (ví dụ 0.0850 tương ứng 8.5%/năm)
    interest_method VARCHAR(50) NOT NULL, -- REDUCING_BALANCE hoặc FLAT

    term_months INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,

    outstanding_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    early_payment_fee_rate DECIMAL(7,4) DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, CLOSED, OVERDUE, SETTLED

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_loans_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_loans_type
        FOREIGN KEY (loan_type_id)
        REFERENCES loan_types(loan_type_id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);

DROP TRIGGER IF EXISTS trg_loans_updated_at ON loans;
CREATE TRIGGER trg_loans_updated_at
BEFORE UPDATE ON loans
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 5. ASSETS (TÀI SẢN BẢO ĐẢM / COLLATERAL)
-- =========================================================
CREATE TABLE IF NOT EXISTS assets (
    asset_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    loan_id BIGINT NULL,

    asset_name VARCHAR(150) NOT NULL,
    asset_type VARCHAR(50) NOT NULL, -- REAL_ESTATE, VEHICLE, SAVINGS, OTHER
    asset_value DECIMAL(15,2) NOT NULL,
    valuation_date DATE,
    legal_document_url VARCHAR(500) NULL,
    image_url VARCHAR(500) NULL,
    description TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_assets_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_assets_loan
        FOREIGN KEY (loan_id)
        REFERENCES loans(loan_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- =========================================================
-- 6. LOAN DOCUMENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS loan_documents (
    document_id BIGSERIAL PRIMARY KEY,

    loan_id BIGINT NOT NULL,

    document_type VARCHAR(50) NOT NULL,
    file_url VARCHAR(500) NOT NULL,

    ocr_status VARCHAR(30) DEFAULT 'PENDING',
    ocr_result JSONB,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_documents_loan
        FOREIGN KEY (loan_id)
        REFERENCES loans(loan_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

DROP TRIGGER IF EXISTS trg_loan_documents_updated_at ON loan_documents;
CREATE TRIGGER trg_loan_documents_updated_at
BEFORE UPDATE ON loan_documents
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 7. PAYMENT SCHEDULES
-- =========================================================
CREATE TABLE IF NOT EXISTS payment_schedules (
    schedule_id BIGSERIAL PRIMARY KEY,

    loan_id BIGINT NOT NULL,

    installment_number INT NOT NULL,
    due_date DATE NOT NULL,

    principal_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    interest_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    fee_amount DECIMAL(15,2) NOT NULL DEFAULT 0,

    total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    remaining_balance DECIMAL(15,2) NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_schedule_loan
        FOREIGN KEY (loan_id)
        REFERENCES loans(loan_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT uq_schedule_installment
        UNIQUE (loan_id, installment_number)
);

-- =========================================================
-- 8. PAYMENTS
-- =========================================================
CREATE TABLE IF NOT EXISTS payments (
    payment_id BIGSERIAL PRIMARY KEY,

    schedule_id BIGINT NOT NULL,

    paid_amount DECIMAL(15,2) NOT NULL,
    paid_date TIMESTAMP NOT NULL,

    payment_method VARCHAR(50) NOT NULL,
    transaction_reference VARCHAR(150),
    note TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_payments_schedule
        FOREIGN KEY (schedule_id)
        REFERENCES payment_schedules(schedule_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 9. CREDIT PROFILES
-- =========================================================
CREATE TABLE IF NOT EXISTS credit_profiles (
    profile_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL UNIQUE,

    credit_score INT,
    dti_ratio DECIMAL(7,4),
    ltv_ratio DECIMAL(7,4),
    credit_utilization DECIMAL(7,4),
    on_time_payment_rate DECIMAL(7,4),

    active_loan_count INT DEFAULT 0,
    risk_level VARCHAR(30),

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_credit_profiles_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

DROP TRIGGER IF EXISTS trg_credit_profiles_updated_at ON credit_profiles;
CREATE TRIGGER trg_credit_profiles_updated_at
BEFORE UPDATE ON credit_profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =========================================================
-- 10. CREDIT REPORTS
-- =========================================================
CREATE TABLE IF NOT EXISTS credit_reports (
    report_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    credit_score INT,
    dti_ratio DECIMAL(7,4),
    ltv_ratio DECIMAL(7,4),
    credit_utilization DECIMAL(7,4),
    on_time_payment_rate DECIMAL(7,4),

    total_debt DECIMAL(15,2) DEFAULT 0,
    overdue_amount DECIMAL(15,2) DEFAULT 0,

    risk_level VARCHAR(30),
    report_period VARCHAR(30),

    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_credit_reports_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 11. NOTIFICATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS notifications (
    notification_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    schedule_id BIGINT NULL,

    notification_type VARCHAR(50) NOT NULL,
    channel VARCHAR(30) NOT NULL,

    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,

    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_notifications_schedule
        FOREIGN KEY (schedule_id)
        REFERENCES payment_schedules(schedule_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
);

-- =========================================================
-- 12. DEBT STRATEGIES
-- =========================================================
CREATE TABLE IF NOT EXISTS debt_strategies (
    strategy_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    strategy_type VARCHAR(30) NOT NULL,
    extra_payment DECIMAL(15,2) DEFAULT 0,

    estimated_interest_saved DECIMAL(15,2),
    estimated_months_saved INT,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE, CANCELLED

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_strategies_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 13. SIMULATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS simulations (
    simulation_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,
    loan_id BIGINT NOT NULL,

    extra_payment DECIMAL(15,2) DEFAULT 0,

    early_payment_fee DECIMAL(15,2) DEFAULT 0,
    estimated_interest DECIMAL(15,2) DEFAULT 0,
    estimated_interest_saved DECIMAL(15,2) DEFAULT 0,

    months_reduced INT DEFAULT 0,
    total_saving DECIMAL(15,2) DEFAULT 0,

    scenario_type VARCHAR(50) NOT NULL DEFAULT 'EXTRA_PAYMENT',
    scenario_name VARCHAR(150) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'SIMULATION_REFERENCE',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_simulations_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_simulations_loan
        FOREIGN KEY (loan_id)
        REFERENCES loans(loan_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 14. REFRESH TOKENS & SESSIONS (QUẢN LÝ PHIÊN THIẾT BỊ)
-- =========================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    token TEXT NOT NULL,
    
    -- Thông tin thiết bị phục vụ màn hình M06 & SessionModel
    device_name VARCHAR(150) NULL,
    platform VARCHAR(100) NULL,
    ip_address VARCHAR(50) NULL,
    location VARCHAR(150) NULL,
    last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_refresh_tokens_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 15. OTP VERIFICATIONS
-- =========================================================
CREATE TABLE IF NOT EXISTS otp_verifications (
    otp_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NULL, -- Cho phép NULL khi OTP gửi cho luồng Đăng ký tài khoản mới
    email VARCHAR(150) NULL,
    phone VARCHAR(20) NULL,

    otp_code VARCHAR(10) NOT NULL,
    purpose VARCHAR(50) NOT NULL, -- REGISTER, FORGOT_PASSWORD, TRANSACTION, EMAIL_VERIFICATION

    attempt_count INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,

    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_otp_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- =========================================================
-- 16. NOTIFICATION PREFERENCES
-- =========================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
    preference_id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL UNIQUE,

    push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    balance_fluctuation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    monthly_statement_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    reminder_days INT NOT NULL DEFAULT 3,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_notification_preferences_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
BEFORE UPDATE ON notification_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- =========================================================
-- 17. DỮ LIỆU KHỞI TẠO MẪU (SEED DATA TƯƠNG THÍCH VỚI APP)
-- =========================================================

-- A. LOAN TYPES
INSERT INTO loan_types (loan_type_id, type_code, type_name, description) VALUES
(1, 'CONSUMER', 'Vay tiêu dùng / Tín chấp', 'Khoản vay tín chấp tiêu dùng không bắt buộc tài sản bảo đảm'),
(2, 'MORTGAGE', 'Vay thế chấp / Bất động sản', 'Khoản vay có tài sản bảo đảm là bất động sản hoặc nhà đất'),
(3, 'CAR', 'Vay mua xe / Ô tô', 'Khoản vay thế chấp mua phương tiện đi lại, ô tô'),
(4, 'CREDIT_CARD', 'Thẻ tín dụng', 'Hạn mức thấu chi thẻ tín dụng chi tiêu linh hoạt'),
(5, 'OTHER', 'Khoản vay khác', 'Các gói tín dụng và khoản vay cá nhân khác')
ON CONFLICT (loan_type_id) DO UPDATE SET type_name = EXCLUDED.type_name;

-- B. USERS (Tài khoản thử nghiệm tương thích UserMockData)
INSERT INTO users (
    user_id, full_name, email, phone, password_hash, monthly_income, date_of_birth,
    avatar_url, id_card_number, address, occupation, workplace, contract_type,
    is_ekyc_verified, ekyc_tier, membership_tier, cic_score,
    is_biometric_enabled, auto_lock_enabled, is_active
) VALUES (
    1, 'Nguyen Van Dev', 'dev@test.com', '0900000001', '123456', 25000000.00, '1998-05-12',
    NULL, '079201008888', 'Tòa nhà Landmark 81, P. 22, Q. Bình Thạnh, TP. Hồ Chí Minh', 'Kỹ sư Phần mềm Senior', 'Tập đoàn Công nghệ FPT', 'Hợp đồng lao động không xác định thời hạn',
    TRUE, 'C06', 'GOLD', 745,
    TRUE, TRUE, TRUE
)
ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name;

-- C. BANK ACCOUNTS (Tài khoản ngân hàng liên kết khớp UserMockData)
INSERT INTO bank_accounts (account_id, user_id, bank_name, account_number, account_holder_name, is_default_disbursal, is_auto_debit) VALUES
(1, 1, 'Techcombank', '190382918888', 'NGUYEN VAN DEV', TRUE, FALSE),
(2, 1, 'Vietcombank', '007100129999', 'NGUYEN VAN DEV', FALSE, TRUE)
ON CONFLICT (account_id) DO UPDATE SET bank_name = EXCLUDED.bank_name;

-- D. LOANS (Các khoản vay mẫu khớp với LoanMockData)
INSERT INTO loans (loan_id, user_id, loan_type_id, loan_name, lender_name, loan_type, principal_amount, interest_rate, interest_method, term_months, start_date, end_date, outstanding_amount, early_payment_fee_rate, status) VALUES
(101, 1, 3, 'Vay mua xe VinFast VF8', 'Vietcombank', 'CAR', 500000000.00, 0.0850, 'REDUCING_BALANCE', 48, '2025-06-15', '2029-06-15', 385000000.00, 0.0150, 'ACTIVE'),
(102, 1, 4, 'Thẻ tín dụng VIB Super Card', 'VIB', 'CREDIT_CARD', 100000000.00, 0.2400, 'FLAT', 12, '2026-01-05', '2027-01-05', 28500000.00, 0.0000, 'ACTIVE'),
(103, 1, 1, 'Vay tiêu dùng tín chấp', 'MBBank', 'CONSUMER', 80000000.00, 0.1200, 'REDUCING_BALANCE', 24, '2026-02-20', '2028-02-20', 62000000.00, 0.0200, 'ACTIVE'),
(104, 1, 2, 'Vay mua căn hộ Sunrise City', 'Techcombank', 'MORTGAGE', 1800000000.00, 0.0790, 'REDUCING_BALANCE', 120, '2024-03-10', '2034-03-10', 1540000000.00, 0.0250, 'ACTIVE'),
(105, 1, 1, 'Vay tiền mặt qua sao kê lương', 'FE Credit', 'CONSUMER', 30000000.00, 0.1800, 'FLAT', 12, '2025-01-15', '2026-01-15', 0.00, 0.0300, 'CLOSED')
ON CONFLICT (loan_id) DO UPDATE SET loan_name = EXCLUDED.loan_name;

-- E. ASSETS (Tài sản thế chấp khớp với AssetMockData)
INSERT INTO assets (asset_id, user_id, loan_id, asset_name, asset_type, asset_value, valuation_date, description) VALUES
(1, 1, 101, 'Ô tô VinFast VF8 Plus 2023', 'VEHICLE', 750000000.00, '2025-06-01', 'Xe thế chấp giải ngân khoản vay Vietcombank. Cavet gốc giữ tại ngân hàng.'),
(2, 1, 104, 'Căn hộ chung cư Sunrise City (85m2)', 'REAL_ESTATE', 2800000000.00, '2024-02-20', 'Sổ hồng căn hộ tháp W2, tầng 18. Thế chấp vay Techcombank.'),
(3, 1, NULL, 'Sổ tiết kiệm BIDV kỳ hạn 12 tháng', 'SAVINGS', 250000000.00, '2026-08-31', 'Tài sản thanh khoản cao dùng dự phòng tài chính.')
ON CONFLICT (asset_id) DO UPDATE SET asset_name = EXCLUDED.asset_name;

-- F. SESSIONS & REFRESH TOKENS (Các phiên đăng nhập khớp SessionModel)
INSERT INTO refresh_tokens (token_id, user_id, token, device_name, platform, ip_address, location, last_active, expires_at) VALUES
(1, 1, 'mock_refresh_token_001', 'iPhone 15 Pro Max', 'iOS 17.5 • FinCredit App', '113.161.45.12', 'TP. Hồ Chí Minh, Việt Nam', NOW(), '2026-12-31 23:59:59'),
(2, 1, 'mock_refresh_token_002', 'MacBook Pro 16" M3', 'macOS Sonoma • Chrome 128', '113.161.45.12', 'TP. Hồ Chí Minh, Việt Nam', NOW() - INTERVAL '3 hours', '2026-12-31 23:59:59'),
(3, 1, 'mock_refresh_token_003', 'Samsung Galaxy S24 Ultra', 'Android 14 • OneUI 6.1', '14.232.208.9', 'Hà Nội, Việt Nam', NOW() - INTERVAL '2 days', '2026-12-31 23:59:59')
ON CONFLICT (token_id) DO UPDATE SET device_name = EXCLUDED.device_name;

-- G. CREDIT PROFILE
INSERT INTO credit_profiles (user_id, credit_score, dti_ratio, ltv_ratio, credit_utilization, on_time_payment_rate, active_loan_count, risk_level) VALUES
(1, 745, 0.3200, 0.5500, 0.2850, 0.9800, 4, 'LOW')
ON CONFLICT (user_id) DO UPDATE SET credit_score = EXCLUDED.credit_score;

-- H. NOTIFICATION PREFERENCES
INSERT INTO notification_preferences (user_id, push_enabled, email_enabled, reminder_days, balance_fluctuation_enabled, monthly_statement_enabled) VALUES
(1, TRUE, TRUE, 3, TRUE, TRUE)
ON CONFLICT (user_id) DO UPDATE SET push_enabled = EXCLUDED.push_enabled;

-- I. PAYMENT SCHEDULES (Lịch phân kỳ trả nợ mẫu khớp PaymentScheduleMockData)
INSERT INTO payment_schedules (
    schedule_id, loan_id, installment_number, due_date,
    principal_amount, interest_amount, fee_amount, total_amount, remaining_balance, status, created_at
) VALUES
(1, 101, 1, '2026-08-10', 2083333.33, 625000.00, 0.00, 2708333.33, 47916666.67, 'PAID', '2026-01-10 10:10:00'),
(2, 101, 2, '2026-09-10', 2083333.33, 598958.33, 0.00, 2682291.66, 45833333.34, 'PAID', '2026-01-10 10:10:00'),
(3, 101, 3, '2026-10-10', 2083333.33, 572916.67, 50000.00, 2756250.00, 43750000.01, 'OVERDUE', '2026-01-10 10:10:00'),
(4, 101, 4, '2026-11-10', 2083333.33, 546875.00, 0.00, 2630208.33, 41666666.68, 'PENDING', '2026-01-10 10:10:00'),
(5, 101, 5, '2026-12-10', 2083333.33, 520833.33, 0.00, 2604166.66, 39583333.35, 'PENDING', '2026-01-10 10:10:00'),
(6, 102, 1, '2026-11-05', 2500000.00, 570000.00, 0.00, 3070000.00, 25930000.00, 'PENDING', '2026-01-05 10:00:00')
ON CONFLICT (schedule_id) DO UPDATE SET status = EXCLUDED.status;

-- J. PAYMENTS (Lịch sử thanh toán khớp PaymentMockData)
INSERT INTO payments (
    payment_id, schedule_id, paid_amount, paid_date, payment_method, transaction_reference, note, created_at
) VALUES
(1, 1, 2708333.33, '2026-02-08 14:30:00', 'BANK_TRANSFER', 'MOCK-TXN-0001', 'Thanh toán kỳ đầu tiên.', '2026-02-08 14:30:00'),
(2, 2, 2682291.66, '2026-03-08 14:25:00', 'BANK_TRANSFER', 'MOCK-TXN-0002', NULL, '2026-03-08 14:25:00')
ON CONFLICT (payment_id) DO UPDATE SET paid_amount = EXCLUDED.paid_amount;

-- K. CREDIT REPORTS (Báo cáo tín dụng định kỳ khớp CreditReportMockData)
INSERT INTO credit_reports (
    report_id, user_id, credit_score, dti_ratio, ltv_ratio, credit_utilization,
    on_time_payment_rate, total_debt, overdue_amount, risk_level, report_period, generated_at
) VALUES
(1, 1, 710, 0.3550, 0.0000, 0.4500, 0.9500, 58000000.00, 0.00, 'MEDIUM', '2026-06', '2026-07-01 08:00:00'),
(2, 1, 730, 0.3120, 0.0000, 0.3800, 1.0000, 50000000.00, 0.00, 'LOW', '2026-07', '2026-08-01 08:00:00'),
(3, 1, 745, 0.2850, 0.0000, 0.3200, 1.0000, 43750000.00, 0.00, 'LOW', '2026-08', '2026-09-01 08:00:00')
ON CONFLICT (report_id) DO UPDATE SET credit_score = EXCLUDED.credit_score;

-- L. NOTIFICATIONS (Thông báo nợ khớp NotificationMockData)
INSERT INTO notifications (
    notification_id, user_id, schedule_id, notification_type, channel,
    title, message, scheduled_at, sent_at, status, created_at
) VALUES
(1, 1, 3, 'OVERDUE_ALERT', 'PUSH', 'Cảnh báo kỳ thanh toán quá hạn', 'Kỳ 3 khoản vay mua xe của bạn đã quá ngày đến hạn (10/10/2026). Vui lòng thanh toán sớm để bảo đảm điểm tín dụng.', '2026-10-11 08:00:00', '2026-10-11 08:01:00', 'SENT', '2026-10-10 23:59:00'),
(2, 1, 6, 'PAYMENT_REMINDER', 'PUSH', 'Nhắc lịch thanh toán thẻ tín dụng', 'Kỳ 1 thẻ tín dụng VIB Super Card (3.070.000 đ) sẽ đến hạn vào ngày 05/11/2026.', '2026-11-02 08:00:00', NULL, 'PENDING', '2026-10-25 09:00:00'),
(3, 1, 4, 'PAYMENT_REMINDER', 'EMAIL', 'Thông báo nghĩa vụ thanh toán kỳ 4', 'Kỳ 4 hợp đồng Vay mua xe VinFast VF8 số tiền 2.630.208 đ sẽ đến hạn vào 10/11/2026.', '2026-11-07 08:00:00', NULL, 'PENDING', '2026-10-26 10:00:00'),
(4, 1, 2, 'PAYMENT_RECEIPT', 'PUSH', 'Ghi nhận thanh toán thành công', 'Bạn đã hoàn tất thanh toán kỳ 2 hợp đồng Vay mua xe số tiền 2.682.291 đ.', '2026-09-10 10:00:00', '2026-09-10 10:02:00', 'SENT', '2026-09-10 10:00:00'),
(5, 1, 3, 'OVERDUE_ALERT', 'SMS', 'Nhắc nợ khẩn cấp qua SMS', 'Tin nhắn gửi qua SMS không thành công do sự cố mạng viễn thông.', '2026-10-11 08:00:00', NULL, 'FAILED', '2026-10-11 08:00:00')
ON CONFLICT (notification_id) DO UPDATE SET status = EXCLUDED.status;

-- M. DEBT STRATEGIES (Chiến lược trả nợ tối ưu khớp DebtStrategyMockData)
INSERT INTO debt_strategies (
    strategy_id, user_id, strategy_type, extra_payment,
    estimated_interest_saved, estimated_months_saved, status, created_at
) VALUES
(1, 1, 'AVALANCHE', 2000000.00, 3250000.00, 4, 'ACTIVE', '2026-09-01 09:00:00')
ON CONFLICT (strategy_id) DO UPDATE SET strategy_type = EXCLUDED.strategy_type;

-- N. SIMULATIONS (Kịch bản mô phỏng trả nợ khớp SimulationMockData)
INSERT INTO simulations (
    simulation_id, user_id, loan_id, extra_payment, early_payment_fee,
    estimated_interest, estimated_interest_saved, months_reduced, total_saving,
    scenario_type, scenario_name, status, created_at
) VALUES
(1, 1, 101, 2000000.00, 87500.00, 8250000.00, 3250000.00, 4, 3162500.00, 'EXTRA_PAYMENT', 'Trả thêm 2 triệu hàng tháng', 'SIMULATION_REFERENCE', '2026-09-01 09:30:00')
ON CONFLICT (simulation_id) DO UPDATE SET scenario_type = EXCLUDED.scenario_type;

-- O. LOAN DOCUMENTS (Tài liệu hợp đồng khoản vay khớp LoanDocumentMockData)
INSERT INTO loan_documents (
    document_id, loan_id, document_type, file_url, ocr_status, ocr_result, created_at, updated_at
) VALUES
(1, 101, 'CONTRACT', 'https://example.com/mock/loan-contract-001.pdf', 'COMPLETED', '{"loan_name": "Vay mua xe VinFast VF8", "principal_amount": 500000000.0}'::jsonb, '2025-06-10 08:30:00', '2025-06-10 08:35:00')
ON CONFLICT (document_id) DO UPDATE SET document_type = EXCLUDED.document_type;

-- P. OTP VERIFICATIONS (Mã xác thực OTP khớp OtpVerificationMockData)
INSERT INTO otp_verifications (
    otp_id, user_id, email, phone, otp_code, purpose, attempt_count, max_attempts, expires_at, verified_at, status, created_at
) VALUES
(1, 1, 'dev@test.com', '0900000001', '123456', 'EMAIL_VERIFICATION', 0, 5, '2026-09-22 10:05:00', '2026-09-22 09:57:00', 'VERIFIED', '2026-09-22 09:55:00')
ON CONFLICT (otp_id) DO UPDATE SET otp_code = EXCLUDED.otp_code;

-- =========================================================
-- 18. ĐỒNG BỘ LẠI BỘ ĐẾM SEQUENCE SAU KHI CHÈN ID THỦ CÔNG
-- =========================================================
SELECT setval(pg_get_serial_sequence('loan_types', 'loan_type_id'), COALESCE((SELECT MAX(loan_type_id) FROM loan_types), 1));
SELECT setval(pg_get_serial_sequence('users', 'user_id'), COALESCE((SELECT MAX(user_id) FROM users), 1));
SELECT setval(pg_get_serial_sequence('bank_accounts', 'account_id'), COALESCE((SELECT MAX(account_id) FROM bank_accounts), 1));
SELECT setval(pg_get_serial_sequence('loans', 'loan_id'), COALESCE((SELECT MAX(loan_id) FROM loans), 1));
SELECT setval(pg_get_serial_sequence('assets', 'asset_id'), COALESCE((SELECT MAX(asset_id) FROM assets), 1));
SELECT setval(pg_get_serial_sequence('refresh_tokens', 'token_id'), COALESCE((SELECT MAX(token_id) FROM refresh_tokens), 1));
SELECT setval(pg_get_serial_sequence('credit_profiles', 'profile_id'), COALESCE((SELECT MAX(profile_id) FROM credit_profiles), 1));
SELECT setval(pg_get_serial_sequence('notification_preferences', 'preference_id'), COALESCE((SELECT MAX(preference_id) FROM notification_preferences), 1));
SELECT setval(pg_get_serial_sequence('payment_schedules', 'schedule_id'), COALESCE((SELECT MAX(schedule_id) FROM payment_schedules), 1));
SELECT setval(pg_get_serial_sequence('payments', 'payment_id'), COALESCE((SELECT MAX(payment_id) FROM payments), 1));
SELECT setval(pg_get_serial_sequence('credit_reports', 'report_id'), COALESCE((SELECT MAX(report_id) FROM credit_reports), 1));
SELECT setval(pg_get_serial_sequence('notifications', 'notification_id'), COALESCE((SELECT MAX(notification_id) FROM notifications), 1));
SELECT setval(pg_get_serial_sequence('debt_strategies', 'strategy_id'), COALESCE((SELECT MAX(strategy_id) FROM debt_strategies), 1));
SELECT setval(pg_get_serial_sequence('simulations', 'simulation_id'), COALESCE((SELECT MAX(simulation_id) FROM simulations), 1));
SELECT setval(pg_get_serial_sequence('loan_documents', 'document_id'), COALESCE((SELECT MAX(document_id) FROM loan_documents), 1));
SELECT setval(pg_get_serial_sequence('otp_verifications', 'otp_id'), COALESCE((SELECT MAX(otp_id) FROM otp_verifications), 1));

-- =========================================================
-- 19. HÀM & TRIGGER BẮN SỰ KIỆN REAL-TIME (LISTEN / NOTIFY)
-- =========================================================
CREATE OR REPLACE FUNCTION notify_realtime_event()
RETURNS TRIGGER AS $$
DECLARE
    payload JSON;
    record_data RECORD;
BEGIN
    IF (TG_OP = 'DELETE') THEN
        record_data = OLD;
    ELSE
        record_data = NEW;
    END IF;

    payload = json_build_object(
        'table', TG_TABLE_NAME,
        'action', TG_OP,
        'timestamp', CURRENT_TIMESTAMP,
        'data', row_to_json(record_data)
    );

    -- Phát tín hiệu lên kênh 'credit_health_realtime'
    PERFORM pg_notify('credit_health_realtime', payload::text);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Gắn Trigger real-time vào 5 bảng có biến động liên tục trên App
DROP TRIGGER IF EXISTS trg_realtime_notifications ON notifications;
CREATE TRIGGER trg_realtime_notifications
AFTER INSERT OR UPDATE OR DELETE ON notifications
FOR EACH ROW EXECUTE FUNCTION notify_realtime_event();

DROP TRIGGER IF EXISTS trg_realtime_loans ON loans;
CREATE TRIGGER trg_realtime_loans
AFTER INSERT OR UPDATE OR DELETE ON loans
FOR EACH ROW EXECUTE FUNCTION notify_realtime_event();

DROP TRIGGER IF EXISTS trg_realtime_payment_schedules ON payment_schedules;
CREATE TRIGGER trg_realtime_payment_schedules
AFTER INSERT OR UPDATE OR DELETE ON payment_schedules
FOR EACH ROW EXECUTE FUNCTION notify_realtime_event();

DROP TRIGGER IF EXISTS trg_realtime_payments ON payments;
CREATE TRIGGER trg_realtime_payments
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION notify_realtime_event();

DROP TRIGGER IF EXISTS trg_realtime_credit_profiles ON credit_profiles;
CREATE TRIGGER trg_realtime_credit_profiles
AFTER INSERT OR UPDATE OR DELETE ON credit_profiles
FOR EACH ROW EXECUTE FUNCTION notify_realtime_event();

-- =========================================================
-- 20. ĐÁNH INDEX TỐI ƯU HÓA TRUY VẤN
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_loans_user_status ON loans(user_id, status);
CREATE INDEX IF NOT EXISTS idx_schedules_loan_status_due ON payment_schedules(loan_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_notifications_user_status ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_schedule ON payments(schedule_id);