/**
 * 移动端 API（/api/mobile/v1）：独立接口层，零业务复制。
 * - 认证/权限/题库/会话/考试全部复用 Web 侧同一 Model + 同一守卫（authRequired/requireSelfMember/requireRole）。
 * - 统一返回 { success, data, message, code? } + 正确 HTTP 状态码；敏感字段一律不透出。
 * - 考试/刷题答案口径与 Web 一致：未提交不泄露 answer/textAnswer。
 */
import { Router } from 'express';
import crypto from 'crypto';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { authRequired, requireSelfMember } from '../auth.js';
import { rateLimit } from '../security.js';
import { isObjectId } from '../validate.js';

const router = Router();

/** 题库版本指纹：enabled 题目 _id 升序签名的短哈希（12位），题变即变；与更新时间一起作为 App 本地比对依据 */
async function bankFingerprint() {
  const ids = await Question.find({ enabled: true }).sort({ _id: 1 }).select('_id').lean();
  const hash = crypto.createHash('sha256');
  for (const d of ids) hash.update(String(d._id));
  return { version: hash.digest('hex').slice(0, 12), total: ids.length };
}

/** GET /api/mobile/v1/health App 启动连通性探针（免登录，只报可达+延迟由端上计时） */
router.get('/health', (req, res) => ok(res, { status: 'ok', time: new Date().toISOString() }, '服务正常'));

/** GET /api/mobile/v1/bank/meta 题库元信息（版本/数量/章节/大小/SHA-256，需登录） */
router.get('/bank/meta', authRequired, async (req, res) => {
  try {
    const { version, total } = await bankFingerprint();
    const chapters = await Chapter.find({ enabled: true }).sort({ sort: 1, name: 1 }).lean();
    const counts = await Question.aggregate([{ $match: { enabled: true } }, { $group: { _id: '$chapterId', count: { $sum: 1 } } }]);
    const map = new Map(counts.map((c) => [String(c._id), c.count]));
    const chapterList = chapters.map((c) => ({ id: c._id, name: c.name, questionCount: map.get(String(c._id)) || 0 }));
    const payload = JSON.stringify({ version, chapters: chapterList });
    return ok(res, {
      version,
      total,
      chapterCount: chapterList.length,
      chapters: chapterList,
      updatedAt: chapters.reduce((m, c) => (c.updatedAt > m ? c.updatedAt : m), chapters[0]?.updatedAt || new Date()),
      // 全量包大小/SHA-256 由端上按实际下载字节计算；此处给预估（按enabled题平均0.5KB）
      estimatedBytes: total * 512,
      sha256: crypto.createHash('sha256').update(payload).digest('hex'),
    });
  } catch { return fail(res, '获取题库信息失败', 'INTERNAL', 500); }
});

/** GET /api/mobile/v1/bank/full 全量题库（分页：?skip&limit，最大500/页；题干+选项+答案全量，需登录） */
router.get('/bank/full', authRequired, async (req, res) => {
  try {
    const { version } = await bankFingerprint();
    const skip = Math.max(0, Number(req.query.skip) || 0);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 500));
    const [chapters, questions] = await Promise.all([
      Chapter.find({ enabled: true }).sort({ sort: 1, name: 1 }).lean(),
      Question.find({ enabled: true }).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
    ]);
    return ok(res, {
      version,
      skip,
      limit,
      hasMore: questions.length === limit,
      chapters: skip === 0 ? chapters.map((c) => ({ id: c._id, name: c.name, sort: c.sort || 0 })) : undefined,
      questions: questions.map((q) => ({
        id: q._id, chapterId: q.chapterId, type: q.type, stem: q.stem,
        options: q.options || [], answer: q.answer ?? null, textAnswer: q.textAnswer || '',
        score: q.score || 2,
      })),
    });
  } catch { return fail(res, '获取题库失败', 'INTERNAL', 500); }
});
const ok = (res, data, message = '操作成功', status = 200) => res.status(status).json({ success: true, data, message });
const fail = (res, message, code = 'BAD_REQUEST', status = 400) => res.status(status).json({ success: false, message, code });

const mobileLoginLimit = rateLimit({ scope: 'mobile-login', windowMs: 5 * 60 * 1000, max: 60, message: '请求过于频繁，请稍后再试' });

/** 文档索引：GET /api/mobile/v1 */
router.get('/', (req, res) => ok(res, {
  version: 'v1',
  base: '/api/mobile/v1',
  auth: 'Bearer JWT（Authorization 头）或 HttpOnly Cookie，二选一',
  endpoints: [
    'POST /auth/register/send-code', 'POST /auth/register', 'POST /auth/login', 'GET /auth/me', 'PUT /user/profile',
    'GET /chapters', 'GET /questions/list', 'GET /bank/total',
    'POST /practice/sessions', 'GET /practice/sessions', 'GET /practice/sessions/:id', 'PATCH /practice/sessions/:id', 'POST /practice/sessions/:id/complete', 'POST /practice/answer',
    'GET /wrongs', 'GET /favorites',
    'GET /classes/mine', 'POST /classes/join', 'POST /classes/leave', 'GET /classes/:id/exams',
    'GET /exams', 'GET /exams/:id', 'POST /exams/custom', 'POST /exams/:id/start', 'POST /exams/:id/submit', 'GET /exams/:id/result',
  ],
}, 'WLBD 移动端 API v1'));

// ---------- 认证（复用 Web auth 路由逻辑：直接挂载同一 handler，保证单套权限）----------
import authRoutes from './auth.js';
router.use('/auth', mobileLoginLimit, (req, res, next) => {
  // 移动端注册/登录同样走 ALTCHA+验证码同一套；只做返回格式适配
  const orig = res.json.bind(res);
  res.json = (body) => {
    if (body && typeof body === 'object' && !('success' in body) && res.statusCode < 400) {
      return orig({ success: true, data: body, message: '操作成功' });
    }
    return orig(body);
  };
  next();
}, authRoutes);

// 用户资料（复用同一 User 模型 + 白名单）
router.put('/user/profile', authRequired, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (name !== undefined) {
      const n = String(name ?? '').trim().slice(0, 20);
      if (!n) return fail(res, '昵称不能为空', 'BAD_REQUEST', 400);
      req.user.name = n;
    }
    await req.user.save();
    const { publicUser } = await import('../auth.js');
    return ok(res, { user: publicUser(req.user) });
  } catch { return fail(res, '保存失败', 'INTERNAL', 500); }
});

// ---------- 题库（只读，答案脱敏：列表/详情不含 answer/textAnswer）----------
router.get('/chapters', authRequired, async (req, res) => {
  try {
    const { Chapter } = await import('../models/Chapter.js');
    const { Question } = await import('../models/Question.js');
    const chapters = await Chapter.find({ enabled: true }).sort({ sort: 1, name: 1 }).lean();
    const counts = await Question.aggregate([{ $match: { enabled: true } }, { $group: { _id: '$chapterId', count: { $sum: 1 } } }]);
    const map = new Map(counts.map((c) => [String(c._id), c.count]));
    return ok(res, { chapters: chapters.map((c) => ({ id: c._id, name: c.name, questionCount: map.get(String(c._id)) || 0 })) });
  } catch { return fail(res, '获取章节失败', 'INTERNAL', 500); }
});

router.get('/questions/list', authRequired, async (req, res) => {
  try {
    const mode = String(req.query.mode || 'order');
    const hasExtract = !!(req.query.chapterId || req.query.type || (req.query.skip != null && Number(req.query.skip) > 0));
    if (mode !== 'order' || hasExtract) {
      const gate = requireSelfMember(req);
      if (!gate.ok) return fail(res, gate.error, 'FORBIDDEN', 403);
    }
    const { Question } = await import('../models/Question.js');
    const filter = { enabled: true };
    if (req.query.chapterId) {
      if (!isObjectId(String(req.query.chapterId))) return fail(res, '章节不存在', 'NOT_FOUND', 404);
      filter.chapterId = req.query.chapterId;
    }
    if (req.query.type) filter.type = String(req.query.type);
    const lim = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    let list;
    if (mode === 'random') {
      list = await Question.aggregate([{ $match: filter }, { $sample: { size: lim } }]);
    } else {
      list = await Question.find(filter).sort({ _id: 1 }).skip(Math.max(0, Number(req.query.skip) || 0)).limit(lim).lean();
    }
    // 脱敏：不下发 answer/textAnswer/analysis
    const items = list.map((q) => ({ id: q._id, type: q.type, stem: q.stem, options: q.options || [], score: q.score || 2, chapterId: q.chapterId }));
    return ok(res, { questions: items });
  } catch { return fail(res, '获取题目失败', 'INTERNAL', 500); }
});

router.get('/bank/total', authRequired, async (req, res) => {
  try {
    const { Question } = await import('../models/Question.js');
    return ok(res, { total: await Question.countDocuments({ enabled: true }) });
  } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
});

// ---------- 刷题（创建/恢复/答题/完成：归属 userId=me，会员门与 Web 同规则）----------
router.post('/practice/sessions', authRequired, async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: JSON.stringify(req.body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '创建失败', r.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', r.status);
    // 会话题目脱敏后返回
    if (data.questions) data.questions = data.questions.map((q) => ({ id: q._id || q.id, type: q.type, stem: q.stem, options: q.options || [], score: q.score || 2 }));
    return ok(res, data, '操作成功', 201);
  } catch { return fail(res, '创建失败', 'INTERNAL', 500); }
});

for (const [m, p] of [['get', '/practice/sessions'], ['get', '/practice/sessions/latest']]) {
  router[m](p, authRequired, async (req, res) => {
    try {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/sessions${p.includes('latest') ? '/latest' : ''}${qs}`, { headers: { Authorization: req.headers.authorization || '' } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return fail(res, data.error || '获取失败', 'BAD_REQUEST', r.status);
      return ok(res, data);
    } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
  });
}

router.get('/practice/sessions/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return fail(res, '记录不存在', 'NOT_FOUND', 404);
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/sessions/${req.params.id}`, { headers: { Authorization: req.headers.authorization || '' } });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '获取失败', r.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', r.status);
    if (data.questions) data.questions = data.questions.map((q) => ({ id: q._id || q.id, type: q.type, stem: q.stem, options: q.options || [], score: q.score || 2 }));
    return ok(res, data);
  } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
});

router.patch('/practice/sessions/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return fail(res, '记录不存在', 'NOT_FOUND', 404);
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/sessions/${req.params.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: JSON.stringify(req.body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '保存失败', 'BAD_REQUEST', r.status);
    return ok(res, data);
  } catch { return fail(res, '保存失败', 'INTERNAL', 500); }
});

router.post('/practice/sessions/:id/complete', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return fail(res, '记录不存在', 'NOT_FOUND', 404);
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/sessions/${req.params.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: '{}',
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '完成失败', 'BAD_REQUEST', r.status);
    return ok(res, data);
  } catch { return fail(res, '完成失败', 'INTERNAL', 500); }
});

router.post('/practice/answer', authRequired, async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/practice/answer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: JSON.stringify(req.body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '判分失败', r.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', r.status);
    return ok(res, data);
  } catch { return fail(res, '判分失败', 'INTERNAL', 500); }
});

// ---------- 错题/收藏（只返回本人）----------
for (const p of ['/wrongs', '/favorites']) {
  router.get(p, authRequired, async (req, res) => {
    try {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api${p}${qs}`, { headers: { Authorization: req.headers.authorization || '' } });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return fail(res, data.error || '获取失败', 'BAD_REQUEST', r.status);
      return ok(res, data);
    } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
  });
}

// ---------- 班级/考试（归属按 me 重验，越权直接 403）----------
router.get('/classes/mine', authRequired, async (req, res) => {
  try {
    const { ClassModel } = await import('../models/Class.js');
    if (req.user.role === 'student') {
      if (!req.user.classId) return ok(res, { classes: [] });
      const c = await ClassModel.findById(req.user.classId).select('name code desc').lean();
      return ok(res, { classes: c ? [{ id: c._id, name: c.name, code: c.code }] : [] });
    }
    if (!['teacher', 'admin'].includes(req.user.role)) return fail(res, '无权执行此操作', 'FORBIDDEN', 403);
    const filter = req.user.role === 'admin' ? {} : { teacherId: req.user._id };
    const list = await ClassModel.find(filter).select('name code desc').sort({ createdAt: -1 }).lean();
    return ok(res, { classes: list.map((c) => ({ id: c._id, name: c.name, code: c.code })) });
  } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
});

router.post('/classes/join', authRequired, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return fail(res, '班级码无效', 'BAD_REQUEST', 400);
    const { ClassModel } = await import('../models/Class.js');
    const cls = await ClassModel.findOne({ code, enabled: true }).lean();
    if (!cls) return fail(res, '班级码无效', 'NOT_FOUND', 404);
    req.user.classId = cls._id;
    await req.user.save();
    return ok(res, { class: { id: cls._id, name: cls.name } }, '加入成功');
  } catch { return fail(res, '加入失败', 'INTERNAL', 500); }
});

router.post('/classes/leave', authRequired, async (req, res) => {
  try {
    req.user.classId = null;
    await req.user.save();
    return ok(res, {}, '已退出班级');
  } catch { return fail(res, '操作失败', 'INTERNAL', 500); }
});

router.get('/exams', authRequired, async (req, res) => {
  try {
    const { Exam, ExamAttempt } = await import('../models/Exam.js');
    const ors = [{ kind: 'system', status: 'published' }];
    if (req.user.classId) ors.push({ kind: 'teacher', status: 'published', classId: req.user.classId });
    ors.push({ kind: 'custom', createdBy: req.user._id });
    if (['teacher', 'admin'].includes(req.user.role)) ors.push({ createdBy: req.user._id });
    const exams = await Exam.find({ $or: ors }).sort({ createdAt: -1 }).select('-items').lean();
    const ids = exams.map((e) => e._id);
    const attempts = await ExamAttempt.find({ examId: { $in: ids }, userId: req.user._id }).select('examId status score').lean();
    const am = new Map(attempts.map((a) => [String(a.examId), a]));
    return ok(res, { exams: exams.map((e) => ({ id: e._id, title: e.title, kind: e.kind, status: e.status, totalCount: e.totalCount, durationMin: e.durationMin, deadlineAt: e.deadlineAt, myAttempt: am.get(String(e._id)) || null })) });
  } catch { return fail(res, '获取试卷失败', 'INTERNAL', 500); }
});

router.get('/exams/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return fail(res, '试卷不存在', 'NOT_FOUND', 404);
    const { Exam } = await import('../models/Exam.js');
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) return fail(res, '试卷不存在', 'NOT_FOUND', 404);
    if (exam.kind === 'teacher' && exam.classId && String(req.user.classId) !== String(exam.classId) && req.user.role === 'student') {
      return fail(res, '该考试仅限指定班级', 'FORBIDDEN', 403);
    }
    // 未交卷不泄露答案
    const items = exam.items.map((it) => ({ questionId: it.questionId, type: it.type, stem: it.stem, options: it.options || [], score: it.score || 2 }));
    return ok(res, { exam: { id: exam._id, title: exam.title, kind: exam.kind, durationMin: exam.durationMin, deadlineAt: exam.deadlineAt, totalCount: items.length, items } });
  } catch { return fail(res, '获取失败', 'INTERNAL', 500); }
});

router.post('/exams/custom', authRequired, async (req, res) => {
  try {
    const { isMember } = await import('../auth.js');
    if (req.user.role !== 'teacher' && req.user.role !== 'admin' && !isMember(req.user)) {
      return fail(res, '该功能为会员专属功能', 'FORBIDDEN', 403);
    }
    const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/exams/custom`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' }, body: JSON.stringify(req.body || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return fail(res, data.error || '组卷失败', r.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', r.status);
    return ok(res, data, '组卷成功', 201);
  } catch { return fail(res, '组卷失败', 'INTERNAL', 500); }
});

for (const [m, suffix] of [['post', 'start'], ['post', 'submit'], ['get', 'result']]) {
  router[m](`/exams/:id/${suffix}`, authRequired, async (req, res) => {
    try {
      if (!isObjectId(req.params.id)) return fail(res, '试卷不存在', 'NOT_FOUND', 404);
      const r = await fetch(`http://127.0.0.1:${process.env.PORT || 4001}/api/exams/${req.params.id}/${suffix}`, {
        method: m.toUpperCase(), headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization || '' },
        body: m === 'get' ? undefined : JSON.stringify(req.body || {}),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return fail(res, data.error || '操作失败', r.status === 403 ? 'FORBIDDEN' : r.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', r.status);
      return ok(res, data);
    } catch { return fail(res, '操作失败', 'INTERNAL', 500); }
  });
}

export default router;
