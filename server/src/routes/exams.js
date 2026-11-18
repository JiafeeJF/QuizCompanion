import { Router } from 'express';
import { emitExamPublished, emitExamChanged } from '../realtime.js';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { Exam, ExamAttempt } from '../models/Exam.js';
import { ClassModel } from '../models/Class.js';
import { authRequired, isMember, requireRole } from '../auth.js';
import { genToken, gradeAnswer, sampleArray } from '../utils.js';
import { sensitiveWriteLimit } from '../security.js';
import { isObjectId, validDeadline, validDurationMin } from '../validate.js';

const router = Router();
// 考试写操作分组限流（创建/交卷防刷；查询不限，避免班级并发刷题 429）
router.use(sensitiveWriteLimit);

/** snapshot：落盘题快照（解析已下线，不再落盘） */
function snapshot(q) {
  return {
    questionId: q._id,
    type: q.type,
    stem: q.stem,
    options: q.options || [],
    answer: q.answer ?? null,
    textAnswer: q.textAnswer || '',
    score: q.score || 2,
  };
}

/**
 * buildItems：组卷抽题（random / chapter 原逻辑不动；新增 sequence）。
 * - sequence：从全库 enabled 按 canonical 顺序（_id:1，与学员端顺序刷题一致）取 start～end，
 *   不随机、不跨章节拆分、disabled 不占号；items 按原顺序快照落盘。
 */
async function buildItems({ selectMode, chapterRules, totalCount, sequenceRange }) {
  if (selectMode === 'sequence') {
    const { getEnabledQuestionCount, getSequenceSlice, validateSequenceRange } = await import('../bankOrder.js');
    const total = await getEnabledQuestionCount();
    const err = validateSequenceRange(sequenceRange?.start, sequenceRange?.end, total);
    if (err) {
      const e = new Error(err);
      e.statusCode = 400;
      throw e;
    }
    const slice = await getSequenceSlice(sequenceRange.start, sequenceRange.end);
    if (!slice.length) {
      const e = new Error('题库暂无符合条件的题目');
      e.statusCode = 400;
      throw e;
    }
    return slice.map(snapshot);
  }
  let picked = [];
  if (selectMode === 'chapter' && Array.isArray(chapterRules) && chapterRules.length) {
    for (const rule of chapterRules) {
      const pool = await Question.find({ enabled: true, chapterId: rule.chapterId }).lean();
      picked.push(...sampleArray(pool, Number(rule.count) || 0));
    }
  } else {
    const pool = await Question.find({ enabled: true }).lean();
    picked = sampleArray(pool, Number(totalCount) || 50);
  }
  return picked.map(snapshot);
}

function toListItem(e) {
  return {
    _id: e._id,
    title: e.title,
    desc: e.desc,
    kind: e.kind,
    scope: e.scope,
    status: e.status,
    classId: e.classId,
    createdBy: e.createdBy,
    selectMode: e.selectMode,
    sequenceRange: e.sequenceRange || undefined,
    totalCount: e.totalCount || e.items.length,
    totalScore: (e.items || []).reduce((s, it) => s + (it.score || 2), 0),
    durationMin: e.durationMin,
    deadlineAt: e.deadlineAt,
    shuffleItems: !!e.shuffleItems,
    shareToken: e.shareToken,
    createdAt: e.createdAt,
    notificationStatus: e.notificationStatus || 'none',
    notificationStats: e.notificationStats || undefined,
  };
  // 通知发送统计：仅在教师详情页（带 items 的完整 exam 对象）透出，列表不透出避免噪音
  if (e.notificationSentAt) list.notificationSentAt = e.notificationSentAt;
  if (e.summaryStatus) list.summaryStatus = e.summaryStatus;
  if (e.summarySentAt) list.summarySentAt = e.summarySentAt;
  return list;
}

/**
 * 确定性洗牌（Fisher-Yates + xfnv1a/mulberry32）：同一种子永远同一顺序。
 * 学生每人种子不同 → 顺序各异防窥屏；同一学生屡刷一致 → 刷新/重进不乱、交卷对得上。
 * 只重排数组顺序，不改动题目内容/答案/判分（submit 按 questionId 对齐）。
 */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function seededShuffle(arr, seedStr) {
  const a = [...arr];
  let s = hashSeed(String(seedStr));
  const rand = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function durationFromAttempt(attempt) {
  const startMs = new Date(attempt?.startedAt).getTime();
  const endMs = new Date(attempt?.submittedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.floor((endMs - startMs) / 1000);
}

function remainingExamSec(attempt, durationMin) {
  const startedMs = new Date(attempt?.startedAt).getTime();
  const totalSec = Math.max(0, Math.floor(Number(durationMin || 0) * 60));
  if (!Number.isFinite(startedMs) || !totalSec) return totalSec;
  return Math.max(0, totalSec - Math.floor((Date.now() - startedMs) / 1000));
}

/** 题库有效总数（顺序抽题 UI 上限展示用） */
router.get('/sequence-range/total', authRequired, async (req, res) => {
  try {
    const { getEnabledQuestionCount } = await import('../bankOrder.js');
    res.json({ total: await getEnabledQuestionCount() });
  } catch (e) {
    res.status(500).json({ error: '获取题库总数失败' });
  }
});

/** GET /api/exams 学员可见试卷：系统卷 + 本班教师卷 + 我创建的自定义卷 */
router.get('/', authRequired, async (req, res) => {
  try {
    const ors = [{ kind: 'system', status: 'published' }];
    if (req.user.classId) ors.push({ kind: 'teacher', status: 'published', classId: req.user.classId });
    ors.push({ kind: 'custom', createdBy: req.user._id });
    const exams = await Exam.find({ $or: ors }).sort({ createdAt: -1 }).lean();
    // 附带我的作答状态
    const ids = exams.map((e) => e._id);
    const attempts = await ExamAttempt.find({ examId: { $in: ids }, userId: req.user._id })
      .select('examId status score accuracy submittedAt')
      .lean();
    const am = new Map(attempts.map((a) => [String(a.examId), a]));
    res.json({
      exams: exams.map((e) => ({ ...toListItem(e), myAttempt: am.get(String(e._id)) || null })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取试卷失败' });
  }
});

/** 顺序抽题范围预览：GET /api/exams/sequence-range/info?start=&end=（组卷 UI 用，只读不建卷） */
router.get('/sequence-range/info', authRequired, async (req, res) => {
  try {
    const { getSequenceRangeInfo } = await import('../bankOrder.js');
    const info = await getSequenceRangeInfo(req.query.start, req.query.end);
    if (info.error) return res.status(400).json({ error: info.error, total: info.total });
    res.json(info);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取范围预览失败' });
  }
});

/** GET /api/exams/share/:token 分享链接入口（登录后解析出试卷 id） */
router.get('/share/:token', authRequired, async (req, res) => {
  try {
    const exam = await Exam.findOne({ shareToken: req.params.token, status: 'published' }).lean();
    if (!exam) return res.status(404).json({ error: '分享的考试不存在或已结束' });
    res.json({ examId: exam._id, title: exam.title, kind: exam.kind });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/exams/:id 试卷详情（含题面，不含答案；教师/创建者可见答案） */
router.get('/:id', authRequired, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    const isOwner =
      String(exam.createdBy) === String(req.user._id) || ['teacher', 'admin'].includes(req.user.role);
    const canSeeAnswer = isOwner && exam.kind !== 'custom' ? true : exam.kind === 'custom' && isOwner;
    // 每人独立打乱：开启 shuffleItems 的卷，按本人 userId 稳定种子重排（自己屡刷不变，他人各不相同）
    const orderSeed = exam.shuffleItems ? `${exam._id}:${req.user._id}` : null;
    const ordered = orderSeed ? seededShuffle(exam.items, orderSeed) : exam.items;
    const items = ordered.map((it) => ({
      questionId: it.questionId,
      type: it.type,
      stem: it.stem,
      options: it.options,
      score: it.score,
      ...(canSeeAnswer ? { answer: it.answer, textAnswer: it.textAnswer } : {}),
    }));
    res.json({ exam: { ...toListItem(exam), items, ...(canSeeAnswer ? { answers: exam.items } : {}) } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取试卷失败' });
  }
});

/** POST /api/exams/custom 会员创建自定义卷 { title, selectMode, chapterRules, totalCount, sequenceRange, durationMin, shuffleItems }
 * 学生自主组卷：免费学生禁止（会员专属），教师/管理员不受限。
 * 教师给班级组卷走 POST /teacher（kind=teacher），不受本门限制。
 * shuffleItems=true：落盘前整卷打乱一次（自定义卷仅创建者作答，等价于独立打乱）。
 */
router.post('/custom', authRequired, async (req, res) => {
  try {
    if (req.user.role !== 'teacher' && req.user.role !== 'admin' && !isMember(req.user)) {
      return res.status(403).json({ error: '该功能为会员专属功能' });
    }
    // 白名单抽题模式；chapterRules 只接受 {chapterId,count} 且 chapterId 必须合法
    const { title, selectMode = 'random', chapterRules = [], totalCount = 50, sequenceRange = null, durationMin = 90, shuffleItems = false } = req.body || {};
    if (!['random', 'chapter', 'sequence'].includes(selectMode)) return res.status(400).json({ error: '组卷方式非法' });
    if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写试卷标题' });
    const cleanRules = (Array.isArray(chapterRules) ? chapterRules : [])
      .filter((r) => r && isObjectId(String(r.chapterId)) && Number(r.count) > 0)
      .map((r) => ({ chapterId: String(r.chapterId), count: Math.min(500, Math.floor(Number(r.count))) }));
    let items;
    try {
      items = await buildItems({ selectMode, chapterRules: cleanRules, totalCount, sequenceRange });
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message || '组卷失败' });
    }
    if (!items.length) return res.status(400).json({ error: '题库暂无符合条件的题目' });
    // 打乱只重排顺序：内容/答案/判分不受影响（submit 按 questionId 对齐）
    if (shuffleItems === true) items = seededShuffle(items, `exam:${Date.now()}:${Math.random()}`);
    const dm = validDurationMin(durationMin) || 90;
    const exam = await Exam.create({
      title: String(title).trim().slice(0, 60),
      kind: 'custom',
      scope: 'exam',
      status: 'published',
      createdBy: req.user._id,
      selectMode,
      chapterRules: cleanRules,
      sequenceRange: selectMode === 'sequence' && sequenceRange
        ? { start: Number(sequenceRange.start), end: Number(sequenceRange.end) }
        : undefined,
      totalCount: items.length,
      durationMin: dm,
      shuffleItems: shuffleItems === true,
      items,
    });
    res.json({ exam: toListItem(exam.toObject()) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建失败' });
  }
});

/** DELETE /api/exams/:id 删除自定义卷（仅创建者；kind 归属双校验防越权） */
router.delete('/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '试卷不存在' });
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    if (exam.kind === 'custom' && String(exam.createdBy) === String(req.user._id)) {
      await ExamAttempt.deleteMany({ examId: exam._id, userId: req.user._id });
      await exam.deleteOne();
      return res.json({ ok: true });
    }
    if (req.user.role === 'admin') {
      await ExamAttempt.deleteMany({ examId: exam._id });
      await exam.deleteOne();
      return res.json({ ok: true });
    }
    return res.status(403).json({ error: '无权删除' });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

/** POST /api/exams/:id/start 开始作答（同一试卷仅一条 doing：存在则恢复，不新建；并发由索引兜底） */
router.post('/:id/start', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: '考试不可用' });
    const exam = await Exam.findById(req.params.id);
    if (!exam || exam.status !== 'published') return res.status(400).json({ error: '考试不可用' });
    if (exam.deadlineAt && exam.deadlineAt < new Date()) return res.status(400).json({ error: '考试已截止' });
    // 教师卷仅本班可见
    if (exam.kind === 'teacher' && exam.classId && String(req.user.classId) !== String(exam.classId)) {
      if (req.user.role === 'student') return res.status(403).json({ error: '该考试仅限指定班级' });
    }
    const orderSeed = exam.shuffleItems ? `${exam._id}:${req.user._id}` : null;
    const orderedItems = orderSeed ? seededShuffle(exam.items, orderSeed) : exam.items;
    let attempt = await ExamAttempt.findOne({ examId: exam._id, userId: req.user._id, status: 'doing' });
    if (attempt) {
      if (!Array.isArray(attempt.questionOrder) || attempt.questionOrder.length === 0) {
        attempt.questionOrder = orderedItems.map((item) => item.questionId);
        await attempt.save();
      }
      return res.json({ attemptId: attempt._id, startedAt: attempt.startedAt, durationMin: exam.durationMin, remainingSec: remainingExamSec(attempt, exam.durationMin), questionOrder: attempt.questionOrder, resumed: true });
    }
    if (!exam.allowRedo) {
      const done = await ExamAttempt.findOne({ examId: exam._id, userId: req.user._id, status: 'submitted' });
      if (done) return res.status(400).json({ error: '该考试只允许作答一次' });
    }
    try {
      attempt = await ExamAttempt.create({
        examId: exam._id,
        userId: req.user._id,
        totalCount: exam.items.length,
        questionOrder: orderedItems.map((item) => item.questionId),
        totalScore: exam.items.reduce((s, it) => s + (it.score || 2), 0),
      });
    } catch (err) {
      // 并发双写：唯一索引兜底，回查已有 doing 返回
      if (err?.code === 11000) {
        attempt = await ExamAttempt.findOne({ examId: exam._id, userId: req.user._id, status: 'doing' });
        if (attempt) return res.json({ attemptId: attempt._id, startedAt: attempt.startedAt, durationMin: exam.durationMin, remainingSec: remainingExamSec(attempt, exam.durationMin), questionOrder: attempt.questionOrder, resumed: true });
      }
      throw err;
    }
    res.json({ attemptId: attempt._id, startedAt: attempt.startedAt, durationMin: exam.durationMin, remainingSec: remainingExamSec(attempt, exam.durationMin), questionOrder: attempt.questionOrder, resumed: false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '开始考试失败' });
  }
});

/** POST /api/exams/:id/abandon 作废进行中的考试，不产生有效成绩 */
router.post('/:id/abandon', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '试卷不存在' });
    const attempt = await ExamAttempt.findOneAndUpdate(
      { examId: req.params.id, userId: req.user._id, status: 'doing' },
      { $set: { status: 'abandoned', durationSec: 0, answers: [], submittedAt: null } },
      { new: true }
    ).lean();
    res.json({ ok: true, abandoned: !!attempt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '作废考试失败' });
  }
});

/** POST /api/exams/abandon-in-progress
 * App 冷启动/进入模考模块时的兜底清理：进程被杀时前端来不及上报，
 * 服务端仍将所有未交卷记录作废，避免下次恢复后继续累计用时。
 */
router.post('/abandon-in-progress', authRequired, async (req, res) => {
  try {
    const result = await ExamAttempt.updateMany(
      { userId: req.user._id, status: 'doing' },
      { $set: { status: 'abandoned', durationSec: 0, answers: [], submittedAt: null } }
    );
    res.json({ ok: true, abandonedCount: result.modifiedCount || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '清理未完成考试失败' });
  }
});

/**
 * POST /api/exams/:id/submit { answers: [{ questionId, answer }] } 交卷判分
 * 客观题自动判；填空/简答记 0 分并标记（教师端可后续人工给分，v1 仅展示参考答案）
 */
router.post('/:id/submit', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '试卷不存在' });
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    // 截止后拒绝提交（复用 start 同一 deadline 口径；doing 不删除，按现有规则保留）
    if (exam.status === 'ended') return res.status(400).json({ error: '考试已结束' });
    if (exam.deadlineAt && exam.deadlineAt < new Date()) return res.status(400).json({ error: '考试已截止' });
    const attempt = await ExamAttempt.findOne({ examId: exam._id, userId: req.user._id, status: 'doing' }).sort({
      createdAt: -1,
    });
    if (!attempt) return res.status(400).json({ error: '没有进行中的作答' });
    const ansMap = new Map((req.body?.answers || []).map((a) => [String(a.questionId), a.answer]));
    let score = 0;
    let correctCount = 0;
    const itemByQuestionId = new Map(exam.items.map((item) => [String(item.questionId), item]));
    const persistedOrder = Array.isArray(attempt.questionOrder) && attempt.questionOrder.length
      ? attempt.questionOrder.map(String)
      : exam.items.map((item) => String(item.questionId));
    const graded = persistedOrder.map((questionId) => itemByQuestionId.get(questionId)).filter(Boolean).map((it) => {
      const ua = ansMap.has(String(it.questionId)) ? ansMap.get(String(it.questionId)) : null;
      const auto = ['single', 'multiple', 'judge'].includes(it.type);
      const correct = auto && ua !== null && ua !== undefined ? gradeAnswer(it, ua) : false;
      const s = correct ? it.score || 2 : 0;
      score += s;
      if (correct) correctCount++;
      return { questionId: it.questionId, answer: ua, correct, score: s };
    });
    attempt.answers = graded;
    attempt.score = score;
    attempt.correctCount = correctCount;
    attempt.accuracy = exam.items.length ? Math.round((correctCount / exam.items.length) * 100) : 0;
    attempt.status = 'submitted';
    if (!Array.isArray(attempt.questionOrder) || attempt.questionOrder.length === 0) {
      attempt.questionOrder = graded.map((answer) => answer.questionId);
    }
    attempt.submittedAt = new Date();
    // 用时只按真实考试区间结算：交卷时间 - 开始时间。
    // 开始时间缺失时保留 0，避免用考试时长等固定值伪造耗时。
    const startedMs = attempt.startedAt?.getTime() || 0;
    const rawSec = startedMs ? Math.floor((attempt.submittedAt.getTime() - startedMs) / 1000) : 0;
    // Persist only seconds derived from the server timestamps. Never accept
    // a client duration or a millisecond value here.
    attempt.durationSec = Math.max(0, Math.floor(rawSec));
    await attempt.save();
    try { const { buildSubmitConfirmMail } = await import('../email.js'); const m = buildSubmitConfirmMail({ examTitle: exam.title, score, totalScore: attempt.totalScore, accuracy: attempt.accuracy }); sendMail({ to: req.user.email, subject: m.subject, text: m.text, html: m.html }).catch(() => {}); } catch {}
    res.json({
      attempt: {
        _id: attempt._id,
        score,
        totalScore: attempt.totalScore,
        correctCount,
        totalCount: exam.items.length,
        accuracy: attempt.accuracy,
      durationSec: durationFromAttempt(attempt),
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '交卷失败' });
  }
});

/** GET /api/exams/:id/result 我的成绩 + 错题回顾（不含解析）+ 班级排名（教师卷，取每人最好成绩） */
router.get('/:id/result', authRequired, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    const attempt = await ExamAttempt.findOne({ examId: exam._id, userId: req.user._id, status: 'submitted' })
      .sort({ submittedAt: -1 })
      .lean();
    if (!attempt) return res.status(404).json({ error: '暂无成绩' });
    // Keep an existing valid stored value (including an administrator's
    // documented correction). Only backfill missing/invalid legacy values
    // from the immutable server timestamps.
    const storedDurationSec = Number(attempt.durationSec);
    if (!Number.isFinite(storedDurationSec) || storedDurationSec <= 0) {
      const canonicalDurationSec = durationFromAttempt(attempt);
      await ExamAttempt.updateOne({ _id: attempt._id }, { $set: { durationSec: canonicalDurationSec } });
      attempt.durationSec = canonicalDurationSec;
    }
  const answerByQuestionId = new Map((attempt.answers || []).map((a) => [String(a.questionId), a]));
  const itemByQuestionId = new Map((exam.items || []).map((it) => [String(it.questionId), it]));
  const persistedOrder = Array.isArray(attempt.questionOrder) && attempt.questionOrder.length
    ? attempt.questionOrder.map(String)
    : exam.items.map((it) => String(it.questionId));
  const detail = persistedOrder.map((questionId) => {
    const it = itemByQuestionId.get(questionId);
    if (!it) return null;
    const a = answerByQuestionId.get(questionId) || {};
      return {
        questionId: it.questionId,
        type: it.type,
        stem: it.stem,
        options: it.options,
        score: it.score,
        userAnswer: a.answer ?? null,
        correct: !!a.correct,
        gotScore: a.score || 0,
        answer: it.answer,
        textAnswer: it.textAnswer,
      };
    }).filter(Boolean);
    // 班级排名：仅教师卷且绑定班级时计算。学员可见同班排名（直接显示用户名）。
    // 取每人最好一次 submitted 成绩排名，多次作答不堆排名。
    let ranking = exam.kind === 'teacher' ? { list: [], total: 0, myRank: null, available: false } : null;
    if (exam.kind === 'teacher' && exam.classId) {
      const visible =
        req.user.role !== 'student' ||
        String(req.user.classId) === String(exam.classId);
      if (visible) {
        ranking = await buildBestRanking(exam._id);
        const mine = ranking.find((r) => String(r.userId) === String(req.user._id));
        const named = ranking.map((r) => ({
          rank: r.rank,
          name: r.name,
          avatar: r.avatar || '',
          score: r.score,
          accuracy: r.accuracy,
          // 排名行用时显示用：null 表示未知（前端显示 --），不传 0 避免被当成 0 秒
          durationSec: r.durationSec,
          mine: String(r.userId) === String(req.user._id),
        }));
        ranking = { list: named.slice(0, 50), total: ranking.length, myRank: mine?.rank ?? null, available: true };
      }
    }
    res.json({ attempt, detail, exam: toListItem(exam), ranking });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取成绩失败' });
  }
});

/** GET /api/exams/:id/attempts 某卷作答记录（教师看本班 / 管理员看全部） */
router.get('/:id/attempts', authRequired, async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).lean();
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    const isAdmin = req.user.role === 'admin';
    const isTeacher =
      req.user.role === 'teacher' && exam.classId && String(exam.classId) === String(req.user.classId);
    const isCreator = String(exam.createdBy) === String(req.user._id);
    // 班级成员（学员）可看本班排名：仅教师卷 + 本班
    const isClassmate =
      exam.kind === 'teacher' && exam.classId && String(req.user.classId) === String(exam.classId);
    if (!isAdmin && !isTeacher && !isCreator && !isClassmate) return res.status(403).json({ error: '权限不足' });
    if (isClassmate && !isAdmin && !isTeacher && !isCreator) {
      // 学员看排名：每人最好成绩 + 用户名 + 头像 + 用时，不堆排名
      const ranking = await buildBestRanking(exam._id);
      const named = ranking.map((r) => ({
        rank: r.rank,
        name: r.name,
        avatar: r.avatar || '',
        score: r.score,
        accuracy: r.accuracy,
        durationSec: r.durationSec,
        mine: String(r.userId) === String(req.user._id),
      }));
      return res.json({ ranking: { list: named.slice(0, 50), total: ranking.length } });
    }
    const filter = { examId: exam._id, status: 'submitted' };
    const attempts = await ExamAttempt.find(filter)
      .populate('userId', 'name email')
      .sort({ score: -1, submittedAt: 1 })
      .lean();
    res.json({ attempts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * 班级排名：取每人最好一次 submitted 成绩，多次作答只占一个名次，不堆排名。
 * 排序规则：分数高者胜；同分则完成用时（durationSec）短者胜；还相同按更早交卷在前。
 * 名次：分数+用时都相同才并列同名次（1,2,2,4 跳号），否则按序排名。
 * 用时语义：durationSec 为 null 表示未知（老数据缺失/计算失败）——排序时未知置后，
 * 前端统一显示 "--"，绝不显示 NaN 或空白。
 * 返回 [{ userId, name, avatar, email, score, accuracy, durationSec|null, submittedAt, rank }]
 */
async function buildBestRanking(examId) {
  const attempts = await ExamAttempt.find({ examId, status: 'submitted' })
    .populate('userId', 'name email avatar')
    .select('userId score accuracy durationSec submittedAt startedAt')
    .lean();
  const best = new Map();
  for (const a of attempts) {
    const uid = String(a.userId?._id || a.userId);
    const cur = best.get(uid);
    // 用时回填：新记录一定有 durationSec；老记录可能 0/缺失，用 submittedAt-startedAt 补算
    const dur = normalizeDuration(a);
    // 比较用排序键：未知(null)视为无穷大，同分时排在已知用时之后
    const sortKey = (d) => (d == null ? Number.MAX_SAFE_INTEGER : d);
    const curDur = cur?.durationSec ?? null;
    if (
      !cur ||
      (a.score || 0) > (cur.score || 0) ||
      ((a.score || 0) === (cur.score || 0) && sortKey(dur) < sortKey(curDur)) ||
      ((a.score || 0) === (cur.score || 0) && sortKey(dur) === sortKey(curDur) && new Date(a.submittedAt) < new Date(cur.submittedAt))
    ) {
      best.set(uid, {
        userId: uid,
        name: a.userId?.name || '未命名',
        avatar: a.userId?.avatar || '',
        email: a.userId?.email || '',
        score: a.score || 0,
        accuracy: a.accuracy || 0,
        durationSec: dur,
        submittedAt: a.submittedAt,
      });
    }
  }
  const rows = [...best.values()].sort(
    (x, y) =>
      y.score - x.score ||
      (x.durationSec == null ? Number.MAX_SAFE_INTEGER : x.durationSec) -
        (y.durationSec == null ? Number.MAX_SAFE_INTEGER : y.durationSec) ||
      new Date(x.submittedAt) - new Date(y.submittedAt)
  );
  // 分数+用时都相同才并列同名次（1,2,2,4 跳号），否则按序排名（未知用时之间 null===null 可并列）
  let prev = null;
  let prevRank = 0;
  rows.forEach((r, i) => {
    if (prev && r.score === prev.score && (r.durationSec ?? null) === (prev.durationSec ?? null)) r.rank = prevRank;
    else { r.rank = i + 1; prev = r; prevRank = r.rank; }
  });
  return rows;
}

/**
 * 用时归一化：返回秒数（>=1 的整数）或 null（未知）。
 * - durationSec 有效（>0）→ 直接用
 * - 0/缺失 → 用 submittedAt-startedAt（或 createdAt）回填补算
 * - 都算不出 → null（未知），前端显示 "--"
 */
function normalizeDuration(a) {
  // Prefer the persisted duration. It is server-generated for new attempts
  // and may contain an explicit administrator correction for legacy data.
  const raw = Number(a?.durationSec);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  const end = a?.submittedAt ? new Date(a.submittedAt).getTime() : 0;
  const start = (a?.startedAt ? new Date(a.startedAt).getTime() : 0) || (a?.createdAt ? new Date(a.createdAt).getTime() : 0);
  if (end > 0 && start > 0 && end >= start) {
    const sec = Math.floor((end - start) / 1000);
    if (sec > 0) return sec;
  }
  return null;
}

/** 教师创建模拟考试（含作业）：POST /api/exams/teacher
 * selectMode: random 随机 / chapter 按章节 / sequence 顺序范围（start～end，按 canonical 题库顺序取，不随机）
 * shuffleItems=true：落盘保持抽题原序，学员拉详情时按"本人稳定种子"独立打乱（每人顺序不同、防窥屏）。
 * 草稿/发布语义：status=draft 只保存不通知；status=published（默认）才触发学生邮件通知。
 * 前端“保存草稿”传 status=draft，“发布考试”传 published（或调 PUT /:id/status 发布）。
 * 重复发布不重发：enqueue 内部按 examId+studentId 占位幂等。
 */
router.post('/teacher', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const {
      title,
      desc = '',
      classId,
      selectMode = 'random',
      chapterRules = [],
      totalCount = 50,
      sequenceRange = null,
      durationMin = 90,
      deadlineAt = null,
      scope = 'exam',
      allowRedo = true,
      shuffleItems = false,
      status = 'published',
    } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写标题' });
    if (!['draft', 'published'].includes(status)) return res.status(400).json({ error: '状态非法' });
    if (!['random', 'chapter', 'sequence'].includes(selectMode)) return res.status(400).json({ error: '组卷方式非法' });
    if (classId && !isObjectId(String(classId))) return res.status(404).json({ error: '班级不存在' });
    const dl = validDeadline(deadlineAt);
    if (typeof dl === 'string') return res.status(400).json({ error: dl });
    const cleanRules = (Array.isArray(chapterRules) ? chapterRules : [])
      .filter((r) => r && isObjectId(String(r.chapterId)) && Number(r.count) > 0)
      .map((r) => ({ chapterId: String(r.chapterId), count: Math.min(500, Math.floor(Number(r.count))) }));
    let cls = null;
    if (classId) {
      cls = await ClassModel.findById(classId);
      if (!cls) return res.status(404).json({ error: '班级不存在' });
      if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
        return res.status(403).json({ error: '只能给自己的班级布置考试' });
      }
    }
    let items;
    try {
      items = await buildItems({ selectMode, chapterRules: cleanRules, totalCount, sequenceRange });
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message || '组卷失败' });
    }
    if (!items.length) return res.status(400).json({ error: '题库暂无符合条件的题目' });
    const dm = validDurationMin(durationMin) || 90;
    const exam = await Exam.create({
      title: String(title).trim().slice(0, 60),
      desc: String(desc || '').slice(0, 500),
      kind: 'teacher',
      scope: scope === 'homework' ? 'homework' : 'exam',
      status,
      classId: cls?._id || null,
      createdBy: req.user._id,
      selectMode,
      chapterRules: cleanRules,
      sequenceRange: selectMode === 'sequence' && sequenceRange
        ? { start: Number(sequenceRange.start), end: Number(sequenceRange.end) }
        : undefined,
      totalCount: items.length,
      durationMin: dm,
      deadlineAt: dl,
      allowRedo: allowRedo !== false,
      shuffleItems: shuffleItems === true,
      shareToken: genToken(),
      items,
    });
    // 草稿不发邮件：教师创建即 published，直接发布并后台通知（接口立即返回，不等邮件）
    let mailQueued = false;
    if (status === 'published') {
      emitExamPublished(exam);
      const { enqueuePublishedNotifications } = await import('../examNotify.js');
      enqueuePublishedNotifications(exam._id).catch((e) => console.error('[exam-mail]', e.message));
      mailQueued = true;
    }
    res.json({ exam: { ...toListItem(exam.toObject()), shareToken: exam.shareToken }, mailQueued });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建失败' });
  }
});

/** 教师：结束/删除自己班级的考试 */
router.put('/:id/status', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    if (req.user.role === 'teacher') {
      if (exam.kind !== 'teacher' || (exam.classId && String(req.user.classId) !== String(exam.classId) && String(exam.createdBy) !== String(req.user._id))) {
        // 允许操作自己创建的教师卷
        if (String(exam.createdBy) !== String(req.user._id)) return res.status(403).json({ error: '权限不足' });
      }
    }
    const { status } = req.body || {};
    if (!['published', 'ended'].includes(status)) return res.status(400).json({ error: '状态非法' });
    const wasDraft = exam.status === 'draft';
    exam.status = status;
    await exam.save();
    if (status === 'ended') emitExamChanged(exam, 'ended');
    // 草稿→发布：触发一次学生通知（占位幂等，重复点发布不重发）
    let mailQueued = false;
    if (wasDraft && status === 'published') {
      emitExamPublished(exam);
      const { enqueuePublishedNotifications } = await import('../examNotify.js');
      enqueuePublishedNotifications(exam._id).catch((e) => console.error('[exam-mail]', e.message));
      mailQueued = true;
    }
    res.json({ ok: true, mailQueued });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

router.delete('/teacher/:id', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: '试卷不存在' });
    if (req.user.role === 'teacher' && String(exam.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ error: '只能删除自己创建的考试' });
    }
    await ExamAttempt.deleteMany({ examId: exam._id });
    await exam.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

export default router;
