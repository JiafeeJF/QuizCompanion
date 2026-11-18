import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { initRealtime } from './realtime.js';
import { connectDB } from './db.js';
import { User } from './models/User.js';
import { ensureSuperAdmin } from './initSuperAdmin.js';
import { startExamSummaryCron } from './examCron.js';
import { startMemberCron } from './memberCron.js';
import { startAnnouncementCron } from './announcementCron.js';
import { startAppVersionCron } from './appVersionCron.js';
import authRoutes from './routes/auth.js';
import questionRoutes from './routes/questions.js';
import chapterRoutes from './routes/chapters.js';
import practiceRoutes from './routes/practice.js';
import practiceSessionRoutes from './routes/practice-sessions.js';
import examRoutes from './routes/exams.js';
import classRoutes from './routes/classes.js';
import adminRoutes from './routes/admin.js';
import mobileRoutes from './routes/mobile.js';
import jumpRoutes from './routes/jump.js';
import noticeRoutes from './routes/notices.js';
import ticketRoutes from './routes/tickets.js';
import metaRoutes from './routes/meta.js';
import announcementRoutes from './routes/announcements.js';
import appVersionRoutes, { appPublicRouter } from './routes/appVersion.js';
import systemRoutes from './routes/system.js';
import mobileAdminAccessRoutes from './routes/mobileAdminAccess.js';
import { getMaintenance } from './models/AppSetting.js';
import { isAdminUser } from './auth.js';

const app = express();
const PORT = Number(process.env.PORT || 4001);

const origins = String(process.env.CLIENT_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// App 端（Capacitor 原生）来源：androidScheme=https 时为 https://localhost，
// 旧版/自定义 scheme 为 capacitor://localhost。凭证请求不能用 *，必须逐个放行。
const NATIVE_ORIGINS = ['https://localhost', 'capacitor://localhost', 'http://localhost'];
const allowedOrigins = new Set([...origins, ...NATIVE_ORIGINS]);

const httpServer = http.createServer(app);
const io = initRealtime(httpServer, allowedOrigins);

// Socket.IO 鉴权：沿用登录 JWT；未登录连接不进入业务房间
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || String(socket.handshake.headers.cookie || '').match(/wlbd_token=([^;]+)/)?.[1];
    const claims = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
    const user = claims?.id ? await User.findById(claims.id).select('_id role classId tokenVersion').lean() : null;
    if (!user || Number(user.tokenVersion || 0) !== Number(claims.v || 0)) return next(new Error('登录状态已失效'));
    socket.user = user;
    next();
  } catch { next(new Error('登录状态已失效')); }
});

io.on('connection', (socket) => {
  const { id, classId, role } = socket.user || {};
  socket.join(`user:${id}`);
  if (classId) socket.join(`class:${classId}`);
  if (role === 'student') socket.join('role:student');
  if (role === 'admin') socket.join('role:admin');
});

export function realtime() { return io; }


app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (allowedOrigins.has(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
// Cookie 解析必须在路由之前：authRequired 从 HttpOnly Cookie 读 token
app.use(cookieParser());
// 反向代理（Nginx）下正确取 req.ip / Secure Cookie：只信任一跳代理
app.set('trust proxy', 1);
// 生产安全头：Helmet 默认集（CSP 仅 report 观察模式，避免 Vite 内联脚本被拦）
const isProd = process.env.NODE_ENV === 'production';
let helmetMw = null;
try {
  const { default: helmet } = await import('helmet');
  helmetMw = helmet({
    contentSecurityPolicy: isProd ? { reportOnly: true } : false,
    crossOriginEmbedderPolicy: false,
  });
} catch {
  console.warn('[security] helmet 未安装：跳过安全头（请 npm i helmet 后重启）');
}
if (helmetMw) app.use(helmetMw);
if (isProd) {
  // HSTS 仅生产 + HTTPS（Nginx 终止 TLS 后同样生效）
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'wuli-baodian', time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/system', systemRoutes);
// APK 隐藏管理入口需在维护拦截前验证，实际管理 API 仍要求管理员 JWT。
app.use('/api/mobile-admin', mobileAdminAccessRoutes);

// 维护期间统一挡住普通业务请求；管理员与公告接口继续可用。
app.use('/api', async (req, res, next) => {
  try {
    const state = await getMaintenance();
    if (!state.enabled || req.path.startsWith('/system') || req.path.startsWith('/announcements')) return next();
    const token = req.cookies?.wlbd_token || (String(req.headers.authorization || '').startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
    let user = null;
    try {
      const claims = token ? jwt.verify(token, process.env.JWT_SECRET) : null;
      user = claims?.id ? await User.findById(claims.id).select('_id role isSuperAdmin status tokenVersion').lean() : null;
      if (user && Number(user.tokenVersion || 0) !== Number(claims.v || 0)) user = null;
    } catch {}
    if (isAdminUser(user)) return next();
    return res.status(503).json({ error: state.message || '系统维护中，请稍后再试', code: 'MAINTENANCE', maintenance: state });
  } catch {
    return next();
  }
});
app.use('/api/chapters', chapterRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/practice', practiceRoutes);
app.use('/api/practice', practiceSessionRoutes); // 刷题会话：/api/practice/sessions*
app.use('/api', practiceRoutes); // 错题本/收藏：/api/wrongs*、/api/favorites*
app.use('/api/exams', examRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/admin', appVersionRoutes); // 管理：APK 版本上传/列表/删除（/api/admin/app-versions*）
app.use('/api/admin', adminRoutes);
app.use('/api/app', appPublicRouter); // 公开：APP 最新版本信息/下载打点
app.use('/api/jump', jumpRoutes); // 公开：跳板页链接有效性校验（/api/jump/resolve）
app.use('/api/notices', noticeRoutes); // 站内通知：新考试/作业提醒（未读数/列表/已读）
app.use('/api/tickets', ticketRoutes); // 工单反馈：提交/列表/详情/回复 + 提醒邮箱配置
app.use('/api/meta', metaRoutes); // 公开：服务器延迟测试 + IP 归属地（/api/meta/ping、/api/meta/network）
app.use('/api/announcements', announcementRoutes); // 公告：学员列表/详情/已读 + 后台增删改查
app.use('/api/mobile/v1', mobileRoutes);

app.use((req, res) => res.status(404).json({ error: '接口不存在' }));

async function main() {
  await connectDB();
  // API 接受请求前先确保超级管理员就绪
  await ensureSuperAdmin();
  // 考试截止总结定时任务（60s 一轮，启动 10s 后补扫，重启不重发）
  startExamSummaryCron();
  startMemberCron();
  startAnnouncementCron();
  startAppVersionCron();
  httpServer.listen(PORT, () => console.log(`[server] 物联宝典后端启动 http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error('[server] 启动失败:', e.message);
  process.exit(1);
});
