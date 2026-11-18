import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { TopBar, ProgressBar } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';

const MODE_NAME = { order: '顺序刷题', random: '随机刷题', chapter: '章节刷题' };

function SessionCard({ s, onResume, onDelete }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{s.title}</p>
        <span className="chip shrink-0 bg-black/[0.05] text-sub">{MODE_NAME[s.mode] || s.mode}</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <ProgressBar value={s.progress} className="flex-1" />
        <span className="shrink-0 text-[12px] text-sub">{s.answeredCount}/{s.total}</span>
      </div>
      <div className="mt-1.5 flex items-center text-[12px] text-faint">
        {s.answeredCount > 0 && <span>正确率 {s.accuracy}%</span>}
        <span className="ml-auto" />
        {s.completed
          ? <span className="chip bg-ok/[0.1] text-ok">已完成</span>
          : <>
              <button className="shrink-0 text-[13px] text-bad" onClick={() => onDelete(s._id)}>删除</button>
              <button className="btn-primary ml-2 shrink-0 !px-5 !py-2 text-[13px]" onClick={() => onResume(s._id)}>继续 →</button>
            </>}
      </div>
    </div>
  );
}

/** 刷题记录：未完成（断点续刷）+ 已完成历史 */
export default function PracticeHistory() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState('doing'); // doing | done
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async (t = tab) => {
    setLoading(true);
    try {
      // 继续刷题 Tab 仅顺序/随机；刷题历史 Tab 看全部（含章节）
      const params = t === 'done' ? { completed: 'true' } : { completed: 'false', modes: 'order,random' };
      const { sessions } = await api.practiceSessions(params);
      setSessions(sessions || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(tab); }, [tab]);

  const del = async (id) => {
    if (!(await confirm({ title: '删除刷题记录', message: '该轮进度将被删除，确定吗？', confirmText: '删除' }))) return;
    try {
      await api.deleteSession(id);
      setSessions((prev) => prev.filter((s) => String(s._id) !== String(id)));
      toast('已删除', 'success');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div>
      <TopBar title="刷题记录" />
      <div className="mb-3 flex gap-2 px-4">
        {[['doing', '继续刷题'], ['done', '刷题历史']].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${tab === k ? 'bg-ink text-white' : 'bg-white text-sub'}`}>{label}</button>
        ))}
      </div>
      {loading ? <PageLoading /> : sessions.length === 0 ? (
        <Empty text={tab === 'doing' ? '暂无未完成的刷题，开始一次新的刷题吧' : '还没有已完成的刷题'} />
      ) : (
        <div className="space-y-2.5 px-4 pb-6">
          {sessions.map((s) => (
            <SessionCard key={s._id} s={s} onResume={(id) => navigate(`/practice/s/${id}`)} onDelete={del} />
          ))}
          <p className="py-2 text-center text-[12px] text-faint">共 {sessions.length} 条</p>
        </div>
      )}
    </div>
  );
}
