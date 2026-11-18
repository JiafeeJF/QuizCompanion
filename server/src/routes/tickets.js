import { Router } from 'express';
import { Ticket, TICKET_STATUS } from '../models/Ticket.js';
import { getTicketNotifyEmails, setTicketNotifyEmailsRaw } from '../models/AppSetting.js';
import { authRequired, requireRole } from '../auth.js';
import { isObjectId } from '../validate.js';
import { cleanText, sensitiveWriteLimit } from '../security.js';
import { sendMail, buildTicketReplyMail } from '../email.js';
import { emitUserEvent } from '../realtime.js';

const router = Router();

const TYPE_NAME = { bug: 'Bug反馈', suggest: '功能建议', other: '其他' };
const VALID_TYPES = ['bug', 'suggest', 'other'];
const VALID_STATUS = ['pending', 'processing', 'replied', 'closed'];

/** dataURL 图片校验：jpeg/png/webp，每张 ≤ 150KB（base64 约 200KB），最多 3 张 */
function cleanImages(images) {
  if (!Array.isArray(images)) return [];
  const out = [];
  for (const s of images.slice(0, 3)) {
    const str = String(s || '');
    if (!str) continue;
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(str)) {
      const e = new Error('截图格式不正确（仅支持 jpg/png/webp）');
      e.statusCode = 400;
      throw e;
    }
    if (str.length > 200 * 1024) {
      const e = new Error('截图过大，请压缩后上传（每张 ≤ 150KB）');
      e.statusCode = 400;
      throw e;
    }
    out.push(str);
  }
  return out;
}

function toUserItem(t) {
  return {
    _id: t._id,
    type: t.type,
    typeName: TYPE_NAME[t.type] || t.type,
    title: t.title,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    // 有管理员新回复且用户没看过 → 列表打红点
    hasNewReply: !!(t.lastAdminReplyAt && (!t.userSeenAt || new Date(t.lastAdminReplyAt) > new Date(t.userSeenAt))),
  };
}

function toDetail(t) {
  return {
    _id: t._id,
    type: t.type,
    typeName: TYPE_NAME[t.type] || t.type,
    title: t.title,
    desc: t.desc,
    images: t.images || [],
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messages: (t.messages || []).map((m) => ({
      _id: m._id,
      role: m.role,
      authorName: m.authorName,
      content: m.content,
      images: m.images || [],
      createdAt: m.createdAt,
    })),
  };
}

/**
 * 新工单邮件提醒（fire-and-forget）：
 * - 未配置提醒邮箱 → 静默跳过，工单照常入库
 * - 发送失败 → 只记日志，不影响提交
 */
function notifyAdmins(ticket, user) {
  (async () => {
    try {
      const emails = await getTicketNotifyEmails();
      if (!emails.length) return;
      const time = new Date(ticket.createdAt).toLocaleString('zh-CN', { hour12: false });
      const descShort = String(ticket.desc || '').slice(0, 300);
      const text =
        `【物联宝典】收到新的用户工单\n\n` +
        `类型：${TYPE_NAME[ticket.type] || ticket.type}\n` +
        `标题：${ticket.title}\n` +
        `提交用户：${ticket.userName || ''}（${ticket.userEmail || ''}）\n` +
        `提交时间：${time}\n` +
        `描述：${descShort}\n\n` +
        `请登录管理后台 → 工单管理查看并回复。`;
      const html = `
      <div style="font-family:'PingFang SC','Microsoft YaHei',sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0e0e11;border-radius:16px;">
        <div style="font-size:18px;font-weight:700;color:#fff;margin-bottom:4px;">物联宝典 · 新工单提醒</div>
        <p style="color:#71717a;font-size:13px;margin:0 0 16px;">${time}</p>
        <div style="background:#18181b;border-radius:12px;padding:16px;margin-bottom:12px;">
          <p style="color:#fff;font-size:15px;font-weight:700;margin:0 0 8px;">【${TYPE_NAME[ticket.type] || ticket.type}】${cleanText(ticket.title, 100)}</p>
          <p style="color:#a1a1aa;font-size:13px;line-height:1.8;margin:0;">${cleanText(descShort, 400).replace(/\n/g, '<br/>')}</p>
        </div>
        <p style="color:#71717a;font-size:13px;margin:0;">提交用户：${cleanText(ticket.userName || '', 40)}（${cleanText(ticket.userEmail || '', 80)}）</p>
        ${ticket.images?.length ? `<p style="color:#71717a;font-size:13px;">附截图 ${ticket.images.length} 张（请登录后台查看）</p>` : ''}
        <p style="color:#71717a;font-size:13px;">请登录管理后台 → 工单管理查看并回复。</p>
      </div>`;
      for (const to of emails) {
        // eslint-disable-next-line no-await-in-loop
        await sendMail({ to, subject: `【物联宝典】新工单：${ticket.title}`.slice(0, 80), text, html });
      }
    } catch (e) {
      console.error('[ticket] 提醒邮件发送失败:', e.message);
    }
  })();
}

/** POST /api/tickets 提交工单（登录用户；写限流同考试写口径） */
router.post('/', authRequired, sensitiveWriteLimit, async (req, res) => {
  try {
    const { type = 'bug', title = '', desc = '', images = [] } = req.body || {};
    if (!VALID_TYPES.includes(type)) return res.status(400).json({ error: '工单类型非法' });
    const t = cleanText(title, 100);
    const d = String(desc || '').replace(/[<>]/g, '').trim().slice(0, 5000);
    if (!t) return res.status(400).json({ error: '请填写标题' });
    if (!d) return res.status(400).json({ error: '请填写详细描述' });
    let imgs;
    try {
      imgs = cleanImages(images);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }
    const ticket = await Ticket.create({
      userId: req.user._id,
      userName: req.user.name || '',
      userEmail: req.user.email || '',
      type,
      title: t,
      desc: d,
      images: imgs,
      // 提交人顺手记一条首楼，详情页时间线完整
      messages: [{
        role: 'user',
        authorId: req.user._id,
        authorName: req.user.name || '',
        content: d,
        images: imgs,
      }],
    });
    notifyAdmins(ticket, req.user);
    res.json({ ok: true, ticket: toUserItem(ticket.toObject()) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '提交失败，请稍后重试' });
  }
});

/** GET /api/tickets/mine 我的工单列表（倒序；附未读回复数供红点用） */
router.get('/mine', authRequired, async (req, res) => {
  try {
    const list = await Ticket.find({ userId: req.user._id })
      .select('type title status createdAt updatedAt lastAdminReplyAt userSeenAt')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const unread = list.filter(
      (t) => t.lastAdminReplyAt && (!t.userSeenAt || new Date(t.lastAdminReplyAt) > new Date(t.userSeenAt))
    ).length;
    res.json({ tickets: list.map(toUserItem), unread });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/tickets/mine/:id 我的工单详情（打开即视为已读，顺手标 userSeenAt） */
router.get('/mine/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '工单不存在' });
    const t = await Ticket.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!t) return res.status(404).json({ error: '工单不存在' });
    // 打开详情=已读：清“有新回复”红点（fire-and-forget，不阻塞返回）
    Ticket.updateOne({ _id: t._id }, { $set: { userSeenAt: new Date() } }).catch(() => {});
    res.json({ ticket: toDetail(t) });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** POST /api/tickets/mine/:id/append 用户追加说明（文字+可选1-3张图；已关闭工单不可追加） */
router.post('/mine/:id/append', authRequired, sensitiveWriteLimit, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '工单不存在' });
    const t = await Ticket.findOne({ _id: req.params.id, userId: req.user._id });
    if (!t) return res.status(404).json({ error: '工单不存在' });
    if (t.status === 'closed') return res.status(400).json({ error: '工单已关闭，无需再补充' });
    const content = String(req.body?.content || '').replace(/[<>]/g, '').trim().slice(0, 2000);
    if (!content) return res.status(400).json({ error: '请填写补充说明' });
    let imgs;
    try {
      imgs = cleanImages(req.body?.images || []);
    } catch (e) {
      return res.status(e.statusCode || 400).json({ error: e.message });
    }
    t.messages.push({ role: 'user', authorId: req.user._id, authorName: req.user.name || '', content, images: imgs });
    // 用户有新动作 → 管理员侧重新冒泡（updatedAt 参与后台排序），状态 closed 除外保持不动
    await t.save();
    res.json({ ok: true, ticket: toDetail(t.toObject()) });
  } catch (e) {
    res.status(500).json({ error: '提交失败' });
  }
});

/** GET /api/tickets/admin/list 全量列表（管理员；按状态/类型筛选，更新时间倒序） */
router.get('/admin/list', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const { status = '', type = '' } = req.query || {};
    const filter = {};
    if (status && VALID_STATUS.includes(status)) filter.status = status;
    if (type && VALID_TYPES.includes(type)) filter.type = type;
    const list = await Ticket.find(filter)
      .select('userName userEmail type title status createdAt updatedAt lastAdminReplyAt')
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();
    const counts = {};
    for (const s of TICKET_STATUS) counts[s] = await Ticket.countDocuments({ status: s });
    res.json({
      tickets: list.map((t) => ({
        _id: t._id,
        userName: t.userName || '未命名',
        userEmail: t.userEmail || '',
        type: t.type,
        typeName: TYPE_NAME[t.type] || t.type,
        title: t.title,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      counts,
    });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/tickets/admin/:id 详情（管理员；打开即 pending→processing，顺手流转省一次点击） */
router.get('/admin/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '工单不存在' });
    const t = await Ticket.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ error: '工单不存在' });
    if (t.status === 'pending') {
      Ticket.updateOne({ _id: t._id, status: 'pending' }, { $set: { status: 'processing' } }).catch(() => {});
      t.status = 'processing';
    }
    res.json({ ticket: toDetail(t) });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** POST /api/tickets/admin/:id/reply 回复（管理员；文字必填，回复后状态自动 →replied） */
router.post('/admin/:id/reply', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '工单不存在' });
    const t = await Ticket.findById(req.params.id);
    if (!t) return res.status(404).json({ error: '工单不存在' });
    if (t.status === 'closed') return res.status(400).json({ error: '工单已关闭，请重新开启后再回复' });
    const content = String(req.body?.content || '').replace(/[<>]/g, '').trim().slice(0, 5000);
    if (!content) return res.status(400).json({ error: '请填写回复内容' });
    t.messages.push({ role: 'admin', authorId: req.user._id, authorName: req.user.name || '管理员', content });
    t.status = 'replied';
    t.lastAdminReplyAt = new Date();
    await t.save();
    try {
      let email = t.userEmail;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
        const u = await User.findById(t.userId).select('email').lean().catch(() => null);
        email = u?.email || '';
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
        const m = buildTicketReplyMail({ title: t.title, reply: content.slice(0, 300) });
        const r = await sendMail({ to: email, subject: m.subject, text: m.text, html: m.html });
        if (!r?.failed) await Ticket.updateOne({ _id: t._id }, { $set: { lastReplyMailAt: new Date() } });
      } else {
        console.error('[ticket-mail] 跳过：用户邮箱无效', String(t._id));
      }
    } catch (e) { console.error('[ticket-mail] 发送失败:', e.message); }
    emitUserEvent(t.userId, 'ticket:replied', { ticketId: String(t._id), status: t.status, title: t.title || '' });
    res.json({ ok: true, ticket: toDetail(t.toObject()) });
  } catch (e) {
    res.status(500).json({ error: '回复失败' });
  }
});

/** PUT /api/tickets/admin/:id/status 改状态（pending/processing/replied/closed 白名单） */
router.put('/admin/:id/status', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '工单不存在' });
    const { status } = req.body || {};
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: '状态非法' });
    const t = await Ticket.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true }).lean();
    if (!t) return res.status(404).json({ error: '工单不存在' });
    emitUserEvent(t.userId, 'ticket:status_changed', { ticketId: String(t._id), status: t.status, title: t.title || '' });
    res.json({ ok: true, ticket: toDetail(t) });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

/** GET /api/tickets/admin/settings/notify-emails 读取提醒邮箱配置 */
router.get('/admin/settings/notify-emails', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const emails = await getTicketNotifyEmails();
    res.json({ emails });
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

/** PUT /api/tickets/admin/settings/notify-emails 保存提醒邮箱（逗号/分号/换行分隔多个；空=关闭提醒） */
router.put('/admin/settings/notify-emails', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const raw = String(req.body?.emails ?? req.body?.value ?? '');
    // 逐个校验：有一个非法就整单拒绝，避免配错一个导致全部静默
    const parts = raw.split(/[,;，；\s\n]+/).map((s) => s.trim()).filter(Boolean);
    const bad = parts.filter((s) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
    if (bad.length) return res.status(400).json({ error: `邮箱格式不正确：${bad.slice(0, 3).join('、')}` });
    if (parts.length > 10) return res.status(400).json({ error: '提醒邮箱最多 10 个' });
    await setTicketNotifyEmailsRaw(parts.join(','));
    res.json({ ok: true, emails: parts });
  } catch {
    res.status(500).json({ error: '保存失败' });
  }
});

export default router;
