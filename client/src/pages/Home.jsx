import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, memberActive } from '../auth.jsx';
import { useToast } from '../Toast.jsx';
import { Card, ProgressBar, Stat, MemberLock } from '../components/ui.jsx';
import { PageLoading } from '../components/guards.jsx';

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const isMember = memberActive(user);

  useEffect(() => {
    (async () => {
      try {
        const [s, { session }] = await Promise.all([api.practiceStats(), api.latestSession().catch(() => ({ session: null }))]);
        setStats(s);
        setLatest(session || null);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const refreshOnPush = () => {
      (async () => {
        try {
          const [s, { session }] = await Promise.all([api.practiceStats(), api.latestSession().catch(() => ({ session: null }))]);
          setStats(s); setLatest(session || null);
        } catch {}
      })();
    };
    window.addEventListener('wlbd:exams-refresh', refreshOnPush);
    return () => window.removeEventListener('wlbd:exams-refresh', refreshOnPush);
  }, []);
  const startNew = async (payload) => {
    if (starting) return;
    // 首页快捷入口同样走会员门：免费学生点随机只提示（顺序正常进）
    if (!memberActive(user) && payload?.mode === 'random') {
      toast('该功能为会员专属功能', 'error');
      return;
    }
    setStarting(true);
    try {
      const { session } = await api.createSession(payload);
      navigate(`/practice/s/${session._id}`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <div className="mx-auto w-full max-w-lg px-4 pb-6 pt-[calc(var(--safe-area-top)+16px)] sm:px-5">
      {/* 问候 */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-[13px] text-sub">{new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好'}</p>
          <h1 className="text-[24px] font-bold text-ink">{user?.name || '同学'}，继续加油</h1>
        </div>
        <span className={`chip ${isMember ? 'bg-ok/[0.12] text-ok' : 'bg-black/[0.06] text-sub'}`}>
          {isMember ? '会员' : '免费版'}
        </span>
      </div>

      {/* 继续练习：最近一条未完成会话，直达原题序原位置 */}
      <div>
        <Card className="!p-5">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-ink">继续练习</p>
              <p className="mt-1 truncate text-[13px] text-sub">
                {latest
                  ? `${latest.title} · 已做 ${latest.answeredCount}/${latest.total}`
                  : '从第一章开始你的刷题之旅'}
              </p>
            </div>
            <button
              className="btn-primary ml-3 shrink-0 !px-6"
              onClick={() => navigate(latest ? `/practice/s/${latest._id}` : '/practice')}
            >
              {latest ? '继续' : '开始'}
            </button>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[12px] text-sub">
              <span>已刷 {stats?.doneQuestions || 0} / {stats?.totalQuestions || 0} 题</span>
              <span>{stats?.doneRate || 0}%</span>
            </div>
            <ProgressBar value={stats?.doneRate || 0} />
          </div>
        </Card>
      </div>

      {/* 快捷入口：新开刷题走“创建会话”，继续一律走已有会话 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-3.5">
        <Shortcut title="顺序刷题" desc="按题库顺序 · 全库" onClick={() => startNew({ mode: 'order' })} icon="≡" />
        <Shortcut title="随机刷题" desc={isMember ? '随机抽题 · 200题/轮' : '会员专属'} locked={!isMember} onClick={() => startNew({ mode: 'random' })} icon="⟳" />
        <Shortcut title="章节练习" desc={isMember ? '按章节突破' : '会员专属'} locked={!isMember} onClick={() => (isMember ? navigate('/practice#chapters') : toast('该功能为会员专属功能', 'error'))} icon="▤" />
        <Shortcut title="模拟考试" desc="全真组卷" onClick={() => navigate('/exams')} icon="✓" />
      </div>

      {/* 学习数据 */}
      <h2 className="section-title mb-2.5 mt-6">学习进度</h2>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="累计答题" value={stats?.answerCount || 0} />
        <Stat label="正确率" value={`${stats?.accuracy || 0}%`} accent />
        <Stat label="错题" value={stats?.wrongCount || 0} />
      </div>
      <div className="mt-3 flex gap-3">
        <button className="card flex-1 p-4 text-left active:scale-[0.99]" onClick={() => navigate('/wrongs')}>
          <p className="text-[15px] font-bold text-ink">错题本</p>
          <p className="mt-0.5 text-[12px] text-sub">{stats?.wrongCount || 0} 道待巩固</p>
        </button>
        <button className="card flex-1 p-4 text-left active:scale-[0.99]" onClick={() => navigate('/favorites')}>
          <p className="text-[15px] font-bold text-ink">收藏</p>
          <p className="mt-0.5 text-[12px] text-sub">{stats?.favoriteCount || 0} 道已收藏</p>
        </button>
      </div>

      {!isMember && (
      <div className="card mt-4 border-ink bg-ink p-5 text-white shadow-none">
          <p className="text-[15px] font-bold">升级会员，备考更快一步</p>
          <p className="mt-1 text-[13px] text-white/70">随机刷题 · 章节练习 · 自定义组卷 · 错题一键导出</p>
          <p className="mt-1 text-[13px] text-white/70">免费版可顺序刷题 + 完成教师布置的全部任务</p>
          <p className="mt-3 text-[12px] text-white/50">联系管理员后台开通</p>
        </div>
      )}
    </div>
  );
}

function Shortcut({ title, desc, icon, locked = false, onClick }) {
  return (
    <button onClick={onClick} className="card relative flex items-center gap-3 p-4 text-left active:scale-[0.98]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-black/[0.05] text-[18px] font-bold text-ink">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate whitespace-nowrap text-[15px] font-bold leading-snug text-ink">{title}</span>
        <span className="block truncate whitespace-nowrap text-[12px] text-sub">{desc}</span>
      </span>
      {locked && (
        <span className="absolute right-2.5 top-2.5 opacity-90">
          <MemberLock size={14} />
        </span>
      )}
    </button>
  );
}
