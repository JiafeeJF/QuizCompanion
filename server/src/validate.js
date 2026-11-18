/**
 * 服务端输入验证（轻量白名单，不引入新依赖）。
 * 原则：所有 req.body/query/params 走这里终验，不信任前端；
 * role/isMember/isSuperAdmin 等特权字段一律不接受前端传入（各路由只取白名单字段）。
 */
const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

export function isObjectId(v) {
  return typeof v === 'string' && OBJECT_ID_RE.test(v);
}

export function normEmail(v) {
  return String(v || '').trim().toLowerCase();
}

export function validEmailStrict(email) {
  const s = String(email || '').trim();
  if (s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function validPasswordStrict(password) {
  // 沿用项目口径：至少 6 位（考证应用可用性优先）；只加长度上限防 DoS
  const s = String(password || '');
  return s.length >= 6 && s.length <= 128;
}

export function toInt(v, { min = null, max = null, def = null } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n)) return def;
  if (min !== null && n < min) return def;
  if (max !== null && n > max) return def;
  return n;
}

/** 题号范围（顺序抽题/刷题 range）：1-based 闭区间，上限由调用方按题库总数传入 */
export function validRange(start, end, total) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e)) return '题号必须为整数';
  if (s < 1) return '开始题号不能小于 1';
  if (e < s) return '结束题号不能小于开始题号';
  if (total != null && e > total) return `结束题号不能超过 ${total}`;
  return null;
}

export function validRole(role) {
  return ['student', 'teacher', 'admin'].includes(role);
}

/** 分页参数白名单（防 skip 爆炸） */
export function pageParams(query, { maxSize = 100 } = {}) {
  const page = Math.max(1, Number(query?.page) || 1);
  const pageSize = Math.max(1, Math.min(maxSize, Number(query?.pageSize) || 20));
  return { page, pageSize };
}

/** 关键字白名单：截断 + 去控制字符（$regex 查询统一走转义） */
export function safeKeyword(v, maxLen = 50) {
  return String(v || '').replace(/[\0-\x1f\\]/g, '').trim().slice(0, maxLen);
}

/** $regex 转义：用户输入不得作为正则原文 */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 时长/分值/截止时间 */
export function validDurationMin(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(5, Math.min(600, Math.round(n)));
}

export function validScore(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(100, n));
}

export function validDeadline(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '截止时间格式非法';
  return d;
}
