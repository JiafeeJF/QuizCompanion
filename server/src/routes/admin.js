import multer from 'multer';
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { User } from '../models/User.js';
import { sendMail, buildMemberActiveMail } from '../email.js';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { ClassModel } from '../models/Class.js';
import { Exam, ExamAttempt } from '../models/Exam.js';
import { PracticeRecord, WrongBook, Favorite, PracticeSession } from '../models/Practice.js';
import { authRequired, publicUser, requireRole } from '../auth.js';
import { hashPassword, validEmail } from '../utils.js';
import { adminStrictLimit, auditLog, rateLimit } from '../security.js';
import { escapeRegExp, isObjectId, pageParams, safeKeyword, validRole } from '../validate.js';
import { emitUserEvent, emitExamChanged } from '../realtime.js';

const router = Router();
// 查询/导出专线：按账号分桶（雷池回源同 IP 下互不干扰），避免 admin 正常翻页被“请求过于频繁”
const adminReadLimit = rateLimit({ scope: 'admin-read', windowMs: 60 * 1000, max: 600, message: '请求过于频繁，请稍后再试' });
router.use(authRequired, requireRole('admin'));
router.use((req, res, next) => {
  // 写操作（删改导入）保持严格防爆破；纯查询走宽松桶
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return adminStrictLimit(req, res, next);
  return adminReadLimit(req, res, next);
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|csv)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('仅支持 .xlsx / .csv 文件'), ok);
  },
});

const TYPE_ALIAS = {
  single: 'single', '单选': 'single', '单选题': 'single', 'choice': 'single',
  multiple: 'multiple', '多选': 'multiple', '多选题': 'multiple',
  judge: 'judge', '判断': 'judge', '判断题': 'judge', 'truefalse': 'judge',
  fill: 'fill', '填空': 'fill', '填空题': 'fill',
  short: 'short', '简答': 'short', '简答题': 'short', '问答': 'short',
};

/** 解析答案：单选/判断支持 A/B/C 或 0/1/2 或 对/错；多选支持 AB / A,B / 0,2 */
function parseAnswer(type, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const letter = (ch) => {
    const up = String(ch).toUpperCase();
    if (up >= 'A' && up <= 'G') return up.charCodeAt(0) - 65;
    if (up === '对' || up === '√' || up === 'TRUE' || up === 'T' || up === '正确') return 0;
    if (up === '错' || up === '×' || up === 'FALSE' || up === 'F' || up === '错误') return 1;
    const n = Number(ch);
    return Number.isFinite(n) ? n : null;
  };
  if (type === 'multiple') {
    const parts = s.includes(',') || s.includes('，') || s.includes(' ') ? s.split(/[,，\s]+/) : s.split('');
    const idx = parts.map(letter).filter((v) => v !== null);
    return [...new Set(idx)].sort((a, b) => a - b);
  }
  if (type === 'judge') {
    if (/^(对|√|true|t|正确|1)$/i.test(s)) return 0;
    if (/^(错|×|false|f|错误|0)$/i.test(s)) return 1;
    return letter(s);
  }
  const n = letter(s);
  return n === null ? null : n;
}

/** GET /api/admin/import/template 题库导入模板说明 */
router.get('/import/template', (req, res) => {
  res.json({
    columns: ['章节', '题型', '题干', '选项A', '选项B', '选项C', '选项D', '选项E', '选项F', '答案', '分值'],
    typeValues: '单选 / 多选 / 判断 / 填空 / 简答',
    answerFormat: {
      single: 'A（或 0）',
      multiple: 'AB（或 A,B）',
      judge: '对 / 错',
      fill: '直接写答案文本，多个空用 | 分隔',
      short: '直接写参考答案文本',
    },
    note: '支持 .xlsx / .csv；章节不存在会自动创建（解析功能已下线，无需解析列）',
  });
});

/** POST /api/admin/import（multipart file=文件；仅 .xlsx/.csv ≤10MB，MIME+扩展名双校验） */
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const name = String(req.file.originalname || '').toLowerCase();
    // 扩展名白名单 + MIME 双校验（防改后缀uves恶意文件）
    const okExt = name.endsWith('.xlsx') || name.endsWith('.csv');
    const okMime = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/vnd.ms-excel', 'application/octet-stream'].includes(req.file.mimetype);
    if (!okExt || !okMime) return res.status(400).json({ error: '仅支持 .xlsx / .csv 文件' });
    if (!/^[a-z0-9_\-.\u4e00-\u9fa5()（）【】\[\] ]{1,100}\.(xlsx|csv)$/i.test(String(req.file.originalname || ''))) {
      return res.status(400).json({ error: '文件名非法' });
    }
    let rows = [];
    if (name.endsWith('.csv')) {
      rows = parse(req.file.buffer.toString('utf8').replace(/^\uFEFF/, ''), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } else {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    }
    const chapterCache = new Map();
    async function getChapter(chName) {
      const key = String(chName || '未分类').trim() || '未分类';
      if (chapterCache.has(key)) return chapterCache.get(key);
      let ch = await Chapter.findOne({ name: key });
      if (!ch) {
        const maxSort = await Chapter.findOne().sort({ sort: -1 }).select('sort');
        ch = await Chapter.create({ name: key, sort: (maxSort?.sort || 0) + 1 });
      }
      chapterCache.set(key, ch);
      return ch;
    }
    let ok = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = i + 2;
      try {
        const type = TYPE_ALIAS[String(r['题型'] || '').trim()];
        const stem = String(r['题干'] || '').trim();
        if (!type) throw new Error('题型非法');
        if (!stem) throw new Error('题干为空');
        const ch = await getChapter(r['章节']);
        const options = ['选项A', '选项B', '选项C', '选项D', '选项E', '选项F']
          .map((k) => String(r[k] ?? '').trim())
          .filter(Boolean);
        if ((type === 'single' || type === 'multiple') && options.length < 2) throw new Error('选择题至少 2 个选项');
        if (type === 'judge' && options.length === 0) options.push('对', '错');
        const doc = {
          chapterId: ch._id,
          type,
          stem,
          options,
          // 解析列已废弃：忽略导入文件中的「解析」列
          score: Math.max(1, Number(r['分值']) || 2),
          source: 'import',
        };
        if (type === 'fill' || type === 'short') {
          doc.textAnswer = String(r['答案'] || '').trim();
          if (!doc.textAnswer) throw new Error('填空/简答需填写答案文本');
        } else {
          const ans = parseAnswer(type, r['答案']);
          if (ans === null || (Array.isArray(ans) && !ans.length)) throw new Error('答案格式错误');
          doc.answer = ans;
        }
        await Question.create(doc);
        ok++;
      } catch (err) {
        errors.push({ line, error: err.message });
        if (errors.length > 50) break;
      }
    }
    res.json({ ok, failed: errors.length, errors: errors.slice(0, 20), total: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '导入失败' });
  }
});

// ---------- 章节 ----------
router.get('/chapters', async (req, res) => {
  const chapters = await Chapter.find().sort({ sort: 1 }).lean();
  res.json({ chapters });
});
router.post('/chapters', async (req, res) => {
  const { name, sort = 0 } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: '请填写章节名' });
  const ch = await Chapter.create({ name: String(name).trim(), sort: Number(sort) || 0 });
  res.json({ chapter: ch });
});
router.put('/chapters/:id', async (req, res) => {
  const ch = await Chapter.findById(req.params.id);
  if (!ch) return res.status(404).json({ error: '章节不存在' });
  const { name, sort, enabled } = req.body || {};
  if (name !== undefined) ch.name = String(name).trim() || ch.name;
  if (sort !== undefined) ch.sort = Number(sort) || 0;
  if (enabled !== undefined) ch.enabled = !!enabled;
  await ch.save();
  res.json({ chapter: ch });
});
router.delete('/chapters/:id', async (req, res) => {
  const used = await Question.countDocuments({ chapterId: req.params.id });
  if (used) return res.status(400).json({ error: `该章节下还有 ${used} 道题，无法删除` });
  await Chapter.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- 试题 ----------
router.get('/questions', async (req, res) => {
  const { chapterId, type, keyword, page = 1, pageSize = 20 } = req.query;
  const filter = {};
  if (chapterId) filter.chapterId = chapterId;
  if (type) filter.type = type;
  if (keyword) filter.stem = { $regex: String(keyword).slice(0, 50), $options: 'i' };
  const { page: pg, pageSize: ps } = pageParams(req.query, { maxSize: 100 });
  
  const [total, list] = await Promise.all([
    Question.countDocuments(filter),
    Question.find(filter).sort({ createdAt: -1 }).skip((pg - 1) * ps).limit(ps).populate('chapterId', 'name').lean(),
  ]);
  res.json({ total, page: pg, pageSize: ps, list });
});
router.post('/questions', async (req, res) => {
  try {
    const { chapterId, type, stem, options = [], answer, textAnswer = '', score = 2 } = req.body || {};
    if (!chapterId || !type || !stem) return res.status(400).json({ error: '参数不完整' });
    const q = await Question.create({ chapterId, type, stem, options, answer, textAnswer, score });
    res.json({ question: q });
  } catch (e) {
    res.status(500).json({ error: '创建失败' });
  }
});
router.put('/questions/:id', async (req, res) => {
  try {
    const q = await Question.findById(req.params.id);
    if (!q) return res.status(404).json({ error: '题目不存在' });
    const fields = ['chapterId', 'type', 'stem', 'options', 'answer', 'textAnswer', 'difficulty', 'score', 'enabled'];
    for (const f of fields) if (req.body?.[f] !== undefined) q[f] = req.body[f];
    await q.save();
    res.json({ question: q });
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});
router.delete('/questions/:id', async (req, res) => {
  await Question.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
});

// ---------- 用户 ----------
router.get('/users', async (req, res) => {
  const { role, keyword, page = 1, pageSize = 20 } = req.query;
  const filter = {};
  if (role && validRole(role)) filter.role = role;
  if (keyword) filter.email = { $regex: escapeRegExp(safeKeyword(keyword)), $options: 'i' };
  const pg = Math.max(1, Number(page) || 1);
  const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
  const [total, list] = await Promise.all([
    User.countDocuments(filter),
    User.find(filter).sort({ createdAt: -1 }).skip((pg - 1) * ps).limit(ps).populate('classId', 'name code').lean(),
  ]);
  res.json({ total, page: pg, pageSize: ps, list: list.map((u) => publicUser(u)) });
});

/** 开通/取消会员 + 到期时间 + 角色 + 封禁（特权字段白名单，isSuperAdmin 永不接受） */
router.put('/users/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: '用户不存在' });
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    // 超级管理员：role/状态/会员/核心权限全部不可后台修改
    if (u.isSuperAdmin) return res.status(403).json({ error: '超级管理员账号不可修改' });
    const { role, status, isMember, memberExpireAt } = req.body || {};
    // isSuperAdmin 谁能改？只有系统初始化逻辑。这里即使请求体伪造也一律忽略，普通账号无法自提权
    if (role !== undefined) {
      if (!validRole(role)) return res.status(400).json({ error: '角色非法' });
      // 普通 admin 不可提权他人为 admin（防横向提权）；超管不受限
      if (role === 'admin' && !req.user.isSuperAdmin) {
        return res.status(403).json({ error: '无权授予管理员角色' });
      }
      u.role = role;
    }
    if (status !== undefined) {
      if (!['active', 'banned'].includes(status)) return res.status(400).json({ error: '状态非法' });
      u.status = status;
    }
    if (isMember !== undefined) u.isMember = !!isMember;
    if (memberExpireAt !== undefined) u.memberExpireAt = memberExpireAt ? new Date(memberExpireAt) : null;
    const wasMember = u.isMember && (!u.memberExpireAt || u.memberExpireAt > new Date());
    await u.save();
    emitUserEvent(u._id, 'member:updated', { userId: String(u._id), isMember: !!u.isMember, memberExpireAt: u.memberExpireAt || null });
    try { const nowActive = u.isMember && (!u.memberExpireAt || u.memberExpireAt > new Date()); if (!wasMember && nowActive && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email || '')) { const m = buildMemberActiveMail({ name: u.name, expireAt: u.memberExpireAt }); sendMail({ to: u.email, subject: m.subject, text: m.text, html: m.html }).catch(() => {}); } } catch {}
    auditLog({ action: 'admin.update-user', operatorId: req.user._id, targetId: u._id, ip: req.ip, detail: `role=${role} status=${status}` });
    res.json({ user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

/** 重置用户密码（改后该用户旧 token 全部失效） */
router.put('/users/:id/reset-password', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: '用户不存在' });
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    // 超管密码只能本人在“个人中心-修改密码”走认证流程修改，后台禁止任何方式重置
    if (u.isSuperAdmin) return res.status(403).json({ error: '超级管理员密码不可后台重置' });
    const pwd = String(req.body?.password || '').trim() || '123456';
    if (pwd.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
    u.passwordHash = await hashPassword(pwd);
    u.tokenVersion = (u.tokenVersion || 0) + 1;
    await u.save();
    auditLog({ action: 'admin.reset-password', operatorId: req.user._id, targetId: u._id, ip: req.ip });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '重置失败' });
  }
});

/**
 * 删除用户（含教师）：DELETE /api/admin/users/:id
 * - 超级管理员：任何请求一律 403
 * - 禁止删除自己；禁止删除最后一个 admin（避免锁死后台）
 * - 被删账号：token 立刻失效（authRequired 按 _id 查库，查不到即 401 → 前端统一清登录态）
 * - 级联清理该用户全部个人数据：练习记录/错题/收藏/刷题会话/考试作答/创建的试卷（教师卷/自定义卷）；
 *   教师名下班级转交操作人（保留班级与学员归属，避免误删班级导致学员数据丢失），无转交人则随班级解散
 */
router.delete('/users/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '用户不存在' });
    const u = await User.findById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    if (u.isSuperAdmin) return res.status(403).json({ error: '超级管理员账号不可删除' });
    if (String(u._id) === String(req.user._id)) return res.status(400).json({ error: '不能删除自己的账号' });
    if (u.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount <= 1) return res.status(400).json({ error: '至少保留一个管理员账号' });
    }
    const uid = u._id;
    await Promise.all([
      PracticeRecord.deleteMany({ userId: uid }),
      WrongBook.deleteMany({ userId: uid }),
      Favorite.deleteMany({ userId: uid }),
      PracticeSession.deleteMany({ userId: uid }),
      ExamAttempt.deleteMany({ userId: uid }),
      Exam.deleteMany({ createdBy: uid, kind: { $in: ['teacher', 'custom'] } }),
    ]);
    // 教师名下班级：转交给操作管理员，学员 classId 保留不动
    await ClassModel.updateMany({ teacherId: uid }, { $set: { teacherId: req.user._id } });
    await u.deleteOne();
    auditLog({ action: 'admin.delete-user', operatorId: req.user._id, targetId: uid, ip: req.ip, detail: `role=${u.role}` });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '删除失败' });
  }
});

// ---------- 班级与教师 ----------
router.get('/classes', async (req, res) => {
  const classes = await ClassModel.find().populate('teacherId', 'name email').sort({ createdAt: -1 }).lean();
  res.json({ classes });
});
router.get('/teachers', async (req, res) => {
  const teachers = await User.find({ role: 'teacher' }).select('name email classId createdAt').lean();
  res.json({ teachers });
});

/**
 * 删除班级：DELETE /api/admin/classes/:id
 * - 管理员/超管可用（路由级 requireRole('admin') 已覆盖）
 * - 级联：学员（含教师）的 classId 置空；该班教师卷及其作答记录一并删除（避免野试卷残留）；
 *   系统卷/自定义卷不受影响
 */
router.delete('/classes/:id', async (req, res) => {
  try {
    const cls = await ClassModel.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    const teacherExams = await Exam.find({ kind: 'teacher', classId: cls._id }).select('_id').lean();
    const examIds = teacherExams.map((e) => e._id);
    if (examIds.length) {
      await ExamAttempt.deleteMany({ examId: { $in: examIds } });
      await Exam.deleteMany({ _id: { $in: examIds } });
    }
  const removedUsers = await User.find({ classId: cls._id }).select('_id').lean();
  await User.updateMany({ classId: cls._id }, { $set: { classId: null } });
  removedUsers.forEach((u) => emitUserEvent(u._id, 'class:removed', { classId: null }));
    await cls.deleteOne();
    res.json({ ok: true, deletedExams: examIds.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '删除班级失败' });
  }
});

// ---------- 试卷 ----------
router.get('/exams', async (req, res) => {
  const { kind } = req.query;
  const filter = {};
  if (kind) filter.kind = kind;
  const exams = await Exam.find(filter)
    .populate('classId', 'name code')
    .populate('createdBy', 'name email')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ exams: exams.map((e) => ({ ...e, items: undefined })) });
});
router.post('/exams/system', async (req, res) => {
  try {
    const { title, desc = '', selectMode = 'random', totalCount = 100, durationMin = 120 } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: '请填写标题' });
    const { Question: Q } = await import('../models/Question.js');
    const pool = await Q.find({ enabled: true }).lean();
    const { sampleArray: samp } = await import('../utils.js');
    const picked = samp(pool, Number(totalCount) || 100);
    if (!picked.length) return res.status(400).json({ error: '题库为空' });
    const exam = await Exam.create({
      title: String(title).trim().slice(0, 60),
      desc: String(desc).slice(0, 500),
      kind: 'system',
      scope: 'exam',
      status: 'published',
      createdBy: req.user._id,
      selectMode,
      totalCount: picked.length,
      durationMin: Math.max(5, Math.min(600, Number(durationMin) || 120)),
      items: picked.map((q) => ({
        questionId: q._id, type: q.type, stem: q.stem, options: q.options || [],
        answer: q.answer ?? null, textAnswer: q.textAnswer || '', score: q.score || 2,
      })),
    });
    res.json({ exam });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建失败' });
  }
});
router.put('/exams/:id', async (req, res) => {
  const e = await Exam.findById(req.params.id);
  if (!e) return res.status(404).json({ error: '试卷不存在' });
  const { title, desc, status, durationMin, deadlineAt } = req.body || {};
  if (title !== undefined) e.title = String(title).trim().slice(0, 60) || e.title;
  if (desc !== undefined) e.desc = String(desc).slice(0, 500);
  if (status !== undefined && ['draft', 'published', 'ended'].includes(status)) e.status = status;
  if (durationMin !== undefined) e.durationMin = Number(durationMin) || e.durationMin;
  if (deadlineAt !== undefined) e.deadlineAt = deadlineAt ? new Date(deadlineAt) : null;
  await e.save();
  res.json({ ok: true });
});
router.delete('/exams/:id', async (req, res) => {
  const exam = await Exam.findById(req.params.id).select('_id title scope status classId updatedAt').lean();
  await ExamAttempt.deleteMany({ examId: req.params.id });
  await Exam.findByIdAndDelete(req.params.id);
  if (exam) emitExamChanged(exam, 'deleted');
  res.json({ ok: true });
});

// ---------- 统计 ----------
router.get('/stats', async (req, res) => {
  try {
    const [users, questions, chapters, classes, exams, attempts, members] = await Promise.all([
      User.countDocuments(),
      Question.countDocuments({ enabled: true }),
      Chapter.countDocuments({ enabled: true }),
      ClassModel.countDocuments(),
      Exam.countDocuments(),
      ExamAttempt.countDocuments({ status: 'submitted' }),
      User.countDocuments({ isMember: true }),
    ]);
    const typeAgg = await Question.aggregate([
      { $match: { enabled: true } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]);
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(5).select('name email role createdAt').lean();
    res.json({
      stats: { users, questions, chapters, classes, exams, attempts, members },
      questionTypes: typeAgg,
      recentUsers,
    });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

export default router;

router.get('/mail-settings', authRequired, requireRole('admin'), async (req, res) => {
  const { AppSetting } = await import('../models/AppSetting.js');
  const keys = ['mail_member_expiring'];
  const out = {};
  for (const k of keys) { const d = await AppSetting.findOne({ key: k }).lean(); out[k] = String(d?.value || 'on'); }
  res.json(out);
});
router.put('/mail-settings', authRequired, requireRole('admin'), async (req, res) => {
  const { AppSetting } = await import('../models/AppSetting.js');
  const { key, value } = req.body || {};
  if (!['mail_member_expiring'].includes(key)) return res.status(400).json({ error: '未知开关' });
  await AppSetting.updateOne({ key }, { $set: { value: value === 'off' ? 'off' : 'on' } }, { upsert: true });
  res.json({ ok: true });
});
