# TÀI LIỆU HƯỚNG DẪN XÂY DỰNG BACKEND EXPRESS.JS (FINCREDIT API)
> **Dành cho kỹ sư Backend:** Hướng dẫn chi tiết 100% khớp nối chuẩn xác với Flutter Frontend và CSDL MySQL `credit_health_db.sql`. Tuyệt đối tuân thủ các quy chuẩn DTO, mã lỗi HTTP và luồng nghiệp vụ dưới đây để không xảy ra sai lệch giao tiếp.

---

## 1. TỔNG QUAN HỆ THỐNG & TECH STACK

- **Platform:** Node.js (>= 18.x hoặc 20.x LTS)
- **Framework:** Express.js (v4.x hoặc v5.x)
- **Cơ sở dữ liệu:** MySQL 8.0 (Driver: `mysql2/promise`)
- **Quản lý lưu trữ tệp (Cloudflare R2):** `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- **Xác thực & Bảo mật:** `jsonwebtoken`, `bcryptjs`, `cors`, `helmet`, `express-rate-limit`
- **Base URL Frontend gọi tới:**
  - Dev (Android Emulator): `http://10.0.2.2:3000/api/v1`
  - Dev (Web / iOS / Thiết bị thật): `http://<IP_LAN>:3000/api/v1`
  - Prod: `https://api.production.com/api/v1`
- **Cơ chế tiền tố (Prefix):** Frontend có cơ chế tự chuẩn hóa: các endpoint dạng `/api/auth/...` hay `/credit-profile` đều được map chính xác về router backend gắn prefix `/api/v1` hoặc mount trực tiếp tương ứng.

---

## 2. CẤU TRÚC THƯ MỤC BACKEND ĐỀ XUẤT (CHUẨN MVC)

```text
backend/
├── .env                         # Tệp biến môi trường (Copy từ .env.example)
├── package.json
├── server.js                    # Entry point khởi chạy HTTP Server
├── src/
│   ├── app.js                   # Cấu hình Express app, CORS, Middleware
│   ├── config/
│   │   ├── db.js                # MySQL2 Connection Pool
│   │   ├── r2.js                # S3 Client kết nối Cloudflare R2
│   │   └── constants.js         # Mã lỗi, hằng số cấu hình
│   ├── middlewares/
│   │   ├── auth.middleware.js   # Xác thực Bearer JWT Token
│   │   ├── error.middleware.js  # Bắt lỗi toàn cục và trả về JSON chuẩn
│   │   └── validate.middleware.js
│   ├── routes/
│   │   ├── auth.routes.js       # /api/auth/*
│   │   ├── user.routes.js       # /api/user/*
│   │   ├── loan.routes.js       # /api/loans/* & /api/collaterals/*
│   │   ├── credit.routes.js     # /credit-profile/* & /credit-reports/*
│   │   ├── debt.routes.js       # /debt-strategies/*
│   │   ├── schedule.routes.js   # /payment-schedules/* & /notifications/*
│   │   ├── simulation.routes.js # /simulations/*
│   │   └── storage.routes.js    # /api/storage/*
│   ├── controllers/
│   └── services/
```

---

## 3. QUY CHUẨN ĐỊNH DẠNG REQUEST & RESPONSE (DTO)

### 3.1. Header bắt buộc khi gọi API yêu cầu bảo mật
```http
Authorization: Bearer <access_token>
Content-Type: application/json; charset=utf-8
Accept: application/json
```

### 3.2. Cấu trúc Response Thành Công (Envelope)
Frontend hỗ trợ tự động bóc tách cả dạng `{ success: true, data: ... }` lẫn dạng payload trực tiếp. Khuyến nghị chuẩn hóa Envelope:
```json
{
  "success": true,
  "message": "Thao tác thành công",
  "data": { ... }
}
```
*Đối với danh sách:*
```json
{
  "success": true,
  "data": [ ... ]
}
```

### 3.3. Cấu trúc Response Thất Bại & Mã Lỗi HTTP
Backend **BẮT BUỘC** trả về trường `message` hoặc `error` để Frontend hiển thị SnackBar:
```json
{
  "success": false,
  "message": "Mô tả nguyên nhân lỗi tiếng Việt cho người dùng"
}
```

| HTTP Code | Nghiệp vụ Frontend ánh xạ | Hành vi xử lý trên Mobile |
| :---: | :--- | :--- |
| `200` / `201` | Thành công | Parse dữ liệu và cập nhật State Controller |
| `400` / `422` | Tham số sai định dạng | Hiển thị thông báo `message` từ backend |
| `401` | Token hết hạn / Không hợp lệ | Frontend tự động xóa token và chuyển về LoginScreen |
| `403` | Tài khoản bị khóa (`AccountLockedException`) hoặc chưa kích hoạt (`AccountUnverifiedException`) | Mở màn hình OTP kích hoạt hoặc thông báo khóa |
| `404` | Không tìm thấy bản ghi | Trả về empty/null hoặc màn hình rỗng |
| `409` | Bản ghi đã tồn tại (ví dụ: kỳ báo cáo đã lập) | Hiển thị cảnh báo xung đột |
| `429` | Quá giới hạn thử lại OTP / Spam request | Khóa nút gửi lại OTP và bắt đếm ngược |
| `500`+ | Lỗi máy chủ hoặc câu lệnh CSDL | Hiển thị thông báo máy chủ bận |

---

## 4. CHI TIẾT TỪNG MODULE & ENDPOINTS API

### MODULE 1: AUTHENTICATION & USER MANAGEMENT

#### 1. Đăng ký tài khoản
- **Method / Endpoint:** `POST /api/v1/auth/register` (hoặc `/api/auth/register`)
- **Body:**
```json
{
  "full_name": "Nguyễn Văn A",
  "email": "user@gmail.com",
  "phone": "0901234567",
  "password": "Password123@",
  "monthly_income": 25000000,
  "date_of_birth": "1995-08-20",
  "id_card_number": "079201009999",
  "address": "TP. Hồ Chí Minh",
  "occupation": "Kỹ sư",
  "workplace": "Công ty ABC",
  "contract_type": "Chính thức"
}
```
- **Xử lý Backend:** Băm mật khẩu bằng `bcryptjs.hash(password, 10)`, sinh mã OTP 6 số lưu vào bảng `otp_verifications`, chèn bản ghi vào bảng `users` với `is_active = FALSE`. Gửi OTP qua email/SMS.
- **Response `201 Created`:**
```json
{
  "success": true,
  "message": "Đăng ký thành công. Vui lòng xác thực mã OTP gửi về thiết bị."
}
```

#### 2. Xác thực mã OTP
- **Method / Endpoint:** `POST /api/v1/auth/verify-otp` (hoặc `/api/auth/verify-otp`)
- **Body:**
```json
{
  "otp": "123456",
  "flow_type": "REGISTER"
}
```
*(Các loại `flow_type`: `REGISTER`, `RESET_PASSWORD`, `TRANSACTION`)*
- **Xử lý Backend:** Kiểm tra mã OTP chưa hết hạn (`expires_at > NOW()`), số lần nhập `attempts < 5`. Nếu đúng, update `is_verified = TRUE`, nếu là register thì set `users.is_active = TRUE`.
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Xác thực OTP thành công."
}
```

#### 3. Gửi lại mã OTP
- **Method / Endpoint:** `POST /api/v1/auth/resend-otp`
- **Body:** `{ "identifier": "user@gmail.com" }` (hoặc lấy từ token phiên tạm)
- **Response `200 OK`:** `{ "success": true, "message": "Đã gửi lại OTP." }`

#### 4. Đăng nhập
- **Method / Endpoint:** `POST /api/v1/auth/login` (hoặc `/api/auth/login`)
- **Body:**
```json
{
  "identifier": "dev@test.com",
  "password": "Password123@"
}
```
*(Identifier có thể là email, số điện thoại hoặc số CCCD)*
- **Xử lý Backend:**
  - Kiểm tra tài khoản trong bảng `users`.
  - Nếu `is_locked = TRUE` hoặc `lock_until > NOW()`: Trả lỗi `403` với message: `"Tài khoản bị tạm khóa do vi phạm chính sách bảo mật."`
  - Nếu `is_active = FALSE`: Trả lỗi `403` với message: `"Tài khoản chưa được kích hoạt qua OTP."`
  - So sánh mật khẩu bằng `bcryptjs.compare`. Nếu sai: tăng `failed_login_attempts`. Nếu `>= 5`: khóa tài khoản.
  - Nếu đúng: reset `failed_login_attempts = 0`. Tạo JWT Access Token (`15m`) và Refresh Token (`7d`). Lưu session vào bảng `refresh_tokens`.
- **Response `200 OK` (BẮT BUỘC KHỚP TRƯỜNG):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1Ni...",
    "accessToken": "eyJhbGciOiJIUzI1Ni...",
    "user": {
      "user_id": 1,
      "full_name": "Nguyen Van Dev",
      "email": "dev@test.com",
      "phone": "0900000001",
      "monthly_income": 25000000.00,
      "date_of_birth": "1998-05-12",
      "id_card_number": "079201008888",
      "address": "Tòa nhà Landmark 81, P. 22, Q. Bình Thạnh, TP. Hồ Chí Minh",
      "occupation": "Kỹ sư Phần mềm Senior",
      "workplace": "Tập đoàn Công nghệ FPT",
      "contract_type": "Hợp đồng lao động không xác định thời hạn",
      "is_ekyc_verified": true,
      "ekyc_tier": "C06",
      "membership_tier": "GOLD",
      "cic_score": 745,
      "is_biometric_enabled": true,
      "auto_lock_enabled": true,
      "is_active": true
    }
  }
}
```

#### 5. Kiểm tra phiên làm việc (Check Session)
- **Method / Endpoint:** `GET /api/v1/auth/session` (Header: `Bearer <token>`)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1Ni...",
    "refresh_token": "ref_token_sample...",
    "expires_at": "2026-11-10T12:00:00Z",
    "user_id": 1
  }
}
```

#### 6. Tự động làm mới Access Token (Auto Token Refresh)
- **Method / Endpoint:** `POST /api/v1/auth/refresh-token` (hoặc `/api/auth/refresh-token`)
- **Mục đích:** Kích hoạt bởi Auto Token Refresh Interceptor của `ApiClient` khi gặp mã lỗi HTTP `401` để lấy Access Token mới trong suốt với người dùng.
- **Body:**
```json
{
  "refreshToken": "ref_token_sample..."
}
```
*(Backend hỗ trợ đọc cả `req.body.refreshToken` và `req.body.refresh_token`)*
- **Xử lý Backend:**
  - Tra cứu trong bảng `refresh_tokens`. Nếu `token` không tồn tại, hết hạn (`expires_at < NOW()`) hoặc đã thu hồi (`revoked_at IS NOT NULL`): trả mã lỗi `401 Unauthorized`.
  - Nếu hợp lệ: Sinh JWT `access_token` mới (thời hạn 15 phút), gia hạn hoặc cấp mới `refresh_token` (thời hạn 7 ngày), cập nhật `last_active = NOW()`.
- **Response `200 OK` (BẮT BUỘC ĐÚNG CẤU TRÚC CHO FLUTTER):**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI...",
    "refresh_token": "ref_token_sample_new...",
    "expires_at": "2026-11-10T12:00:00Z",
    "user_id": 1
  }
}
```

#### 7. Đổi mật khẩu & Quên mật khẩu
- **Đổi mật khẩu:** `POST /api/v1/auth/change-password`
  - Body: `{ "current_password": "...", "new_password": "..." }`
- **Đặt lại mật khẩu:** `POST /api/v1/auth/reset-password`
  - Body: `{ "new_password": "..." }` (Sau khi đã verify OTP)

#### 8. Quản lý Hồ sơ & Bảo mật người dùng
- **Xem thông tin hồ sơ:** `GET /api/v1/user/profile` -> Trả về object `user`.
- **Cập nhật hồ sơ:** `PUT /api/v1/user/profile`
  - Body: `{ "full_name": "...", "monthly_income": 30000000, "occupation": "...", ... }`
- **Cập nhật cài đặt bảo mật:** `PUT /api/v1/user/security-settings`
  - Body:
  ```json
  {
    "is_biometric_enabled": true,
    "auto_lock_enabled": true
  }
  ```
  - Cập nhật 2 cột `is_biometric_enabled` và `auto_lock_enabled` trong bảng `users`. Trả về `UserModel` đã cập nhật.

#### 9. Tài khoản ngân hàng liên kết
- `GET /api/v1/user/bank-accounts`: Trả về danh sách từ bảng `bank_accounts`.
- `POST /api/v1/user/bank-accounts`:
  - Body:
  ```json
  {
    "bank_name": "Vietcombank",
    "account_number": "9988776655",
    "account_holder_name": "NGUYEN VAN DEV",
    "is_default_disbursal": true,
    "is_auto_debit": false
  }
  ```
- `DELETE /api/v1/user/bank-accounts/:id`: Xóa tài khoản ngân hàng.

---

### MODULE 2: QUẢN LÝ KHOẢN VAY & TÀI SẢN THẾ CHẤP

#### 1. Danh sách khoản vay
- **Method / Endpoint:** `GET /api/v1/loans` (hoặc `/api/loans`)
- **Query Params:**
  - `keyword` (String, tìm theo mã hợp đồng hoặc tên ngân hàng)
  - `status` (Enum: `ACTIVE`, `PENDING`, `CLOSED`, `OVERDUE`)
  - `lender` (String)
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": [
    {
      "loan_id": "LOAN-2024-001",
      "loan_name": "Vay Mua Nhà Chung Cư",
      "lender": "Vietcombank",
      "loan_type_code": "MORTGAGE",
      "principal_amount": 1500000000,
      "remaining_principal": 1250000000,
      "interest_rate": 8.5,
      "interest_calculation_method": "REDUCING_BALANCE",
      "term_months": 240,
      "remaining_term_months": 200,
      "start_date": "2023-01-15T00:00:00Z",
      "due_date": "2043-01-15T00:00:00Z",
      "payment_day_of_month": 15,
      "status": "ACTIVE",
      "collaterals": []
    }
  ]
}
```

#### 2. Chi tiết, Tạo mới & Cập nhật khoản vay
- **Chi tiết:** `GET /api/v1/loans/:loanId`
- **Tạo mới:** `POST /api/v1/loans` (Body: JSON khoản vay theo cấu trúc trên)
- **Cập nhật:** `PUT /api/v1/loans/:loanId` (Body: Cập nhật thông tin khoản vay)
- **Xóa:** `DELETE /api/v1/loans/:loanId` (Body: `{ "soft_delete": true }` -> Cập nhật `status = 'CLOSED'` hoặc xóa cứng nếu `false`).

#### 3. Tài sản thế chấp (Collaterals)
- `GET /api/v1/collaterals?loan_id=:loanId`: Lấy danh sách tài sản theo khoản vay (bảng `assets`).
- `POST /api/v1/collaterals`:
```json
{
  "loan_id": "LOAN-2024-001",
  "asset_type": "REAL_ESTATE",
  "asset_name": "Căn hộ Vinhomes Grand Park",
  "estimated_value": 2500000000,
  "valuation_date": "2024-01-10T00:00:00Z",
  "certificate_number": "GCN-889900/TPHCM",
  "image_url": "https://pub-id.r2.dev/collaterals/vinhomes.jpg"
}
```

#### 4. Quét OCR tài liệu / Hợp đồng
- **Method / Endpoint:** `POST /api/v1/loans/ocr-scan` (hoặc `/api/loans/ocr-scan`)
- **Body:** `{ "image_path": "https://pub-id.r2.dev/..." }`
- **Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "lender": "Ngân hàng TMCP Quân Đội (MB)",
    "principal_amount": 500000000,
    "interest_rate": 9.2,
    "term_months": 60,
    "start_date": "2024-05-01"
  }
}
```

---

### MODULE 3: HỒ SƠ SỨC KHỎE TÍN DỤNG & BÁO CÁO

#### 1. Hồ sơ sức khỏe tín dụng (Credit Profile)
- **Lấy hồ sơ:** `GET /api/v1/credit-profile` (hoặc `/credit-profile`)
- **Response `200 OK` (Khớp `CreditProfileModel`):**
```json
{
  "profile_id": 1,
  "user_id": 1,
  "credit_score": 745,
  "dti_ratio": 32.5,
  "ltv_ratio": 50.0,
  "credit_utilization_ratio": 28.0,
  "payment_history_score": 98.5,
  "risk_tier": "LOW",
  "calculated_at": "2026-11-01T10:00:00Z"
}
```
*Lưu ý: Nếu người dùng chưa có hồ sơ, trả về `404` để Frontend hiển thị trạng thái khởi tạo `CreditEmptyState`.*

- **Tính toán lại điểm tín dụng:** `POST /api/v1/credit-profile/recalculate`
  - Thực hiện tính lại DTI = `(tổng nợ phải trả hàng tháng / thu nhập)` * 100
  - Cập nhật bảng `credit_profiles`, trả về object `CreditProfileModel`.

#### 2. Báo cáo tín dụng định kỳ (Credit Reports)
- **Danh sách báo cáo:** `GET /api/v1/credit-reports` -> Trả về danh sách từ bảng `credit_reports`.
- **Chi tiết báo cáo:** `GET /api/v1/credit-reports/:id`
- **Khởi tạo kỳ báo cáo mới:** `POST /api/v1/credit-reports/generate`
  - Body: `{ "report_period": "2026-Q4" }`
  - Nếu kỳ này đã có trong CSDL: Trả về lỗi `409 Conflict` kèm message: `"Kỳ báo cáo này đã được khởi tạo trước đó. Mỗi kỳ báo cáo chỉ lập một bản ghi ảnh chụp duy nhất."`
  - Nếu thành công: Trả về `CreditReportModel`.

---

### MODULE 4: CHIẾN LƯỢC TỐI ƯU NỢ (DEBT STRATEGY)

- **Danh sách phương án:** `GET /api/v1/debt-strategies` (bảng `debt_strategies`).
- **Kế hoạch đang áp dụng:** `GET /api/v1/debt-strategies/active` -> Trả về chiến lược có `is_active = TRUE`.
- **Áp dụng chiến lược:** `POST /api/v1/debt-strategies/apply`
  - Body:
  ```json
  {
    "user_id": 1,
    "strategy_type": "AVALANCHE",
    "extra_payment": 5000000,
    "estimated_interest_saved": 45000000,
    "estimated_months_saved": 14
  }
  ```
  *(Các loại `strategy_type`: `AVALANCHE` - Lãi cao trả trước, `SNOWBALL` - Nợ nhỏ trả trước)*
- **Hủy chiến lược:** `PATCH /api/v1/debt-strategies/:strategyId/cancel` -> Set `is_active = FALSE`.

---

### MODULE 5: LỊCH PHÂN KỲ & NHẮC NỢ (PAYMENT SCHEDULE)

- **Lấy danh sách kỳ thanh toán:** `GET /api/v1/payment-schedules`
  - Query: `?loan_id=...&user_id=...`
  - Trả về danh sách từ bảng `payment_schedules` (các cột: `schedule_id`, `period_number`, `due_date`, `principal_due`, `interest_due`, `total_due`, `status` (`UNPAID`, `PAID`, `OVERDUE`)).
- **Chi tiết kỳ thanh toán:** `GET /api/v1/payment-schedules/:scheduleId`
- **Thanh toán kỳ nợ:** `POST /api/v1/payment-schedules/:scheduleId/pay`
  - Cập nhật `status = 'PAID'`, `paid_at = NOW()`, tạo bản ghi bảng `payments`, trừ nợ gốc còn lại trong bảng `loans`.
- **Cấu hình nhận thông báo nhắc nợ:**
  - Lấy cài đặt: `GET /api/v1/notifications/preference`
  - Cập nhật: `PUT /api/v1/notifications/preference`
  - Body khớp `NotificationPreferenceModel`:
  ```json
  {
    "id": 1,
    "user_id": 1,
    "push_enabled": true,
    "email_enabled": true,
    "balance_fluctuation_enabled": true,
    "monthly_statement_enabled": true,
    "reminder_days": 3
  }
  ```
- **Danh sách thông báo:** `GET /api/v1/notifications` (bảng `notifications`).
- **Đồng bộ lịch & nhắc nợ:** `POST /api/v1/payment-schedules/sync` -> Trả về `{ "cancelled_count": 0 }`.

---

### MODULE 6: MÔ PHỎNG TÀI CHÍNH (SIMULATION)

- **Lấy danh sách kịch bản:** `GET /api/v1/simulations`
- **Lưu kịch bản mô phỏng:** `POST /api/v1/simulations`
  - Body khớp `SimulationModel`:
  ```json
  {
    "user_id": 1,
    "loan_id": "LOAN-2024-001",
    "scenario_name": "Trả thêm 3 triệu mỗi tháng",
    "simulation_type": "EXTRA_MONTHLY",
    "extra_monthly_payment": 3000000,
    "lump_sum_payment": 0,
    "saved_interest": 62000000,
    "time_saved_months": 18
  }
  ```
- **Xóa kịch bản:** `DELETE /api/v1/simulations/:simulationId`

---

### MODULE 7: QUẢN LÝ LƯU TRỮ TỆP CLOUDFLARE R2 (PUBLIC & PRIVATE)

Khớp chuẩn xác 100% với `ApiStorageRepository` trên Flutter:

#### Bước 1: Xin Presigned URL tải lên (Upload)
- **Method / Endpoint:** `POST /api/v1/storage/presigned-url` (hoặc `/api/storage/presigned-url`)
- **Body:**
```json
{
  "folder": "avatars",
  "file_name": "avatar_1710000000.jpg",
  "content_type": "image/jpeg",
  "is_public": true
}
```
- **Xử lý Backend:**
  - Nếu `is_public === true`: Chọn `R2_BUCKET_PUBLIC`. Khi upload xong file sẽ xem được trực tiếp qua link CDN: `${R2_PUBLIC_DOMAIN}/${file_key}`.
  - Nếu `is_public === false`: Chọn `R2_BUCKET_PRIVATE`. Bucket này cấm public. Tải về phải qua chữ ký tạm thời.
  - Sử dụng `@aws-sdk/s3-request-presigner` tạo `PutObjectCommand` với thời hạn `300` giây (5 phút).
- **Response `200 OK` (BẮT BUỘC ĐÚNG TRƯỜNG CHO FLUTTER):**
```json
{
  "success": true,
  "data": {
    "upload_url": "https://<account_id>.r2.cloudflarestorage.com/fincredit-public/avatars/avatar_1710000000.jpg?X-Amz-Algorithm=...",
    "file_key": "avatars/avatar_1710000000.jpg",
    "download_url": "https://pub-xxxx.r2.dev/avatars/avatar_1710000000.jpg",
    "expires_in": 300,
    "http_method": "PUT",
    "headers": {
      "Content-Type": "image/jpeg"
    }
  }
}
```

#### Bước 2: Frontend tự PUT trực tiếp lên Cloudflare R2
*(Frontend thực hiện trực tiếp từ Mobile, không đi qua server Express, giảm 100% tải băng thông cho backend)*

#### Bước 3: Xác nhận lưu trữ vào CSDL
- **Method / Endpoint:** `POST /api/v1/storage/confirm-upload` (hoặc `/api/storage/confirm-upload`)
- **Body:**
```json
{
  "file_key": "avatars/avatar_1710000000.jpg",
  "folder": "avatars",
  "metadata": {
    "user_id": 1
  }
}
```
- **Response `200 OK`:**
```json
{
  "success": true,
  "download_url": "https://pub-xxxx.r2.dev/avatars/avatar_1710000000.jpg"
}
```

#### Bước 4: Lấy link xem tài liệu riêng tư (Private Documents)
- **Method / Endpoint:** `GET /api/v1/storage/view-url` (hoặc `/api/storage/view-url`)
- **Query Params:** `?file_key=contracts/1/hop_dong_vay.pdf&expires_in=600`
- **Xử lý Backend:** Tạo Presigned URL cho `GetObjectCommand` trên `R2_BUCKET_PRIVATE` với thời hạn 10 phút (600 giây).
- **Response `200 OK`:**
```json
{
  "success": true,
  "view_url": "https://<account_id>.r2.cloudflarestorage.com/fincredit-private/contracts/1/hop_dong_vay.pdf?X-Amz-Signature=..."
}
```

---

## 5. MÃ NGUỒN MẪU KHỞI TẠO CÁC MODULE TRỌNG TÂM

### 5.1. File `src/config/db.js` (Kết nối MySQL2)
```javascript
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'credit_health_db',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 20,
  queueLimit: 0,
  timezone: process.env.DB_TIMEZONE || '+07:00',
});

export default pool;
```

### 5.2. File `src/config/r2.js` (Cloudflare R2 Client & Presigned URLs)
```javascript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import dotenv from 'dotenv';
dotenv.config();

export const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

export async function generateR2UploadUrl({ folder, fileName, contentType, isPublic }) {
  const bucketName = isPublic ? process.env.R2_BUCKET_PUBLIC : process.env.R2_BUCKET_PRIVATE;
  const fileKey = `${folder}/${fileName}`;
  const expiresIn = Number(process.env.R2_PRESIGNED_UPLOAD_EXPIRES) || 300;

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn });

  const downloadUrl = isPublic
    ? `${process.env.R2_PUBLIC_DOMAIN}/${fileKey}`
    : '';

  return {
    upload_url: uploadUrl,
    file_key: fileKey,
    download_url: downloadUrl,
    expires_in: expiresIn,
    http_method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
  };
}

export async function generateR2ViewUrl({ fileKey, expiresIn = 600 }) {
  const command = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_PRIVATE,
    Key: fileKey,
  });
  return await getSignedUrl(r2Client, command, { expiresIn: Number(expiresIn) });
}
```

### 5.3. File `src/middlewares/auth.middleware.js` (Bảo vệ Route)
```javascript
import jwt from 'jsonwebtoken';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Yêu cầu không có mã xác thực Bearer Token.',
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({
        success: false,
        message: 'Phiên đăng nhập đã hết hạn hoặc token không hợp lệ.',
      });
    }
    req.user = user;
    next();
  });
}
```

### 5.4. File `src/app.js` (Cấu hình Express & CORS)
```javascript
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Import Routers
import authRoutes from './routes/auth.routes.js';
import loanRoutes from './routes/loan.routes.js';
import creditRoutes from './routes/credit.routes.js';
import debtRoutes from './routes/debt.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import simulationRoutes from './routes/simulation.routes.js';
import storageRoutes from './routes/storage.routes.js';

dotenv.config();
const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gắn tiền tố chuẩn
const API_PREFIX = process.env.API_PREFIX || '/api/v1';

// Đăng ký toàn bộ các nhóm route
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/user`, authRoutes);
app.use(`${API_PREFIX}/loans`, loanRoutes);
app.use(`${API_PREFIX}/collaterals`, loanRoutes);
app.use(`${API_PREFIX}/credit-profile`, creditRoutes);
app.use(`${API_PREFIX}/credit-reports`, creditRoutes);
app.use(`${API_PREFIX}/debt-strategies`, debtRoutes);
app.use(`${API_PREFIX}/payment-schedules`, scheduleRoutes);
app.use(`${API_PREFIX}/notifications`, scheduleRoutes);
app.use(`${API_PREFIX}/simulations`, simulationRoutes);
app.use(`${API_PREFIX}/storage`, storageRoutes);

// Fallback tương thích các đường dẫn gốc /api/*
app.use('/api/auth', authRoutes);
app.use('/api/user', authRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/collaterals', loanRoutes);
app.use('/api/credit-profile', creditRoutes);
app.use('/api/credit-reports', creditRoutes);
app.use('/api/debt-strategies', debtRoutes);
app.use('/api/payment-schedules', scheduleRoutes);
app.use('/api/notifications', scheduleRoutes);
app.use('/api/simulations', simulationRoutes);
app.use('/api/storage', storageRoutes);

// Middleware xử lý lỗi tập trung
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]:', err);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Lỗi xử lý nội bộ máy chủ FinCredit.',
  });
});

export default app;
```

---

## 6. CHECKLIST KIỂM THỬ KHI KẾT NỐI VỚI FLUTTER FRONTEND

1. [ ] **Chạy Database:** Đã import tệp `credit_health_db.sql` vào MySQL cục bộ và kiểm tra đủ 16 bảng.
2. [ ] **Kiểm tra CORS:** Đã cấu hình `CORS_ORIGIN=*` để tránh lỗi `XMLHttpRequest error` khi test trên Flutter Web/Chrome.
3. [ ] **Kiểm tra IP:**
   - Android Emulator: Dùng `http://10.0.2.2:3000/api/v1`.
   - Điện thoại thật: Máy tính và điện thoại cùng mạng Wifi, dùng IP máy tính `http://192.168.x.x:3000/api/v1`.
4. [ ] **Test luồng Auth:** Gọi login với tài khoản mẫu `dev@test.com` / mật khẩu `123456`, kiểm tra Flutter tự động nhận JWT token và chuyển vào `HomeScreen`.
5. [ ] **Test luồng Upload Cloudflare R2:**
   - Chọn ảnh đại diện hoặc chụp ảnh hợp đồng -> Gọi xin presigned URL -> PUT binary lên R2 -> Kiểm tra tệp xuất hiện trên Cloudflare R2 Dashboard.
6. [ ] **Xác thực Mã lỗi:** Thử đăng nhập sai mật khẩu 5 lần, kiểm tra xem Backend có trả về HTTP `403` và app có chuyển hướng chuẩn sang trạng thái tài khoản bị khóa hay không.

