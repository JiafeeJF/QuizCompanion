import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar, Card, Modal, formatDuration } from '../components/ui.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import QuestionCard from '../components/QuestionCard.jsx';
import { useNativeBackHandler } from '../utils/nativeBack.js';

/** 考试详情 + 答题 + 交卷 */
export default function ExamDetail({ examId, initialExam = null, autoStart = false, onExit, onResult, leaveHandlerRef }) {
  const { id: routeId } = useParams();
  const id = examId || routeId;
  const navigate = useNavigate();
  const location = useLocation();
  const autoStarted = useRef(false);
  const toast = useToast();
  const reduced = useReducedMotion();
  const starting = useRef(false);
  const [startPending, setStartPending] = useState(false);
  const [exam, setExam] = useState(initialExam);
  const [answers, setAnswers] = useState({});
  const [started, setStarted] = useState(false);
  const [left, setLeft] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const examGuard = useRef({ submitted: false, leaving: false, modal: false });
  const startedRef = useRef(false);
  const abandonSentRef = useRef(false);
  startedRef.current = started;
  const [loading, setLoading] = useState(!initialExam);
  const [myAttempt, setMyAttempt] = useState(null);

  useEffect(() => {
    if (initialExam) return;
    (async () => {
      try {
        const { exam } = await api.examDetail(id);
        setExam(exam);
        // 打开试卷=看到通知：清该卷未读（红点/NEW 跟着消）
        api.noticeReadExam(id).catch(() => {});
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // 倒计时
  useEffect(() => {
    if (!started || left <= 0) return;
    const t = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000);
    return () => clearInterval(t);
  }, [started, left]);

  useEffect(() => {
    if (started && left === 0 && exam) submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  // 浏览器返回键：答题中拦截一次，取消则补回历史
  useEffect(() => {
    if (!started) return;
    window.history.pushState({ exam: true }, '');
    const onPop = () => {
      const g = examGuard.current;
      if (g.submitted || g.leaving) return;
      if (!g.modal) {
        g.modal = true;
        setLeaveOpen(true);
        window.history.pushState({ exam: true }, '');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [started]);

  const abandonAttempt = (beacon = false) => {
    const g = examGuard.current;
    if (!startedRef.current || g.submitted || abandonSentRef.current) return Promise.resolve();
    abandonSentRef.current = true;
    try { sessionStorage.removeItem(`wlbd:exam:${id}`); } catch {}
    return beacon ? api.abandonExamBeacon(id) : api.abandonExam(id).catch(() => {});
  };

  // 刷新/关闭标签页直接作废，不保留进行中的成绩。
  useEffect(() => {
    if (!started) return;
    const onBefore = (e) => {
      const g = examGuard.current;
      if (g.submitted || g.leaving) return;
      abandonAttempt(true);
    };
    const onPageHide = () => {
      const g = examGuard.current;
      if (!g.submitted && !g.leaving) abandonAttempt(true);
    };
    window.addEventListener('beforeunload', onBefore);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('beforeunload', onBefore);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [started]);

  const setImmersive = (on) => {
    try { window.dispatchEvent(new CustomEvent('wlbd:exam-immersive', { detail: { active: !!on } })); } catch {}
  };
  // 卸载兜底：离开考试页必恢复导航（Shell 收到 false 即显示）
  useEffect(() => () => {
    try { window.dispatchEvent(new CustomEvent('wlbd:exam-immersive', { detail: { active: false } })); } catch {}
  }, []);
  const requestLeave = () => {
    const g = examGuard.current;
    if (g.submitted || g.leaving || g.modal) return;
    g.modal = true;
    setLeaveOpen(true);
  };
  // The persistent exam surface delegates Escape/native back to this guard.
  useEffect(() => {
    if (!leaveHandlerRef) return;
    leaveHandlerRef.current = () => {
      if (starting.current) return;
      if (startedRef.current) requestLeave();
      else onExit?.();
    };
    return () => { leaveHandlerRef.current = null; };
  }, [leaveHandlerRef, onExit]);
  // Edge-back and the navigation button use the visible exit button's flow.
  // An open dialog has higher priority, so another back closes it first.
  useNativeBackHandler(started, requestLeave, 50);
  const cancelLeave = () => {
    examGuard.current.modal = false;
    setLeaveOpen(false);
  };
  const confirmLeave = () => {
    const g = examGuard.current;
    if (g.leaving) return;
    g.leaving = true;
    g.modal = false;
    setLeaveOpen(false);
    setImmersive(false);
    // Do not hold navigation on the network; the API request is best effort
    // and the unload/pagehide beacon is the fallback for a hard exit.
    abandonAttempt(false);
    if (onExit) onExit();
    else navigate('/exams', { replace: true });
  };

  const start = async () => {
    if (starting.current) return;
    starting.current = true;
    setStartPending(true);
    try {
      const attempt = await api.startExam(id);
      abandonSentRef.current = false;
      setStarted(true);
      setLeft(Number.isFinite(Number(attempt.remainingSec)) ? Number(attempt.remainingSec) : exam.durationMin * 60);
      setImmersive(true);
    } catch (e) {
      examGuard.current.submitted = false;
      toast(e.message, 'error');
    } finally { starting.current = false; setStartPending(false); }
  };

  const submit = async (auto = false) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const list = exam.items.map((it) => ({ questionId: it.questionId, answer: answers[String(it.questionId)] ?? null }));
      examGuard.current.submitted = true;
      examGuard.current.modal = false;
      setLeaveOpen(false);
      const { attempt } = await api.submitExam(id, list);
      toast(auto ? '时间到，已自动交卷' : '交卷成功', 'success');
      setImmersive(false);
      if (onResult) onResult();
      else navigate(`/exams/${id}/result`, { replace: true });
    } catch (e) {
      examGuard.current.submitted = false;
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!exam || (!autoStart && location.state?.autoStartExam !== id) || autoStarted.current) return;
    autoStarted.current = true;
    if (!examId) navigate(location.pathname, { replace: true, state: null });
    start();
  }, [exam, id, location.state]);

  if (loading) return <PageLoading />;
  if (!exam) return (<div><TopBar title="考试" /><Empty text="试卷不存在" /></div>);
  if (!started && (location.state?.autoStartExam === id || (autoStart && !autoStarted.current) || (autoStarted.current && startPending))) return <PageLoading />;

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const doneCount = Object.keys(answers).length;

  // 未开始：试卷说明页
  if (!started) {
    return (
      <div>
        <TopBar title="考试说明" onBack={onExit} />
        <div className="px-4 pb-6"><ExamOverview exam={exam} startPending={startPending} onStart={start} onResult={onResult || (() => navigate(`/exams/${id}/result`))} /></div>
      </div>
    );
  }

  // 答题中：倒计时条自身处理顶部安全区（sticky 贴顶 + 背景融合无色块）
  return (
    <div>
      <div className="sticky top-0 z-40 flex items-center gap-2 bg-bg/85 px-4 pb-3 pt-[calc(var(--safe-area-top)+10px)] backdrop-blur-xl">
        <span className={`rounded-full px-3.5 py-1.5 text-[14px] font-bold tabular-nums ${left < 300 ? 'bg-bad text-white' : 'bg-ink text-white'}`}>
          {fmt(left)}
        </span>
        <span className="flex-1 text-center text-[13px] text-sub">已答 {doneCount}/{exam.items.length}</span>
        <button onClick={requestLeave} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-bad shadow-sm">退出</button>
        <button onClick={() => setSheetOpen(true)} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold shadow-sm">答题卡</button>
      </div>
      <motion.div initial={reduced ? false : { x: 20, opacity: .7 }} animate={{ x: 0, opacity: 1 }}
        transition={{ duration: .3, ease: [.22, 1, .36, 1] }} className="space-y-3 px-4 pb-6">
        {exam.items.map((it, i) => (
          <QuestionCard
            key={it.questionId}
            q={{ _id: it.questionId, type: it.type, stem: it.stem, options: it.options, score: it.score }}
            index={i}
            total={exam.items.length}
            value={answers[String(it.questionId)] ?? (it.type === 'multiple' ? [] : it.type === 'fill' || it.type === 'short' ? '' : null)}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [String(it.questionId)]: v }))}
            submitted={false}
          />
        ))}
        <button className="btn-primary w-full !py-4" disabled={submitting} onClick={() => submit(false)}>
          {submitting ? '交卷中…' : `交卷（已答 ${doneCount}/${exam.items.length}）`}
        </button>
      </motion.div>
      <Modal open={leaveOpen} onClose={cancelLeave} title="确认退出考试？">
        <p className="text-[14px] leading-relaxed text-sub">退出后作答进度可能丢失，确定要离开吗？</p>
        <div className="mt-4 flex gap-2.5">
          <button className="btn-secondary flex-1" onClick={cancelLeave}>继续作答</button>
          <button className="btn-primary flex-1 !bg-bad" onClick={confirmLeave}>确认退出</button>
        </div>
      </Modal>
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="答题卡">
        <div className="grid grid-cols-5 gap-2.5">
          {exam.items.map((it, i) => (
            <div key={it.questionId} className={`flex h-11 items-center justify-center rounded-xl text-[14px] font-semibold ${answers[String(it.questionId)] !== undefined && answers[String(it.questionId)] !== null && answers[String(it.questionId)] !== '' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>
              {i + 1}
            </div>
          ))}
        </div>
        <button className="btn-primary mt-4 w-full" onClick={() => { setSheetOpen(false); submit(false); }}>交卷</button>
      </Modal>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl bg-black/[0.03] py-3">
      <p className="text-[18px] font-bold text-ink">{value}</p>
      <p className="text-[12px] text-sub">{label}</p>
    </div>
  );
}

/** 班级排名用时显示：统一中文格式（45秒 / 2分05秒 / 1小时2分05秒，异常显示 --） */
function fmtDur(sec) {
  return formatDuration(sec);
}

/** Mounted only for class exams. Keep the shell visible while real rankings load. */
export function RankingCard({ examId, visible = true }) {
  const reduced = useReducedMotion();
  const [ranking, setRanking] = useState(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let alive = true;
    setDone(false); setRanking(null);
    api.examAttempts(examId)
      .then(d => { if (alive) { setRanking(d.ranking || null); setDone(true); } })
      .catch(() => { if (alive) setDone(true); });
    return () => { alive = false; };
  }, [examId]);
  return <motion.div initial={reduced ? false : { opacity: 0 }} animate={{ opacity: visible ? 1 : 0 }} transition={{ duration: reduced ? 0 : .2 }} className="card p-4" aria-busy={!done}>
    <div className="mb-2 flex flex-wrap items-center justify-between gap-1">
      <h2 className="section-title !text-[15px]">班级排名</h2>
      <span className="text-[12px] text-faint">分数高者胜 · 同分用时短者胜 {ranking && '· 共 ' + ranking.total + ' 人'}</span>
    </div>
    {!done && <div aria-label="正在加载班级排名" className="space-y-3 py-2">{[0,1,2].map(i => <div key={i} className="h-10 rounded-xl bg-black/[0.04]" />)}</div>}
    {done && !ranking && <p className="py-4 text-[13px] text-sub">暂时无法获取排名，请稍后重试</p>}
    {done && ranking && !ranking.list?.length && <p className="py-4 text-[13px] text-sub">暂无已交卷成绩</p>}
    <div className="divide-y divide-line/60">
      {(ranking?.list || []).map((r, index, rows) => (
        <motion.div key={r.userId || r.name + '-' + r.avatar + '-' + rows.slice(0,index).filter(x => x.name === r.name && x.avatar === r.avatar).length}
          initial={reduced || index >= 10 ? false : { opacity: 0, y: 6 }} animate={{ opacity: visible ? 1 : 0, y: visible || reduced ? 0 : 6 }}
          transition={{ duration: .24, delay: Math.min(index, 9) * .035 }}
          className={'flex items-center gap-2 py-2 ' + (r.mine ? 'font-bold' : '')}>
          <motion.span initial={reduced || r.rank > 3 ? false : { scale: .9 }} animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 240, damping: 22 }}
            className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ' + (r.rank === 1 ? 'bg-[#F5A623] text-white' : r.rank === 2 ? 'bg-black/[0.12] text-ink' : r.rank === 3 ? 'bg-[#C97B2D]/80 text-white' : 'bg-black/[0.05] text-sub')}>{r.rank}</motion.span>
          <Avatar user={{ name: r.name, avatar: r.avatar }} size={28} />
          <span className="min-w-0 flex-1 text-[14px] text-sub"><span className="block truncate">{r.name}</span>{r.mine && <span className="chip bg-ok/[0.12] !px-2 !py-0.5 !text-[11px] text-ok">我</span>}</span>
          <div className="ml-auto flex shrink-0 flex-col items-end gap-0.5 min-[400px]:flex-row min-[400px]:items-center min-[400px]:gap-3">
            <span className="whitespace-nowrap text-[14px] font-bold tabular-nums text-ink">{r.score} 分</span>
            <span className="whitespace-nowrap text-[12px] tabular-nums text-faint">{fmtDur(r.durationSec)}</span>
          </div>
        </motion.div>
      ))}
    </div>
  </motion.div>;
}

/** Shared real exam information: used by the existing route and inline list expansion. */
export function ExamOverview({ exam, onStart, onResult, startPending = false, presentationReady = true }) {
  return (
        <div className="space-y-3">
          <div className="card p-5">
            <p className="text-[19px] font-bold text-ink">{exam.title}</p>
            {exam.desc && <p className="mt-1.5 text-[14px] leading-relaxed text-sub">{exam.desc}</p>}
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Info label="题目" value={`${exam.items.length}`} />
              <Info label="时长" value={`${exam.durationMin}′`} />
              <Info label="总分" value={`${exam.items.reduce((s, it) => s + (it.score || 2), 0)}`} />
            </div>
            {exam.deadlineAt && <p className="mt-3 text-center text-[13px] text-warn">截止：{new Date(exam.deadlineAt).toLocaleString('zh-CN', { hour12: false })}</p>}
            {exam.myAttempt?.status === 'submitted' && (
              <p className="mt-3 rounded-2xl bg-ok/[0.08] p-3 text-center text-[13px] font-semibold text-ok">
                上次得分 {exam.myAttempt.score} 分，可重新作答{exam.allowRedo === false ? '' : '或查看成绩'}
              </p>
            )}
          </div>
          <button className="btn-primary w-full !py-4" onClick={onStart} disabled={startPending}>{startPending ? '准备中…' : '开始答题'}</button>
          <button className="btn-secondary w-full" onClick={onResult}>查看上次成绩</button>
          {/* 班级排名：仅本班教师卷可见，取每人最好成绩，每人只占一个名次 */}
          {exam.kind === 'teacher' && <RankingCard key={exam._id} examId={exam._id} visible={presentationReady} />}
        </div>
  );
}
