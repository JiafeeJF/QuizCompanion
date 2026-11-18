import { Question } from './models/Question.js';
import { Chapter } from './models/Chapter.js';

/**
 * 题库顺序抽题的 canonical 排序（与学员端实际看到的顺序一致）。
 *
 * 调查结论（2026-09）：
 * - 学员端顺序刷题 `GET /api/questions/list?mode=order`：`{ enabled:true }` + sort `{ _id:1 }`
 * - 刷题会话 order/range 建会话：同样 `{ enabled:true }` + sort `{ _id:1 }` + skip/limit
 * - 管理后台 `GET /api/admin/questions`：sort `{ createdAt:-1 }`，是管理视角（最新在前），不是学员题号
 * - Question 模型本身没有 sort/序号字段，`_id`（ObjectId 含时间戳）即创建顺序，也就是当前真实的学员侧顺序
 *
 * 所以「第 N 题」= 全库 `enabled=true` 按 `_id:1` 排序后的第 N 个。disabled 题目先过滤，不占号。
 * 以后若给 Question 加 sort 字段，只改这里一处（SORT/aggregate stage），所有顺序抽题自动跟随。
 */
export const QUESTION_ORDER = { _id: 1 };

export const SEQUENCE_MAX = 500;

export function validateSequenceRange(start, end, total) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e)) return '开始题号和结束题号必须为整数';
  if (s < 1) return '开始题号不能小于 1';
  if (e < s) return '结束题号不能小于开始题号';
  if (e > total) return `当前题库共有 ${total} 道有效题，结束题号不能超过 ${total}。`;
  if (e - s + 1 > SEQUENCE_MAX) return `单次顺序抽题最多 ${SEQUENCE_MAX} 题`;
  return null;
}

export async function getEnabledQuestionCount() {
  return Question.countDocuments({ enabled: true });
}

/** 按 canonical 顺序取第 start～end 题（1-based，含两端），只返回精简字段 */
export async function getSequenceSlice(start, end) {
  const s = Number(start);
  const e = Number(end);
  return Question.find({ enabled: true })
    .sort(QUESTION_ORDER)
    .skip(s - 1)
    .limit(e - s + 1)
    .select('_id chapterId type stem options answer textAnswer score')
    .lean();
}

/** 范围预览：总数 + 范围内章节分布（不下发答案，只给组卷 UI 做辅助展示） */
export async function getSequenceRangeInfo(start, end) {
  const total = await getEnabledQuestionCount();
  const err = validateSequenceRange(start, end, total);
  if (err) return { total, error: err };
  const slice = await Question.find({ enabled: true })
    .sort(QUESTION_ORDER)
    .skip(Number(start) - 1)
    .limit(Number(end) - Number(start) + 1)
    .select('_id chapterId')
    .lean();
  const counts = new Map();
  for (const q of slice) {
    const k = String(q.chapterId || 'none');
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const chapters = await Chapter.find({ _id: { $in: [...counts.keys()].filter((k) => k !== 'none') } })
    .select('name')
    .lean();
  const nameMap = new Map(chapters.map((c) => [String(c._id), c.name]));
  return {
    total,
    start: Number(start),
    end: Number(end),
    count: slice.length,
    chapters: [...counts.entries()].map(([id, count]) => ({
      chapterId: id === 'none' ? null : id,
      name: id === 'none' ? '未归类' : nameMap.get(id) || '未知章节',
      count,
    })),
  };
}
