import { Exam } from './models/Exam.js';
import { sendSummaryOnce, enqueueDeadlineReminders } from './examNotify.js';

/**
 * 截止总结定时任务：每 60s 扫一次已过 deadline 且未总结的教师卷。
 * - 查询极轻：kind=teacher + deadlineAt<now + status!=ended，按 deadlineAt 索引走
 * - 幂等：sendSummaryOnce 内部 examId+type 占位抢锁；重启后补发靠同一机制（查库不靠内存）
 * - 不删改 Attempt：doing 超期按现有 submit/start 的 deadline 检查自然拒绝（复用，不重实现）
 */
const INTERVAL_MS = 60 * 1000;
let timer = null;

async function sweep(reason) {
  try {
    const now = new Date();
    const due = await Exam.find({
      kind: 'teacher',
      status: { $ne: 'ended' },
      deadlineAt: { $ne: null, $lt: now },
      $or: [{ summaryStatus: { $exists: false } }, { summaryStatus: { $in: ['none', 'pending', 'failed'] } }],
    }).select('_id deadlineAt summaryStatus').lean();
    for (const e of due) {
      try { await enqueueDeadlineReminders(e._id); } catch (err) { console.error('[exam-cron] 截止提醒失败:', err.message); }
      try {
        await sendSummaryOnce(e._id, reason);
      } catch (err) {
        console.error('[exam-cron] 总结失败:', String(e._id), err.message);
      }
    }
    if (due.length) console.log(`[exam-cron] 截止扫描 ${reason}: ${due.length} 场已处理`);
  } catch (e) {
    console.error('[exam-cron]', e.message);
  }
}

export function startExamSummaryCron() {
  if (timer) return;
  // 启动 10s 后先扫一次（重启补发），之后每 60s
  setTimeout(() => sweep('startup'), 10 * 1000);
  timer = setInterval(() => sweep('tick'), INTERVAL_MS);
  timer.unref?.();
}
