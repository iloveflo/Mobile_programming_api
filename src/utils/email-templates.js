function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatVietnamTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/**
 * Bố cục Email chuẩn Fintech (Stripe / Wise / Mercury style)
 * Đồng bộ tuyệt đối với Design Tokens FinCredit:
 * - Primary: #0D47A1 (Royal Deep Blue)
 * - Primary Light: #1976D2
 * - Primary Soft: #EBF3FC
 * - Background: #F8FAFD
 * - Border: #E2E8F0
 * - Text Primary: #0F172A / Secondary: #64748B
 */
function wrapFinCreditLayout({ title, preheader, category, recipientName, contentHtml }) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader || title);
  const safeCategory = escapeHtml(category);
  const safeName = escapeHtml(recipientName || 'Quý khách');
  const timeStr = escapeHtml(formatVietnamTime(new Date()));

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFD;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#F8FAFD;padding:36px 16px 44px 16px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;">
          <!-- Top Brand Accent Line (Royal Deep Blue) -->
          <tr>
            <td style="height:4px;background-color:#0D47A1;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Minimalist Header -->
          <tr>
            <td style="padding:26px 36px 20px 36px;border-bottom:1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <table role="presentation" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="width:28px;height:28px;background-color:#0D47A1;border-radius:7px;text-align:center;vertical-align:middle;color:#FFFFFF;font-size:15px;font-weight:800;letter-spacing:-0.5px;">
                          F
                        </td>
                        <td style="padding-left:10px;vertical-align:middle;">
                          <span style="font-size:17px;font-weight:700;color:#0F172A;letter-spacing:-0.3px;">FinCredit</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="font-size:12px;font-weight:500;color:#64748B;">${safeCategory}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td style="padding:32px 36px 34px 36px;">
              <h1 style="margin:0 0 18px 0;font-size:21px;line-height:1.35;font-weight:700;color:#0F172A;letter-spacing:-0.3px;">
                ${safeTitle}
              </h1>
              <p style="margin:0 0 18px 0;font-size:14.5px;line-height:1.65;color:#334155;">
                Kính gửi ${safeName},
              </p>

              ${contentHtml}

              <p style="margin:26px 0 0 0;font-size:14px;line-height:1.6;color:#64748B;">
                Trân trọng,<br/>
                <strong style="color:#0F172A;font-weight:600;">Đội ngũ FinCredit</strong>
              </p>
            </td>
          </tr>
        </table>

        <!-- Quiet Trust Footer -->
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;">
          <tr>
            <td style="padding:20px 12px 0 12px;text-align:left;">
              <p style="margin:0 0 6px 0;font-size:12px;line-height:1.55;color:#64748B;">
                Thời điểm ghi nhận: ${timeStr} (GMT+7). FinCredit không bao giờ yêu cầu Quý khách cung cấp mật khẩu hoặc mã OTP qua điện thoại, tin nhắn hay đường dẫn lạ.
              </p>
              <p style="margin:0;font-size:12px;line-height:1.55;color:#94A3B8;">
                Email tự động từ hệ thống FinCredit Việt Nam • Hỗ trợ: support@fincredit.vn • Hotline: 1900 6868
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderLedgerRows(rows) {
  const validRows = rows.filter(r => r && r.value);
  if (validRows.length === 0) return '';

  const trs = validRows
    .map((row, idx) => {
      const borderBottom = idx < validRows.length - 1 ? 'border-bottom:1px solid #E2E8F0;' : '';
      const valueColor = row.accent ? '#0D47A1' : '#0F172A';
      const valueWeight = row.bold ? '700' : '600';
      return `
        <tr>
          <td style="padding:12px 16px;font-size:13.5px;color:#64748B;${borderBottom}">${escapeHtml(row.label)}</td>
          <td align="right" style="padding:12px 16px;font-size:14px;font-weight:${valueWeight};color:${valueColor};font-variant-numeric:tabular-nums;${borderBottom}">${escapeHtml(row.value)}</td>
        </tr>`;
    })
    .join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0;background-color:#F8FAFD;border:1px solid #E2E8F0;border-radius:8px;border-collapse:separate;">
      ${trs}
    </table>`;
}

function extractLedgerFromMessage(title, message, notificationType) {
  const msg = String(message || '').trim();

  if (notificationType === 'PAYMENT_REMINDER') {
    const match = msg.match(/Kỳ\s+(\d+)\s+hợp đồng\s+(.+?)\s+số tiền\s+([\d.,]+\s*đ)\s+sẽ đến hạn vào\s+(\d{2}\/\d{2}\/\d{4})/i);
    if (match) {
      return renderLedgerRows([
        { label: 'Hợp đồng vay', value: match[2].trim() },
        { label: 'Kỳ thanh toán', value: `Kỳ ${match[1]}` },
        { label: 'Ngày đến hạn', value: match[4] },
        { label: 'Số tiền cần thanh toán', value: match[3], bold: true, accent: true },
      ]);
    }
    const simpleMatch = msg.match(/Ky\s+(\d+):\s*([\d.,]+)\s*VND/i);
    if (simpleMatch) {
      return renderLedgerRows([
        { label: 'Nội dung', value: title },
        { label: 'Kỳ thanh toán', value: `Kỳ ${simpleMatch[1]}` },
        { label: 'Số tiền cần thanh toán', value: `${Number(simpleMatch[2]).toLocaleString('vi-VN')} đ`, bold: true, accent: true },
      ]);
    }
  }

  if (notificationType === 'BALANCE_FLUCTUATION') {
    const disburse = msg.match(/Khoản vay\s+"(.+?)"\s+vừa được ghi nhận với dư nợ\s+([\d.,]+\s*đ)/i);
    if (disburse) {
      return renderLedgerRows([
        { label: 'Loại biến động', value: 'Ghi nhận khoản vay mới' },
        { label: 'Tên khoản vay', value: disburse[1] },
        { label: 'Dư nợ hiện tại', value: disburse[2], bold: true, accent: true },
      ]);
    }
    const paid = msg.match(/Đã thanh toán kỳ\s+(\d+)\s+\((.+?)\):\s*giảm\s+([\d.,]+\s*đ)\s+gốc\.\s*Dư nợ còn lại:\s*([\d.,]+\s*đ)/i);
    if (paid) {
      return renderLedgerRows([
        { label: 'Loại biến động', value: `Thanh toán kỳ ${paid[1]}` },
        { label: 'Tên khoản vay', value: paid[2] },
        { label: 'Gốc đã giảm', value: `-${paid[3]}` },
        { label: 'Dư nợ còn lại', value: paid[4], bold: true, accent: true },
      ]);
    }
    const updated = msg.match(/Khoản vay\s+"(.+?)"\s+đã được cập nhật\.\s*Dư nợ:\s*([\d.,]+\s*đ),\s*lãi suất:\s*([\d.,]+%\/năm),\s*kỳ hạn:\s*(\d+)\s*tháng/i);
    if (updated) {
      return renderLedgerRows([
        { label: 'Loại biến động', value: 'Cập nhật thông tin khoản vay' },
        { label: 'Tên khoản vay', value: updated[1] },
        { label: 'Lãi suất / Kỳ hạn', value: `${updated[3]} • ${updated[4]} tháng` },
        { label: 'Dư nợ hiện tại', value: updated[2], bold: true, accent: true },
      ]);
    }
    const closedOrDeleted = msg.match(/Khoản vay\s+"(.+?)"\s+đã được\s+(xóa khỏi hệ thống|đóng \/ tất toán)\.\s*Dư nợ trước đó:\s*([\d.,]+\s*đ)/i);
    if (closedOrDeleted) {
      return renderLedgerRows([
        { label: 'Loại biến động', value: closedOrDeleted[2] === 'xóa khỏi hệ thống' ? 'Xóa khoản vay' : 'Đóng / Tất toán khoản vay' },
        { label: 'Tên khoản vay', value: closedOrDeleted[1] },
        { label: 'Dư nợ trước đó', value: closedOrDeleted[3] },
        { label: 'Dư nợ hiện tại', value: '0 đ', bold: true, accent: true },
      ]);
    }
  }

  // Fallback sạch cho Sao kê tháng hoặc nội dung nhiều dòng
  const lines = msg.split('\n').map(l => l.trim()).filter(Boolean);
  const keyValueRows = [];
  for (const line of lines) {
    const clean = line.replace(/^-\s*/, '');
    const colonIdx = clean.indexOf(':');
    if (colonIdx > 0 && colonIdx < 45) {
      const label = clean.slice(0, colonIdx).trim();
      const value = clean.slice(colonIdx + 1).trim();
      if (label && value && !label.toLowerCase().startsWith('xin chào')) {
        keyValueRows.push({ label, value, bold: label.toLowerCase().includes('dư nợ') });
      }
    }
  }
  if (keyValueRows.length >= 2) {
    return renderLedgerRows(keyValueRows);
  }

  return `
    <div style="margin:20px 0;padding:16px 18px;background-color:#F8FAFD;border:1px solid #E2E8F0;border-radius:8px;font-size:14px;line-height:1.65;color:#1E293B;">
      ${lines.map(l => `<div style="margin-bottom:4px;">${escapeHtml(l)}</div>`).join('')}
    </div>`;
}

export function renderOtpEmail({ fullName, code, purpose = 'REGISTER', expiresSeconds = 120 }) {
  const safeCode = escapeHtml(code);
  const minutes = Math.max(1, Math.round(Number(expiresSeconds) / 60));
  const purposeLabel = purpose === 'RESET_PASSWORD'
    ? 'đặt lại mật khẩu'
    : purpose === 'LOGIN_DEVICE'
      ? 'xác thực đăng nhập thiết bị mới'
      : 'xác thực đăng ký tài khoản';

  const html = wrapFinCreditLayout({
    title: 'Mã xác thực OTP của Quý khách',
    preheader: `Mã xác thực OTP FinCredit: ${code} (hiệu lực ${minutes} phút)`,
    category: 'Xác thực bảo mật',
    recipientName: fullName,
    contentHtml: `
      <p style="margin:0 0 18px 0;font-size:14.5px;line-height:1.65;color:#334155;">
        Vui lòng sử dụng mã xác thực một lần dưới đây để hoàn tất yêu cầu <strong>${escapeHtml(purposeLabel)}</strong> trên ứng dụng FinCredit:
      </p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;">
        <tr>
          <td align="center" style="background-color:#EBF3FC;border:1px solid #BFDBFE;border-radius:8px;padding:22px 16px;">
            <div style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:10px;color:#0D47A1;font-variant-numeric:tabular-nums;">
              ${safeCode}
            </div>
            <div style="margin-top:8px;font-size:12.5px;color:#64748B;">
              Mã có hiệu lực trong ${minutes} phút
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13.5px;line-height:1.6;color:#64748B;">
        Nếu Quý khách không thực hiện yêu cầu này, vui lòng bỏ qua email hoặc đổi mật khẩu ngay trong phần Cài đặt &amp; Bảo mật.
      </p>
    `,
  });

  return {
    subject: 'FinCredit - Mã xác thực OTP tài khoản',
    text: `Kính gửi ${fullName || 'Quý khách'}, mã OTP ${purposeLabel} FinCredit của Quý khách là: ${code} (hiệu lực ${minutes} phút). Tuyệt đối không chia sẻ mã này với bất kỳ ai.`,
    html,
  };
}

export function renderNotificationEmail({ fullName, title, message, notificationType = 'PAYMENT_REMINDER' }) {
  let category = 'Thông báo';
  let intro = 'Hệ thống FinCredit gửi tới Quý khách thông tin cập nhật mới nhất về tài khoản tín dụng:';

  if (notificationType === 'BALANCE_FLUCTUATION') {
    category = 'Biến động dư nợ';
    intro = 'Hệ thống FinCredit vừa ghi nhận biến động mới trên khoản vay của Quý khách:';
  } else if (notificationType === 'PAYMENT_REMINDER') {
    category = 'Nhắc thanh toán';
    intro = 'Quý khách có một kỳ thanh toán khoản vay sắp đến hạn với thông tin chi tiết dưới đây:';
  } else if (notificationType === 'MONTHLY_STATEMENT') {
    category = 'Sao kê định kỳ';
    intro = 'FinCredit gửi tới Quý khách tổng hợp sao kê tín dụng định kỳ tháng này:';
  }

  const ledgerHtml = extractLedgerFromMessage(title, message, notificationType);

  const html = wrapFinCreditLayout({
    title,
    preheader: message,
    category,
    recipientName: fullName,
    contentHtml: `
      <p style="margin:0;font-size:14.5px;line-height:1.65;color:#334155;">
        ${escapeHtml(intro)}
      </p>
      ${ledgerHtml}
      <p style="margin:0;font-size:13.5px;line-height:1.6;color:#64748B;">
        Vui lòng mở ứng dụng FinCredit để xem chi tiết lịch trả nợ và theo dõi các chỉ số sức khỏe tài chính của Quý khách.
      </p>
    `,
  });

  return {
    subject: `FinCredit - ${title}`,
    text: message,
    html,
  };
}
