import mongoose from 'mongoose';
import crypto from 'crypto';

/**
 * AppSetting（系统配置键值表：工单提醒邮箱等运营开关）
 * - 按 key 唯一存取，管理员可写；读走内存缓存（5 分钟），避免每个请求查库
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: String, default: '' },
  },
  { timestamps: true }
);

export const AppSetting = mongoose.model('AppSetting', settingSchema);

const DEFAULT_MAINTENANCE = { enabled: false, message: '系统维护中，请稍后再试', restoreAt: '', accessId: '' };
let maintenanceCache = { at: 0, value: null };

export async function getMaintenance() {
  const now = Date.now();
  if (maintenanceCache.value && now - maintenanceCache.at < 5_000) return maintenanceCache.value;
  const doc = await AppSetting.findOne({ key: 'maintenance_mode' }).lean();
  let value = { ...DEFAULT_MAINTENANCE };
  if (doc?.value) {
    try {
      const parsed = JSON.parse(String(doc.value));
      if (parsed && typeof parsed === 'object') value = { ...value, ...parsed, enabled: !!parsed.enabled };
    } catch {}
  }
  maintenanceCache = { at: now, value };
  return value;
}

export async function setMaintenance(value = {}) {
  const current = await getMaintenance();
  const hasEnabled = Object.prototype.hasOwnProperty.call(value, 'enabled');
  const enabled = hasEnabled ? !!value.enabled : current.enabled;
  const accessId = enabled ? (current.enabled ? current.accessId : crypto.randomBytes(32).toString('base64url')) : '';
  const next = {
    enabled,
    message: Object.prototype.hasOwnProperty.call(value, 'message')
      ? (String(value.message || DEFAULT_MAINTENANCE.message).trim().slice(0, 200) || DEFAULT_MAINTENANCE.message)
      : current.message,
    restoreAt: Object.prototype.hasOwnProperty.call(value, 'restoreAt')
      ? (value.restoreAt ? new Date(value.restoreAt).toISOString() : '')
      : current.restoreAt,
    accessId,
  };
  await AppSetting.updateOne({ key: 'maintenance_mode' }, { $set: { value: JSON.stringify(next) } }, { upsert: true });
  maintenanceCache = { at: Date.now(), value: next };
  return next;
}

export async function regenerateMaintenanceAccess() {
  const current = await getMaintenance();
  if (!current.enabled) throw new Error('维护模式未开启');
  const next = { ...current, accessId: crypto.randomBytes(32).toString('base64url') };
  await AppSetting.updateOne({ key: 'maintenance_mode' }, { $set: { value: JSON.stringify(next) } }, { upsert: true });
  maintenanceCache = { at: Date.now(), value: next };
  return next;
}

// 工单提醒邮箱：逗号/分号/换行分隔的多个邮箱；缓存 5 分钟
const CACHE_TTL_MS = 5 * 60 * 1000;
let ticketEmailsCache = { at: 0, list: null };

export async function getTicketNotifyEmails() {
  const now = Date.now();
  if (ticketEmailsCache.list !== null && now - ticketEmailsCache.at < CACHE_TTL_MS) {
    return ticketEmailsCache.list;
  }
  const doc = await AppSetting.findOne({ key: 'ticket_notify_emails' }).lean();
  const list = String(doc?.value || '')
    .split(/[,;，；\s\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  ticketEmailsCache = { at: now, list };
  return list;
}

/** 写配置后清缓存（同进程即时生效） */
export async function setTicketNotifyEmailsRaw(value) {
  await AppSetting.updateOne(
    { key: 'ticket_notify_emails' },
    { $set: { value: String(value || '') } },
    { upsert: true }
  );
  ticketEmailsCache = { at: 0, list: null };
}

// ---------------- 开发者资料（头像/文案/媒体链接，后台可编辑） ----------------
// 文档内容仅供应用内展示使用（明文存储在 MongoDB，含介绍文案与媒体链接）

/** 开发者资料默认值：文案默认独立开发说明，链接留空时前端按钮自动隐藏 */
const DEFAULT_DEV_PROFILE = {
  name: '物联宝典开发者',
  intro: '本应用由开发者独立完成全部开发工作，包括产品设计、前端、后端、题库整理与功能实现。',
  avatar: '',
  tiktok: '',
  github: '',
};

let devProfileCache = { at: 0, obj: null };

export async function getDevProfile() {
  const now = Date.now();
  if (devProfileCache.obj !== null && now - devProfileCache.at < CACHE_TTL_MS) {
    return devProfileCache.obj;
  }
  const doc = await AppSetting.findOne({ key: 'dev_profile' }).lean();
  let merged = { ...DEFAULT_DEV_PROFILE };
  if (doc?.value) {
    try {
      const parsed = JSON.parse(String(doc.value));
      if (parsed && typeof parsed === 'object') merged = { ...merged, ...parsed };
    } catch {}
  }
  devProfileCache = { at: now, obj: merged };
  return merged;
}

export async function setDevProfileRaw(obj) {
  await AppSetting.updateOne(
    { key: 'dev_profile' },
    { $set: { value: JSON.stringify(obj) } },
    { upsert: true }
  );
  devProfileCache = { at: 0, obj: null };
}
