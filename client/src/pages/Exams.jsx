import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAuth, memberActive } from '../auth.jsx';
import { TopBar, Card, MemberLock } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { useNotices } from '../notices.jsx';

import { AnimatePresence } from 'framer-motion';
import ExamPaperOverlay from '../components/ExamPaperOverlay.jsx';
import { useNativeBackHandler } from '../utils/nativeBack.js';

const KIND_NAME = { system: '系统卷', teacher: '班级考试', custom: '我的组卷' };

export default function Exams() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { user } = useAuth();
  const [exams, setExams] = useState([]);
  const [filter, setFilter] = useState('all'); // all | system | teacher | custom
  const [loading, setLoading] = useState(true);
  const requestedRef = useRef(false);
  const isMember = memberActive(user);
  const { refresh: refreshNotices } = useNotices();
  const [newIds, setNewIds] = useState(new Set()); // 有未读通知的考试 id（NEW 徽标用）
  const confirm = useConfirm();
  const [selection, setSelection] = useState(null);
  const [paperOrigin, setPaperOrigin] = useState(null);
  const openExam = (exam, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPaperOrigin({ top: rect.top, left: rect.left, width: rect.width });
    setSelection(exam._id);
  };
  useNativeBackHandler(!!selection, () => setSelection(null), 20);

  useEffect(() => {
    const requestedId = location.state?.openExamId;
    if (loading || !requestedId) return;
    if (exams.some(exam => String(exam._id) === String(requestedId))) {
      setPaperOrigin(null);
      setSelection(requestedId);
    } else {
      toast('该试卷不存在或暂不可访问', 'error');
    }
    navigate('/exams', { replace: true, state: null });
  }, [loading, exams, location.state, navigate, toast]);

  const load = async () => {
    try {
      // 未读通知 → 考试列表 NEW 徽标；进列表即视为"看到"，标已读清红点
      const [{ exams }, noticeRes] = await Promise.all([
        api.exams(),
        api.notices(30).catch(() => ({ notices: [] })),
      ]);
      setExams(Array.isArray(exams) ? exams : []);
      const ids = new Set(
        (noticeRes.notices || []).filter((n) => !n.read && n.examStatus === 'active').map((n) => String(n.examId))
      );
      setNewIds(ids);
      if (ids.size) {
        // 进列表=看到：标已读 + 刷红点（弹窗的"只弹一次"由 seen 本地记，不受影响）
        api.noticesRead().catch(() => {});
        refreshNotices();
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // React StrictMode 在开发环境会重复执行 effect，避免因此重复请求造成列表抖动。
    if (requestedRef.current) return;
    requestedRef.current = true;
    // 安卓进程被杀时无法保证 pagehide 上报；进入模考模块先由服务端
    // 作废该用户遗留的未交卷记录，再读取列表，避免恢复出旧考试和旧计时。
    api.abandonInProgressExams()
      .then((result) => {
        if (result?.abandonedCount) toast('上次考试未正常交卷，已作废，可重新开始', 'info');
      })
      .catch(() => {})
      .finally(load);
    const onRefresh = () => load();
    window.addEventListener('wlbd:exams-refresh', onRefresh);
    return () => window.removeEventListener('wlbd:exams-refresh', onRefresh);
  }, []);

  // 删除我创建的组卷：仅 kind=custom 且创建者是自己（后端再校验产物归属）；确认弹窗防误删
  const del = async (e) => {
    if (e.kind !== 'custom') return toast('仅可删除自己创建的组卷', 'error');
    const ok = await confirm({
      title: '删除组卷',
      message: `确定删除《${e.title}》吗？删除后不可恢复，相关作答记录会一并清理。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteCustomExam(String(e._id));
      toast('组卷已删除', 'success');
      setExams((prev) => prev.filter((x) => String(x._id) !== String(e._id)));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) return <PageLoading />;

  const list = exams.filter((e) => (filter === 'all' ? true : e.kind === filter));
  const counts = {
    all: exams.length,
    system: exams.filter((e) => e.kind === 'system').length,
    teacher: exams.filter((e) => e.kind === 'teacher').length,
    custom: exams.filter((e) => e.kind === 'custom').length,
  };
  const filters = [['all', `全部 ${counts.all}`], ['system', `系统卷 ${counts.system}`], ['teacher', `班级 ${counts.teacher}`], ['custom', `我的 ${counts.custom}`]];
  const filterIndex = Math.max(0, filters.findIndex(([key]) => key === filter));
  const sliderOffset = ['', 'translate-x-[calc(100%+0.25rem)]', 'translate-x-[calc(200%+0.5rem)]', 'translate-x-[calc(300%+0.75rem)]'][filterIndex];

  return (
    <div>
      <TopBar
        title="模拟考试"
        back={false}
        right={
          <button
            onClick={() => {
              if (!isMember) return toast('该功能为会员专属功能', 'error');
              navigate('/exams/custom');
            }}
            className="flex h-9 items-center gap-1 rounded-full bg-ink px-4 text-[13px] font-semibold text-white"
          >
            ＋ 组卷{!isMember && <MemberLock size={17} light className="ml-0.5" />}
          </button>
        }
      />
      <div className="h-[4.5rem]" aria-hidden="true" />
      <div className="wlbd-fixed-tabs fixed top-[calc(var(--safe-area-top)+52px)] z-30">
        <div className="wlbd-segment relative mb-3 grid grid-cols-4 gap-1 rounded-2xl p-1" role="tablist" aria-label="试卷筛选">
          <span className={`wlbd-segment-slider absolute inset-y-1 left-1 w-[calc(25%-0.1875rem)] ${sliderOffset}`} aria-hidden="true" />
          {filters.map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setSelection(null); setFilter(k); }}
              role="tab"
              aria-selected={filter === k}
              className={`relative z-10 min-h-11 rounded-xl px-2 py-2 text-[12px] font-semibold transition-colors ${filter === k ? 'text-ink' : 'text-sub'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
        {list.length === 0 && <Empty text={filter === 'custom' ? '还没有自定义组卷，点击右上角创建' : '暂无试卷'} />}
        <div className="space-y-2.5 px-4 pb-4">
          {list.map((e) => (
            <div key={e._id}>
              <Card onClick={event => openExam(e, event)}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip bg-black/[0.05] text-sub">{KIND_NAME[e.kind] || e.kind}</span>
                      {e.scope === 'homework' && <span className="chip bg-warn/[0.12] text-warn">作业</span>}
                      {newIds.has(String(e._id)) && <span className="chip bg-bad text-white">NEW</span>}
                      {e.status === 'ended' && <span className="chip bg-bad/[0.08] text-bad">已结束</span>}
                      {e.myAttempt?.status === 'submitted' && (
                        <span className="chip shrink-0 bg-ok/[0.1] text-ok">已考 {e.myAttempt.score} 分</span>
                      )}
                      <span className="ml-auto shrink-0 text-[12px] text-faint">{e.totalCount} 题 · {e.durationMin} 分钟</span>
                    </div>
                    <p className="mt-2 break-words text-[16px] font-bold text-ink">{e.title}</p>
                    {e.desc && <p className="mt-0.5 line-clamp-1 text-[13px] text-sub">{e.desc}</p>}
                    {e.deadlineAt && (
                      <p className="mt-1 text-[12px] text-warn">截止：{new Date(e.deadlineAt).toLocaleString('zh-CN', { hour12: false })}</p>
                    )}
                  </div>
                  {/* 我创建的组卷：卡片右侧垃圾桶图标按钮（flex 右列垂直居中，不占内容高度，仅 custom 才渲染） */}
                  {e.kind === 'custom' && (
                    <button
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-faint active:bg-bad/[0.08] active:text-bad"
                      onClick={(ev) => { ev.stopPropagation(); del(e); }}
                      aria-label="删除组卷"
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  )}
                </div>
              </Card>
            </div>
          ))}
        </div>
      <AnimatePresence>
        {selection && exams.some(e => e._id === selection) && <ExamPaperOverlay key={selection} exam={exams.find(e => e._id === selection)} origin={paperOrigin} onClose={() => setSelection(null)} />}
      </AnimatePresence>
    </div>
  );
}
