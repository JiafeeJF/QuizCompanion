import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';

export const TICKET_STATUS_META = {
  pending: { label: '待处理', cls: 'bg-warn/[0.12] text-warn' },
  processing: { label: '处理中', cls: 'bg-[#2D7DFF]/[0.1] text-[#2D7DFF]' },
  replied: { label: '已回复', cls: 'bg-ok/[0.12] text-ok' },
  closed: { label: '已关闭', cls: 'bg-black/[0.06] text-faint' },
};
const TYPE_TABS = [['bug', 'Bug反馈'], ['suggest', '功能建议'], ['other', '其他']];

function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 截图压缩：复用头像压缩思路，输出 jpeg dataURL（宽边 ≤ 1080，质量 0.7，单张约几十 KB） */
export function compressShot(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) return reject(new Error('请选择图片文件'));
    if (file.size > 10 * 1024 * 1024) return reject(new Error('图片超过 10MB，请换一张'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxSide = 1080;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        const w = Math.max(1, Math.round((img.naturalWidth || 0) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || 0) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } catch (e) { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/** 我的工单：列表 + 新建入口（有新回复的标题旁打红点；key 按用户隔离缓存防串号） */
export function Tickets() {
  const navigate = useNavigate();
  const toast = useToast();
  const [list, setList] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.myTickets()
      .then(({ tickets }) => { if (alive) setList(tickets || []); })
      .catch((e) => { if (alive) { toast(e.message, 'error'); setList([]); } });
    load();
    const onRefresh = () => load();
    window.addEventListener('wlbd:tickets-refresh', onRefresh);
    return () => { alive = false; window.removeEventListener('wlbd:tickets-refresh', onRefresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (list === null) return <PageLoading />;
  return (
    <div>
      <TopBar title="意见反馈" />
      <div className="space-y-2.5 px-4 pb-6">
        <button className="btn-primary w-full" onClick={() => navigate('new')}>＋ 提交反馈</button>
        {list.length === 0 && <Empty text="还没有提交过反馈，遇到问题随时告诉我们" />}
        {list.map((t) => (
          <button key={t._id} onClick={() => navigate(t._id)} className="card block w-full p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="chip shrink-0 bg-black/[0.05] text-sub">{t.typeName}</span>
              <span className={`chip shrink-0 ${TICKET_STATUS_META[t.status]?.cls || ''}`}>{TICKET_STATUS_META[t.status]?.label || t.status}</span>
              {t.hasNewReply && <span className="h-2 w-2 shrink-0 rounded-full bg-bad" />}
              <span className="ml-auto shrink-0 text-[12px] text-faint">{fmtTime(t.createdAt)}</span>
            </div>
            <p className="mt-2 truncate text-[15px] font-bold text-ink">{t.title}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 提交工单：类型三选一 + 标题 + 描述 + 可选截图（1-3 张，本地压缩后上传） */
export function TicketNew() {
  // 学员端 /tickets/new 与教师端 /teacher/tickets/new 共用：提交后按当前路径前缀回跳对应详情页
  const base = window.location.pathname.startsWith('/teacher') ? '/teacher/tickets' : '/tickets';
  const navigate = useNavigate();
  const toast = useToast();
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [shots, setShots] = useState([]);
  const [busy, setBusy] = useState(false);

  const pick = async (file) => {
    if (!file) return;
    if (shots.length >= 3) return toast('最多上传 3 张截图', 'error');
    try {
      const url = await compressShot(file);
      setShots((p) => [...p, url].slice(0, 3));
    } catch (e) { toast(e.message, 'error'); }
  };

  const submit = async () => {
    if (!title.trim()) return toast('请填写标题', 'error');
    if (!desc.trim()) return toast('请填写详细描述', 'error');
    setBusy(true);
    try {
      const { ticket } = await api.createTicket({ type, title: title.trim(), desc: desc.trim(), images: shots });
      toast('已提交，我们会尽快处理', 'success');
      navigate(`${base}/${ticket._id}`, { replace: true });
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div>
      <TopBar title="提交反馈" />
      <div className="space-y-3 px-4 pb-6">
        <div className="card p-4">
          <label className="label">问题类型</label>
          <div className="flex gap-2">
            {TYPE_TABS.map(([k, label]) => (
              <button key={k} onClick={() => setType(k)} className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${type === k ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <label className="label">标题（最多 100 字）</label>
          <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="一句话概括问题，如：交卷后用时显示--" />
        </div>
        <div className="card p-4">
          <label className="label">详细描述</label>
          <textarea className="input-field min-h-[120px]" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={5000} placeholder="复现步骤、机型、截图…写得越细修得越快" />
        </div>
        <div className="card p-4">
          <label className="label">截图（选填，最多 3 张）</label>
          <div className="flex flex-wrap gap-2">
            {shots.map((s, i) => (
              <div key={i} className="relative">
                <img src={s} alt={`截图${i + 1}`} className="h-20 w-20 rounded-xl object-cover" />
                <button onClick={() => setShots((p) => p.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bad text-[12px] font-bold text-white" aria-label="删除截图">×</button>
              </div>
            ))}
            {shots.length < 3 && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl bg-black/[0.04] text-[22px] text-faint">
                ＋
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy ? '提交中…' : '提交'}</button>
      </div>
    </div>
  );
}

/** 工单详情：首楼 + 回复时间线 + 已关闭外可追加说明 */
export function TicketDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [t, setT] = useState(null);
  const [append, setAppend] = useState('');
  const [busy, setBusy] = useState(false);
  // 详情已确认不存在时记 false，避免回列表时把“加载中”误判为空列表
  const load = () => api.ticketDetail(id).then(({ ticket }) => setT(ticket)).catch((e) => {
    if (/不存在/.test(e.message || '')) { setT(false); return; }
    // 网络抖动：保留骨架屏并重试一次，不直接判死
    setTimeout(() => {
      api.ticketDetail(id).then(({ ticket }) => setT(ticket)).catch((e2) => { toast(e2.message, 'error'); setT(false); });
    }, 1500);
    toast(e.message, 'error');
  });
  useEffect(() => {
    let alive = true;
    const run = () => api.ticketDetail(id).then(({ ticket }) => { if (alive) setT(ticket); }).catch((e) => {
      if (!alive) return;
      if (/不存在/.test(e.message || '')) { setT(false); return; }
      setTimeout(() => {
        if (!alive) return;
        api.ticketDetail(id).then(({ ticket }) => { if (alive) setT(ticket); }).catch((e2) => { if (alive) { toast(e2.message, 'error'); setT(false); } });
      }, 1500);
      toast(e.message, 'error');
    });
    run();
    const onRefresh = (event) => {
      if (!event.detail?.ticketId || String(event.detail.ticketId) === String(id)) run();
    };
    window.addEventListener('wlbd:tickets-refresh', onRefresh);
    return () => { alive = false; window.removeEventListener('wlbd:tickets-refresh', onRefresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (t === null) return <PageLoading />;
  if (t === false) return (<div><TopBar title="工单详情" /><Empty text="工单不存在" /></div>);

  const sendAppend = async () => {
    if (!append.trim()) return toast('请填写补充说明', 'error');
    setBusy(true);
    try {
      const { ticket } = await api.ticketAppend(id, { content: append.trim() });
      setT(ticket); setAppend('');
      toast('已补充说明', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <div>
      <TopBar title="工单详情" />
      <div className="space-y-3 px-4 pb-6">
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <span className="chip bg-black/[0.05] text-sub">{t.typeName}</span>
            <span className={`chip ${TICKET_STATUS_META[t.status]?.cls || ''}`}>{TICKET_STATUS_META[t.status]?.label || t.status}</span>
            <span className="ml-auto text-[12px] text-faint">{fmtTime(t.createdAt)}</span>
          </div>
          <p className="mt-2 text-[16px] font-bold text-ink">{t.title}</p>
          <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{t.desc}</p>
          {(t.images || []).length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {t.images.map((s, i) => (
                <a key={i} href={s} target="_blank" rel="noreferrer"><img src={s} alt={`截图${i + 1}`} className="h-20 w-20 rounded-xl object-cover" /></a>
              ))}
            </div>
          )}
        </div>
        {/* 回复时间线：首楼已在上面展示，这里跳过第一条 user 首楼避免重复 */}
        <div className="space-y-2.5">
          {(t.messages || []).slice(1).map((m) => (
            <div key={m._id} className={`card p-4 ${m.role === 'admin' ? '!bg-ok/[0.05]' : ''}`}>
              <div className="flex items-center gap-2">
                <span className={`chip ${m.role === 'admin' ? 'bg-ok/[0.15] text-ok' : 'bg-black/[0.05] text-sub'}`}>
                  {m.role === 'admin' ? '官方回复' : '我的补充'}
                </span>
                <span className="ml-auto text-[12px] text-faint">{fmtTime(m.createdAt)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{m.content}</p>
            </div>
          ))}
        </div>
        {t.status !== 'closed' ? (
          <div className="card p-4">
            <label className="label">追加说明（选填）</label>
            <textarea className="input-field min-h-[80px]" value={append} onChange={(e) => setAppend(e.target.value)} maxLength={2000} placeholder="补充复现信息…" />
            <button className="btn-secondary mt-2.5 w-full" disabled={busy} onClick={sendAppend}>{busy ? '发送中…' : '发送补充说明'}</button>
          </div>
        ) : (
          <p className="py-2 text-center text-[13px] text-faint">该工单已关闭，感谢你的反馈</p>
        )}
      </div>
    </div>
  );
}
