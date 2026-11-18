import { Router } from 'express';
import { authRequired, requireRole } from '../auth.js';
import { getMaintenance, setMaintenance, regenerateMaintenanceAccess } from '../models/AppSetting.js';
import { emitMaintenanceChanged } from '../realtime.js';
import { Announcement } from '../models/Announcement.js';

const router = Router();

router.get('/maintenance', async (req, res) => {
  try {
    const { accessId, ...publicState } = await getMaintenance();
    res.json(publicState);
  } catch {
    res.status(500).json({ error: '获取系统状态失败' });
  }
});

router.get('/maintenance/admin', authRequired, requireRole('admin'), async (req, res) => {
  res.json(await getMaintenance());
});

router.post('/maintenance/access/regenerate', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const state = await regenerateMaintenanceAccess();
    res.json(state);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/maintenance-access/:accessId', async (req, res) => {
  const state = await getMaintenance();
  if (!state.enabled || !state.accessId || state.accessId !== req.params.accessId) return res.status(404).json({ error: '入口不存在' });
  res.json({ ok: true });
});

router.get('/announcements', async (req, res) => {
  try {
    const now = new Date();
    const announcements = await Announcement.find({
      status: 'active',
      $and: [
        { $or: [{ effectiveAt: null }, { effectiveAt: { $lte: now } }] },
        { $or: [{ staleAt: null }, { staleAt: { $gt: now } }] },
      ],
    }).sort({ priority: -1, createdAt: -1 }).limit(50).select('title content createdAt priority').lean();
    res.json({ announcements });
  } catch {
    res.status(500).json({ error: '获取公告失败' });
  }
});

router.put('/maintenance', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const patch = req.body || {};
    const state = await setMaintenance(patch);
    // 文案/预计时间保存不改变维护状态，也不触发踢出/恢复事件；只有开关操作才广播。
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) emitMaintenanceChanged(state);
    res.json(state);
  } catch {
    res.status(400).json({ error: '维护设置保存失败' });
  }
});

export default router;
