import { Router } from 'express';
import { Announcement, AnnouncementRead } from '../models/Announcement.js';
import { authRequired, requireRole } from '../auth.js';
import { isObjectId } from '../validate.js';
import { cleanText, sensitiveWriteLimit } from '../security.js';
import { emitAnnouncementNew, emitAnnouncementUpdated } from '../realtime.js';

const router = Router();
// 写操作防刷（发公告/标已读走敏感写口径）；纯查询不限
router.use(sensitiveWriteLimit);

const fmtDate = (v) => (v ? new Date(v) : null);

/** 当前时间窗下是否"活动中"（status=active 且在 [effectiveAt, staleAt] 内） */
function isLive(a, now = new Date()) {
  if (!a || a.status !== 'active') return false;
  if (a.effectiveAt && new Date(a.effectiveAt) > now) return false;
  if (a.staleAt && new Date(a.staleAt) <= now) return false;
  return true;
}

function toItem(a, read = false) {
  return {
    _id: a._id,
    title: a.title,
    content: a.content,
    status: a.status,
    priority: a.priority || 0,
    effectiveAt: a.effectiveAt || null,
    staleAt: a.staleAt || null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    read: !!read,
    // 后台展示用的人话状态：启用中 / 未开始 / 已过期 / 草稿 / 已停用
    liveState: liveStateOf(a),
  };
}

function liveStateOf(a) {
  const now = new Date();
  if (a.status === 'draft') return 'draft';
  if (a.status === 'closed') return 'closed';
  if (a.effectiveAt && new Date(a.effectiveAt) > now) return 'scheduled';
  if (a.staleAt && new Date(a.staleAt) <= now) return 'expired';
  return 'live';
}

/** 时间窗校验：staleAt 必须晚于 effectiveAt（两者都填时） */
function checkWindow(effectiveAt, staleAt) {
  if (effectiveAt && staleAt && new Date(staleAt) <= new Date(effectiveAt)) {
    return '过期时间必须晚于生效时间';
  }
  return '';
}

/** GET /api/announcements 学员：当前有效的公告列表（倒序：优先级→生效时间），附已读标记 */
router.get('/', authRequired, async (req, res) => {
  try {
    const now = new Date();
    const list = await Announcement.find({ status: 'active' })
      .sort({ priority: -1, effectiveAt: -1, createdAt: -1 })
      .limit(50)
      .lean();
    const live = list.filter((a) => isLive(a, now));
    const ids = live.map((a) => a._id);
    const reads = ids.length
      ? await AnnouncementRead.find({ announcementId: { $in: ids }, userId: req.user._id }).select('announcementId').lean()
      : [];
    const readSet = new Set(reads.map((r) => String(r.announcementId)));
    res.json({ announcements: live.map((a) => toItem(a, readSet.has(String(a._id)))), unread: live.filter((a) => !readSet.has(String(a._id))).length });
  } catch (e) {
    res.status(500).json({ error: '获取公告失败' });
  }
});

/** GET /api/announcements/:id 学员：单条详情（仅有效的；打开不自动标已读，由前端关闭/已看时调 read） */
router.get('/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '公告不存在' });
    const a = await Announcement.findById(req.params.id).lean();
    if (!a || !isLive(a)) return res.status(404).json({ error: '公告不存在' });
    const read = await AnnouncementRead.findOne({ announcementId: a._id, userId: req.user._id }).lean();
    res.json({ announcement: toItem(a, !!read) });
  } catch (e) {
    res.status(500).json({ error: '获取公告失败' });
  }
});

/** POST /api/announcements/:id/read 学员：标已读（幂等；关闭弹窗/看完详情时调） */
router.post('/:id/read', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '公告不存在' });
    const a = await Announcement.findById(req.params.id).lean();
    if (!a || !isLive(a)) return res.status(404).json({ error: '公告不存在' });
    await AnnouncementRead.updateOne(
      { announcementId: a._id, userId: req.user._id },
      { $setOnInsert: { readAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

/** GET /api/announcements/admin/list 后台：全量（含草稿/停用/过期），更新时间倒序 */
router.get('/admin/list', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const list = await Announcement.find({}).sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ announcements: list.map((a) => toItem(a)) });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** POST /api/announcements/admin 后台：新建（默认草稿，需手动启用才展示） */
router.post('/admin', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { title = '', content = '', status = 'draft', priority = 0, effectiveAt = null, staleAt = null } = req.body || {};
    const t = cleanText(title, 80);
    const c = String(content || '').replace(/[<>]/g, '').trim().slice(0, 5000);
    if (!t) return res.status(400).json({ error: '请填写标题' });
    if (!c) return res.status(400).json({ error: '请填写内容' });
    if (!['draft', 'active', 'closed'].includes(status)) return res.status(400).json({ error: '状态非法' });
    const eff = effectiveAt ? new Date(effectiveAt) : null;
    const sta = staleAt ? new Date(staleAt) : null;
    if ((effectiveAt && Number.isNaN(eff?.getTime())) || (staleAt && Number.isNaN(sta?.getTime()))) {
      return res.status(400).json({ error: '时间格式不正确' });
    }
    const wErr = eff && sta ? checkWindow(eff, sta) : '';
    if (wErr) return res.status(400).json({ error: wErr });
    const now = new Date();
    const a = await Announcement.create({
      title: t,
      content: c,
      status,
      priority: Math.max(-100, Math.min(100, Number(priority) || 0)),
      effectiveAt: eff,
      staleAt: sta,
      publishedAt: status === 'active' && (!eff || eff <= now) ? now : null,
      createdBy: req.user._id,
    });
    if (isLive(a, now)) emitAnnouncementNew(a);
    res.json({ announcement: toItem(a.toObject()) });
  } catch (e) {
    res.status(500).json({ error: '创建失败' });
  }
});

/** PUT /api/announcements/admin/:id 后台：编辑（标题/内容/状态/优先级/时间窗） */
router.put('/admin/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '公告不存在' });
    const { title, content, status, priority, effectiveAt, staleAt } = req.body || {};
    const a = await Announcement.findById(req.params.id);
    if (!a) return res.status(404).json({ error: '公告不存在' });
    const wasLive = isLive(a);
    if (title !== undefined) {
      const t = cleanText(title, 80);
      if (!t) return res.status(400).json({ error: '标题不能为空' });
      a.title = t;
    }
    if (content !== undefined) {
      const c = String(content || '').replace(/[<>]/g, '').trim().slice(0, 5000);
      if (!c) return res.status(400).json({ error: '内容不能为空' });
      a.content = c;
    }
    if (status !== undefined) {
      if (!['draft', 'active', 'closed'].includes(status)) return res.status(400).json({ error: '状态非法' });
      a.status = status;
    }
    if (priority !== undefined) a.priority = Math.max(-100, Math.min(100, Number(priority) || 0));
    if (effectiveAt !== undefined) {
      if (!effectiveAt) a.effectiveAt = null;
      else {
        const d = new Date(effectiveAt);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: '生效时间格式不正确' });
        a.effectiveAt = d;
      }
    }
    if (staleAt !== undefined) {
      if (!staleAt) a.staleAt = null;
      else {
        const d = new Date(staleAt);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: '过期时间格式不正确' });
        a.staleAt = d;
      }
    }
    const wErr = checkWindow(a.effectiveAt, a.staleAt);
    if (wErr) return res.status(400).json({ error: wErr });
    const now = new Date();
    if (a.status === 'active' && (!a.effectiveAt || new Date(a.effectiveAt) <= now)) {
      if (!a.publishedAt) a.publishedAt = now;
    } else {
      a.publishedAt = null;
    }
    await a.save();
    const live = isLive(a, now);
    if (!wasLive && live) emitAnnouncementNew(a);
    else if (wasLive) emitAnnouncementUpdated(a, 'updated');
    res.json({ announcement: toItem(a.toObject()) });
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

/** DELETE /api/announcements/admin/:id 后台：删除（含已读记录一并清理） */
router.delete('/admin/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '公告不存在' });
    const a = await Announcement.findById(req.params.id);
    if (!a) return res.status(404).json({ error: '公告不存在' });
    await AnnouncementRead.deleteMany({ announcementId: a._id });
    emitAnnouncementUpdated(a, 'deleted');
    await a.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

/** PUT /api/announcements/admin/:id/status 后台：一键启停（active/closed/draft 白名单） */
router.put('/admin/:id/status', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '公告不存在' });
    const { status } = req.body || {};
    if (!['draft', 'active', 'closed'].includes(status)) return res.status(400).json({ error: '状态非法' });
    const a = await Announcement.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).lean();
    if (!a) return res.status(404).json({ error: '公告不存在' });
    const now = new Date();
    if (status === 'active' && (!a.effectiveAt || new Date(a.effectiveAt) <= now) && !a.publishedAt) {
      await Announcement.updateOne({ _id: a._id, publishedAt: null }, { $set: { publishedAt: now } });
      a.publishedAt = now;
    }
    if (isLive(a, now)) emitAnnouncementNew(a);
    else if (status !== 'active' || !a.effectiveAt || new Date(a.effectiveAt) <= now) emitAnnouncementUpdated(a, 'updated');
    res.json({ announcement: toItem(a) });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

// fmtDate 保留给后续导出/审计用，避免 lint 未使用告警
void fmtDate;

export default router;
