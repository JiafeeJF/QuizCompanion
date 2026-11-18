
import { User } from './models/User.js';
import { sendMail, buildMemberExpiringMail } from './email.js';
import { AppSetting } from './models/AppSetting.js';
async function flag(key, defVal) {
  try { const d = await AppSetting.findOne({ key }).lean(); if (!d) return defVal; return String(d.value) !== 'off'; }
  catch { return defVal; }
}
export function startMemberCron() {
  const run = async () => {
    try {
      if (!(await flag('mail_member_expiring', true))) return;
      const now = new Date(); const in3d = new Date(now.getTime() + 3 * 864e5); const in2d = new Date(now.getTime() + 2 * 864e5);
      const users = await User.find({ isMember: true, memberExpireAt: { $gte: in2d, $lte: in3d }, status: 'active' }).select('email name memberExpireAt mailExpiringSentAt').lean();
      for (const u of users) {
        if (u.mailExpiringSentAt && new Date(u.mailExpiringSentAt).getTime() > now.getTime() - 7 * 864e5) continue;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email || '')) continue;
        const { subject, text, html } = buildMemberExpiringMail({ name: u.name, expireAt: u.memberExpireAt });
        const r = await sendMail({ to: u.email, subject, text, html });
        if (!r?.failed) await User.updateOne({ _id: u._id }, { $set: { mailExpiringSentAt: new Date() } });
      }
    } catch (e) { console.error('[member-cron]', e.message); }
  };
  setTimeout(run, 20 * 1000);
  const t = setInterval(run, 6 * 3600 * 1000); t.unref?.();
}
