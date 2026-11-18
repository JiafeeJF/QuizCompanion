import { Announcement } from './models/Announcement.js';
import { emitAnnouncementNew } from './realtime.js';

const INTERVAL_MS = 30 * 1000;
let timer = null;

async function sweep(reason) {
  try {
    const now = new Date();
    const due = await Announcement.find({
      status: 'active',
      effectiveAt: { $ne: null, $lte: now },
      publishedAt: null,
    }).sort({ effectiveAt: 1 }).limit(100).lean();
    let count = 0;
    for (const item of due) {
      const claimed = await Announcement.updateOne(
        { _id: item._id, publishedAt: null },
        { $set: { publishedAt: now } },
      );
      if (claimed.modifiedCount) {
        emitAnnouncementNew({ ...item, publishedAt: now });
        count += 1;
      }
    }
    if (count) console.log(`[announcement-cron] ${reason}: ${count} 条公告到时发布`);
  } catch (e) {
    console.error('[announcement-cron]', e.message);
  }
}

export function startAnnouncementCron() {
  if (timer) return;
  setTimeout(() => sweep('startup'), 5 * 1000);
  timer = setInterval(() => sweep('tick'), INTERVAL_MS);
  timer.unref?.();
}
