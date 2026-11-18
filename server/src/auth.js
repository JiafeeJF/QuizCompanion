import jwt from 'jsonwebtoken';
import { User } from './models/User.js';

export const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
}
// token 版本：修改密码后 version+1，旧 token 自动失效（payload.v 对不上即 401）
export const TOKEN_VERSION_KEY = 'tokenVersion';
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 30);
if (!(TOKEN_DAYS >= 1 && TOKEN_DAYS <= 90)) {
  throw new Error('TOKEN_DAYS 非法（1～90 天）');
}

export function signToken(user) {
  return jwt.sign({ id: String(user._id), role: user.role, v: user.tokenVersion || 0 }, JWT_SECRET, {
    expiresIn: `${TOKEN_DAYS}d`,
  });
}

/**
 * Cookie 配置（自 CoupleOrder 移植的持久登录方案）：
 * - httpOnly 防 XSS 偷 token；secure 仅生产开启；sameSite 生产 none（跨站）/开发 lax
 * - maxAge 30 天与 JWT 有效期对齐：关闭网页重开仍保持登录
 */
const isProduction = process.env.NODE_ENV === 'production';
export const authCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  maxAge: TOKEN_DAYS * 24 * 60 * 60 * 1000,
  path: '/',
};
export const AUTH_COOKIE_NAME = 'wlbd_token';

export function publicUser(user) {
  if (!user) return null;
  const obj = typeof user.toObject === 'function' ? user.toObject({ virtuals: true }) : { ...user };
  delete obj.passwordHash;
  delete obj.emailChangeCode;
  delete obj.emailChangeCodeExpireAt;
  delete obj.emailChangeTarget;
  delete obj.tokenVersion;
  // 会员有效态统一在此计算：未开通 false；长期（无到期）true；有到期则与当前时间比
  try { obj.memberActive = isMember(user); } catch { obj.memberActive = false; }
  return obj;
}

/**
 * 登录态校验（CoupleOrder 双通道适配到 WLBD）：
 * 1) 优先读 HttpOnly Cookie（浏览器自动携带，XSS 拿不到）
 * 2) 回退读 Authorization: Bearer（兼容旧 token / 非浏览器客户端）
 */
export async function authRequired(req, res, next) {
  try {
    const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
    const header = req.headers.authorization || '';
    const token = cookieToken || (header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) return res.status(401).json({ error: '请先登录' });
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: '账号不存在' });
    if (user.status === 'banned') return res.status(403).json({ error: '账号已被封禁' });
    // 改密后旧 token 失效：payload.v 与库里 tokenVersion 对不上即 401
    if ((payload.v || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

/** 角色守卫：requireRole('teacher', 'admin')；isSuperAdmin 直接拥有 admin 全部权限 */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '请先登录' });
    if (req.user.isSuperAdmin && roles.includes('admin')) return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: '权限不足' });
    next();
  };
}

/** 是否超管 */
export function isSuperAdmin(user) {
  return !!user?.isSuperAdmin;
}

/** 是否会员（含过期判定） */
export function isMember(user) {
  if (!user) return false;
  if (!user.isMember) return false;
  if (user.memberExpireAt && new Date(user.memberExpireAt) < new Date()) return false;
  return true;
}

/** 是否教师/管理员/超管（不受学生免费权限限制） */
export function isStaff(user) {
  return !!user && (user.role === 'teacher' || user.role === 'admin');
}

/** 会员专属功能统一提示文案 */
export const MEMBER_ONLY_MSG = '该功能为会员专属功能';

export function isAdminUser(user) {
  return !!user && (user.role === 'admin' || user.isSuperAdmin);
}

/**
 * 学生自主使用会员门（STUDENT_SELF）。
 * 免费学生自主使用只开放：顺序刷题；随机/章节/自定义/指定范围等一律会员专属。
 * 教师/管理员(含超管)直接放行。教师布置任务（kind=teacher / scope 作业/考试）不走本门，
 * 由各路由先判定“教师任务”后直行，见 practice-sessions.js / exams.js / questions.js。
 * 返回：{ ok: true } 或 { ok: false, error }
 */
export function requireSelfMember(req) {
  if (isStaff(req.user)) return { ok: true };
  if (isMember(req.user)) return { ok: true };
  return { ok: false, error: MEMBER_ONLY_MSG };
}
