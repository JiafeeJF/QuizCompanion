import crypto from 'crypto';

// Auth security ported from CoupleOrder: login rate-limit / failure lock + register email codes.
// - rateLimit: per-IP sliding window for login/send-code endpoints.
// - loginGuard/recordLoginFailure/clearLoginFailures: lock one email 10min after 5 fails;
//   block one IP after 20 fails in 5min; cleared on successful login.
// - issueEmailCode/verifyEmailCode: register codes, same scheme as CoupleOrder:
//   sha256 stored in memory (never plaintext); 5min TTL; one-time use; void after 5 wrong tries;
//   resend limits: same email 60s gap, 5/hour, 10/day; same IP 20/hour.
// - audit: console log for login/register events.
// - cleanText: sanitize audit log text.
// NOT ported: image validation, pair codes (CoupleOrder business).

const buckets = new Map();

function keyFor(req, scope) {
  // 登录用户按账号分桶：雷池 + Nginx 回源后所有请求源 IP 相同，按 IP 限流会误伤
  const uid = req.user?._id ? String(req.user._id) : null;
  if (uid) return `${scope}:user:${uid}`;
  return `${scope}:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

const DEFAULT_MSG = '请求过于频繁，请稍后再试';

export function rateLimit({ scope, windowMs, max, message }) {
  const msg = message || DEFAULT_MSG;
  return (req, res, next) => {
    const key = keyFor(req, scope);
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.expiresAt <= now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) {
      res.set('Retry-After', String(Math.ceil((current.expiresAt - now) / 1000)));
      return res.status(429).json({ error: msg });
    }
    next();
  };
}

// ------- 敏感接口分组限流（宽严分离：刷题/查询宽松，登录/发码/管理严格）-------
// 机房 NAT 同 IP 下全班并发：刷题类用高阈值；登录/发码/管理用低阈值防爆破。
const SENSITIVE_LIMIT = rateLimit({ scope: 'sensitive', windowMs: 60 * 1000, max: 600, message: DEFAULT_MSG });
const STRICT_LIMIT = rateLimit({ scope: 'strict', windowMs: 5 * 60 * 1000, max: 30, message: DEFAULT_MSG });

/**
 * 敏感操作中间件：按用户分桶（同一账号跨 IP 累计），IP 层另有全局兜底。
 * 写操作（POST/PUT/PATCH/DELETE）且已登录才计数，避免查询流量误伤。
 */
export function sensitiveWriteLimit(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  return SENSITIVE_LIMIT(req, res, next);
}

/** 管理员接口严格限流（防后台爆破/批量破坏） */
export function adminStrictLimit(req, res, next) {
  return STRICT_LIMIT(req, res, next);
}

export function cleanText(value, maxLength = 200) {
  return String(value ?? '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

const loginFailures = new Map();
const MAX_FAILS_BEFORE_LOCK = 5;
const LOCK_MS = 10 * 60 * 1000;
const IP_FAIL_WINDOW_MS = 5 * 60 * 1000;
const IP_FAIL_MAX = 20;

export function loginGuard(email, ip) {
  const now = Date.now();
  const key = String(email || '').trim().toLowerCase();
  const record = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  if (record.lockedUntil > now) return { blocked: true, reason: 'account' };
  const ipRecord = loginFailures.get(`ip:${ip || 'unknown'}`) || { failures: [] };
  ipRecord.failures = ipRecord.failures.filter((time) => now - time < IP_FAIL_WINDOW_MS);
  if (ipRecord.failures.length >= IP_FAIL_MAX) return { blocked: true, reason: 'ip' };
  return { blocked: false };
}

export function recordLoginFailure(email, ip) {
  const key = String(email || '').trim().toLowerCase();
  const record = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILS_BEFORE_LOCK) record.lockedUntil = Date.now() + LOCK_MS;
  loginFailures.set(key, record);
  const ipKey = `ip:${ip || 'unknown'}`;
  const ipRecord = loginFailures.get(ipKey) || { failures: [] };
  ipRecord.failures.push(Date.now());
  loginFailures.set(ipKey, ipRecord);
}

export function clearLoginFailures(email) {
  loginFailures.delete(String(email || '').trim().toLowerCase());
}

/** 测试/管理用途：清除指定邮箱的登录锁定（测试脚本重启内存态；生产滥用会被审计） */
export function clearLoginLock(email) {
  clearLoginFailures(email);
}

/** 测试启动时重置内存限流态（重启进程的内存等价物；生产不用） */
export function resetSecurityState() {
  buckets.clear();
  loginFailures.clear();
  verificationCodes.clear();
  sendHistory.clear();
}

const verificationCodes = new Map();
const sendHistory = new Map();
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

const RATE_LIMIT_MSGS = {
  tooFreq: '验证码发送过于频繁，请 60 秒后再试',
  hourLimit: '该邮箱本小时验证码发送次数已达上限',
  dayLimit: '该邮箱今日验证码发送次数已达上限',
  ipLimit: '当前网络验证码发送次数过多，请稍后再试',
};
const VERIFY_MSGS = {
  expired: '邮箱验证码已过期或不存在，请重新获取',
  tooManyWrong: '验证码错误次数过多，请重新获取',
  wrong: '邮箱验证码错误',
};

export function issueEmailCode(email, ip) {
  const key = String(email || '').trim().toLowerCase();
  const now = Date.now();
  const record = sendHistory.get(key) || { sent: [] };
  record.sent = record.sent.filter((t) => now - t < 24 * 60 * 60 * 1000);
  if (record.sent.some((t) => now - t < 60 * 1000)) return { error: RATE_LIMIT_MSGS.tooFreq };
  if (record.sent.filter((t) => now - t < 60 * 60 * 1000).length >= 5) {
    return { error: RATE_LIMIT_MSGS.hourLimit };
  }
  if (record.sent.length >= 10) return { error: RATE_LIMIT_MSGS.dayLimit };
  const ipKey = `ip:${ip || 'unknown'}`;
  const ipRecord = sendHistory.get(ipKey) || { sent: [] };
  ipRecord.sent = ipRecord.sent.filter((t) => now - t < 60 * 60 * 1000);
  if (ipRecord.sent.length >= 20) return { error: RATE_LIMIT_MSGS.ipLimit };
  const code = String(crypto.randomInt(100000, 1000000));
  verificationCodes.set(key, { codeHash: hashCode(code), expiresAt: now + CODE_TTL_MS, attempts: 0 });
  record.sent.push(now);
  ipRecord.sent.push(now);
  sendHistory.set(key, record);
  sendHistory.set(ipKey, ipRecord);
  return { code };
}

export function verifyEmailCode(email, code) {
  const key = String(email || '').trim().toLowerCase();
  const record = verificationCodes.get(key);
  if (!record || record.expiresAt < Date.now()) {
    verificationCodes.delete(key);
    return { ok: false, error: VERIFY_MSGS.expired };
  }
  if (record.codeHash !== hashCode(String(code || '').trim())) {
    record.attempts += 1;
    if (record.attempts >= MAX_VERIFY_ATTEMPTS) verificationCodes.delete(key);
    return { ok: false, error: record.attempts >= MAX_VERIFY_ATTEMPTS ? VERIFY_MSGS.tooManyWrong : VERIFY_MSGS.wrong };
  }
  verificationCodes.delete(key);
  return { ok: true };
}

export function audit(action, userId, details = '') {
  console.info(`[security] ${action} user=${userId || '-'} ${cleanText(details, 300)}`);
}

/**
 * 安全审计日志（落库 examNotify 风格的轻量版：auth/admin 敏感操作）。
 * 只记 operatorUserId/action/target/IP/result，不记密码/验证码/JWT/Cookie。
 * 落库失败不阻塞业务（catch 吞掉，只打 console）。
 */
export async function auditLog({ action, operatorId = null, targetId = null, ip = '', result = 'ok', detail = '' }) {
  try {
    const { AuditLog } = await import('./models/AuditLog.js');
    await AuditLog.create({
      action: String(action).slice(0, 60),
      operatorId: operatorId || null,
      targetId: targetId ? String(targetId).slice(0, 100) : '',
      ip: String(ip || '').slice(0, 60),
      result: result === 'fail' ? 'fail' : 'ok',
      detail: cleanText(detail, 300),
    });
  } catch (e) {
    console.error('[audit] 落库失败:', e.message);
  }
}
