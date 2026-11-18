import { Router } from 'express';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { authRequired, requireSelfMember } from '../auth.js';

const router = Router();

/** GET /api/chapters 章节列表（含每章题数） */
router.get('/', authRequired, async (req, res) => {
  try {
    const chapters = await Chapter.find({ enabled: true }).sort({ sort: 1, name: 1 }).lean();
    const counts = await Question.aggregate([
      { $match: { enabled: true } },
      { $group: { _id: '$chapterId', count: { $sum: 1 } } },
    ]);
    const map = new Map(counts.map((c) => [String(c._id), c.count]));
    res.json({
      chapters: chapters.map((c) => ({ ...c, questionCount: map.get(String(c._id)) || 0 })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取章节失败' });
  }
});

/** GET /api/questions/count/summary 题库总量（首页展示） */
router.get('/count/summary', authRequired, async (req, res) => {
  try {
    const total = await Question.countDocuments({ enabled: true });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/questions/list 拉题（学员端刷题用）
 * 免费学生自主拉题只开放：order 且不带 chapterId/type/skip 抽题参数（纯顺序续读由会话走）；
 * random / chapterId / type / skip(指定起始题号) 自主调用全部会员专属。
 * 教师任务不经过本接口（任务题序建会话时一次落盘），恢复走 sessions/:id，无会员门。
 */
router.get('/list', authRequired, async (req, res) => {
  try {
    const { chapterId, mode = 'order', limit = 20, skip = 0, type } = req.query;
    const hasExtractParam = !!(chapterId || type || (skip != null && Number(skip) > 0));
    if (mode !== 'order' || hasExtractParam) {
      const gate = requireSelfMember(req);
      if (!gate.ok) return res.status(403).json({ error: gate.error });
    }
    const filter = { enabled: true };
    if (chapterId) filter.chapterId = chapterId;
    if (type) filter.type = type;
    const lim = Math.max(1, Math.min(100, Number(limit) || 20));
    let list;
    if (mode === 'random') {
      const pipeline = [{ $match: filter }, { $sample: { size: lim } }];
      list = await Question.aggregate(pipeline);
    } else {
      const sk = Math.max(0, Number(skip) || 0);
      list = await Question.find(filter).sort({ _id: 1 }).skip(sk).limit(lim).lean();
    }
    res.json({ questions: list, hasMore: mode === 'order' ? list.length === lim : false });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取题目失败' });
  }
});

/** GET /api/questions/:id 单题详情（含答案解析，用于错题本/收藏/交卷后） */
router.get('/:id', authRequired, async (req, res) => {
  try {
    if (req.params.id === 'list' || req.params.id === 'count') {
      return res.status(404).json({ error: '接口不存在' });
    }
    const q = await Question.findById(req.params.id).lean();
    if (!q || !q.enabled) return res.status(404).json({ error: '题目不存在' });
    res.json({ question: q });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取题目失败' });
  }
});

/** GET /api/questions/count/summary 题库总量（首页展示） */
router.get('/count/summary', authRequired, async (req, res) => {
  try {
    const total = await Question.countDocuments({ enabled: true });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

export default router;
