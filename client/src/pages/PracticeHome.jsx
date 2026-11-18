import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAuth, memberActive } from '../auth.jsx';
import { TopBar, ProgressBar, MemberLock } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { getLocalBank } from '../bankStore.js';
import { listOfflineSessions } from '../practiceOffline.js';

const MODE_NAME = { order: '顺序刷题', random: '随机刷题', chapter: '章节刷题' };
const MEMBER_ONLY_MSG = '该功能为会员专属功能';

/** 刷题首页：继续刷题 + 顺序/随机固定单分支 + 章节列表（不再提供“开始新的刷题”，避免分支过多）
 * 免费学生自主使用只开放顺序刷题：随机/章节入口点按即提示会员专属（后端同样 403，不只靠隐藏按钮）。
 * 继续列表里的教师任务会话照常可进（后端恢复接口对教师任务不设会员门）。
 */
export default function PracticeHome() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const chapterRef = useRef(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isMember = memberActive(user);
  const [chapters, setChapters] = useState([]);
  const [chapterStats, setChapterStats] = useState([]);
  const [sessions, setSessions] = useState([]);
  // 章节未完成会话：照常保存进度，但不进“继续刷题”列表，只做章节卡片断点续刷
  const [chapterSessions, setChapterSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [section, setSection] = useState(hash === '#chapters' ? 'chapter' : 'practice');

  const load = async () => {
    try {
      // 继续刷题只展示顺序/随机；章节会话单独拉取用于章节卡片续刷（数据保留，直接链接仍可恢复）
      const [{ chapters }, { stats }, { sessions }, { sessions: chSessions }] = await Promise.all([
        api.chapters(), api.chapterStats(),
        api.practiceSessions({ completed: 'false', modes: 'order,random' }),
        api.practiceSessions({ completed: 'false', modes: 'chapter' }).catch(() => ({ sessions: [] })),
      ]);
      setChapters(chapters);
      setChapterStats(stats);
      setSessions(sessions || []);
      setChapterSessions(chSessions || []);
    } catch (e) {
      const cached = listOfflineSessions(user?._id || user?.id).filter((item) => !item.completed);
      const bank = getLocalBank();
      setChapters((bank?.chapters || []).map((chapter) => ({ ...chapter, _id: chapter._id || chapter.id })));
      setSessions(cached.filter((item) => item.mode === 'order' || item.mode === 'random'));
      setChapterSessions(cached.filter((item) => item.mode === 'chapter'));
      if (!cached.length) toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (hash === '#chapters') setSection('chapter');
  }, [hash]);

  // 顺序/随机：每种模式只保留一个未完成分支，有就续刷，没有才新建。
  // 章节：若该章已有未完成会话，直接断点续刷，不另建新会话。
  const startNew = async (payload) => {
    if (starting) return;
    // 免费学生自主点击随机/章节：先本地提示（后端同样会 403，前后端双保险）
    if (!isMember && (payload?.mode === 'random' || payload?.mode === 'chapter')) {
      toast(MEMBER_ONLY_MSG, 'error');
      return;
    }
    if (payload?.mode === 'chapter' && payload?.chapterId) {
      const exist = chapterSessions.find((s) => String(s.chapterId) === String(payload.chapterId));
      if (exist) {
        navigate(`/practice/s/${exist._id}`);
        return;
      }
    }
    if (payload?.mode === 'order' || payload?.mode === 'random') {
      const exist = sessions.find((s) => s.mode === payload.mode);
      if (exist) {
        navigate(`/practice/s/${exist._id}`);
        return;
      }
    }
    setStarting(true);
    try {
      // 后端 find-or-create：存在未完成进度直接返回 { resumed: true }，不存在才新建
      const { session, resumed } = await api.createSession(payload);
      if (resumed) toast('继续上次进度', 'success');
      if (payload?.mode === 'chapter') {
        setChapterSessions((prev) => [{ ...session }, ...prev]);
      } else {
        setSessions((prev) => [{ ...session }, ...prev]);
      }
      navigate(`/practice/s/${session._id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setStarting(false);
    }
  };

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

  const statMap = new Map(chapterStats.map((s) => [String(s.chapterId), s]));

  if (loading) return <PageLoading />;

  return (
    <div>
      <TopBar title="刷题" back={false} />
      <div className="h-[4.5rem]" aria-hidden="true" />
      <div className="wlbd-fixed-tabs fixed top-[calc(var(--safe-area-top)+44px)] z-30">
        <div className="wlbd-segment relative grid grid-cols-2 gap-1 rounded-2xl p-1" role="tablist" aria-label="刷题分类">
          <span className={`wlbd-segment-slider absolute inset-y-1 left-1 w-[calc(50%-0.375rem)] ${section === 'chapter' ? 'translate-x-[calc(100%+0.25rem)]' : ''}`} aria-hidden="true" />
          <button className={`relative z-10 min-h-11 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${section === 'practice' ? 'text-ink' : 'text-sub'}`} onClick={() => setSection('practice')} role="tab" aria-selected={section === 'practice'}>继续 / 顺序随机</button>
          <button className={`relative z-10 min-h-11 rounded-xl px-2 py-2 text-[13px] font-semibold transition-colors ${section === 'chapter' ? 'text-ink' : 'text-sub'}`} onClick={() => setSection('chapter')} role="tab" aria-selected={section === 'chapter'}>章节练习</button>
        </div>
      </div>
      {section === 'practice' && (
        <>
      <h2 className="section-title mb-2.5 mt-3 px-4">继续刷题{sessions.length > 0 && `（${sessions.length}）`}</h2>
          {sessions.length === 0 ? (
            <p className="mx-4 rounded-2xl bg-white p-4 text-center text-[13px] text-sub">暂无未完成的刷题，从下方入口开始吧</p>
          ) : (
            <div className="space-y-2.5 px-4">
              {sessions.slice(0, 5).map((s) => (
                <div key={s._id} className="card p-4">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{s.title}</p>
                    <span className="chip shrink-0 bg-black/[0.05] text-sub">{MODE_NAME[s.mode] || s.mode}</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-2"><ProgressBar value={s.progress} className="flex-1" /><span className="shrink-0 text-[12px] text-sub">{s.answeredCount}/{s.total}</span></div>
                  <div className="mt-1.5 flex items-center text-[12px] text-faint">
                    {s.answeredCount > 0 && <span>正确率 {s.accuracy}%</span>}
                    <button className="ml-auto shrink-0 text-[13px] text-bad" onClick={() => del(s._id)}>删除</button>
                    <button className="btn-primary ml-2 shrink-0 !px-5 !py-2 text-[13px]" onClick={() => navigate(`/practice/s/${s._id}`)}>继续 →</button>
                  </div>
                </div>
              ))}
              {sessions.length > 5 && <button className="btn-secondary w-full !py-2.5 text-[13px]" onClick={() => navigate('/practice/history')}>查看更多（{sessions.length}）</button>}
            </div>
          )}
      <h2 className="section-title mb-2.5 mt-3 px-4">顺序 / 随机练习</h2>
      <div className="grid grid-cols-2 gap-3 px-4">
            <ModeCard title="顺序练习" desc="按题库顺序逐题 · 全库连刷" onClick={() => startNew({ mode: 'order' })} />
            <ModeCard title={<span>随机练习{!isMember && <MemberLock size={19} className="ml-1" />}</span>} desc={isMember ? '随机抽题 · 200题/轮' : '会员专属'} locked={!isMember} onClick={() => startNew({ mode: 'random' })} />
      </div>
        </>
      )}
      {section === 'chapter' && <>
      <h2 ref={chapterRef} className="section-title scroll-mt-20 mb-2.5 mt-3 flex items-center gap-1.5 px-4">按章节练习{!isMember && <MemberLock size={18} />}</h2>
          {!isMember && <p className="mx-4 mb-2.5 rounded-2xl bg-ink p-3.5 text-[13px] leading-relaxed text-white/80">章节练习为会员专属功能，免费版可使用顺序刷题。教师布置的班级任务不受此限制。</p>}
          {chapters.length === 0 && <Empty text="题库暂无章节" />}
      <div className="space-y-2.5 px-4 pb-4">
            {chapters.map((c) => {
              const st = statMap.get(String(c._id));
              const chSess = chapterSessions.find((s) => String(s.chapterId) === String(c._id));
              return <button key={c._id} onClick={() => startNew({ mode: 'chapter', chapterId: c._id })} className="card w-full p-4 text-left active:scale-[0.99]">
                <div className="flex items-center justify-between"><p className="min-w-0 flex-1 truncate text-[15px] font-bold text-ink">{c.name}</p><span className="ml-2 shrink-0 text-[13px] text-faint">{c.questionCount} 题</span></div>
                {chSess ? <div className="mt-2.5 flex items-center gap-2"><ProgressBar value={chSess.progress} className="flex-1" /><span className="shrink-0 text-[12px] text-sub">本轮 {chSess.answeredCount}/{chSess.total} · 继续 →</span></div> : st ? <div className="mt-2.5 flex items-center gap-2"><ProgressBar value={st.accuracy} className="flex-1" /><span className="w-10 shrink-0 text-right text-[12px] text-sub">{st.accuracy}%</span></div> : <div className="mt-2.5 flex items-center gap-2"><ProgressBar value={0} className="flex-1" /><span className="w-10 shrink-0 text-right text-[12px] text-sub">未练</span></div>}
              </button>;
            })}
      </div>
      </>}
    </div>
  );
}

function ModeCard({ title, desc, locked, onClick }) {
  return (
    <button onClick={onClick} className={`card p-5 text-left active:scale-[0.98] ${locked ? 'bg-black/[0.04]' : 'bg-ink text-white'}`}>
      <p className={`text-[16px] font-bold ${locked ? 'text-ink' : ''}`}>{title}</p>
      <p className={`mt-1 text-[12px] ${locked ? 'text-sub' : 'text-white/60'}`}>{desc}</p>
      <p className={`mt-3 text-[13px] font-semibold ${locked ? 'text-sub' : ''}`}>开始 →</p>
    </button>
  );
}
