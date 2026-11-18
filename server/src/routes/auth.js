import { Router } from 'express';
import crypto, { createHash } from 'crypto';
import { User } from '../models/User.js';
import { authRequired, publicUser, signToken, requireRole, authCookieOptions, AUTH_COOKIE_NAME } from '../auth.js';
import { comparePassword, findUserByEmail, hashPassword, validEmail, validPassword } from '../utils.js';
import { rateLimit, loginGuard, recordLoginFailure, clearLoginFailures, clearLoginLock, audit, auditLog, issueEmailCode, verifyEmailCode } from '../security.js';
import { isObjectId, validRole } from '../validate.js';
import { createCaptchaChallenge, verifyCaptcha } from '../captcha.js';
import { sendMail, buildEmailChangeCodeMail, buildRegisterCodeMail, buildWelcomeMail } from '../email.js';
import { getMaintenance } from '../models/AppSetting.js';
import { isValidMobileAdminKey } from '../mobileAdminAccess.js';

const router = Router();
// 登录限流：单 IP 5 分钟 60 次。
// 为何不是 CoupleOrder 的 20 次：学校机房/NAT 出口下全班同 IP，20 次极易误伤正常登录；
// 真正的防爆破主力是 loginGuard（同一邮箱连错 5 次锁定 10 分钟），IP 层只做兜底。
const loginLimit = rateLimit({ scope: 'login', windowMs: 5 * 60 * 1000, max: 60, message: '请求过于频繁，请稍后再试' });
// 注册/发码限流：暴力注册与邮箱轰炸防护（发码另有 security.js 内邮箱/IP 级发送限流）。
// 同 CoupleOrder 口径：发码 5 分钟 20 次；注册 15 分钟放宽到 60 次——
// 学校机房 NAT 同 IP + 自测连续调用场景下 5 次会误伤；防爆破主力是验证码本身（5 分钟过期/错 5 次作废）。
const registerLimit = rateLimit({ scope: 'register', windowMs: 15 * 60 * 1000, max: 60, message: '注册请求过于频繁，请稍后再试' });
const sendCodeLimit = rateLimit({ scope: 'register-code', windowMs: 5 * 60 * 1000, max: 20, message: '请求过于频繁，请稍后再试' });

/** GET /api/auth/captcha/challenge 拉取 ALTCHA 人机挑战（登录/注册前调用） */
router.get('/captcha/challenge', async (req, res) => {
  try {
    res.json(await createCaptchaChallenge());
  } catch {
    res.status(503).json({ error: '人机验证暂时不可用，请稍后重试' });
  }
});

/**
 * POST /api/auth/register/send-code { email, captchaToken }
 * 注册发码：人机验证 → 邮箱格式 → 未注册检查 → 发码（5 分钟有效，60 秒禁重发）。
 * 真实验证码只走邮件，响应不带 code。
 */
router.post('/register/send-code', sendCodeLimit, async (req, res) => {
  try {
    const maintenance = await getMaintenance();
    if (maintenance.enabled) return res.status(503).json({ error: maintenance.message, code: 'MAINTENANCE', maintenance });
    const { email, captchaToken } = req.body || {};
    if (!(await verifyCaptcha(captchaToken))) {
      return res.status(400).json({ error: '人机验证失败，请重试' });
    }
    const email2 = String(email || '').trim().toLowerCase();
    if (!validEmail(email2)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (await findUserByEmail(email2)) return res.status(400).json({ error: '该邮箱已注册，请直接登录' });
    const issued = issueEmailCode(email2, req.ip);
    if (issued.error) return res.status(429).json({ error: issued.error });
    const { subject, text, html } = buildRegisterCodeMail(issued.code);
    const r = await sendMail({ to: email2, subject, text, html });
    if (r?.failed) return res.status(502).json({ error: '邮件发送失败，请稍后重试' });
    res.json({ ok: true, message: '验证码已发送到邮箱，5 分钟内有效' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '发送失败，请稍后重试' });
  }
});

/**
 * POST /api/auth/register { name?, email, password, emailCode, captchaToken }
 * CoupleOrder 注册能力适配到 WLBD：
 * - 必验：人机 payload 后端复验 + 邮箱验证码（成功即删防重放）+ 邮箱未注册
 * - 密码：沿用 WLBD 至少 6 位（考证应用降低门槛；不套 CoupleOrder 8 位+大小写规则，避免旧用户/新用户双轨）
 * - 新用户 role=student / isMember=false，role 不接受前端传入（教师/管理员走后台）
 * - 无配对码；成功写 HttpOnly Cookie + 返回 token，前端自动登录进学员端
 */
router.post('/register', registerLimit, async (req, res) => {
  try {
    const maintenance = await getMaintenance();
    if (maintenance.enabled) return res.status(503).json({ error: maintenance.message, code: 'MAINTENANCE', maintenance });
    const { name = '', email, password, emailCode, captchaToken } = req.body || {};
    // 1) 人机验证：后端复验完整 payload，前端“已打勾”不算数
    if (!(await verifyCaptcha(captchaToken))) {
      return res.status(400).json({ error: '人机验证失败，请重试' });
    }
    // 2) 邮箱验证码：成功即删，过期/错 5 次作废
    const codeResult = verifyEmailCode(email, emailCode);
    if (!codeResult.ok) return res.status(400).json({ error: codeResult.error });
    // 3) 邮箱 + 密码后端终验（不只依赖前端）
    const email2 = String(email || '').trim().toLowerCase();
    if (!validEmail(email2)) return res.status(400).json({ error: '邮箱格式不正确' });
    if (!validPassword(password)) return res.status(400).json({ error: '密码至少 6 位' });
    if (await findUserByEmail(email2)) return res.status(400).json({ error: '该邮箱已注册，请直接登录' });
    const user = await User.create({
      name: String(name || '').trim().slice(0, 20),
      email: email2,
      passwordHash: await hashPassword(password),
      role: 'student',
    });
    audit('register', String(user._id), `email=${email2}`);
    try { const m = buildWelcomeMail(user.name); sendMail({ to: email2, subject: m.subject, text: m.text, html: m.html }).catch(() => {}); } catch {}
    const token = signToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/**
 * POST /api/auth/login { email, password, captchaToken }
 * CoupleOrder 登录能力适配到 WLBD：
 * - 人机验证必过（防脚本批量撞库）；WLBD 密码哈希 bcryptjs(10) 与 CoupleOrder 相同，直接复用 comparePassword
 * - 同一邮箱连续失败 5 次锁定 10 分钟；错误提示统一“邮箱或密码错误”防枚举
 * - 成功后同时写 HttpOnly Cookie + 返回 token（双通道：Cookie 自动携带为主，Bearer 兼容旧端）
 * - WLBD User 原样返回（含 role / isMember / memberExpireAt / classId），角色体系不变
 */
router.post('/login', loginLimit, async (req, res) => {
  try {
    const { email, password, captchaToken, accessId, mobileAdminKey } = req.body || {};
    if (!(await verifyCaptcha(captchaToken))) {
      return res.status(400).json({ error: '人机验证失败，请重试' });
    }
    const email2 = String(email || '').trim().toLowerCase();
    const guard = loginGuard(email2, req.ip);
    if (guard.blocked) return res.status(429).json({ error: '登录失败次数过多，请 10 分钟后再试' });
    const user = await findUserByEmail(email2);
    if (!user) {
      recordLoginFailure(email2, req.ip);
      audit('login-failed', null, `email=${email2}`);
      return res.status(401).json({ error: '邮箱或密码错误' });
    }
    if (!(await comparePassword(password, user.passwordHash))) {
      recordLoginFailure(email2, req.ip);
      audit('login-failed', String(user._id));
      return res.status(401).json({ error: '邮箱或密码错误' });
    }
    if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁' });
    const maintenance = await getMaintenance();
    const isAdmin = user.role === 'admin' || user.isSuperAdmin;
    const maintenanceAdminAccess = isAdmin && (
      maintenance.accessId === String(accessId || '') || isValidMobileAdminKey(mobileAdminKey)
    );
    if (maintenance.enabled && !maintenanceAdminAccess) {
      return res.status(503).json({ error: maintenance.message, code: 'MAINTENANCE', maintenance });
    }
    clearLoginFailures(email2);
    audit('login', String(user._id));
    const token = signToken(user);
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
    res.json({ token, user: publicUser(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/** POST /api/auth/logout 清 Cookie + 前端清 token（见 auth.jsx logout） */
router.post('/logout', async (req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { ...authCookieOptions, maxAge: undefined });
  res.json({ ok: true });
});

/** GET /api/auth/me */
router.get('/me', authRequired, async (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** PUT /api/auth/profile { name } 修改昵称 */
router.put('/profile', authRequired, async (req, res) => {
  const { name, avatar } = req.body || {};
  if (name !== undefined) {
    const n = String(name ?? '').trim().slice(0, 20);
    if (!n) return res.status(400).json({ error: '昵称不能为空' });
    req.user.name = n;
  }
  if (avatar !== undefined) {
    // 头像为前端压缩后的 dataURL；dataURL 以外的一律拒绝，避免存任意大文本
    const s = String(avatar || '');
    if (s && !/^data:image\/(jpeg|png|webp);base64,/.test(s)) {
      return res.status(400).json({ error: '头像格式不正确' });
    }
    if (s.length > 150 * 1024) return res.status(400).json({ error: '头像过大，请重新选择' });
    req.user.avatar = s;
  }
  await req.user.save();
  res.json({ user: publicUser(req.user) });
});

/** PUT /api/auth/password { oldPassword, newPassword }（改密后旧 token 全部失效，需重新登录） */
router.put('/password', authRequired, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!(await comparePassword(oldPassword, req.user.passwordHash))) {
      return res.status(400).json({ error: '原密码不正确' });
    }
    if (!validPassword(newPassword)) return res.status(400).json({ error: '新密码至少 6 位' });
    req.user.passwordHash = await hashPassword(newPassword);
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save();
    res.clearCookie(AUTH_COOKIE_NAME, { ...authCookieOptions, maxAge: undefined });
    const token = signToken(req.user);
    res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions);
    audit('change-password', String(req.user._id));
    res.json({ ok: true, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '修改密码失败' });
  }
});

/**
 * 修改邮箱（两步 + 真实邮件验证码）
 * POST /api/auth/email/request { newEmail, password }  -> 生成 6 位验证码并用 SMTP 发到新邮箱
 * PUT  /api/auth/email { newEmail, code }              -> 校验并换绑
 * 响应不再返回 code：生产一律走邮件，避免验证码泄露。
 * 演示模式（DEMO_EMAIL_CODES=true）：调用者是超管且目标邮箱是演示域（example.com/.test/localhost），
 * 则直接返回 code 方便测试；真实邮箱永远走邮件。
 */
const emailChangeAttempts = new Map();
// 演示域白名单：只有这些域的验证码允许在演示模式下回显，防生产泄漏
const DEMO_EMAIL_SUFFIXES = ['@example.com', '.test', '@localhost'];
const isDemoEchoEmail = (email2) =>
  process.env.DEMO_EMAIL_CODES === 'true' &&
  DEMO_EMAIL_SUFFIXES.some((suf) => String(email2).endsWith(suf));
function hashEmailCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}
router.post('/email/request', authRequired, async (req, res) => {
  try {
    const { newEmail, password } = req.body || {};
    const email2 = String(newEmail || '').trim().toLowerCase();
    if (!validEmail(email2)) return res.status(400).json({ error: '新邮箱格式不正确' });
    if (email2 === req.user.email) return res.status(400).json({ error: '新邮箱与当前邮箱相同' });
    if (await findUserByEmail(email2)) return res.status(400).json({ error: '该邮箱已被其他账号使用' });
    if (!(await comparePassword(password, req.user.passwordHash))) {
      return res.status(400).json({ error: '密码不正确' });
    }
    // 60 秒禁重发（防邮箱轰炸）
    if (req.user.emailChangeCodeExpireAt && req.user.emailChangeCodeExpireAt.getTime() - Date.now() > 9 * 60 * 1000) {
      return res.status(429).json({ error: '验证码发送过于频繁，请稍后再试' });
    }
    const code = String(crypto.randomInt(100000, 1000000));
    req.user.emailChangeTarget = email2;
    req.user.emailChangeCode = hashEmailCode(code);
    req.user.emailChangeCodeExpireAt = new Date(Date.now() + 10 * 60 * 1000);
    await req.user.save();
    emailChangeAttempts.delete(String(req.user._id));
    const { subject, text, html } = buildEmailChangeCodeMail(code);
    const r = await sendMail({ to: email2, subject, text, html });
    if (r?.failed) {
      // 邮件失败：把验证码带回错误信息，让前端 toast 能展示原因（用户可据此重试或联系管理员）
      return res.status(502).json({ error: `邮件发送失败：${r.error || 'SMTP 异常'}，请稍后重试或联系管理员` });
    }
    // 演示模式 + 超管 + 演示域邮箱：直接回显 code，方便测试；真实邮箱永远走邮件
    if (r?.mocked && req.user.isSuperAdmin && isDemoEchoEmail(email2)) {
      return res.json({ ok: true, code, message: '演示模式：验证码直接返回（仅超管+演示域）' });
    }
    res.json({ ok: true, message: '验证码已发送到新邮箱，10 分钟内有效' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '请求失败' });
  }
});

router.put('/email', authRequired, async (req, res) => {
  try {
    const { newEmail, code } = req.body || {};
    const email2 = String(newEmail || '').trim().toLowerCase();
    if (!req.user.emailChangeCode || !req.user.emailChangeTarget) {
      return res.status(400).json({ error: '请先获取验证码' });
    }
    if (req.user.emailChangeCodeExpireAt < new Date()) {
      req.user.emailChangeCode = null;
      req.user.emailChangeTarget = null;
      req.user.emailChangeCodeExpireAt = null;
      await req.user.save();
      return res.status(400).json({ error: '验证码已过期，请重新获取' });
    }
    const uid = String(req.user._id);
    const tries = (emailChangeAttempts.get(uid) || 0) + 1;
    emailChangeAttempts.set(uid, tries);
    if (tries > 5) {
      req.user.emailChangeCode = null;
      req.user.emailChangeTarget = null;
      req.user.emailChangeCodeExpireAt = null;
      await req.user.save();
      emailChangeAttempts.delete(uid);
      return res.status(400).json({ error: '验证码错误次数过多，请重新获取' });
    }
    if (req.user.emailChangeTarget !== email2 || req.user.emailChangeCode !== hashEmailCode(String(code || '').trim())) {
      return res.status(400).json({ error: '验证码错误' });
    }
    if (await User.findOne({ email: email2, _id: { $ne: req.user._id } })) {
      return res.status(400).json({ error: '该邮箱已被其他账号使用' });
    }
    req.user.email = email2;
    req.user.emailChangeCode = null;
    req.user.emailChangeTarget = null;
    req.user.emailChangeCodeExpireAt = null;
    await req.user.save();
    emailChangeAttempts.delete(uid);
    audit('change-email', uid, `target=${email2}`);
    res.json({ user: publicUser(req.user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '换绑失败' });
  }
});

/** 管理员改用户角色（兜底接口；正式管理走 /api/admin） */
router.put('/role', authRequired, requireRole('admin'), async (req, res) => {
  const { userId, role } = req.body || {};
  if (!validRole(role)) return res.status(400).json({ error: '角色非法' });
  if (!isObjectId(String(userId))) return res.status(404).json({ error: '用户不存在' });
  const u = await User.findById(userId);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  // 超管 role 不可动：兜底接口同样拦截，防止绕过 /api/admin 直接降权
  if (u.isSuperAdmin) return res.status(403).json({ error: '超级管理员角色不可修改' });
  // 普通 admin 不可提权他人为 admin；超管不受限
  if (role === 'admin' && !req.user.isSuperAdmin) {
    return res.status(403).json({ error: '无权授予管理员角色' });
  }
  u.role = role;
  await u.save();
  auditLog({ action: 'admin.set-role', operatorId: req.user._id, targetId: u._id, ip: req.ip, detail: `role=${role}` });
  res.json({ user: publicUser(u) });
});

export default router;
