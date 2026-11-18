import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { ExamNotice } from '../models/ExamNotice.js';
import { Exam } from '../models/Exam.js';
import { User } from '../models/User.js';
import { authRequired, AUTH_COOKIE_NAME, JWT_SECRET } from '../auth.js';
import { subscribeStudent, unsubscribeStudent } from '../noticeBus.js';
import { isObjectId } from '../validate.js';

const router = Router();

/**
 * GET /api/notices/stream 实时事件流（SSE，替代 60s 轮询）
 * - 必须在 authRequired 之前：EventSource 不支持自定义请求头，token 走 ?token= 查询参数
 * - 只推给学生；教师/管理员连上只收心跳（不断连，前端可复用判断在线）
 * - 心跳 25s 一次（过 nginx 默认 60s 空闲超时），Nginx 需配 proxy_buffering off + X-Accel-Buffering no
 */
router.get('/stream', async (req, res) => {
  // SSE 专属鉴权：query token → 手动验签（不能复用 authRequired，它只读 header/Cookie）
  try {
    const qToken = String(req.query.token || '');
    const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = qToken || cookieToken || bearer;
    let user = null;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        user = await User.findById(payload.id);
        if (user && (user.status === 'banned' || (payload.v || 0) !== (user.tokenVersion || 0))) user = null;
      } catch { user = null; }
    }
    if (!user) {
      res.status(401).json({ error: '请先登录' });
      return;
    }
    // SSE 头：no-transform 防 CDN/代理压缩吞流
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch {}
    }, 25000);
    // 只有学生订阅考试事件；老师/管理员不断连（收心跳即可）
    const subscribed = user.role === 'student';
    if (subscribed) subscribeStudent(user._id, res);
    // 连上先推一次未读数，前端红点秒对齐（不等轮询）
    try {
      const count = await ExamNotice.countDocuments({ studentId: user._id, read: false });
      res.write(`event: unread\ndata: ${JSON.stringify({ count })}\n\n`);
    } catch {}
    const cleanup = () => {
      clearInterval(ping);
      if (subscribed) unsubscribeStudent(user._id, res);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
  } catch {
    try { res.status(500).json({ error: '连接失败' }); } catch {}
  }
});

// 以下接口走登录态（Cookie/Bearer），stream 在上面已单独鉴权
router.use(authRequired);

/**
 * GET /api/notices/unread-count 未读通知数（红点用，轻量只返回数字）
 */
router.get('/unread-count', async (req, res) => {
  try {
    const count = await ExamNotice.countDocuments({ studentId: req.user._id, read: false });
    res.json({ count });
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * GET /api/notices?limit=10 拉取通知列表（倒序，附考试当前状态：已结束/已删除标出来）
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(30, Math.max(1, Number(req.query.limit) || 10));
    const list = await ExamNotice.find({ studentId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('examId', 'title status deadlineAt scope kind')
      .lean();
    res.json({
      notices: list.map((n) => {
        const ex = n.examId && typeof n.examId === 'object' ? n.examId : null;
        return {
          _id: n._id,
          examId: ex?._id || n.examId,
          kind: n.kind,
          title: ex?.title || n.title,
          read: n.read,
          createdAt: n.createdAt,
          // 考试现状：gone=已删除，ended=已结束/已截止，active=可做
          examStatus: !ex ? 'gone' : ex.status === 'ended' || (ex.deadlineAt && new Date(ex.deadlineAt) < new Date()) ? 'ended' : 'active',
        };
      }),
    });
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * POST /api/notices/read { ids? } 标已读：不传 ids=全部已读，传数组=指定已读
 */
router.post('/read', async (req, res) => {
  try {
    const { ids } = req.body || {};
    const filter = { studentId: req.user._id, read: false };
    if (Array.isArray(ids) && ids.length) {
      const clean = ids.filter((id) => isObjectId(String(id)));
      if (!clean.length) return res.json({ ok: true, modified: 0 });
      filter._id = { $in: clean };
    }
    const r = await ExamNotice.updateMany(filter, { $set: { read: true, readAt: new Date() } });
    res.json({ ok: true, modified: r.modifiedCount || 0 });
  } catch {
    res.status(500).json({ error: '操作失败' });
  }
});

/**
 * POST /api/notices/read-exam/:examId 打开试卷即已读（考试详情页进入时调用，同试卷多条只清未读）
 */
router.post('/read-exam/:examId', async (req, res) => {
  try {
    if (!isObjectId(req.params.examId)) return res.status(400).json({ error: '参数非法' });
    const r = await ExamNotice.updateMany(
      { studentId: req.user._id, examId: req.params.examId, read: false },
      { $set: { read: true, readAt: new Date() } }
    );
    res.json({ ok: true, modified: r.modifiedCount || 0 });
  } catch {
    res.status(500).json({ error: '操作失败' });
  }
});

export default router;
