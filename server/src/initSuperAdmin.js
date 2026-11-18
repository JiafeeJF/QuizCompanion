import { User } from './models/User.js';
import { validEmail } from './utils.js';
import { hashPassword } from './utils.js';

/**
 * ensureSuperAdmin：启动时确保默认超级管理员存在。
 * - 账号/密码全部来自 ENV（SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD），不硬编码
 * - 邮箱统一 trim().toLowerCase()：大小写视为同一账号
 * - 不存在 → 用 ENV 密码哈希创建（role=admin, isSuperAdmin=true）
 * - 已存在 → 只补齐 role/isSuperAdmin，绝不重置密码（避免重启覆盖管理员改过的密码）
 * - SUPER_ADMIN_FORCE_RESET=true 显式开启时才用 ENV 密码强制重置（应急找回用）
 * - 生产环境缺配置 → 抛错中断启动，禁止用默认弱密码上线
 */
function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export async function ensureSuperAdmin() {
  const email = normEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const forceReset = String(process.env.SUPER_ADMIN_FORCE_RESET || 'false').toLowerCase() === 'true';

  if (!email || !validEmail(email)) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SUPER_ADMIN_EMAIL 未配置或格式非法，生产环境拒绝启动');
    }
    console.warn('[init] SUPER_ADMIN_EMAIL 未配置：跳过超级管理员初始化（开发环境）');
    return null;
  }
  if (!password || password.length < 8) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SUPER_ADMIN_PASSWORD 未配置或弱于 8 位，生产环境拒绝启动');
    }
    if (!password) {
      console.warn('[init] SUPER_ADMIN_PASSWORD 未配置：跳过超级管理员初始化（开发环境）');
      return null;
    }
    console.warn('[init] SUPER_ADMIN_PASSWORD 弱于 8 位：仅允许开发环境使用');
  }

  let u = await User.findOne({ email });
  if (!u) {
    u = await User.create({
      name: '系统超级管理员',
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      isSuperAdmin: true,
      status: 'active',
    });
    console.log(`[init] 超级管理员已创建: ${email}`);
    return u;
  }
  // 已存在：只补齐权限位，密码默认不动
  let dirty = false;
  if (u.role !== 'admin') { u.role = 'admin'; dirty = true; }
  if (u.isSuperAdmin !== true) { u.isSuperAdmin = true; dirty = true; }
  if (u.status === 'banned') { u.status = 'active'; dirty = true; }
  if (forceReset) {
    u.passwordHash = await hashPassword(password);
    dirty = true;
    console.log('[init] SUPER_ADMIN_FORCE_RESET=true：超级管理员密码已按 ENV 重置');
  }
  if (dirty) await u.save();
  return u;
}
