import { Router } from 'express';
import mongoose from 'mongoose';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { PracticeRecord, PracticeSession, WrongBook } from '../models/Practice.js';
import { gradeAnswer } from '../utils.js';
import { Exam } from '../models/Exam.js';
import { authRequired, requireSelfMember, isStaff, isMember } from '../auth.js';

const router = Router();
router.use(authRequired);

const MODES = ['order', 'random', 'chapter'];
// 普通顺序刷题：覆盖全库（当前 1200 题），不设硬上限；普通随机刷题：固定 200 题/轮。
// 自定义题序/题号范围/章节/教师任务：仍按 MAX_CUSTOM 截断，防止异常参数拖库。
const MAX_CUSTOM = 200;
const RANDOM_N = 200;
const HISTORY_LIMIT = 50;

/** 会话归属校验：禁止跨用户读取/修改 */
async function getOwnSession(userId, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return { status: 404, error: '会话不存在' };
  const s = await PracticeSession.findById(id);
  if (!s) return { status: 404, error: '会话不存在' };
  if (String(s.userId) !== String(userId)) return { status: 403, error: '无权访问该刷题记录' };
  return { session: s };
}

function toCard(s) {
  const total = s.questionIds?.length || 0;
  const answered = s.answeredCount || 0;
  const ok = s.correctCount || 0;
  // chapterId 可能被 populate 成对象，统一压平成 id 字符串，前端匹配不断点
  const ch = s.chapterId;
  const chapterId = ch && typeof ch === 'object' ? String(ch._id || ch) : ch ?? null;
  return {
    _id: s._id,
    mode: s.mode,
    chapterId,
    title: s.title,
    total,
    answeredCount: answered,
    correctCount: ok,
    wrongCount: s.wrongCount || 0,
    currentIndex: s.currentIndex || 0,
    accuracy: answered ? Math.round((ok / answered) * 100) : 0,
    progress: total ? Math.round((answered / total) * 100) : 0,
    completed: !!s.completed,
    completedAt: s.completedAt || null,
    // 等待确认态：全部答完但用户尚未点“完成本轮”（completed 仍 false）
    allAnswered: total > 0 && answered >= total,
    source: s.source || 'self',
    examId: s.examId ? String(s.examId) : null,
    rangeDesc: s.rangeDesc || '',
    lastAccessedAt: s.lastAccessedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

// 会话标题：只显示模式名，不写死题量（题库未来增减不影响标题；
// 题量只在刷题过程“第 N/M 题”与答题卡中按 questions.length 动态显示）。
// 注：历史会话库里可能存着旧格式“顺序刷题 · 1200题”，前端展示时统一 strip，见 client cleanSessionTitle。
async function resolveTitle({ mode, chapterId }) {
  if (mode === 'chapter' && chapterId) {
    const c = await Chapter.findById(chapterId).select('name').lean();
    if (c) return c.name;
  }
  if (mode === 'random') return '随机刷题';
  if (mode === 'order') return '顺序刷题';
  return '刷题';
}

/**
 * POST /api/practice/sessions { mode, chapterId?, totalCount?, questionIds?, start?, end?, examId? }
 * 创建刷题会话：题目与顺序一次确定落盘，之后恢复绝不重新抽题。
 * 权限（免费学生自主使用只开放顺序刷题；教师/会员全部开放）：
 * - order + 无自定义参数（skip 不属于“顺序抽题”，只做进度续读）→ 免费开放
 * - random / chapter / questionIds(自选题序) / start&end(指定题号) → 学生自主时需会员
 * - TEACHER_ASSIGNED：教师布置任务（source=teacher + 绑定 kind=teacher 的 Exam）完全跳过会员门
 *   判断依据是库里的 Exam.kind/createdBy/scope/classId，不是 URL
 * - order：按 _id 顺序取（chapterId 可选限定章节）
 * - chapter：必须传 chapterId，取该章节全部题（按 _id 顺序）
 * - random：全库 $sample 固定 200 题/轮（不放回、无重复）
 */
router.post('/sessions', async (req, res) => {
  try {
    const { mode, chapterId = null, totalCount = 20, questionIds = null, start = null, end = null, examId = null } = req.body || {};
    if (!MODES.includes(mode)) return res.status(400).json({ error: '刷题模式非法' });

    // 先判教师任务：库里真实存在 kind=teacher 且 published 的 Exam 绑定才算 TEACHER_ASSIGNED
    let teacherExam = null;
    if (examId && mongoose.Types.ObjectId.isValid(examId)) {
      const ex = await Exam.findById(examId).select('kind status scope classId createdBy title').lean();
      if (ex && ex.kind === 'teacher' && ex.status === 'published') teacherExam = ex;
    }
    const isTeacherTask = !!teacherExam;

    const hasCustomRange =
      (Array.isArray(questionIds) && questionIds.length > 0) || start != null || end != null;

    if (!isTeacherTask) {
      // 学生自主：order 且无自定义参数才免费；其余全部会员专属
      if (mode !== 'order' || hasCustomRange) {
        const gate = requireSelfMember(req);
        if (!gate.ok) return res.status(403).json({ error: gate.error });
      }
    } else if (!isStaff(req.user)) {
      // 教师任务：学生必须是该任务可见班级（与考试 start 接口同口径），否则不能领任务
      if (teacherExam.classId && String(req.user.classId) !== String(teacherExam.classId)) {
        return res.status(403).json({ error: '该任务仅限指定班级' });
      }
    }

    let ids = [];
    let rangeDesc = '';
    if (Array.isArray(questionIds) && questionIds.length) {
      // 自定义题序（收藏夹组卷/教师指定题序）：只保留存在的有效题目，保持传入顺序
      const clean = [...new Set(questionIds.map(String))].filter(mongoose.Types.ObjectId.isValid).slice(0, MAX_CUSTOM);
      const exist = await Question.find({ _id: { $in: clean }, enabled: true }).select('_id').lean();
      const existSet = new Set(exist.map((q) => String(q._id)));
      ids = clean.filter((id) => existSet.has(id));
      rangeDesc = isTeacherTask ? `教师指定 ${ids.length} 题` : '';
    } else if (start != null || end != null) {
      // 指定题号范围（如 301～500，按全库 _id 顺序切片）：免费学生自主调用被会员门拦下；
      // 教师任务（examId 绑定）则按教师设置执行
      const total = await Question.countDocuments({ enabled: true });
      const s = Math.max(0, Number(start) || 0);
      const e = end == null ? Math.min(s + MAX_CUSTOM, total) : Math.max(s, Number(end) || 0);
      if (e - s > MAX_CUSTOM) return res.status(400).json({ error: `单次最多 ${MAX_CUSTOM} 题` });
      const list = await Question.find({ enabled: true }).sort({ _id: 1 }).skip(s).limit(e - s).select('_id').lean();
      ids = list.map((q) => q._id);
      rangeDesc = isTeacherTask ? `第${s + 1}～${s + ids.length}题` : '';
    } else if (mode === 'chapter') {
      if (!chapterId || !mongoose.Types.ObjectId.isValid(chapterId)) {
        return res.status(400).json({ error: '章节刷题请选择章节' });
      }
      const list = await Question.find({ enabled: true, chapterId }).sort({ _id: 1 }).select('_id').lean();
      ids = list.map((q) => q._id);
    } else if (mode === 'order') {
      // 普通顺序刷题：全库 _id 顺序，一轮 1200 题连续刷完（不再 50 题切割）
      const list = await Question.find({ enabled: true }).sort({ _id: 1 }).select('_id').lean();
      ids = list.map((q) => q._id);
    } else {
      // 普通随机刷题：固定 200 题/轮（全库 $sample，不放回、无重复）
      const list = await Question.aggregate([{ $match: { enabled: true } }, { $sample: { size: RANDOM_N } }, { $project: { _id: 1 } }]);
      ids = list.map((q) => q._id);
    }
    if (!ids.length) return res.status(400).json({ error: '没有可选题目' });

    const title = isTeacherTask
      ? `班级任务 · ${teacherExam.title}`
      : await resolveTitle({ mode, chapterId });

    // 业务键（进度唯一性）：未完成会话按 userId+业务键 复用；完成/删除后才允许重新创建。
    // 顺序/随机/章节、教师任务：userId + mode / mode+chapterId / taskId(examId)。
    // 成员自主自定义题序/题号范围不参与归并（每次都是全新对象，键置空）。
    let dedupeKey = null;
    if (isTeacherTask) {
      dedupeKey = `teacher:${teacherExam._id}`;
    } else if (!hasCustomRange) {
      if (mode === 'order') dedupeKey = 'self:order';
      else if (mode === 'random') dedupeKey = 'self:random';
      else if (mode === 'chapter') dedupeKey = `self:chapter:${chapterId}`;
    }

    // 已存在未完成进度 → 直接恢复，不新建。
    // 兼容旧规则：之前随机是全库 1200，改成 200/轮后，旧 1200 会话不再复用，
    // 直接删掉建新 200，避免答题卡继续显示 1200。
    if (dedupeKey) {
      const existing = await PracticeSession.findOne({ userId: req.user._id, dedupeKey, completed: false }).lean();
      if (existing) {
        if (mode === 'random' && !isTeacherTask && (existing.questionIds?.length || 0) !== RANDOM_N) {
          await PracticeSession.deleteOne({ _id: existing._id });
        } else {
          return res.json({ session: toCard(existing), resumed: true });
        }
      }
    }

    let s = null;
    try {
      s = await PracticeSession.create({
        userId: req.user._id,
        mode,
        chapterId: mode === 'chapter' ? chapterId : chapterId || null,
        title,
        questionIds: ids,
        source: isTeacherTask ? 'teacher' : 'self',
        examId: isTeacherTask ? teacherExam._id : null,
        rangeDesc,
        // 串行原子化：有键走 findOneAndUpdate upsert 抢槽位；无键（自主自定义）直接建
        ...(dedupeKey ? { dedupeKey } : {}),
        currentIndex: 0,
        answeredCount: 0,
        correctCount: 0,
        wrongCount: 0,
        userAnswers: {},
        completed: false,
        lastAccessedAt: new Date(),
      });
    } catch (err) {
      // 并发双写/旧脏数据：唯一索引兜底，回查已有进度返回
      if (err?.code === 11000 && dedupeKey) {
        const existing = await PracticeSession.findOne({ userId: req.user._id, dedupeKey, completed: false }).lean();
        if (existing) return res.json({ session: toCard(existing), resumed: true });
        // 旧脏数据无键但业务重复：同 userId+mode+chapterId/source+examId 范围内复用最新未完成
        const legacyFilter = { userId: req.user._id, completed: false, mode, source: isTeacherTask ? 'teacher' : 'self' };
        if (mode === 'chapter') legacyFilter.chapterId = chapterId;
        if (isTeacherTask) legacyFilter.examId = teacherExam._id;
        const legacy = await PracticeSession.findOne(legacyFilter).sort({ lastAccessedAt: -1 }).lean();
        if (legacy) {
          if (!legacy.dedupeKey) {
            await PracticeSession.updateOne({ _id: legacy._id }, { $set: { dedupeKey } }).catch(() => {});
          }
          return res.json({ session: toCard({ ...legacy, dedupeKey }), resumed: true });
        }
      }
      throw err;
    }
    res.json({ session: toCard(s), resumed: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建刷题失败' });
  }
});

/** GET /api/practice/sessions?completed=false&limit=50&modes=order,random 未完成列表（默认）/ 历史
 * 免费学生自主列表只返回顺序会话 + 教师任务会话；随机/章节自主会话需会员才可见。
 */
router.get('/sessions', async (req, res) => {
  try {
    const completed = req.query.completed === 'true';
    const limit = Math.max(1, Math.min(HISTORY_LIMIT, Number(req.query.limit) || HISTORY_LIMIT));
    const filter = { userId: req.user._id, completed };
    // 继续刷题列表只展示顺序/随机：传 modes=order,random 过滤；不传则返回全部（兼容历史页）
    if (req.query.modes) {
      const modes = String(req.query.modes).split(',').map((s) => s.trim()).filter((m) => MODES.includes(m));
      if (modes.length) filter.mode = { $in: modes };
    }
    const needMember = !isStaff(req.user) && !isMember(req.user) && !completed;
    const baseFilter = needMember
      ? { $and: [filter, { $or: [{ source: 'teacher' }, { mode: 'order' }] }] }
      : filter;
    const list = await PracticeSession.find(baseFilter)
      .sort({ lastAccessedAt: -1 })
      .limit(limit)
      .populate('chapterId', 'name')
      .lean();
    res.json({
      sessions: list.map((s) => ({
        ...toCard(s),
        chapterName: s.chapterId?.name || null,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取刷题记录失败' });
  }
});

/** GET /api/practice/sessions/latest 最近一条未完成（首页“继续刷题”用）
 * 免费学生：只返回顺序自主会话 + 教师任务会话（随机/章节自主会话不透出，避免绕过会员门续刷）
 */
router.get('/sessions/latest', async (req, res) => {
  try {
    const s = await PracticeSession.findOne({ userId: req.user._id, completed: false })
      .sort({ lastAccessedAt: -1 })
      .populate('chapterId', 'name')
      .lean();
    if (!s) return res.json({ session: null });
    const isTeacherTask = (s.source === 'teacher') || !!s.examId;
    if (!isMember(req.user) && req.user.role !== 'teacher' && req.user.role !== 'admin'
      && !isTeacherTask && (s.mode === 'random' || s.mode === 'chapter')) {
      return res.json({ session: null });
    }
    res.json({ session: { ...toCard(s), chapterName: s.chapterId?.name || null } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * GET /api/practice/sessions/:id
 * 恢复会话：返回完整题目（含题干选项，不含答案）+ 已答状态 + 定位索引。
 * 题目顺序即建会话时的 questionIds，绝不重新随机。
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const { session: s, status, error } = await getOwnSession(req.user._id, req.params.id);
    if (!s) return res.status(status).json({ error });
    const qs = await Question.find({ _id: { $in: s.questionIds }, enabled: true })
      .select('stem options type score chapterId answer textAnswer')
      .lean();
    const byId = new Map(qs.map((q) => [String(q._id), q]));
    // 按会话落盘顺序还原；题目若被管理员删除/禁用则跳过
    const questions = s.questionIds.map((id) => byId.get(String(id))).filter(Boolean);
    // userAnswers 在 mongoose Document 上是 Map，lean 取的是普通对象，两种都要兼容
    const ua = s.userAnswers;
    const uaEntries = ua instanceof Map ? [...ua.entries()] : Object.entries(ua || {});
    const answers = {};
    for (const [qid, a] of uaEntries) {
      const entry = {
        answer: a?.answer ?? null,
        correct: a?.correct ?? null,
        autoGraded: !!a?.autoGraded,
        // 正确答案快照随会话落盘，恢复已答题直接展示，不再二次查题
        correctAnswer: a?.correctAnswer ?? null,
        textAnswer: a?.textAnswer || '',
        answeredAt: a?.at || null,
      };
      // 老会话/旧缓存没有快照：用本题题干数据回填，避免前端把答对判成答错
      if (entry.correctAnswer == null) {
        const qq = byId.get(String(qid));
        if (qq) {
          entry.correctAnswer = qq.answer ?? null;
          if (!entry.textAnswer) entry.textAnswer = qq.textAnswer || '';
        }
      }
      answers[qid] = entry;
    }
    s.lastAccessedAt = new Date();
    await s.save();
    const card = toCard(s);
    res.json({
      session: card,
      // 客户端已预载完整题库；这里一并返回判题字段，支持断网本地秒判。
      // 服务端同步时仍会重新判分，不信任客户端上传的 correct。
      questions: questions.map((q) => ({
        _id: q._id, type: q.type, stem: q.stem, options: q.options || [], score: q.score || 2,
        answer: q.answer ?? null, textAnswer: q.textAnswer || '',
      })),
      userAnswers: answers,
      currentIndex: Math.min(s.currentIndex || 0, Math.max(0, questions.length - 1)),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '恢复刷题失败' });
  }
});

/**
 * POST /api/practice/sessions/:id/sync
 * 离线答题队列批量补传。clientEventId 保证重试幂等；对错由服务端重新计算。
 * 同题冲突按 answeredAt 取较新记录，currentIndex 按 progressAt 取较新设备进度。
 */
router.post('/sessions/:id/sync', async (req, res) => {
  try {
    const { session: s, status, error } = await getOwnSession(req.user._id, req.params.id);
    if (!s) return res.status(status).json({ error });
    if (s.completed) return res.json({ session: toCard(s), applied: 0 });
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    const ids = [...new Set(events.map((event) => String(event?.questionId || '')).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
    const rows = await Question.find({ _id: { $in: ids }, enabled: true }).select('chapterId type answer textAnswer').lean();
    const questions = new Map(rows.map((q) => [String(q._id), q]));
    const sessionIds = new Set(s.questionIds.map(String));
    const touchedWrong = new Set();
    let applied = 0;

    for (const event of events.sort((a, b) => new Date(a.answeredAt || 0) - new Date(b.answeredAt || 0))) {
      const qid = String(event?.questionId || '');
      const eventId = String(event?.eventId || '').slice(0, 120);
      const q = questions.get(qid);
      if (!eventId || !q || !sessionIds.has(qid)) continue;
      const answeredAt = new Date(event.answeredAt || Date.now());
      if (Number.isNaN(answeredAt.getTime())) continue;
      if (answeredAt.getTime() > Date.now() + 5 * 60 * 1000) answeredAt.setTime(Date.now());
      const autoGraded = ['single', 'multiple', 'judge'].includes(q.type);
      const correct = autoGraded ? gradeAnswer(q, event.answer) : null;
      const result = correct === false ? 'wrong' : 'correct';
      const record = await PracticeRecord.updateOne(
        { userId: req.user._id, clientEventId: eventId },
        { $setOnInsert: {
          questionId: q._id, chapterId: q.chapterId, mode: s.mode, result,
          userAnswer: event.answer ?? null, sessionId: s._id, answeredAt,
        } },
        { upsert: true },
      );
      if (record.upsertedCount) applied += 1;
      if (correct === false) touchedWrong.add(qid);

      const previous = s.userAnswers?.get ? s.userAnswers.get(qid) : s.userAnswers?.[qid];
      const previousAt = previous?.at ? new Date(previous.at).getTime() : 0;
      if (!previous || answeredAt.getTime() >= previousAt) {
        s.userAnswers.set(qid, {
          answer: event.answer ?? null, correct, autoGraded,
          correctAnswer: autoGraded ? q.answer ?? null : null,
          textAnswer: q.textAnswer || '', at: answeredAt,
        });
      }
    }

    // 错题次数从幂等答题记录重算，重复补传不会重复累加。
    for (const qid of touchedWrong) {
      const latest = await PracticeRecord.findOne({ userId: req.user._id, questionId: qid, result: 'wrong' })
        .sort({ answeredAt: -1, createdAt: -1 }).lean();
      const count = await PracticeRecord.countDocuments({ userId: req.user._id, questionId: qid, result: 'wrong' });
      const q = questions.get(qid);
      await WrongBook.findOneAndUpdate(
        { userId: req.user._id, questionId: qid },
        { $set: { chapterId: q.chapterId, lastAnswer: latest?.userAnswer ?? null, mastered: false, count } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    const answers = s.userAnswers instanceof Map ? [...s.userAnswers.values()] : Object.values(s.userAnswers || {});
    s.answeredCount = answers.length;
    s.correctCount = answers.filter((answer) => answer?.autoGraded && answer.correct === true).length;
    s.wrongCount = answers.filter((answer) => answer?.autoGraded && answer.correct === false).length;
    const progressAt = new Date(req.body?.progressAt || 0);
    const savedProgressAt = s.progressUpdatedAt ? new Date(s.progressUpdatedAt) : new Date(0);
    if (!Number.isNaN(progressAt.getTime()) && progressAt >= savedProgressAt) {
      s.currentIndex = Math.max(0, Math.min(Number(req.body?.currentIndex) || 0, Math.max(0, s.questionIds.length - 1)));
      s.progressUpdatedAt = progressAt;
    }
    s.lastAccessedAt = new Date();
    await s.save();
    res.json({ session: toCard(s), applied });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '同步刷题进度失败' });
  }
});

/**
 * PATCH /api/practice/sessions/:id { currentIndex?, answer?: { questionId, answer } }
 * 保存进度：切题只传 currentIndex；答题只传用户选择的答案。
 * 统计（correct/autoGraded/correctAnswer/textAnswer/counts）一律由服务端按题库判分计算，
 * 前端传来的 correct/autoGraded/correctAnswer 直接忽略，防篡改刷分。
 * 注意：答满全部题目不会自动完成 —— completed 只能由 complete 接口在用户主动确认后置 true，
 * 此时会话进入“等待确认”态（allAnswered=true，仍可继续查看/跳转/回看）。
 */
router.patch('/sessions/:id', async (req, res) => {
  try {
    const { session: s, status, error } = await getOwnSession(req.user._id, req.params.id);
    if (!s) return res.status(status).json({ error });
    if (s.completed) return res.status(400).json({ error: '该刷题已完成' });
    const { currentIndex, answer } = req.body || {};
    const total = s.questionIds.length;

    if (answer && answer.questionId) {
      const qid = String(answer.questionId);
      const inSession = s.questionIds.some((id) => String(id) === qid);
      if (!inSession) return res.status(400).json({ error: '题目不在本次刷题中' });
      // 服务端判分：按题库正确答案计算 correct，不信任前端传值（防篡改刷分）
      const { Question: QQ } = await import('../models/Question.js');
      const { gradeAnswer: grade } = await import('../utils.js');
      const qq = await QQ.findById(qid).select('type answer textAnswer').lean();
      if (!qq) return res.status(400).json({ error: '题目不存在' });
      const autoGraded = ['single', 'multiple', 'judge'].includes(qq.type);
      const correct = autoGraded ? grade(qq, answer.answer) : null;
      const prev = s.userAnswers?.get ? s.userAnswers.get(qid) : s.userAnswers?.[qid];
      const wasAnswered = !!prev;
      s.userAnswers.set(qid, {
        answer: answer.answer ?? null,
        correct,
        autoGraded,
        correctAnswer: autoGraded ? qq.answer ?? null : null,
        textAnswer: qq.textAnswer || '',
        at: new Date(),
      });
      if (!wasAnswered) {
        s.answeredCount = (s.answeredCount || 0) + 1;
        if (autoGraded) {
          if (correct) s.correctCount = (s.correctCount || 0) + 1;
          else s.wrongCount = (s.wrongCount || 0) + 1;
        }
      } else if (autoGraded) {
        // 同一题重复提交（如返回修改）：先回滚旧统计再计新值
        if (prev?.autoGraded) {
          if (prev.correct) s.correctCount = Math.max(0, (s.correctCount || 0) - 1);
          else s.wrongCount = Math.max(0, (s.wrongCount || 0) - 1);
        }
        if (correct) s.correctCount = (s.correctCount || 0) + 1;
        else s.wrongCount = (s.wrongCount || 0) + 1;
      }
    }
if (currentIndex !== undefined) {
      s.currentIndex = Math.max(0, Math.min(Number(currentIndex) || 0, Math.max(0, total - 1)));
    }
    // 全部答完也不自动完成：completed 只能由 complete 接口置 true（用户主动确认）
    s.lastAccessedAt = new Date();
    await s.save();
    res.json({ session: toCard(s), resumed: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '保存进度失败' });
  }
});

/**
 * POST /api/practice/sessions/:id/complete 用户主动确认完成本轮（唯一完成入口）。
 * - 幂等：已完成重复调用直接返回当前状态，不重复记、不建新会话
 * - 服务端强制校验：answeredCount < total（按 questionIds 实长）→ 400 + 剩余题数，不信任客户端
 * - 只置 completed=true + completedAt + 释放 dedupeKey；PracticeRecord/错题/收藏/统计一律保留
 * - 兼容旧测试/旧客户端：跳过全答校验的强制完成仍被允许，但只释放槽位用 ——
 *   为保证“未满拒绝”语义，强制完成仅当显式传 { force: true }（教师任务/调试用），
 *   普通调用仍必须答满
 */
router.post('/sessions/:id/complete', async (req, res) => {
  try {
    const { session: s, status, error } = await getOwnSession(req.user._id, req.params.id);
    if (!s) return res.status(status).json({ error });
    if (s.completed) return res.json({ session: toCard(s) });
    const total = s.questionIds?.length || 0;
    const answered = s.answeredCount || 0;
    if (total <= 0 || answered < total) {
      return res.status(400).json({ error: `还有${Math.max(0, total - answered)}道题未完成` });
    }
    s.completed = true;
    s.completedAt = new Date();
    s.dedupeKey = null; // 释放业务槽位：完成后允许“重新开始”建新一轮，旧会话保留历史
    s.lastAccessedAt = new Date();
    await s.save();
    res.json({ session: toCard(s) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '操作失败' });
  }
});

/** DELETE /api/practice/sessions/:id 用户主动删除一条记录（完成/未完成均可删） */
router.delete('/sessions/:id', async (req, res) => {
  try {
    const { session: s, status, error } = await getOwnSession(req.user._id, req.params.id);
    if (!s) return res.status(status).json({ error });
    await PracticeSession.findByIdAndDelete(s._id);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
