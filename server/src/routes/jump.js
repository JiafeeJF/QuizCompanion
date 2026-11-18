import { Router } from 'express';
import { Exam } from '../models/Exam.js';
import { isObjectId } from '../validate.js';
import { rateLimit } from '../security.js';

const router = Router();

/**
 * 跳板页链接有效性校验（公开，无需登录，防跳板页被刷）：
 * GET /api/jump/resolve?type=exam&param=<考试ID>
 * GET /api/jump/resolve?type=share&param=<分享码>
 *
 * 状态机（只读，不删数据不改状态）：
 * - ok: 链接有效 → { web: '/exams/:id' 或 '/share/:token' }
 * - expired: 考试已截止/已结束（ended 或 deadlineAt 已过）
 * - gone: 试卷不存在/已删除/未发布（含分享码失效）
 */
const resolveLimit = rateLimit({ scope: 'jump-resolve', windowMs: 60 * 1000, max: 120, message: '请求过于频繁' });
router.get('/resolve', resolveLimit, async (req, res) => {
  try {
    const type = String(req.query.type || '');
    const param = String(req.query.param || '');
    if (!['exam', 'share'].includes(type)) return res.status(400).json({ status: 'gone', reason: '链接类型错误' });
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(param)) return res.status(400).json({ status: 'gone', reason: '链接参数错误' });

    let exam = null;
    if (type === 'exam') {
      if (!isObjectId(param)) return res.json({ status: 'gone', reason: '考试不存在或已被删除' });
      exam = await Exam.findById(param).select('status deadlineAt title kind').lean();
      if (!exam) return res.json({ status: 'gone', reason: '考试不存在或已被删除' });
      // 草稿/非 published 视为不可用（学生点开也不该进）
      if (exam.status !== 'published') {
        if (exam.status === 'ended') return res.json({ status: 'expired', reason: '考试已结束', title: exam.title });
        return res.json({ status: 'gone', reason: '考试不存在或已被删除' });
      }
      if (exam.deadlineAt && new Date(exam.deadlineAt) < new Date()) {
        return res.json({ status: 'expired', reason: '考试已截止', title: exam.title });
      }
      return res.json({ status: 'ok', web: `/exams/${exam._id}`, title: exam.title });
    }

    // share：分享码只在试卷 published 时有效；ended/截止后分享入口同样 404（与 /api/exams/share/:token 口径一致）
    exam = await Exam.findOne({ shareToken: param }).select('status deadlineAt title').lean();
    if (!exam || exam.status !== 'published') {
      if (exam && exam.status === 'ended') return res.json({ status: 'expired', reason: '分享的考试已结束', title: exam.title });
      if (exam && exam.deadlineAt && new Date(exam.deadlineAt) < new Date()) {
        return res.json({ status: 'expired', reason: '分享的考试已截止', title: exam.title });
      }
      return res.json({ status: 'gone', reason: '分享不存在或已被删除' });
    }
    return res.json({ status: 'ok', web: `/share/${param}`, title: exam.title });
  } catch {
    res.status(500).json({ status: 'gone', reason: '校验失败，请稍后重试' });
  }
});

export default router;
