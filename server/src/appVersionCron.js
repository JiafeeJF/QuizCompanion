import { AppVersion } from './models/AppVersion.js';
import { emitVersionNew } from './realtime.js';

const INTERVAL_MS = 30 * 1000;
let timer = null;

async function sweep(reason) {
  try {
    const now = new Date();
    const due = await AppVersion.find({
      latest: false,
      publishAt: { $ne: null, $lte: now },
      publishedAt: null,
    }).sort({ publishAt: 1 }).limit(20).lean();
    for (const item of due) {
      const claimed = await AppVersion.findOneAndUpdate(
        { _id: item._id, latest: false, publishedAt: null },
        { $set: { latest: true, publishedAt: now } },
        { new: true },
      ).lean();
      if (!claimed) continue;
      await AppVersion.updateMany({ _id: { $ne: claimed._id }, latest: true }, { $set: { latest: false } });
      emitVersionNew(claimed);
      console.log(`[app-version-cron] ${reason}: v${claimed.version} 已发布`);
    }
  } catch (e) {
    console.error('[app-version-cron]', e.message);
  }
}

export function startAppVersionCron() {
  if (timer) return;
  setTimeout(() => sweep('startup'), 5 * 1000);
  timer = setInterval(() => sweep('tick'), INTERVAL_MS);
  timer.unref?.();
}
