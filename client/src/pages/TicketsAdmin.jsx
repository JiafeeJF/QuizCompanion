import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { TopBar } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { TICKET_STATUS_META } from './Tickets.jsx';
import { useNativeBackHandler } from '../utils/nativeBack.js';

const STATUS_TABS = [['', '全部'], ['pending', '待处理'], ['processing', '处理中'], ['replied', '已回复'], ['closed', '已关闭']];
const TYPE_TABS = [['', '全部类型'], ['bug', 'Bug'], ['suggest', '建议'], ['other', '其他']];
const STATUS_ACTIONS = [['processing', '标为处理中'], ['replied', '标为已回复'], ['closed', '关闭工单'], ['pending', '重新开启']];

function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 工单管理：列表（状态/类型筛选）+ 详情回复 + 状态流转 + 提醒邮箱配置 */
export function TicketsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [settingOpen, setSettingOpen] = useState(false);

  const load = async (s = status, t = type) => {
    try {
      const params = {};
      if (s) params.status = s;
      if (t) params.type = t;
      const d = await api.adminTickets(params);
      setList(d.tickets || []); setCounts(d.counts || {});
    } catch (e) { toast(e.message, 'error'); setList([]); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { load(status, type); }, [status, type]);

  const changeStatus = async (id, next) => {
    if (next === 'closed') {
      if (!(await confirm({ title: '关闭工单', message: '关闭后用户不可再追加说明，确定吗？', confirmText: '关闭' }))) return;
    }
    try {
      await api.adminTicketStatus(id, next);
      toast('状态已更新', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (list === null) return <PageLoading />;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="section-title !mb-0">工单管理</h3>
        <span className="text-[12px] text-faint">待处理 {counts.pending || 0} · 处理中 {counts.processing || 0}</span>
        <button className="btn-secondary ml-auto !px-4 !py-2 text-[13px]" onClick={() => setSettingOpen(true)}>提醒邮箱</button>
      </div>
      <div className="no-scrollbar mb-2.5 flex gap-2 overflow-x-auto">
        {STATUS_TABS.map(([k, label]) => (
          <button key={k} onClick={() => setStatus(k)} className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold ${status === k ? 'bg-ink text-white' : 'bg-white text-sub'}`}>
            {label}{k && counts[k] != null ? ` ${counts[k]}` : ''}
          </button>
        ))}
      </div>
      <div className="no-scrollbar mb-3 flex gap-2 overflow-x-auto">
        {TYPE_TABS.map(([k, label]) => (
          <button key={k} onClick={() => setType(k)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${type === k ? 'bg-ink text-white' : 'bg-white text-faint'}`}>{label}</button>
        ))}
      </div>
      {list.length === 0 && <Empty text="暂无工单" />}
      <div className="space-y-2.5">
        {list.map((t) => (
          <div key={t._id} className="card p-4">
            <div className="flex items-center gap-2">
              <span className="chip shrink-0 bg-black/[0.05] text-sub">{t.typeName}</span>
              <span className={`chip shrink-0 ${TICKET_STATUS_META[t.status]?.cls || ''}`}>{TICKET_STATUS_META[t.status]?.label || t.status}</span>
              <span className="ml-auto shrink-0 text-[12px] text-faint">{fmtTime(t.updatedAt)}</span>
            </div>
            <p className="mt-2 truncate text-[15px] font-bold text-ink">{t.title}</p>
            <p className="mt-0.5 truncate text-[12px] text-faint">{t.userName} · {t.userEmail}</p>
            <div className="mt-2.5 flex gap-2">
              <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => setDetailId(t._id)}>查看/回复</button>
              {t.status !== 'closed'
                ? <button className="btn-ghost flex-1 !py-2 text-[13px]" onClick={() => changeStatus(t._id, 'closed')}>关闭</button>
                : <button className="btn-ghost flex-1 !py-2 text-[13px]" onClick={() => changeStatus(t._id, 'pending')}>重新开启</button>}
            </div>
          </div>
        ))}
      </div>
      {detailId && (
        <TicketReplyModal
          id={detailId}
          onClose={() => { setDetailId(null); load(); }}
          onStatus={(next) => changeStatus(detailId, next)}
        />
      )}
      {settingOpen && <NotifyEmailsModal onClose={() => setSettingOpen(false)} />}
    </div>
  );
}

/** 详情+回复弹窗：截图原图查看 + 回复 + 状态切换 */
function TicketReplyModal({ id, onClose, onStatus }) {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  useNativeBackHandler(true, onClose, 100);
  useEffect(() => {
    api.adminTicketDetail(id).then(({ ticket }) => setT(ticket)).catch((e) => toast(e.message, 'error'));
  }, [id]);
  const send = async () => {
    if (!reply.trim()) return toast('请填写回复内容', 'error');
    setBusy(true);
    try {
      const { ticket } = await api.adminTicketReply(id, reply.trim());
      setT(ticket); setReply('');
      toast('已回复，用户端可立即看到', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="safefullscreen fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(var(--safe-area-bottom)+20px)] sm:rounded-3xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-ink">工单详情</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-sub" aria-label="关闭">✕</button>
        </div>
        {!t ? <PageLoading /> : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="chip bg-black/[0.05] text-sub">{t.typeName}</span>
                <span className={`chip ${TICKET_STATUS_META[t.status]?.cls || ''}`}>{TICKET_STATUS_META[t.status]?.label || t.status}</span>
                <span className="ml-auto text-[12px] text-faint">{fmtTime(t.createdAt)}</span>
              </div>
              <p className="mt-2 text-[16px] font-bold text-ink">{t.title}</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{t.desc}</p>
              {(t.images || []).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {t.images.map((s, i) => (
                    <a key={i} href={s} target="_blank" rel="noreferrer"><img src={s} alt={`截图${i + 1}`} className="h-20 w-20 rounded-xl object-cover" /></a>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              {(t.messages || []).slice(1).map((m) => (
                <div key={m._id} className={`rounded-2xl p-3.5 ${m.role === 'admin' ? 'bg-ok/[0.07]' : 'bg-black/[0.03]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`chip ${m.role === 'admin' ? 'bg-ok/[0.15] text-ok' : 'bg-black/[0.05] text-sub'}`}>
                      {m.role === 'admin' ? `官方回复${m.authorName ? ` · ${m.authorName}` : ''}` : '用户补充'}
                    </span>
                    <span className="ml-auto text-[12px] text-faint">{fmtTime(m.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{m.content}</p>
                </div>
              ))}
            </div>
            {t.status !== 'closed' ? (
              <>
                <div>
                  <label className="label">回复用户（发送后状态自动变为“已回复”）</label>
                  <textarea className="input-field min-h-[90px]" value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder="写清楚处理结果…" />
                </div>
                <button className="btn-primary w-full" disabled={busy} onClick={send}>{busy ? '发送中…' : '发送回复'}</button>
                <div className="flex flex-wrap gap-2">
                  {STATUS_ACTIONS.filter(([k]) => k !== t.status).map(([k, label]) => (
                    <button key={k} className="btn-ghost flex-1 !py-2 text-[13px]" onClick={() => onStatus(k)}>{label}</button>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <p className="flex-1 py-2 text-center text-[13px] text-faint">工单已关闭</p>
                <button className="btn-ghost flex-1 !py-2 text-[13px]" onClick={() => onStatus('pending')}>重新开启</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** 提醒邮箱配置：多个邮箱逗号/换行分隔；留空=关闭邮件提醒（工单照常提交） */
function NotifyEmailsModal({ onClose }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  useNativeBackHandler(true, onClose, 100);
  useEffect(() => {
    api.ticketNotifyEmails()
      .then(({ emails }) => { setValue((emails || []).join('\n')); setLoaded(true); })
      .catch((e) => { toast(e.message, 'error'); setLoaded(true); });
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await api.saveTicketNotifyEmails(value);
      toast(value.trim() ? '提醒邮箱已保存，新工单将自动发邮件' : '已清空，不再发送提醒邮件', 'success');
      onClose();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="safefullscreen fixed inset-0 z-[95] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(var(--safe-area-bottom)+20px)] sm:rounded-3xl sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-ink">工单提醒邮箱</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-sub" aria-label="关闭">✕</button>
        </div>
        {!loaded ? <PageLoading /> : (
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-sub">有用户提交新工单时，系统自动发邮件到这些邮箱（最多 10 个，一行一个）。留空则不发邮件，工单照常提交。</p>
            <textarea className="input-field min-h-[110px]" value={value} onChange={(e) => setValue(e.target.value)} placeholder={'admin@example.com\ntech@example.com'} />
            <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
