import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { randomUUID } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2Client, generateR2ViewUrl, requireR2, deleteR2Object } from '../config/r2.js';
import { rows, one, found, insert } from '../utils/api.js';

const BUNDLED_REGULAR_FONT = fileURLToPath(new URL('../assets/fonts/NotoSans-Regular.ttf', import.meta.url));
const BUNDLED_BOLD_FONT = fileURLToPath(new URL('../assets/fonts/NotoSans-Bold.ttf', import.meta.url));
const DEFAULT_REGULAR_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const DEFAULT_BOLD_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

function firstExistingFont(candidates) {
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function resolveFonts() {
  const regular = firstExistingFont([
    process.env.PDF_FONT_PATH,
    BUNDLED_REGULAR_FONT,
    DEFAULT_REGULAR_FONT,
  ]);
  const bold = firstExistingFont([
    process.env.PDF_BOLD_FONT_PATH,
    BUNDLED_BOLD_FONT,
    DEFAULT_BOLD_FONT,
    regular,
  ]);
  return { regular, bold, hasUnicode: Boolean(regular) };
}

function formatVnd(value) {
  return `${Math.round(Number(value || 0)).toLocaleString('vi-VN')} VNĐ`;
}

function getVnDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(date));
  return Object.fromEntries(parts.map(p => [p.type, p.value]));
}

function formatDateVn(date) {
  const { day, month, year, hour, minute } = getVnDateParts(date);
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

function formatDateOnlyVn(date) {
  if (!date) return 'Chưa cập nhật';
  const { day, month, year } = getVnDateParts(date);
  return `${day}/${month}/${year}`;
}

function formatPctFromRatio(ratio, fallback = 'Chưa tính') {
  if (ratio == null) return fallback;
  return `${(Number(ratio) * 100).toFixed(1)}%`;
}

function loanStatusVn(status) {
  switch (String(status || '').toUpperCase()) {
    case 'ACTIVE': return 'Đang hoạt động';
    case 'OVERDUE': return 'Quá hạn';
    case 'CLOSED':
    case 'SETTLED': return 'Đã tất toán';
    case 'PENDING': return 'Chờ kích hoạt';
    default: return status || 'Không xác định';
  }
}

function loanTypeVn(type) {
  switch (String(type || '').toUpperCase()) {
    case 'MORTGAGE': return 'Thế chấp BĐS';
    case 'CAR': return 'Vay mua xe';
    case 'CONSUMER': return 'Vay tiêu dùng';
    case 'CREDIT_CARD': return 'Thẻ tín dụng';
    case 'OTHER': return 'Khoản vay khác';
    default: return type || 'Khác';
  }
}

function interestMethodVn(method) {
  switch (String(method || '').toUpperCase()) {
    case 'REDUCING_BALANCE': return 'Dư nợ giảm dần';
    case 'FLAT': return 'Lãi phẳng';
    default: return method || 'Chưa rõ';
  }
}

function assetTypeVn(type) {
  switch (String(type || '').toUpperCase()) {
    case 'REAL_ESTATE': return 'Bất động sản';
    case 'VEHICLE': return 'Phương tiện';
    case 'SAVINGS': return 'Sổ tiết kiệm';
    case 'OTHER': return 'Tài sản khác';
    default: return type || 'Khác';
  }
}

function scoreRatingVn(score) {
  if (score == null) return 'Chưa đánh giá';
  if (score >= 750) return 'Xuất sắc (Hạng A+)';
  if (score >= 680) return 'Tốt (Hạng A)';
  if (score >= 580) return 'Trung bình (Hạng B)';
  return 'Cần cải thiện (Hạng C)';
}

function riskLevelVn(risk) {
  switch (String(risk || '').toUpperCase()) {
    case 'LOW': return 'Thấp (An toàn)';
    case 'MEDIUM': return 'Trung bình';
    case 'HIGH': return 'Cao (Cần lưu ý)';
    default: return 'Chưa xác định';
  }
}

export async function generateFinancialPdfBuffer(userId) {
  const user = found(await one('SELECT * FROM users WHERE user_id=$1', [userId]));
  const [loans, profile, assets, scheduleStats, upcomingSchedules, loanProgressRows] = await Promise.all([
    rows(
      `SELECT * FROM loans WHERE user_id=$1
       ORDER BY CASE status WHEN 'OVERDUE' THEN 1 WHEN 'ACTIVE' THEN 2 ELSE 3 END, created_at DESC`,
      [userId],
    ),
    one('SELECT * FROM credit_profiles WHERE user_id=$1', [userId]),
    rows(
      `SELECT a.*, COALESCE(string_agg(DISTINCT l.loan_name, ', '), '') AS linked_loans
       FROM assets a
       LEFT JOIN loan_collaterals lc ON lc.asset_id = a.asset_id
       LEFT JOIN loans l ON l.loan_id = COALESCE(lc.loan_id, a.loan_id)
       WHERE a.user_id = $1
       GROUP BY a.asset_id
       ORDER BY a.asset_value DESC`,
      [userId],
    ),
    one(
      `SELECT
         COUNT(*) FILTER (WHERE s.status = 'PAID')::int AS paid_count,
         COUNT(*) FILTER (WHERE s.status <> 'PAID' AND s.due_date < CURRENT_DATE)::int AS overdue_count,
         COUNT(*) FILTER (WHERE s.status <> 'PAID')::int AS remaining_count,
         COALESCE(SUM(s.total_amount) FILTER (WHERE s.status <> 'PAID' AND s.due_date < CURRENT_DATE), 0) AS overdue_amount
       FROM payment_schedules s
       JOIN loans l ON l.loan_id = s.loan_id
       WHERE l.user_id = $1`,
      [userId],
    ),
    rows(
      `SELECT s.installment_number, s.due_date, s.total_amount, s.status, l.loan_name, l.lender_name
       FROM payment_schedules s
       JOIN loans l ON l.loan_id = s.loan_id
       WHERE l.user_id = $1 AND s.status <> 'PAID'
       ORDER BY s.due_date ASC
       LIMIT 6`,
      [userId],
    ),
    rows(
      `SELECT s.loan_id, COUNT(*)::int AS total_terms, COUNT(*) FILTER (WHERE s.status = 'PAID')::int AS paid_terms
       FROM payment_schedules s
       JOIN loans l ON l.loan_id = s.loan_id
       WHERE l.user_id = $1
       GROUP BY s.loan_id`,
      [userId],
    ),
  ]);

  const progressMap = new Map(loanProgressRows.map(r => [String(r.loan_id), r]));

  const fonts = resolveFonts();
  const textSafe = value => fonts.hasUnicode
    ? String(value ?? '')
    : String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');

  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  const chunks = [];
  const complete = new Promise((resolve, reject) => {
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const setRegular = (size = 10) => {
    if (fonts.regular) doc.font(fonts.regular);
    return doc.fontSize(size);
  };
  const setBold = (size = 10) => {
    if (fonts.bold) doc.font(fonts.bold);
    return doc.fontSize(size);
  };

  const pageWidth = doc.page.width - 80; // 595.28 - 80 = 515.28
  const pageBottomLimit = 765;
  const now = new Date();
  const vnParts = getVnDateParts(now);
  const reportCode = `HSNL-${user.user_id}-${vnParts.year}${vnParts.month}${vnParts.day}`;

  let y = 36;
  const ensureSpace = needed => {
    if (y + needed > pageBottomLimit) {
      doc.addPage();
      y = 42;
      return true;
    }
    return false;
  };

  const drawSectionHeading = title => {
    ensureSpace(38);
    setBold(10.5).fillColor('#0D47A1').text(textSafe(title), 40, y);
    y += 16;
    doc.save();
    doc.moveTo(40, y).lineTo(40 + pageWidth, y).strokeColor('#CBD5E1').lineWidth(0.75).stroke();
    doc.restore();
    y += 8;
  };

  // 1. Header Banner Ứng dụng FinCredit
  doc.save();
  doc.rect(40, y, pageWidth, 64).fill('#0D47A1');
  setBold(14).fillColor('#FFFFFF').text(textSafe('FINCREDIT VIỆT NAM'), 54, y + 12, { width: 320 });
  setRegular(8.5).fillColor('#DBEAFE').text(textSafe('Ứng dụng Quản lý Phân kỳ Trả nợ & Báo cáo Sức khỏe Tín dụng Cá nhân'), 54, y + 32, { width: 320 });

  setBold(8.5).fillColor('#FFFFFF').text(textSafe(`Mã hồ sơ: ${reportCode}`), 375, y + 14, { width: 166, align: 'right' });
  setRegular(8).fillColor('#DBEAFE').text(textSafe(`Ngày lập: ${formatDateVn(now)}`), 375, y + 30, { width: 166, align: 'right' });
  doc.restore();

  // 2. Tiêu đề Biên bản
  y = 114;
  setBold(15).fillColor('#0F172A').text(textSafe('BIÊN BẢN BÁO CÁO HỒ SƠ NĂNG LỰC TÀI CHÍNH'), 40, y, { width: pageWidth, align: 'center' });
  setRegular(9).fillColor('#64748B').text(textSafe('(Xác nhận thông tin định danh, việc làm, chỉ số tín dụng, tài sản bảo đảm & nghĩa vụ nợ)'), 40, doc.y + 3, { width: pageWidth, align: 'center' });
  doc.moveTo(40, doc.y + 8).lineTo(40 + pageWidth, doc.y + 8).strokeColor('#CBD5E1').lineWidth(1).stroke();
  y = doc.y + 18;

  // 3. Mục I: Thông tin định danh & việc làm
  drawSectionHeading('I. THÔNG TIN ĐỊNH DANH, VIỆC LÀM & XÁC THỰC KHÁCH HÀNG');

  const infoRows = [
    ['Họ và tên:', textSafe(user.full_name || 'Chưa cập nhật'), 'Mã định danh:', `FC-${user.user_id}`],
    ['Ngày sinh:', textSafe(formatDateOnlyVn(user.date_of_birth)), 'Số CCCD gắn chip:', textSafe(user.id_card_number || 'Chưa cập nhật')],
    ['Email liên hệ:', textSafe(user.email), 'Số điện thoại:', textSafe(user.phone || 'Chưa cập nhật')],
    ['Nghề nghiệp:', textSafe(user.occupation || 'Chưa cập nhật'), 'Nơi công tác:', textSafe(user.workplace || 'Chưa cập nhật')],
    ['Loại hợp đồng:', textSafe(user.contract_type || 'Chưa cập nhật'), 'Thu nhập / tháng:', textSafe(formatVnd(user.monthly_income))],
    ['Xác thực eKYC:', textSafe(user.is_ekyc_verified ? `Đã xác thực (${user.ekyc_tier || 'C06'})` : 'Chưa xác thực'), 'Hạng thành viên:', textSafe(user.membership_tier || 'STANDARD')],
  ];

  const boxHeight = infoRows.length * 21 + 28;
  ensureSpace(boxHeight + 12);
  doc.save();
  doc.roundedRect(40, y, pageWidth, boxHeight, 4).fillAndStroke('#F8FAFC', '#E2E8F0');
  let rowY = y + 8;
  for (const [k1, v1, k2, v2] of infoRows) {
    setRegular(8.5).fillColor('#64748B').text(textSafe(k1), 50, rowY, { width: 92 });
    setBold(8.5).fillColor('#0F172A').text(v1, 144, rowY, { width: 150, ellipsis: true });
    setRegular(8.5).fillColor('#64748B').text(textSafe(k2), 302, rowY, { width: 92 });
    setBold(8.5).fillColor('#0F172A').text(v2, 396, rowY, { width: 148, ellipsis: true });
    rowY += 21;
  }
  setRegular(8.5).fillColor('#64748B').text(textSafe('Địa chỉ cư trú:'), 50, rowY, { width: 92 });
  setBold(8.5).fillColor('#0F172A').text(textSafe(user.address || 'Chưa cập nhật'), 144, rowY, { width: 400, ellipsis: true });
  doc.restore();
  y += boxHeight + 16;

  // 4. Mục II: Chỉ số sức khỏe tín dụng & nghĩa vụ nợ (6 thẻ: 2 hàng x 3 cột)
  drawSectionHeading('II. CHỈ SỐ SỨC KHỎE TÍN DỤNG & NGHĨA VỤ TÀI CHÍNH');

  const totalPrincipal = loans.reduce((s, l) => s + Number(l.principal_amount || 0), 0);
  const totalOutstanding = loans.reduce((s, l) => s + Number(l.outstanding_amount || 0), 0);
  const activeCount = loans.filter(l => ['ACTIVE', 'OVERDUE'].includes(String(l.status).toUpperCase())).length;
  const totalAssetValue = assets.reduce((s, a) => s + Number(a.asset_value || 0), 0);
  const creditScore = profile?.credit_score ?? user.cic_score ?? null;
  const dtiPct = profile?.dti_ratio != null ? Number(profile.dti_ratio) * 100 : null;
  const ltvPct = profile?.ltv_ratio != null ? Number(profile.ltv_ratio) * 100 : null;
  const onTimePct = profile?.on_time_payment_rate != null ? Number(profile.on_time_payment_rate) * 100 : null;
  const utilizationPct = profile?.credit_utilization != null ? Number(profile.credit_utilization) * 100 : null;
  const overdueAmount = Number(scheduleStats?.overdue_amount || 0);

  const cardGap = 10;
  const cardW = (pageWidth - cardGap * 2) / 3;
  const cards = [
    {
      label: 'ĐIỂM TÍN DỤNG (CIC / NỘI BỘ)',
      value: creditScore != null ? `${creditScore} / 850` : 'Chưa có',
      sub: `${scoreRatingVn(creditScore)} • Rủi ro: ${riskLevelVn(profile?.risk_level)}`,
      color: '#0D47A1',
    },
    {
      label: 'TỔNG DƯ NỢ HIỆN TẠI',
      value: formatVnd(totalOutstanding),
      sub: `Trên ${activeCount} khoản vay hiệu lực / ${loans.length} tổng`,
      color: '#DC2626',
    },
    {
      label: 'TỶ LỆ NỢ / THU NHẬP (DTI)',
      value: dtiPct != null ? `${dtiPct.toFixed(1)}%` : 'Chưa tính',
      sub: dtiPct == null ? 'Thiếu dữ liệu kỳ trả' : dtiPct > 40 ? 'Mức cảnh báo (>40%)' : 'Ngưỡng kiểm soát an toàn',
      color: dtiPct != null && dtiPct > 40 ? '#D97706' : '#16A34A',
    },
    {
      label: 'TỶ LỆ VAY / TÀI SẢN (LTV)',
      value: ltvPct != null ? `${ltvPct.toFixed(1)}%` : 'Chưa có TSĐB',
      sub: `Tổng TSĐB: ${formatVnd(totalAssetValue)}`,
      color: ltvPct != null && ltvPct > 70 ? '#D97706' : '#0D47A1',
    },
    {
      label: 'THANH TOÁN ĐÚNG HẠN',
      value: onTimePct != null ? `${onTimePct.toFixed(1)}%` : 'Chưa có kỳ',
      sub: `Đã trả ${scheduleStats?.paid_count ?? 0} kỳ • Quá hạn: ${scheduleStats?.overdue_count ?? 0}`,
      color: onTimePct != null && onTimePct < 90 ? '#DC2626' : '#16A34A',
    },
    {
      label: 'DƯ NỢ QUÁ HẠN & HẠN MỨC THẺ',
      value: formatVnd(overdueAmount),
      sub: utilizationPct != null ? `Dùng thẻ tín dụng: ${utilizationPct.toFixed(1)}%` : 'Không có dư nợ thẻ tín dụng',
      color: overdueAmount > 0 ? '#DC2626' : '#0F172A',
    },
  ];

  ensureSpace(140);
  cards.forEach((c, idx) => {
    const colIdx = idx % 3;
    const rowIdx = Math.floor(idx / 3);
    const cx = 40 + colIdx * (cardW + cardGap);
    const cy = y + rowIdx * 68;
    doc.save();
    doc.roundedRect(cx, cy, cardW, 60, 4).fillAndStroke('#FFFFFF', '#CBD5E1');
    setBold(7.2).fillColor('#64748B').text(textSafe(c.label), cx + 9, cy + 8, { width: cardW - 18 });
    setBold(11).fillColor(c.color).text(textSafe(c.value), cx + 9, cy + 22, { width: cardW - 18 });
    setRegular(7.2).fillColor('#475569').text(textSafe(c.sub), cx + 9, cy + 40, { width: cardW - 18 });
    doc.restore();
  });
  y += 144;

  // 5. Mục III: Bảng chi tiết danh mục khoản vay
  drawSectionHeading('III. CHI TIẾT DANH MỤC KHOẢN VAY');

  const loanCols = [
    { title: 'STT', w: 24, align: 'center' },
    { title: 'Khoản vay / TCTD / Loại', w: 152, align: 'left' },
    { title: 'Giá trị gốc', w: 80, align: 'right' },
    { title: 'Dư nợ còn lại', w: 80, align: 'right' },
    { title: 'Lãi suất / Kỳ', w: 68, align: 'right' },
    { title: 'Tiến độ', w: 47, align: 'center' },
    { title: 'Trạng thái', w: 64, align: 'center' },
  ];

  const drawLoanHeader = topY => {
    doc.save();
    doc.rect(40, topY, pageWidth, 24).fillAndStroke('#EBF3FC', '#CBD5E1');
    let cx = 40;
    for (const col of loanCols) {
      setBold(7.5).fillColor('#0D47A1').text(textSafe(col.title), cx + 3, topY + 7, { width: col.w - 6, align: col.align });
      cx += col.w;
    }
    doc.restore();
    return topY + 24;
  };

  y = drawLoanHeader(y);

  if (loans.length === 0) {
    doc.save();
    doc.rect(40, y, pageWidth, 28).stroke('#E2E8F0');
    setRegular(8.5).fillColor('#64748B').text(textSafe('Khách hàng hiện chưa có khoản vay nào được ghi nhận trên hệ thống.'), 40, y + 9, { width: pageWidth, align: 'center' });
    doc.restore();
    y += 38;
  } else {
    loans.forEach((loan, idx) => {
      const rowH = 38;
      if (ensureSpace(rowH + 6)) {
        y = drawLoanHeader(y);
      }
      doc.save();
      doc.rect(40, y, pageWidth, rowH).fillAndStroke(idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
      const ratePct = `${(Number(loan.interest_rate || 0) * 100).toFixed(1)}%/năm`;
      const termText = loan.term_months ? `${loan.term_months} tháng` : 'Không kỳ hạn';
      const prog = progressMap.get(String(loan.loan_id));
      const progText = prog ? `${prog.paid_terms}/${prog.total_terms} kỳ` : '-';
      const cells = [
        String(idx + 1),
        `${loan.loan_name || ''}\n${loan.lender_name || 'Chưa rõ TCTD'} • ${loanTypeVn(loan.loan_type)}`,
        formatVnd(loan.principal_amount),
        formatVnd(loan.outstanding_amount),
        `${ratePct}\n${termText}`,
        progText,
        loanStatusVn(loan.status),
      ];
      let cx = 40;
      cells.forEach((val, cIdx) => {
        const col = loanCols[cIdx];
        const isMultiline = val.includes('\n');
        const topOffset = isMultiline ? 6 : 13;
        setRegular(7.5).fillColor('#0F172A').text(textSafe(val), cx + 3, y + topOffset, { width: col.w - 6, align: col.align });
        cx += col.w;
      });
      doc.restore();
      y += rowH;
    });

    ensureSpace(34);
    doc.save();
    doc.rect(40, y, pageWidth, 24).fillAndStroke('#F1F5F9', '#CBD5E1');
    setBold(8).fillColor('#0F172A').text(textSafe('TỔNG CỘNG DANH MỤC'), 48, y + 7, { width: 168 });
    setBold(8).fillColor('#0F172A').text(textSafe(formatVnd(totalPrincipal)), 216, y + 7, { width: 74, align: 'right' });
    setBold(8).fillColor('#DC2626').text(textSafe(formatVnd(totalOutstanding)), 296, y + 7, { width: 74, align: 'right' });
    setRegular(7.5).fillColor('#475569').text(textSafe(`Đã trả gốc: ${formatVnd(Math.max(0, totalPrincipal - totalOutstanding))}`), 376, y + 7, { width: 170, align: 'right' });
    doc.restore();
    y += 36;
  }

  // 6. Mục IV: Tài sản bảo đảm (Collateral)
  drawSectionHeading('IV. TÀI SẢN BẢO ĐẢM & ĐỊNH GIÁ HIỆN HÀNH');

  if (assets.length === 0) {
    ensureSpace(34);
    doc.save();
    doc.rect(40, y, pageWidth, 26).stroke('#E2E8F0');
    setRegular(8.5).fillColor('#64748B').text(textSafe('Chưa ghi nhận tài sản bảo đảm nào gắn với hồ sơ tín dụng.'), 40, y + 8, { width: pageWidth, align: 'center' });
    doc.restore();
    y += 36;
  } else {
    const assetCols = [
      { title: 'STT', w: 24, align: 'center' },
      { title: 'Tên tài sản & Giấy chứng nhận', w: 176, align: 'left' },
      { title: 'Loại tài sản', w: 82, align: 'left' },
      { title: 'Giá trị định giá', w: 92, align: 'right' },
      { title: 'Ngày định giá', w: 68, align: 'center' },
      { title: 'Khoản vay gắn', w: 73, align: 'left' },
    ];

    const drawAssetHeader = topY => {
      doc.save();
      doc.rect(40, topY, pageWidth, 22).fillAndStroke('#EBF3FC', '#CBD5E1');
      let cx = 40;
      for (const col of assetCols) {
        setBold(7.5).fillColor('#0D47A1').text(textSafe(col.title), cx + 3, topY + 6, { width: col.w - 6, align: col.align });
        cx += col.w;
      }
      doc.restore();
      return topY + 22;
    };

    y = drawAssetHeader(y);
    assets.forEach((asset, idx) => {
      const rowH = 34;
      if (ensureSpace(rowH + 6)) {
        y = drawAssetHeader(y);
      }
      doc.save();
      doc.rect(40, y, pageWidth, rowH).fillAndStroke(idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
      const cert = asset.certificate_number ? `\nSố GCN: ${asset.certificate_number}` : '';
      const cells = [
        String(idx + 1),
        `${asset.asset_name || ''}${cert}`,
        assetTypeVn(asset.asset_type),
        formatVnd(asset.asset_value),
        formatDateOnlyVn(asset.valuation_date),
        asset.linked_loans || 'Chưa gán',
      ];
      let cx = 40;
      cells.forEach((val, cIdx) => {
        const col = assetCols[cIdx];
        const topOffset = val.includes('\n') ? 5 : 11;
        setRegular(7.5).fillColor('#0F172A').text(textSafe(val), cx + 3, y + topOffset, { width: col.w - 6, align: col.align, ellipsis: true });
        cx += col.w;
      });
      doc.restore();
      y += rowH;
    });

    ensureSpace(32);
    doc.save();
    doc.rect(40, y, pageWidth, 22).fillAndStroke('#F1F5F9', '#CBD5E1');
    setBold(8).fillColor('#0F172A').text(textSafe(`TỔNG GIÁ TRỊ TÀI SẢN BẢO ĐẢM (${assets.length} tài sản)`), 48, y + 6, { width: 250 });
    setBold(8).fillColor('#0D47A1').text(textSafe(formatVnd(totalAssetValue)), 322, y + 6, { width: 86, align: 'right' });
    doc.restore();
    y += 34;
  }

  // 7. Mục V: Nghĩa vụ thanh toán sắp đến hạn
  drawSectionHeading('V. KẾ HOẠCH THANH TOÁN SẮP ĐẾN HẠN (6 KỲ GẦN NHẤT)');

  if (upcomingSchedules.length === 0) {
    ensureSpace(34);
    doc.save();
    doc.rect(40, y, pageWidth, 26).stroke('#E2E8F0');
    setRegular(8.5).fillColor('#64748B').text(textSafe('Không có kỳ thanh toán nào chưa tất toán.'), 40, y + 8, { width: pageWidth, align: 'center' });
    doc.restore();
    y += 36;
  } else {
    const schCols = [
      { title: 'STT', w: 24, align: 'center' },
      { title: 'Khoản vay', w: 195, align: 'left' },
      { title: 'Kỳ', w: 46, align: 'center' },
      { title: 'Ngày đến hạn', w: 80, align: 'center' },
      { title: 'Số tiền phải trả', w: 98, align: 'right' },
      { title: 'Trạng thái', w: 72, align: 'center' },
    ];

    const drawSchHeader = topY => {
      doc.save();
      doc.rect(40, topY, pageWidth, 22).fillAndStroke('#EBF3FC', '#CBD5E1');
      let cx = 40;
      for (const col of schCols) {
        setBold(7.5).fillColor('#0D47A1').text(textSafe(col.title), cx + 3, topY + 6, { width: col.w - 6, align: col.align });
        cx += col.w;
      }
      doc.restore();
      return topY + 22;
    };

    y = drawSchHeader(y);
    upcomingSchedules.forEach((sch, idx) => {
      const rowH = 24;
      if (ensureSpace(rowH + 6)) {
        y = drawSchHeader(y);
      }
      doc.save();
      doc.rect(40, y, pageWidth, rowH).fillAndStroke(idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', '#E2E8F0');
      const isOverdue = new Date(sch.due_date) < now || String(sch.status).toUpperCase() === 'OVERDUE';
      const cells = [
        String(idx + 1),
        `${sch.loan_name || ''}${sch.lender_name ? ` (${sch.lender_name})` : ''}`,
        `Kỳ ${sch.installment_number}`,
        formatDateOnlyVn(sch.due_date),
        formatVnd(sch.total_amount),
        isOverdue ? 'Quá hạn' : 'Chờ thanh toán',
      ];
      let cx = 40;
      cells.forEach((val, cIdx) => {
        const col = schCols[cIdx];
        const color = cIdx === 5 && isOverdue ? '#DC2626' : '#0F172A';
        setRegular(7.5).fillColor(color).text(textSafe(val), cx + 3, y + 7, { width: col.w - 6, align: col.align, ellipsis: true });
        cx += col.w;
      });
      doc.restore();
      y += rowH;
    });
    y += 14;
  }

  // 8. Mục VI: Tổng hợp đánh giá sức khỏe tín dụng & Cam kết bảo mật
  drawSectionHeading('VI. TỔNG HỢP SỨC KHỎE TÍN DỤNG & CAM KẾT BẢO MẬT');

  const observations = [];
  if (creditScore != null) {
    observations.push(`• Điểm tín dụng đạt ${creditScore}/850 (${scoreRatingVn(creditScore)}), mức độ rủi ro: ${riskLevelVn(profile?.risk_level)}.`);
  }
  if (dtiPct != null) {
    observations.push(
      dtiPct > 40
        ? `• Tỷ lệ nghĩa vụ trả nợ / thu nhập (DTI) đang ở mức ${dtiPct.toFixed(1)}% (>40%): cần cân đối dòng tiền và hạn chế phát sinh thêm nợ mới.`
        : `• Tỷ lệ nghĩa vụ trả nợ / thu nhập (DTI) đạt ${dtiPct.toFixed(1)}% (≤40%): nằm trong ngưỡng kiểm soát an toàn.`,
    );
  }
  if (overdueAmount > 0) {
    observations.push(`• Hiện có ${scheduleStats?.overdue_count ?? 0} kỳ quá hạn với tổng số tiền ${formatVnd(overdueAmount)} cần ưu tiên tất toán sớm.`);
  } else {
    observations.push('• Không ghi nhận dư nợ quá hạn tại thời điểm lập báo cáo.');
  }
  observations.push('• Báo cáo tuân thủ Thông tư 09/2020/TT-NHNN và Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân; tài liệu được xuất trực tiếp về thiết bị của chủ tài khoản.');

  ensureSpace(90);
  setRegular(8).fillColor('#334155').text(
    textSafe(observations.join('\n')),
    40,
    y,
    { width: pageWidth, lineGap: 3.5 },
  );

  // Đánh số trang ở footer (tắt bottom margin tạm thời để pdfkit không tự sinh trang trắng)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const prevBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    setRegular(7.5).fillColor('#94A3B8').text(
      textSafe(`FinCredit Việt Nam • Mã hồ sơ ${reportCode} • Ngày lập ${formatDateVn(now)} • Trang ${i + 1}/${range.count}`),
      40,
      doc.page.height - 28,
      { width: pageWidth, align: 'center', lineBreak: false },
    );
    doc.page.margins.bottom = prevBottomMargin;
  }

  doc.end();
  return complete;
}

export async function financialPdf(userId) {
  requireR2();
  const body = await generateFinancialPdfBuffer(userId);
  const key = `reports/${userId}/${randomUUID()}.pdf`;
  await r2Client.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET_PRIVATE, Key: key, Body: body, ContentType: 'application/pdf', CacheControl: 'no-cache, private' }));
  const oldReports = await rows("SELECT file_key FROM storage_uploads WHERE user_id=$1 AND folder='reports' AND file_key <> $2", [userId, key]);
  await insert('storage_uploads', { user_id: userId, file_key: key, folder: 'reports', is_public: false, content_type: 'application/pdf', confirmed_at: new Date() });
  if (oldReports.length > 0) {
    await rows("DELETE FROM storage_uploads WHERE user_id=$1 AND folder='reports' AND file_key <> $2 RETURNING file_key", [userId, key]);
    await Promise.all(oldReports.map(r => deleteR2Object({ fileKey: r.file_key, isPublic: false })));
  }
  return { pdf_url: await generateR2ViewUrl({ fileKey: key }), file_key: key };
}
