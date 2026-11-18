import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { Modal, formatBeijingDateTime, formatBeijingDateTimeInput, parseBeijingDateTimeInput } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';

const LIVE_STATE = {
  live: { label: '启用中', cls: 'bg-ok/[0.12] text-ok' },
  scheduled: { label: '未开始', cls: 'bg-[#2D7DFF]/[0.1] text-[#2D7DFF]' },
  expired: { label: '已过期', cls: 'bg-black/[0.06] text-faint' },
  draft: { label: '草稿', cls: 'bg-black/[0.06] text-sub' },
  closed: { label: '已停用', cls: 'bg-bad/[0.08] text-bad' },
};

function fmtDateTime(v) {
  return formatBeijingDateTime(v);
}

/** datetime-local 输入值（YYYY-MM-DDTHH:mm） */
function toInputValue(v) {
  return formatBeijingDateTimeInput(v);
}

/**
 * 公告管理（管理后台 · 公告 Tab）：
 * 列表（状态徽标 + 时间窗）→ 新建/编辑弹窗 → 一键启停 → 删除
 */
export function AnnouncementsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [edit, setEdit] = useState(null); // null=关闭，{}=新建，{_id}=编辑

  const load = async () => {
    try {
      const { announcements } = await api.adminAnnouncements();
      setList(announcements || []);
    } catch (e) { toast(e.message, 'error'); setList([]); }
  };
  useEffect(() => { load(); }, []);

  const toggleStatus = async (a) => {
    const next = a.liveState === 'live' ? 'closed' : 'active';
    if (next === 'active' && a.status === 'draft') {
      if (!(await confirm({ title: '发布公告', message: `发布《${a.title}》吗？学员首页将弹窗展示。`, confirmText: '发布' }))) return;
    }
    try {
      await api.adminAnnouncementStatus(a._id, next);
      toast(next === 'active' ? '已启用' : '已停用', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const del = async (a) => {
    if (!(await confirm({ title: '删除公告', message: `确定删除《${a.title}》吗？已读记录会一并清理。`, confirmText: '删除' }))) return;
    try {
      await api.adminDeleteAnnouncement(a._id);
      toast('已删除', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (list === null) return <PageLoading />;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="section-title !mb-0">公告管理</h3>
        <button className="btn-primary ml-auto !px-4 !py-2 text-[13px]" onClick={() => setEdit({})}>＋ 新建</button>
      </div>
      {list.length === 0 && <Empty text="暂无公告，点击右上角新建" />}
      <div className="space-y-2.5">
        {list.map((a) => (
          <div key={a._id} className="card p-4">
            <div className="flex items-center gap-2">
              <span className={`chip shrink-0 ${LIVE_STATE[a.liveState]?.cls || ''}`}>{LIVE_STATE[a.liveState]?.label || a.liveState}</span>
              {(a.priority || 0) > 0 && <span className="chip shrink-0 bg-warn/[0.12] text-warn">置顶 {a.priority}</span>}
              <span className="ml-auto shrink-0 text-[12px] text-faint">{fmtDateTime(a.updatedAt)}</span>
            </div>
            <p className="mt-2 truncate text-[15px] font-bold text-ink">{a.title}</p>
            <p className="mt-0.5 line-clamp-1 text-[13px] text-faint">{String(a.content || '').split('\n')[0]}</p>
            <p className="mt-1 text-[12px] text-faint">
              {a.effectiveAt ? `生效 ${fmtDateTime(a.effectiveAt)}` : '即时生效'}
              {a.staleAt ? ` · 过期 ${fmtDateTime(a.staleAt)}` : ' · 长期有效'}
            </p>
            <div className="mt-2.5 flex gap-2">
              <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => setEdit(a)}>编辑</button>
              <button className="btn-ghost flex-1 !py-2 text-[13px]" onClick={() => toggleStatus(a)}>
                {a.liveState === 'live' ? '停用' : '启用'}
              </button>
              <button className="btn-ghost flex-1 !py-2 text-[13px] !text-bad" onClick={() => del(a)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {edit && <AnnouncementEditModal init={edit} onClose={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/** 新建/编辑弹窗：标题 + 内容 + 状态 + 优先级 + 时间窗 */
function AnnouncementEditModal({ init, onClose }) {
  const toast = useToast();
  const isNew = !init._id;
  const [title, setTitle] = useState(init.title || '');
  const [content, setContent] = useState(init.content || '');
  const [status, setStatus] = useState(init.status || 'draft');
  const [priority, setPriority] = useState(String(init.priority ?? 0));
  const [effectiveAt, setEffectiveAt] = useState(toInputValue(init.effectiveAt));
  const [staleAt, setStaleAt] = useState(toInputValue(init.staleAt));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim()) return toast('请填写标题', 'error');
    if (!content.trim()) return toast('请填写内容', 'error');
    setBusy(true);
    try {
      const body = {
        title: title.trim(),
        content: content.trim(),
        status,
        priority: Number(priority) || 0,
        effectiveAt: effectiveAt ? parseBeijingDateTimeInput(effectiveAt) : null,
        staleAt: staleAt ? parseBeijingDateTimeInput(staleAt) : null,
      };
      if (isNew) await api.adminCreateAnnouncement(body);
      else await api.adminUpdateAnnouncement(init._id, body);
      toast(isNew ? '已创建' : '已保存', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title={isNew ? '新建公告' : '编辑公告'}>
      <div className="space-y-3">
        <div>
          <label className="label">标题（最多 80 字）</label>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="如：国庆放假刷题安排" />
        </div>
        <div>
          <label className="label">内容（支持换行，最多 5000 字）</label>
          <textarea className="input-field min-h-[140px]" value={content} onChange={(e) => setContent(e.target.value)} maxLength={5000} placeholder="公告正文，换行即分段" />
        </div>
        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className="label">状态</label>
            <div className="flex gap-2">
              {[['draft', '草稿'], ['active', '启用'], ['closed', '停用']].map(([k, label]) => (
                <button key={k} onClick={() => setStatus(k)} className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold ${status === k ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="w-24">
            <label className="label">优先级</label>
            <input type="number" className="input-field" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className="label">生效时间（可选）</label>
            <input type="datetime-local" className="input-field" value={effectiveAt} onChange={(e) => setEffectiveAt(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="label">过期时间（可选）</label>
            <input type="datetime-local" className="input-field" value={staleAt} onChange={(e) => setStaleAt(e.target.value)} />
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-faint">留空=即时生效、长期有效；数字越大越先弹窗展示。</p>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy ? '保存中…' : isNew ? '创建' : '保存'}</button>
      </div>
    </Modal>
  );
}
