import { Browser } from '@capacitor/browser';
import { DOWNLOAD_SITE_URL } from './config.js';
const TOKEN_KEY = 'wlbd_token';

/**
 * API 基地址：
 * - Web 端：相对路径（走同域 / Vite 代理），保持现有行为不变
 * - App 端（Capacitor 原生）：WebView 跑 capacitor://localhost，相对路径无效，
 *   必须用绝对地址直连后端。构建时用 VITE_API_BASE 注入（默认生产域名）。
 */
function isNativeApp() {
  try {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  } catch { return false; }
}
/** 是否安卓 APP 内运行（Capacitor 原生）：检查更新等仅 APP 可见，网页端一律隐藏 */
export function isAppEnv() {
  return isNativeApp();
}
const API_BASE = (() => {
  const env = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) || '';
  if (env) return String(env).replace(/\/$/, '');
  if (isNativeApp()) return 'https://iot.wakaibg5.top';
  return '';
})();
function url(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

/**
 * Token 管理（CoupleOrder localStorage 持久化方案适配到 WLBD）
 * - 登录成功写入 localStorage：关闭网页重开、F5 刷新都保持登录
 * - 退出/401 失效时清掉：受保护页立即回到登录页
 */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  invalidateApiCache('/api/auth/me');
}

/** 统一 401 处理：清无效 token + 广播事件，AuthProvider 监听后清用户态并回登录页 */
function handleUnauthorized() {
  setToken('');
  try {
    window.dispatchEvent(new CustomEvent('wlbd:unauthorized'));
  } catch {}
}

function handleMaintenance(data) {
  if (data?.code !== 'MAINTENANCE') return;
  try { window.dispatchEvent(new CustomEvent('wlbd:maintenance', { detail: data.maintenance || { enabled: true, message: data.error } })); } catch {}
}

const responseCache = new Map();
const pendingRequests = new Map();
const CACHE_TTL = 30_000;
const REQUEST_TIMEOUT = 12_000;

function cachedGet(path, loader, ttl = CACHE_TTL) {
  const now = Date.now();
  const cached = responseCache.get(path);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
  if (pendingRequests.has(path)) return pendingRequests.get(path);
  const pending = loader().then((value) => {
    responseCache.set(path, { value, expiresAt: Date.now() + ttl });
    pendingRequests.delete(path);
    return value;
  }).catch((error) => {
    pendingRequests.delete(path);
    throw error;
  });
  pendingRequests.set(path, pending);
  return pending;
}

export function invalidateApiCache(prefix = '') {
  for (const key of responseCache.keys()) if (!prefix || key.startsWith(prefix)) responseCache.delete(key);
}

async function request(path, { method = 'GET', body, auth = true, timeout = REQUEST_TIMEOUT } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // 双通道：HttpOnly Cookie 由浏览器自动携带（credentials: 'include'），
  // localStorage token 作 Authorization 回退（兼容旧登录态 / 非浏览器端）
  const token = auth ? getToken() : '';
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(url(path), {
      method,
      credentials: 'include',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('请求超时，请检查网络后重试');
      timeoutError.isNetworkError = true;
      throw timeoutError;
    }
    error.isNetworkError = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    handleMaintenance(data);
    if (res.status === 401 && auth) handleUnauthorized();
    throw new Error(data.error || '请求失败，请稍后重试');
  }
  return data;
}

async function requestBlob(path) {
  const headers = {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url(path), { headers, credentials: 'include', signal: controller.signal });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      handleMaintenance(data);
      if (res.status === 401) handleUnauthorized();
      throw new Error(data.error || '请求失败');
    }
    return res.blob();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时，请检查网络后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const get = (p) => request(p);
const getNoAuth = (p) => request(p, { auth: false });
const post = (p, body) => request(p, { method: 'POST', body });
const put = (p, body) => request(p, { method: 'PUT', body });
const del = (p) => request(p, { method: 'DELETE' });

export const api = {
  maintenance: () => request('/api/system/maintenance', { auth: false }),
  maintenanceAccess: (id) => request(`/api/system/maintenance-access/${encodeURIComponent(id)}`, { auth: false }),
  maintenanceAnnouncements: () => request('/api/system/announcements', { auth: false }),
  // 认证（登录需先拉 captchaChallenge 做人机验证，见 Login.jsx）
  captchaChallenge: () => request('/api/auth/captcha/challenge', { auth: false }),
  sendRegisterCode: (d) => request('/api/auth/register/send-code', { method: 'POST', body: d, auth: false }),
  register: (d) => request('/api/auth/register', { method: 'POST', body: d, auth: false }),
  login: (d) => post('/api/auth/login', d),
  logout: () => post('/api/auth/logout'),
  me: () => cachedGet('/api/auth/me', () => get('/api/auth/me'), 15_000),
  updateName: (name) => put('/api/auth/profile', { name }),
  updateProfile: (d) => put('/api/auth/profile', d), // { name?, avatar? } avatar 为前端压缩后的 dataURL
  changePassword: (d) => put('/api/auth/password', d),
  emailCode: (d) => post('/api/auth/email/request', d),
  changeEmail: (d) => put('/api/auth/email', d),

  // 章节与题
  chapters: () => cachedGet('/api/chapters', () => get('/api/chapters'), 5 * 60_000),
  questionCount: () => cachedGet('/api/questions/count/summary', () => get('/api/questions/count/summary'), 60_000),
  questionCount: () => get('/api/questions/count/summary'),
  questions: (params = {}) => get('/api/questions/list?' + new URLSearchParams(params).toString()),
  question: (id) => get(`/api/questions/${id}`),

  // 练习/错题/收藏
  answer: (d) => post('/api/practice/answer', d),
  practiceStats: () => get('/api/practice/stats'),
  chapterStats: () => get('/api/practice/chapter-stats'),
  lastPractice: () => get('/api/practice/last'),
  // 刷题会话（断点续刷）
  createSession: (d) => post('/api/practice/sessions', d),
  practiceSessions: (params = {}) => get('/api/practice/sessions?' + new URLSearchParams(params).toString()),
  latestSession: () => get('/api/practice/sessions/latest'),
  getSession: (id) => get(`/api/practice/sessions/${id}`),
  saveSession: (id, d) => request(`/api/practice/sessions/${id}`, { method: 'PATCH', body: d }),
  syncPracticeSession: (id, d) => request(`/api/practice/sessions/${id}/sync`, { method: 'POST', body: d, timeout: 6_000 }),
  completeSession: (id) => post(`/api/practice/sessions/${id}/complete`),
  deleteSession: (id) => del(`/api/practice/sessions/${id}`),
  wrongs: (params = {}) => get('/api/wrongs?' + new URLSearchParams(params).toString()),
  removeWrong: (qid) => del(`/api/wrongs/${qid}`),
  masterWrong: (qid) => put(`/api/wrongs/${qid}/master`),
  exportWrongs: () => requestBlob('/api/wrongs/export'),
  exportWrongsXlsx: () => requestBlob('/api/wrongs/export.xlsx'),
  favorites: (params = {}) => get('/api/favorites?' + new URLSearchParams(params).toString()),
  addFavorite: (questionId) => post('/api/favorites', { questionId }),
  removeFavorite: (qid) => del(`/api/favorites/${qid}`),
  checkFavorites: (ids) => get('/api/favorites/check?ids=' + ids.join(',')),

  // 考试
  exams: () => get('/api/exams'),
  examDetail: (id) => get(`/api/exams/${id}`),
  examShare: (token) => get(`/api/exams/share/${token}`),
  createCustomExam: (d) => post('/api/exams/custom', d),
  deleteCustomExam: (id) => del(`/api/exams/${id}`),
  startExam: (id) => post(`/api/exams/${id}/start`),
  abandonExam: (id) => post(`/api/exams/${id}/abandon`),
  abandonInProgressExams: () => post('/api/exams/abandon-in-progress'),
  abandonExamBeacon: (id) => {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url(`/api/exams/${id}/abandon`), {
      method: 'POST', credentials: 'include', headers, body: '{}', keepalive: true,
    }).catch(() => {});
  },
  submitExam: (id, answers) => post(`/api/exams/${id}/submit`, { answers }),
  examResult: (id) => get(`/api/exams/${id}/result`),
  examAttempts: (id) => get(`/api/exams/${id}/attempts`),

  // 站内通知：新考试/作业提醒（未读数/列表/已读）
  noticeUnreadCount: () => get('/api/notices/unread-count'),
  notices: (limit = 10) => get(`/api/notices?limit=${limit}`),
  noticesRead: (ids) => post('/api/notices/read', ids ? { ids } : {}),
  noticeReadExam: (examId) => post(`/api/notices/read-exam/${examId}`),

  // 工单反馈
  createTicket: (d) => post('/api/tickets', d), // { type, title, desc, images? } images 为前端压缩后的 dataURL（最多3张）
  myTickets: () => get('/api/tickets/mine'),
  ticketDetail: (id) => get(`/api/tickets/mine/${id}`),
  ticketAppend: (id, d) => post(`/api/tickets/mine/${id}/append`, d),
  adminTickets: (params = {}) => get('/api/tickets/admin/list?' + new URLSearchParams(params).toString()),
  adminTicketDetail: (id) => get(`/api/tickets/admin/${id}`),
  adminTicketReply: (id, content) => post(`/api/tickets/admin/${id}/reply`, { content }),
  adminTicketStatus: (id, status) => put(`/api/tickets/admin/${id}/status`, { status }),
  ticketNotifyEmails: () => get('/api/tickets/admin/settings/notify-emails'),
  saveTicketNotifyEmails: (emails) => put('/api/tickets/admin/settings/notify-emails', { emails }),

  // 教师：班级
  myClasses: () => get('/api/classes/mine'),
  createClass: (d) => post('/api/classes', d),
  updateClass: (id, d) => put(`/api/classes/${id}`, d),
  deleteClass: (id) => del(`/api/classes/${id}`),
  joinClass: (code) => post('/api/classes/join', { code }),
  leaveClass: () => post('/api/classes/leave'),
  classDetail: (id) => get(`/api/classes/${id}`),
  classStudents: (id, params = {}) => get(`/api/classes/${id}/students?` + new URLSearchParams(params).toString()),
  classOverview: (id) => get(`/api/classes/${id}/overview`),
  classExams: (id) => get(`/api/classes/${id}/exams`),
  // 教师：出卷
  createTeacherExam: (d) => post('/api/exams/teacher', d),
  sequenceTotal: () => get('/api/exams/sequence-range/total'),
  sequenceRangeInfo: (start, end) => get(`/api/exams/sequence-range/info?start=${start}&end=${end}`),
  setExamStatus: (id, status) => put(`/api/exams/${id}/status`, { status }),
  deleteTeacherExam: (id) => del(`/api/exams/teacher/${id}`),

  // 管理员
  adminStats: () => get('/api/admin/stats'),
  adminMaintenance: () => get('/api/system/maintenance/admin'),
  saveAdminMaintenance: (d) => put('/api/system/maintenance', d),
  regenerateAdminMaintenanceAccess: () => post('/api/system/maintenance/access/regenerate'),
  adminChapters: () => get('/api/admin/chapters'),
  adminCreateChapter: (d) => post('/api/admin/chapters', d),
  adminUpdateChapter: (id, d) => put(`/api/admin/chapters/${id}`, d),
  adminDeleteChapter: (id) => del(`/api/admin/chapters/${id}`),
  adminQuestions: (params = {}) => get('/api/admin/questions?' + new URLSearchParams(params).toString()),
  adminCreateQuestion: (d) => post('/api/admin/questions', d),
  adminUpdateQuestion: (id, d) => put(`/api/admin/questions/${id}`, d),
  adminDeleteQuestion: (id) => del(`/api/admin/questions/${id}`),
  adminUsers: (params = {}) => get('/api/admin/users?' + new URLSearchParams(params).toString()),
  adminUpdateUser: (id, d) => put(`/api/admin/users/${id}`, d),
  adminResetPassword: (id, password) => put(`/api/admin/users/${id}/reset-password`, { password }),
  adminDeleteUser: (id) => del(`/api/admin/users/${id}`),
  adminClasses: () => get('/api/admin/classes'),
  adminDeleteClass: (id) => del(`/api/admin/classes/${id}`),
  adminTeachers: () => get('/api/admin/teachers'),
  adminExams: (params = {}) => get('/api/admin/exams?' + new URLSearchParams(params).toString()),
  adminCreateSystemExam: (d) => post('/api/admin/exams/system', d),
  adminUpdateExam: (id, d) => put(`/api/admin/exams/${id}`, d),
  adminDeleteExam: (id) => del(`/api/admin/exams/${id}`),
  adminImportTemplate: () => get('/api/admin/import/template'),
  adminAppVersions: () => get('/api/admin/app-versions'),
  adminDeleteAppVersion: (id) => del(`/api/admin/app-versions/${id}`),
  adminImport: async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url('/api/admin/import'), { method: 'POST', headers, body: fd, credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      handleMaintenance(data);
      if (res.status === 401) handleUnauthorized();
      throw new Error(data.error || '导入失败');
    }
    return data;
  },

  // 移动端 API v1（统一 { success, data } 信封）
  mobileHealth: () => fetch(url('/api/mobile/v1/health')).then(async (r) => {
    if (!r.ok) throw new Error('服务器连接失败');
    const j = await r.json().catch(() => ({}));
    return j.success ? j.data : j;
  }),
  mobileBankMeta: () => request('/api/mobile/v1/bank/meta').then((j) => (j.success ? j.data : j)),
  mobileBankFull: (skip = 0, limit = 500) => request(`/api/mobile/v1/bank/full?skip=${skip}&limit=${limit}`).then((j) => (j.success ? j.data : j)),

  // 开发者页：延迟测试 + IP 归属地（公开接口，未登录也可用；signal 用于超时熔断）
  metaPing: (signal) => fetch(url('/api/meta/ping'), { signal }).then((r) => {
    if (!r.ok) throw new Error('ping 失败');
    return r.json();
  }),
  metaNetwork: () => getNoAuth('/api/meta/network'),
  // 开发者资料：公开读（后端优先，失败用 config.js 默认值兜底）
  devProfile: () => getNoAuth('/api/meta/developer').then((j) => j.profile || j),
  adminDevProfile: () => get('/api/meta/admin/developer').then((j) => j.profile || j),
  saveAdminDevProfile: (d) => put('/api/meta/admin/developer', d),

  // 版本检查（公开，无需登录）：返回整包 { version, notes, size, downloads, downloadPath }
  // 注意：downloadPath 是后端拼的相对路径 /downloads/{fileName}，唯一可信的下载地址。
  // APP 内 WebView 跑 capacitor://localhost：没收到的响应（opaque/空包）一律判失败，
  // 由 Mine.jsx 展示"检查更新失败"，不误报"暂无版本信息"。
  versionInfo: async () => {
    const res = await fetch(url('/api/app/version'), { credentials: 'include' });
    if (!res.ok) throw new Error(`版本接口 ${res.status}`);
    const j = await res.json().catch(() => null);
    // 兼容兜底：后端暂无版本时返回 { version: null }，这里原样透出
    if (!j || typeof j !== 'object') throw new Error('版本响应非法');
    return j;
  },
  openApkDownload: async () => {
    // 下载打点（失败不阻塞）
    fetch(url('/api/app/version/download-count'), { method: 'POST' }).catch(() => {});
    if (isNativeApp()) {
      // Capacitor Browser 使用 Android Custom Tab，下载不再困在业务 WebView 中。
      await Browser.open({ url: DOWNLOAD_SITE_URL });
      return;
    }
    window.location.assign(DOWNLOAD_SITE_URL);
  },
  validateMobileAdminAccess: (key) => getNoAuth(`/api/mobile-admin/access/${encodeURIComponent(key)}`),
  // 公告：学员列表/详情/标已读 + 后台增删改查
  announcements: () => get('/api/announcements'),
  announcementDetail: (id) => get(`/api/announcements/${id}`),
  announcementRead: (id) => post(`/api/announcements/${id}/read`),
  adminAnnouncements: () => get('/api/announcements/admin/list'),
  adminCreateAnnouncement: (d) => post('/api/announcements/admin', d),
  adminUpdateAnnouncement: (id, d) => put(`/api/announcements/admin/${id}`, d),
  adminDeleteAnnouncement: (id) => del(`/api/announcements/admin/${id}`),
  adminAnnouncementStatus: (id, status) => put(`/api/announcements/admin/${id}/status`, { status }),
};
