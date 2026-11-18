import nodemailer from 'nodemailer';

/**
 * 邮件发送（QQ SMTP 发件箱）
 * - 配置缺失时降级为控制台打印（本地开发不断流程）
 * - 发信失败只记日志不抛错：验证码已落库，用户可重试，不因邮件抖动阻塞接口
 */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE) === 'true' || String(process.env.SMTP_PORT || '465') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

const FROM = process.env.SMTP_FROM || '物联宝典 <iotexamprep@qq.com>';
// SMTP 无法控制收件客户端的发件人头像；邮件内容使用站点图标保持品牌一致。
const BRAND_ICON_URL = process.env.BRAND_ICON_URL || 'https://iot.wakaibg5.top/favicon-192x192.png';

function brandMark() {
  return `<img src="${BRAND_ICON_URL}" alt="物联宝典" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:10px;object-fit:cover;" />`;
}

export async function sendMail({ to, subject, html, text }) {
  if (!transporter) {
    console.log('\n========== [WLBD 邮件/未配置 SMTP] ==========');
    console.log(`收件人: ${to}`);
    console.log(`主题: ${subject}`);
    console.log('--------------------------------------------');
    console.log(text || html);
    console.log('============================================\n');
    return { mocked: true };
  }
  try {
    await transporter.sendMail({ from: FROM, to, subject, html, text });
    console.log('[mail] 邮件已发送 ->', to);
    return { mocked: false };
  } catch (e) {
    console.error('[mail] 邮件发送失败:', e.message);
    // 把 SMTP 原始错误带回去，前端 toast 能展示原因（"认证失败" vs "域名解析失败" 等，便于排查）
    return { mocked: false, failed: true, error: e.message };
  }
}

/** 换绑邮箱验证码邮件（WLBD 视觉：深色克制风，与登录页开屏一致） */
export function buildEmailChangeCodeMail(code) {
  const text = `你的物联宝典换绑验证码是：${code}，10 分钟内有效。如果这不是你的操作，请忽略本邮件。`;
  const html = `
  <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0e0e11;border-radius:16px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">${brandMark()}<div style="font-size:18px;font-weight:700;color:#fff;">物联宝典 · 换绑邮箱</div></div>
    <p style="color:#a1a1aa;line-height:1.8;">你的验证码是：<b style="font-size:22px;color:#fff;letter-spacing:4px;">${code}</b></p>
    <p style="color:#71717a;font-size:13px;">10 分钟内有效，如果不是你本人的操作，请忽略这封邮件。</p>
  </div>`;
  return { subject: '物联宝典换绑邮箱验证码', text, html };
}

/** 注册验证码邮件（5 分钟有效，与 security.js CODE_TTL_MS 对齐） */
export function buildRegisterCodeMail(code) {
  const text = `欢迎注册物联宝典！你的注册验证码是：${code}，5 分钟内有效。如果这不是你的操作，请忽略本邮件。`;
  const html = `
  <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0e0e11;border-radius:16px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">${brandMark()}<div style="font-size:18px;font-weight:700;color:#fff;">物联宝典 · 注册验证</div></div>
    <p style="color:#a1a1aa;line-height:1.8;">你的注册验证码是：<b style="font-size:22px;color:#fff;letter-spacing:4px;">${code}</b></p>
    <p style="color:#71717a;font-size:13px;">5 分钟内有效，如果不是你本人的操作，请忽略这封邮件。</p>
  </div>`;
  return { subject: '物联宝典注册验证码', text, html };
}

function wrap(title, sub, inner) {
  return { subject: title, html: `<div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;"><div style="background:#111827;padding:18px 22px;color:#fff;"><div style="display:flex;align-items:center;gap:10px;">${brandMark()}<div><div style="font-size:16px;font-weight:700;">${title}</div><div style="font-size:12px;color:#9ca3af;">${sub}</div></div></div></div><div style="padding:22px;">${inner}</div><div style="padding:14px 22px;background:#f9fafb;color:#9ca3af;font-size:12px;">本邮件由物联宝典自动发送，请勿直接回复。</div></div>`, text: inner.replace(/<[^>]+>/g, '') };
}
export function buildWelcomeMail(name) {
  const inner = `<p>Hi ${name || '同学'}，欢迎加入物联宝典！账号已注册成功，现在就可以开始刷题、参加班级考试了。</p><p><a href="https://iot.wakaibg5.top">进入物联宝典刷题 →</a></p>`;
  const r = wrap('【物联宝典】欢迎加入，开始刷题吧', '注册成功', inner);
  return { subject: r.subject, text: '欢迎加入物联宝典！现在就可以开始刷题：https://iot.wakaibg5.top', html: r.html };
}
export function buildSubmitConfirmMail({ examTitle, score, totalScore, accuracy }) {
  const inner = `<p>你已成功交卷《${examTitle}》，得分 ${score} / ${totalScore}，正确率 ${accuracy}%。</p><p><a href="https://iot.wakaibg5.top">查看成绩详情 →</a></p>`;
  const r = wrap('【物联宝典】交卷成功：' + examTitle, '交卷确认', inner);
  return { subject: r.subject, text: `你已成功交卷《${examTitle}》，得分${score}/${totalScore}。`, html: r.html };
}
export function buildTicketReplyMail({ title, reply }) {
  const inner = `<p>你的工单《${title}》有新回复：</p><blockquote>${reply}</blockquote><p><a href="https://iot.wakaibg5.top/tickets">查看回复 →</a></p>`;
  const r = wrap('【物联宝典】工单有新回复：' + title, '意见反馈', inner);
  return { subject: r.subject, text: `工单《${title}》有新回复：${reply}`, html: r.html };
}
export function buildMemberActiveMail({ name, expireAt }) {
  const inner = `<p>Hi ${name || '同学'}，你的会员已开通生效${expireAt ? '，到期时间：' + new Date(expireAt).toLocaleDateString('zh-CN') : '。'}感谢支持！</p>`;
  const r = wrap('【物联宝典】会员已开通', '会员通知', inner);
  return { subject: r.subject, text: inner.replace(/<[^>]+>/g, ''), html: r.html };
}
export function buildMemberExpiringMail({ name, expireAt }) {
  const inner = `<p>Hi ${name || '同学'}，你的会员将于 ${new Date(expireAt).toLocaleDateString('zh-CN')} 到期，到期后自定义组卷与错题导出将受限。请联系管理员续费。</p>`;
  const r = wrap('【物联宝典】会员即将到期', '会员提醒', inner);
  return { subject: r.subject, text: inner.replace(/<[^>]+>/g, ''), html: r.html };
}
