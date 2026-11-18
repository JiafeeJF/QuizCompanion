import { Router } from 'express';
import { Chapter } from '../models/Chapter.js';
import { Question } from '../models/Question.js';
import { authRequired } from '../auth.js';

const router = Router();

/** GET /api/chapters 章节列表（含每章题数），与 /api/questions 配套 */
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

export default router;
