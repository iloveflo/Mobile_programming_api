# FinCredit API

Backend Express/PostgreSQL theo `TaiLieuLamBE.md`. Node.js 20+, PostgreSQL 14+.

## Chạy trên máy

```powershell
npm ci
Copy-Item .env.example .env
# Sửa .env: PostgreSQL, JWT_SECRET và các dịch vụ sử dụng.
# Tạo database credit_health_db trước khi import lần đầu.
psql -U postgres -d credit_health_db -f credit_health_db.sql
npm run db:migrate
npm run db:seed-dev
npm start
```

Chỉ import `credit_health_db.sql` vào database mới phục vụ phát triển: file này có dữ liệu mẫu. Database đã có dữ liệu chỉ chạy `npm run db:migrate`; không import lại seed. Migration có transaction, ghi nhận phiên bản và không xóa bản ghi nghiệp vụ. `db:seed-dev` chỉ đổi mật khẩu mẫu đang lưu dạng plaintext `123456` sang bcrypt; không thay mật khẩu đã được người dùng đổi.

Tạo JWT secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`, rồi đặt vào `.env`. Server từ chối secret mẫu hoặc quá ngắn. Mật khẩu đăng ký mới cần 8–72 byte; tài khoản mẫu `dev@test.com` / `123456` vẫn đăng nhập được.

Khi phát triển chưa có SMTP: đặt `OTP_DELIVERY=console` và `NODE_ENV=development`. OTP xuất hiện ở terminal, không trả trong API. Production bắt buộc gửi qua SMTP. Không dùng cấu hình console trong production.

## Docker

```powershell
docker compose up --build -d
docker compose logs -f backend
```

Docker Engine cần đang chạy. PostgreSQL mới tự nạp schema và migration; backend chạy migration trước khi mở server. Nếu volume đã chứa database cũ, migration bổ sung cột khi backend khởi động; chạy `docker compose exec backend npm run db:seed-dev` để sửa riêng mật khẩu mẫu cũ. Không xóa volume để nâng cấp dữ liệu.

API qua nginx: `http://localhost:3000/api/v1`. Android Emulator: `http://10.0.2.2:3000/api/v1`. Thiết bị thật dùng IP LAN của máy. PostgreSQL Docker được ánh xạ ra cổng `5433` mặc định; Node chạy ngoài Docker cần đặt `DB_PORT=5433` nếu dùng database này.

## Các module đã triển khai

| Module | Xử lý |
| --- | --- |
| Auth | Đăng ký, OTP có hạn sử dụng/số lần thử/cooldown, đăng nhập, remember-me, refresh rotation, danh sách và thu hồi phiên, logout, đổi/reset mật khẩu |
| User | Hồ sơ, cài đặt bảo mật, tài khoản ngân hàng, xuất PDF riêng tư, tích hợp xác minh eKYC |
| Loans | CRUD, lọc, tài sản, tài liệu, sinh lịch trả nợ, tích hợp OCR |
| Credit | Tính DTI/LTV và chỉ số nội bộ, báo cáo ảnh chụp theo kỳ, chặn trùng kỳ |
| Debt | Danh sách, một chiến lược đang áp dụng, hủy chiến lược |
| Schedule | Danh sách/chi tiết, cập nhật ngày đến hạn, ghi nhận thanh toán trong transaction, đồng bộ nhắc nợ |
| Notifications | Danh sách, cài đặt riêng từng người, tạo lịch nhắc không nhân đôi khi sync |
| Simulations | Lưu/xem/xóa kịch bản và các trường DTO trong tài liệu |
| Storage | Presigned PUT, xác nhận tệp, lưu metadata PostgreSQL, presigned GET có kiểm tra quyền |
| Realtime | LISTEN/NOTIFY tới room người dùng, xác thực phiên socket, reconnect PostgreSQL |

Các nhóm route hỗ trợ `/api/v1/...`, `/api/...` và đường dẫn gốc như `/credit-profile`. Các router khoản vay/tài sản, hồ sơ/báo cáo và lịch/thông báo được tách riêng để không trùng handler.

## Chi tiết kết nối Flutter

- Thành công: `{ "success": true, "data": ... }`; thất bại: `{ "success": false, "message": "..." }`. Riêng storage giữ các trường cấp ngoài `download_url`, `file_key`, `view_url` đúng tài liệu.
- `user_id` từ body/query không cấp quyền truy cập; server luôn dùng danh tính từ access token. Mật khẩu/hash không xuất hiện trong response.
- Schema gốc dùng `BIGSERIAL`: lấy ID thực từ response (ví dụ `"101"`) để gọi API. Chuỗi minh họa `LOAN-2024-001` trong tài liệu không phải khóa của SQL hiện có.
- API nhận/trả `interest_rate` theo phần trăm: `8.5` nghĩa là 8,5%/năm; DB lưu `0.085`. Các chỉ số DTI/LTV trả theo phần trăm; DB lưu tỷ lệ.
- `remaining_principal` ánh xạ `outstanding_amount`; `lender` ánh xạ `lender_name`; `interest_calculation_method` ánh xạ `interest_method`. Lịch trả `period_number`, `principal_due`, `interest_due`, `total_due`; DB `PENDING` được trả thành `UNPAID`.
- Thời gian được lưu/đọc UTC; trường ngày thuần giữ `YYYY-MM-DD`. Các timestamp cũ cần vốn được lưu theo UTC; nếu database cũ đã ghi giờ địa phương, phải chuyển đổi riêng trước khi dùng.

### OTP và reset mật khẩu

1. `POST /auth/register` trả `data.challenge_token`.
2. `POST /auth/verify-otp` gửi `{ "otp": "...", "flow_type": "REGISTER", "challenge_token": "..." }`. Có thể truyền challenge ở Bearer header. Client cũ có thể gửi `identifier` thay challenge; không tìm người dùng bằng OTP đơn lẻ.
3. Gửi lại: `POST /auth/resend-otp` với `identifier` và `flow_type`, hoặc dùng `challenge_token` trong body/Bearer header thay identifier. Khi dùng challenge, mục đích OTP phải trùng challenge. Mặc định `REGISTER`; dùng `RESET_PASSWORD` cho quên mật khẩu. Response trả challenge mới, challenge cũ không còn dùng được.
4. Xác thực OTP `RESET_PASSWORD` trả `data.reset_token`.
5. `POST /auth/reset-password` gửi `{ "reset_token": "...", "new_password": "..." }`. Reset token chỉ dùng một lần, thời hạn 10 phút. Đổi/reset mật khẩu thu hồi toàn bộ phiên.

Login trả cả `token`, `accessToken`, `refreshToken` và các alias snake_case. Refresh nhận `refreshToken` hoặc `refresh_token`; client phải lưu token mới sau mỗi lần refresh. Access token gắn với một session; thu hồi session vô hiệu hóa các access token của session đó.

Remember-me tạo phiên tối đa 30 ngày; bỏ chọn tạo phiên tối đa 1 ngày. Mỗi lần refresh xoay token và giới hạn còn tối đa 7 ngày, không kéo dài quá hạn hiện có. `GET /auth/session` trả access token, hạn access và user ID; `refresh_token` là `null` vì server chỉ lưu hash và không thể khôi phục refresh token thô. Flutter giữ refresh token đã nhận lúc login/refresh, không ghi đè nó bằng giá trị null từ check-session.

Để check-session trả đủ refresh token như DTO trong tài liệu, client gửi thêm header `X-Refresh-Token: <refresh_token đang lưu>`. Backend kiểm tra hash, hạn sử dụng, trạng thái thu hồi và đúng session của access token trước khi trả lại token đó. Refresh token của session khác hoặc token cũ sau rotation trả `401`. Không truyền refresh token qua URL/query để tránh xuất hiện trong access log. Flutter Web cần cho phép header này trong cấu hình proxy/CORS nếu có cấu hình riêng.

### Khoản vay và thanh toán

Tạo khoản vay sinh lịch gốc trả đều hàng tháng. `REDUCING_BALANCE` tính lãi trên dư nợ đầu kỳ; `FLAT` tính trên gốc ban đầu. Ngày 29–31 được chặn ở ngày cuối tháng ngắn; kỳ cuối bù sai số làm tròn 2 chữ số. Có thể gửi `remaining_principal` và `remaining_term_months` để nhập khoản vay đang trả dở. Nếu không có kỳ còn lại, hệ thống ước lượng từ tỷ lệ dư nợ/gốc và kỳ hạn.

Thay điều khoản khi chưa có kỳ đã thanh toán sẽ tạo lại lịch. Khi đã thanh toán, API từ chối thay điều khoản bằng `409`. Dư nợ sau khởi tạo chỉ được giảm thông qua ghi nhận thanh toán. `POST /payment-schedules/:id/pay` là **ghi nhận thủ công**, không tự chuyển tiền ngân hàng. Kỳ đã trả không bị trừ gốc lần hai. Mọi bước ghi payment, cập nhật kỳ và dư nợ được commit/rollback cùng nhau.

Đổi lãi suất/ngày trả của khoản vay nhập dở giữ nguyên dư nợ và số kỳ còn lại. Không cho sửa gốc ban đầu của khoản vay nhập dở vì không đủ lịch sử để tái tính phần đã trả. `due_date` là ngày kỳ cuối; khi sửa ngày này, lịch kỳ cuối được cập nhật cùng transaction, và ngày mới phải sau kỳ áp chót. Khi đã có kỳ được thanh toán, thay đổi ngày kết thúc ở cấp khoản vay bị từ chối; có thể điều chỉnh ngày của từng kỳ chưa thanh toán bằng API lịch.

`PUT /loans/:id` nhận `remaining_term_months` (số nguyên dương). Khi chỉ sửa số kỳ còn lại, hệ thống giữ số thứ tự/ngày của kỳ còn lại đầu tiên, điều chỉnh tổng kỳ hạn và ngày kết thúc, chia dư nợ cho số kỳ mới. Ví dụ khoản vay tổng 12 kỳ, còn 5 kỳ từ kỳ 8: đổi còn 4 kỳ sẽ giữ kỳ đầu là kỳ 8, kết thúc kỳ 11, tổng kỳ hạn thành 11. Nếu muốn tổng kỳ hạn khác, gửi thêm `term_months`; `remaining_term_months` không được lớn hơn tổng kỳ hạn. Khi đã ghi nhận bất kỳ thanh toán nào, thay đổi số kỳ bị từ chối bằng `409`, giữ nguyên lịch sử.

Chỉ khoản vay `ACTIVE` hoặc `OVERDUE` được ghi nhận thanh toán và tạo nhắc nợ. Khoản vay `PENDING` cần được cập nhật sang `ACTIVE` trước; `CLOSED`/`SETTLED` không được thanh toán tiếp.

Sau thanh toán, điều chỉnh ngày kỳ hoặc gọi sync, hệ thống tính lại quá hạn từ các kỳ chưa trả: còn kỳ quá hạn thì `OVERDUE`, hết quá hạn thì `ACTIVE`, hết dư nợ thì `CLOSED`. Các khoản đã chủ động đóng hoặc tất toán không tự mở lại.

`sync` cập nhật quá hạn và tạo/cập nhật bản ghi nhắc nợ trong `notifications`; ứng dụng có thể đọc danh sách hoặc nhận sự kiện Socket.IO. Việc phát push qua FCM/APNs hoặc gửi email nhắc nợ theo lịch cần worker/nhà cung cấp riêng; repository chưa có thông tin FCM/APNs. Các bản ghi này giữ `PENDING`, không giả đánh dấu đã gửi.

Điểm tín dụng tính lại là chỉ số nội bộ minh họa, **không phải điểm CIC được tra cứu**. Công thức hiện dùng DTI, mức sử dụng thẻ và lịch sử trả đúng hạn, giới hạn 300–850. DTI lấy tổng `total_amount` của kỳ chưa trả tiếp theo của từng khoản ACTIVE/OVERDUE còn dư nợ, chia thu nhập tháng; kỳ này bao gồm gốc, lãi và phí. Lịch được ưu tiên theo ngày đến hạn rồi số thứ tự kỳ, nên bao gồm kỳ quá hạn đầu tiên nếu còn tồn đọng. Tổng tiền quá hạn được thể hiện riêng ở báo cáo. Khi thiếu thu nhập hoặc khoản đang nợ không có lịch trả, DTI/điểm trả null và risk `UNKNOWN`; không giả định bằng 0. LTV lấy dư nợ các khoản ACTIVE/OVERDUE chia tổng giá trị tài sản liên kết chính các khoản này; tài sản của khoản PENDING/CLOSED/SETTLED không làm giảm LTV. Báo cáo lưu một ảnh chụp tại thời điểm tạo, không sửa lại khi hồ sơ thay đổi.

### R2 và PDF

Cấu hình đủ `R2_ENDPOINT`, hai key, hai bucket và `R2_PUBLIC_DOMAIN`. Public chỉ dành cho `avatars`/`collaterals`; `contracts`, `legal-documents`, `ekyc`, `payslips`, `reports` dùng private. Key do server tạo với user ID và UUID; dùng chính `file_key` trả về cho bước confirm.

1. Xin URL: `POST /storage/presigned-url` với `folder`, `file_name`, `content_type`, `is_public`.
2. Client PUT trực tiếp theo `upload_url` và `headers` trả về.
3. `POST /storage/confirm-upload`: `file_key`, `folder`, `metadata`. Contracts cần `metadata.loan_id`; ảnh tài sản/giấy tờ tài sản cần `metadata.asset_id`. Avatar cập nhật người dùng hiện tại, không nhận user khác.
4. Xem private: `GET /storage/view-url?file_key=...&expires_in=600`.

Confirm thực hiện một HEAD để kiểm tra đã upload, MIME và dung lượng (mặc định 20 MB); confirm lặp lại không nhân bản metadata. Không dùng ListObjects và không HEAD mỗi lần xem. Private chỉ lưu key; public lưu URL CDN. Cấu hình CORS của bucket cho PUT/GET/HEAD, origin của Flutter Web và `Content-Type`.

PDF được tạo bằng PDFKit và đưa lên private R2, trả `pdf_url` tạm thời cùng `file_key`. Đặt `PDF_FONT_PATH` trỏ tới font TTF có tiếng Việt để giữ nguyên dấu; nếu chưa có font, PDF chuyển tên sang chữ Latin không dấu để tránh ký tự hỏng.

### OCR và eKYC

Hai dịch vụ dùng adapter JSON qua HTTP POST tới URL do quản trị cấu hình; Bearer token lấy từ biến môi trường tương ứng. Chưa cấu hình trả `503`, lỗi upstream trả `502`.

- `OCR_PROVIDER_URL`, `OCR_PROVIDER_TOKEN`: request `{ "image_path": "...", "user_id": 1 }`; response trực tiếp `{ "lender": "...", "principal_amount": 500000000, "interest_rate": 9.2, "term_months": 60, "start_date": "2024-05-01" }`.
- `EKYC_PROVIDER_URL`, `EKYC_PROVIDER_TOKEN`: request `{ "user_id": 1, "id_card_number": "...", "front_card_url": "ekyc/...", "back_card_url": "ekyc/..." }`; response `{ "verified": true, "tier": "C06" }` chỉ khi nhà cung cấp thực sự xác minh thành công. Adapter cần quyền đọc private R2 theo key nếu cần ảnh gốc.

Ảnh CCCD phải được upload và confirm trong tài khoản hiện tại trước khi gọi eKYC. Khác ví dụ giản lược trong tài liệu, API không tự công nhận C06 chỉ vì số CCCD có 12 chữ số.

## Kiểm tra

```powershell
npm run check
npm test
npm audit
```

Test chạy HTTP API trên PostgreSQL nhúng PGlite với schema/migration thật, dữ liệu riêng trong RAM. Không kết nối database, SMTP hay R2 thật. Kiểm tra auth/OTP, token rotation, phân quyền, DTO, phép tính lịch, rollback, ghi trùng thanh toán/báo cáo, nhắc nợ, migration, presigned URL và PDF. R2 transport được giả lập; chưa thay thế kiểm thử upload trên bucket thật. PGlite chỉ có một kết nối nên chưa thay thế kiểm thử cạnh tranh nhiều kết nối trên PostgreSQL triển khai.

Trước khi ghép Flutter thật, cấu hình và kiểm tra riêng SMTP, R2, OCR/eKYC; chạy PostgreSQL/Docker; thử Socket.IO với `handshake.auth.token`. Không có source Flutter trong workspace này nên chưa thể kiểm tra end-to-end trên ứng dụng.
