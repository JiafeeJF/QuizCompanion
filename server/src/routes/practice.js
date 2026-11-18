import { Router } from 'express';
import * as XLSX from 'xlsx';
import { Question } from '../models/Question.js';
import { Favorite, PracticeRecord, PracticeSession, WrongBook } from '../models/Practice.js';
import { authRequired, isMember } from '../auth.js';
import { gradeAnswer } from '../utils.js';

const router = Router();

const exportTypeName = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };

function formatExportAnswer(question, answer, textAnswer = '') {
  if (question.type === 'single' || question.type === 'judge') {
    return answer === null || answer === undefined ? '' : ('ABCDEFG'[Number(answer)] || String(answer));
  }
  if (question.type === 'multiple') {
    return Array.isArray(answer) ? answer.map((i) => 'ABCDEFG'[Number(i)] || String(i)).join('') : '';
  }
  return String(answer ?? textAnswer ?? '');
}

async function getWrongExportRows(userId) {
  const list = await WrongBook.find({ userId, mastered: false })
    .populate('questionId')
    .populate('chapterId', 'name')
    .sort({ updatedAt: -1 })
    .lean();

  return list.flatMap((wrong, index) => {
    const question = wrong.questionId;
    if (!question) return [];
    return [{
      '序号': index + 1,
      '章节': wrong.chapterId?.name || '',
      '题型': exportTypeName[question.type] || question.type,
      '题干': question.stem || '',
      '选项': (question.options || []).map((option, i) => `${'ABCDEFG'[i]}.${option}`).join('\n'),
      '我的错误答案': formatExportAnswer(question, wrong.lastAnswer),
      '正确答案': formatExportAnswer(question, question.answer, question.textAnswer),
      '解析': question.analysis || '',
      '错误次数': wrong.count || 0,
    }];
  });
}

/**
 * POST /api/practice/answer { questionId, answer, mode, sessionId? }
 * 判分 + 写练习记录 + 答错自动入错题本
 * 权限：带教师任务会话（source=teacher，按库里落盘判定）直行，不限会员；
 * 无会话的散刷（旧直链）/自主会话按 mode 走会员门：order 免费，random/chapter 会员专属。
 */
router.post('/answer', authRequired, async (req, res) => {
  try {
    const { questionId, answer, mode = 'order', sessionId = null } = req.body || {};
    const q = await Question.findById(questionId);
    if (!q || !q.enabled) return res.status(404).json({ error: '题目不存在' });
    // 会话归属校验：带 sessionId 时必须是本人的会话，否则拒绝写入
    let session = null;
    if (sessionId) {
      const { PracticeSession: PS } = await import('../models/Practice.js');
      if (!String(sessionId).match(/^[0-9a-fA-F]{24}$/)) return res.status(400).json({ error: '会话非法' });
      session = await PS.findById(sessionId);
      if (!session) return res.status(404).json({ error: '刷题会话不存在' });
      if (String(session.userId) !== String(req.user._id)) return res.status(403).json({ error: '无权访问该刷题记录' });
      if (session.source !== 'teacher' && mode !== 'order' && session.mode !== 'order') {
        if (!isMember(req.user) && req.user.role !== 'teacher' && req.user.role !== 'admin') {
          return res.status(403).json({ error: '该功能为会员专属功能' });
        }
      }
    } else if (mode !== 'order') {
      // 无会话散刷 + 非顺序：学生自主高级刷题，会员专属
      if (!isMember(req.user) && req.user.role !== 'teacher' && req.user.role !== 'admin') {
        return res.status(403).json({ error: '该功能为会员专属功能' });
      }
    }
    const autoGraded = ['single', 'multiple', 'judge'].includes(q.type);
    const correct = autoGraded ? gradeAnswer(q, answer) : null;
    const result = correct === null ? 'correct' : correct ? 'correct' : 'wrong';
    await PracticeRecord.create({
      userId: req.user._id,
      questionId: q._id,
      chapterId: q.chapterId,
      mode,
      result,
      userAnswer: answer ?? null,
      sessionId: session ? session._id : null,
    });
    if (correct === false) {
      await WrongBook.findOneAndUpdate(
        { userId: req.user._id, questionId: q._id },
        {
          $set: { chapterId: q.chapterId, lastAnswer: answer ?? null, mastered: false },
          $inc: { count: 1 },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    res.json({
      correct,
      autoGraded,
      answer: q.answer,
      textAnswer: q.textAnswer,
      // 解析已下线：不再下发 analysis
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '判分失败' });
  }
});

/** GET /api/practice/stats 我的学习进度 */
router.get('/stats', authRequired, async (req, res) => {
  try {
    const userId = req.user._id;
    const [totalQ, doneAgg, accAgg, wrongCount, favCount] = await Promise.all([
      Question.countDocuments({ enabled: true }),
      PracticeRecord.aggregate([
        { $match: { userId } },
        { $group: { _id: '$questionId' } },
        { $count: 'n' },
      ]),
      PracticeRecord.aggregate([
        { $match: { userId } },
        { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: [{ $eq: ['$result', 'correct'] }, 1, 0] } } } },
      ]),
      WrongBook.countDocuments({ userId, mastered: false }),
      Favorite.countDocuments({ userId }),
    ]);
    const done = doneAgg[0]?.n || 0;
    const total = accAgg[0]?.total || 0;
    const correct = accAgg[0]?.correct || 0;
    res.json({
      totalQuestions: totalQ,
      doneQuestions: done,
      doneRate: totalQ ? Math.round((done / totalQ) * 100) : 0,
      answerCount: total,
      accuracy: total ? Math.round((correct / total) * 100) : 0,
      wrongCount,
      favoriteCount: favCount,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取进度失败' });
  }
});

/** GET /api/practice/chapter-stats 各章节进度：只统计章节模式答题（mode=chapter），
 * 顺序/随机刷题经过该章题目不再计入，避免“没练该章但进度上涨” */
router.get('/chapter-stats', authRequired, async (req, res) => {
  try {
    const rows = await PracticeRecord.aggregate([
      { $match: { userId: req.user._id, mode: 'chapter' } },
      {
        $group: {
          _id: '$chapterId',
          total: { $sum: 1 },
          correct: { $sum: { $cond: [{ $eq: ['$result', 'correct'] }, 1, 0] } },
        },
      },
    ]);
    res.json({
      stats: rows.map((r) => ({
        chapterId: r._id,
        total: r.total,
        correct: r.correct,
        accuracy: r.total ? Math.round((r.correct / r.total) * 100) : 0,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/practice/last 继续练习：最近一次练习的章节+位置 */
router.get('/last', authRequired, async (req, res) => {
  try {
    const last = await PracticeRecord.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('chapterId', 'name')
      .lean();
    res.json({ last });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

// ---------- 错题本（practiceRouter 挂载于 /api 与 /api/practice，相对路径写法） ----------
/** GET /wrongs?chapterId=&page=&pageSize= */
router.get('/wrongs', authRequired, async (req, res) => {
  try {
    const { chapterId, page = 1, pageSize = 20 } = req.query;
    const filter = { userId: req.user._id, mastered: false };
    if (chapterId) filter.chapterId = chapterId;
    const pg = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const [total, list] = await Promise.all([
      WrongBook.countDocuments(filter),
      WrongBook.find(filter)
        .sort({ updatedAt: -1 })
        .skip((pg - 1) * ps)
        .limit(ps)
        .populate('questionId')
        .populate('chapterId', 'name')
        .lean(),
    ]);
    res.json({ total, page: pg, pageSize: ps, list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取错题本失败' });
  }
});

/** DELETE /wrongs/:questionId 移除错题（掌握了） */
router.delete('/wrongs/:questionId', authRequired, async (req, res) => {
  try {
    await WrongBook.findOneAndDelete({ userId: req.user._id, questionId: req.params.questionId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

/** PUT /wrongs/:questionId/master 标记已掌握 */
router.put('/wrongs/:questionId/master', authRequired, async (req, res) => {
  try {
    await WrongBook.findOneAndUpdate(
      { userId: req.user._id, questionId: req.params.questionId },
      { $set: { mastered: true } }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

/** GET /wrongs/export 导出错题（会员） -> CSV 文本下载 */
router.get('/wrongs/export', authRequired, async (req, res) => {
  try {
    if (!isMember(req.user)) return res.status(403).json({ error: '导出错题为会员功能' });
    const list = await WrongBook.find({ userId: req.user._id, mastered: false })
      .populate('questionId')
      .populate('chapterId', 'name')
      .lean();
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const typeName = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };
    const lines = ['章节,题型,题干,选项,正确答案,错误次数'];
    for (const w of list) {
      const q = w.questionId;
      if (!q) continue;
      const opts = (q.options || []).map((o, i) => `${'ABCDEFG'[i]}.${o}`).join(' | ');
      let ans = '';
      if (q.type === 'single' || q.type === 'judge') ans = 'ABCDEFG'[Number(q.answer)] || q.answer;
      else if (q.type === 'multiple') ans = (q.answer || []).map((i) => 'ABCDEFG'[i]).join('');
      else ans = q.textAnswer || '';
      lines.push(
        [w.chapterId?.name || '', typeName[q.type] || q.type, q.stem, opts, ans, w.count]
          .map(esc)
          .join(',')
      );
    }
    const csv = '\uFEFF' + lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wrong-book.csv"');
    res.send(csv);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '导出失败' });
  }
});

/** GET /wrongs/export.xlsx 导出错题（会员） -> Excel 工作簿 */
router.get('/wrongs/export.xlsx', authRequired, async (req, res) => {
  try {
    if (!isMember(req.user)) return res.status(403).json({ error: '导出错题为会员功能' });
    const rows = await getWrongExportRows(req.user._id);
    const headers = ['序号', '章节', '题型', '题干', '选项', '我的错误答案', '正确答案', '解析', '错误次数'];
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = [
      { wch: 7 }, { wch: 18 }, { wch: 10 }, { wch: 48 }, { wch: 42 },
      { wch: 18 }, { wch: 18 }, { wch: 42 }, { wch: 10 },
    ];
    sheet['!autofilter'] = { ref: `A1:I${Math.max(rows.length + 1, 1)}` };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '错题本');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="wrong-book.xlsx"');
    res.send(buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '导出失败' });
  }
});

// ---------- 收藏 ----------
// 注意：同一 router 挂载于 /api 与 /api/practice，相对路径自动适配两种前缀。
// 顺序保证 /favorites/check 先于 /:questionId 通配，避免 check 被误捕获。
/** GET /favorites/check?ids=a,b 批量查收藏状态（刷题页用） */
router.get('/favorites/check', authRequired, async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    const rows = await Favorite.find({ userId: req.user._id, questionId: { $in: ids } })
      .select('questionId')
      .lean();
    res.json({ favorited: rows.map((r) => String(r.questionId)) });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /favorites 收藏列表 */
router.get('/favorites', authRequired, async (req, res) => {
  try {
    const { chapterId, page = 1, pageSize = 20 } = req.query;
    const filter = { userId: req.user._id };
    if (chapterId) filter.chapterId = chapterId;
    const pg = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(100, Number(pageSize) || 20));
    const [total, list] = await Promise.all([
      Favorite.countDocuments(filter),
      Favorite.find(filter)
        .sort({ createdAt: -1 })
        .skip((pg - 1) * ps)
        .limit(ps)
        .populate('questionId')
        .populate('chapterId', 'name')
        .lean(),
    ]);
    res.json({ total, page: pg, pageSize: ps, list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取收藏失败' });
  }
});

/** POST /favorites { questionId } 收藏 */
router.post('/favorites', authRequired, async (req, res) => {
  try {
    const { questionId } = req.body || {};
    const q = await Question.findById(questionId);
    if (!q) return res.status(404).json({ error: '题目不存在' });
    await Favorite.findOneAndUpdate(
      { userId: req.user._id, questionId },
      { $set: { chapterId: q.chapterId } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '收藏失败' });
  }
});

/** DELETE /favorites/:questionId 取消收藏 */
router.delete('/favorites/:questionId', authRequired, async (req, res) => {
  try {
    await Favorite.findOneAndDelete({ userId: req.user._id, questionId: req.params.questionId });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

export default router;
