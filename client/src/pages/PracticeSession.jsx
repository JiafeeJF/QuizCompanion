import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useAuth } from '../auth.jsx';
import { TopBar, Modal } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import QuestionCard from '../components/QuestionCard.jsx';
import {
  createPracticeEvent, enqueuePracticeEvent, flushPracticeQueue, gradeLocally,
  pendingPracticeCount, readOfflineSession, removeOfflineSession, removePracticeQueue, writeOfflineSession,
} from '../practiceOffline.js';

/**
 * 会话化刷题页：/practice/s/:sessionId
 * - 题目与顺序由后端会话落盘，刷新/重登恢复同一组题
 * - 每答一题：本地题库立即判分并落本地队列，不等待网络
 * - 联网后按事件 ID 幂等补传，服务端重新判分并合并进度
 */

export default function PracticeSession() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const userId = String(user?._id || user?.id || '');

  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [idx, setIdx] = useState(0);
  // 全会话答题状态：{ [questionId]: { answer, correct, autoGraded, submitted } }
  const [states, setStates] = useState({});
  const [input, setInput] = useState(null); // 当前题未提交的输入
  const [submitting, setSubmitting] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dir, setDir] = useState(1);
  const [notFound, setNotFound] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [finishing, setFinishing] = useState(false); // “完成本轮”防连点
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const celebratedRef = useRef(false); // 全答完提示只弹一次
  const autoNextTimer = useRef(null);
  const submitLockRef = useRef(false);
  const stateRef = useRef({ sessionId, idx, states, session, questions });
  stateRef.current = { sessionId, idx, states, session, questions };
  // 未提交的草稿按题存放：{ [qid]: value }，切题互不串味
  const draftsRef = useRef({});

  const q = questions[idx];
  const qid = q ? String(q._id) : null;
  const cur = (qid && states[qid]) || { answer: null, correct: null, autoGraded: false, submitted: false, correctAnswer: null, textAnswer: '' };

  // 统计与派生状态必须定义在所有 useEffect / early-return 之前：
  // 后面的全答完提示 effect 与完成态都会用到它们，放后面会导致 TDZ 引用报错白屏
  // 答题卡统计走本地 states（questionIds 全量已知，未判题不计对错）：
  // 已作答=已提交数；答对/答错仅统计自动判分题，主观题只计已作答
  const statesArr = questions.map((item) => states[String(item._id)]);
  const answeredShown = statesArr.filter((st) => st?.submitted).length;
  const okShown = statesArr.filter((st) => st?.submitted && st.autoGraded && st.correct === true).length;
  const badShown = statesArr.filter((st) => st?.submitted && st.autoGraded && st.correct === false).length;
  const doneCount = answeredShown;
  const okCount = okShown;
  // “等待确认”态：本地全量已提交（跳题漏答也算未全答，currentIndex 到末题不算完成）
  const allAnswered = questions.length > 0 && answeredShown >= questions.length;
  const isFullBank = (session?.mode === 'order' || session?.mode === 'random') && !session?.chapterId && !session?.rangeDesc && session?.source !== 'teacher';
  const modeName = { order: '顺序刷题', random: '随机刷题', chapter: session?.title || '章节刷题' }[session?.mode] || '刷题';
  // QuestionCard 只在提交后展示本地判分结果；服务端随后独立复核并落库。
  const result = cur.submitted
    ? (cur.grading
      ? null
      : { correct: cur.correct, autoGraded: cur.autoGraded, answer: cur.correctAnswer, textAnswer: cur.textAnswer || '' })
    : null;

  // 在线时合并服务端与本地较新答案；离线时直接从完整会话快照恢复。
  useLayoutEffect(() => {
    (async () => {
      setLoading(true);
      setNotFound(false);
      const stored = readOfflineSession(sessionId);
      const cache = stored && String(stored.userId || '') === userId ? stored : null;
      const hasCachedSession = cache?.session && Array.isArray(cache.questions) && cache.questions.length > 0;
      // 未同步进度优先恢复，不让弱网请求阻塞页面。在线请求仍在后台继续并完成合并。
      if (hasCachedSession) {
        setSession(cache.session);
        setQuestions(cache.questions);
        setStates(cache.userAnswers || {});
        setIdx(Math.max(0, Math.min(Number(cache.currentIndex) || 0, cache.questions.length - 1)));
        setLoading(false);
      }
      try {
        const { session: s, questions: qs, userAnswers, currentIndex } = await api.getSession(sessionId);
        const questionList = qs || [];
        const merged = {};
        for (const [k, v] of Object.entries(userAnswers || {})) {
          merged[k] = {
            answer: v.answer ?? null,
            correct: v.correct ?? null,
            autoGraded: !!v.autoGraded,
            correctAnswer: v.correctAnswer ?? null,
            textAnswer: v.textAnswer || '',
            answeredAt: v.answeredAt || s.updatedAt || '',
            pending: false,
            submitted: true,
          };
        }
        if (cache?.userAnswers) {
          for (const [k, v] of Object.entries(cache.userAnswers)) {
            const serverAt = new Date(merged[k]?.answeredAt || 0).getTime();
            const localAt = new Date(v?.answeredAt || 0).getTime();
            if ((!merged[k] || v?.pending || localAt >= serverAt) && questionList.some((x) => String(x._id) === k)) {
              merged[k] = { ...v, submitted: true };
            }
          }
        }
        const hasPending = pendingPracticeCount(sessionId, userId) > 0;
        const startValue = hasPending ? cache?.currentIndex : currentIndex;
        const start = Math.max(0, Math.min(Number(startValue) || 0, Math.max(0, questionList.length - 1)));
        const localSession = { ...s, currentIndex: start, localUpdatedAt: cache?.localUpdatedAt || s.updatedAt };
        setSession(localSession);
        setQuestions(questionList);
        setStates(merged);
        setIdx(start);
        writeOfflineSession(sessionId, { userId, session: localSession, questions: questionList, currentIndex: start, userAnswers: pickAnswers(merged), localUpdatedAt: new Date().toISOString() });
      } catch (e) {
        if (/不存在|无权/.test(e.message)) {
          setSession(null);
          setQuestions([]);
          setNotFound(true);
        } else if (hasCachedSession) {
          // 已经恢复本地进度，网络失败不打断答题。
        }
        else toast('无法连接服务器，且本机没有该轮练习缓存', 'error');
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, userId]);

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine !== false);
    const onSynced = (event) => {
      if (event.detail?.sessionId === sessionId && event.detail?.result?.session) {
        setSession(event.detail.result.session);
        if (pendingPracticeCount(sessionId, userId) === 0) {
          setStates((previous) => {
            const synced = Object.fromEntries(Object.entries(previous).map(([key, value]) => [key, { ...value, pending: false }]));
            const cache = readOfflineSession(sessionId);
            if (cache) writeOfflineSession(sessionId, { ...cache, userId, session: event.detail.result.session, userAnswers: pickAnswers(synced) });
            return synced;
          });
        }
      }
    };
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    window.addEventListener('wlbd:practice-synced', onSynced);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
      window.removeEventListener('wlbd:practice-synced', onSynced);
    };
  }, [sessionId, userId]);

  // 切题回顶部
  useEffect(() => {
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(raf);
  }, [idx]);
  // 最后一道未完成题被作答 → 提示去答题卡确认，不自动完成、不锁死（仍可回看/跳转）
  useEffect(() => {
    if (!loading && questions.length > 0 && answeredShown >= questions.length && !completed && !celebratedRef.current) {
      celebratedRef.current = true;
      toast('本轮所有题目已完成，可在答题卡确认后点击“完成本轮”', 'success');
      setSheetOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answeredShown, questions.length, loading]);

  // 当前题输入/收藏状态：idx 或题目变化时同步。
  // 已提交的题：输入直接取落盘答案；未提交的题：先看本 session 内该题的草稿，
  // 没有草稿且从未输入过才给默认值。草稿按 qid 存放，切题不会把上一题的值带到下一题。
  useEffect(() => {
    if (!q) return;
    if (cur.submitted) {
      setInput(Array.isArray(cur.answer) ? [...cur.answer] : cur.answer ?? (q.type === 'multiple' ? [] : q.type === 'fill' || q.type === 'short' ? '' : null));
    } else if (Object.prototype.hasOwnProperty.call(draftsRef.current, qid)) {
      const d = draftsRef.current[qid];
      setInput(Array.isArray(d) ? [...d] : d);
    } else {
      setInput(q.type === 'multiple' ? [] : q.type === 'fill' || q.type === 'short' ? '' : null);
    }
    api.checkFavorites([q._id]).then(({ favorited }) => setFavorited(favorited.includes(String(q._id)))).catch(() => setFavorited(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, questions.length, qid]);

  // 切题位置也进入本地队列；离线退出后仍能回到最后浏览位置。
  const persistIndex = (i) => {
    const at = new Date().toISOString();
    const current = stateRef.current;
    writeOfflineSession(sessionId, {
      userId,
      session: { ...current.session, currentIndex: i, localUpdatedAt: at },
      questions: current.questions,
      currentIndex: i,
      userAnswers: pickAnswers(current.states),
      localUpdatedAt: at,
    });
    enqueuePracticeEvent(createPracticeEvent({ userId, sessionId, questionId: null, answer: null, mode: session?.mode || 'order', currentIndex: i, answeredAt: at }));
    flushPracticeQueue(api.syncPracticeSession, userId);
  };

  const goto = (i) => {
    const n = Math.max(0, Math.min(i, questions.length - 1));
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    setDir(n >= idx ? 1 : -1);
    setIdx(n);
    persistIndex(n);
  };
  const next = () => {
    if (submitting || finishing) return;
    if (idx + 1 < questions.length) goto(idx + 1);
    else finish();
  };
  const prev = () => { if (submitting || finishing) return; if (idx > 0) goto(idx - 1); };

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const syncKeyboard = () => setKeyboardOpen(viewport.height < window.innerHeight * 0.72);
    syncKeyboard();
    viewport.addEventListener('resize', syncKeyboard);
    return () => viewport.removeEventListener('resize', syncKeyboard);
  }, []);

  // 答题：本地同步判分并持久化；网络同步完全在后台进行。
  const submit = (ans) => {
    if (!q || cur.submitted || submitLockRef.current) return;
    submitLockRef.current = true;
    setSubmitting(true);
    // value 用本次提交实参（单选/判断为点击值，多选/简答为当前输入），
    // 不依赖 input state —— 避免 setState 异步导致读到上一次的旧答案
    const value = ans ?? input;
    const qidAtSubmit = qid;
    const qAtSubmit = q;
    const answeredAt = new Date().toISOString();
    const localResult = gradeLocally(qAtSubmit, value);
    const done = {
      answer: value,
      correct: localResult.correct,
      autoGraded: localResult.autoGraded,
      submitted: true,
      correctAnswer: localResult.answer,
      textAnswer: localResult.textAnswer,
      answeredAt,
      pending: true,
      grading: false,
    };
    delete draftsRef.current[qidAtSubmit];
    const current = stateRef.current;
    const nextStates = { ...current.states, [qidAtSubmit]: done };
    const values = Object.values(nextStates).filter((item) => item?.submitted);
    const correctCount = values.filter((item) => item.autoGraded && item.correct === true).length;
    const wrongCount = values.filter((item) => item.autoGraded && item.correct === false).length;
    const nextSession = {
      ...current.session, currentIndex: current.idx, answeredCount: values.length, correctCount, wrongCount,
      progress: current.questions.length ? Math.round((values.length / current.questions.length) * 100) : 0,
      accuracy: values.length ? Math.round((correctCount / values.length) * 100) : 0,
      localUpdatedAt: answeredAt,
    };
    stateRef.current = { ...current, states: nextStates, session: nextSession };
    setStates(nextStates);
    setSession(nextSession);
    writeOfflineSession(sessionId, {
      userId,
      session: nextSession, questions: current.questions, currentIndex: current.idx,
      userAnswers: pickAnswers(nextStates), localUpdatedAt: answeredAt,
    });
    enqueuePracticeEvent(createPracticeEvent({
      userId, sessionId, questionId: qAtSubmit._id, answer: value,
      mode: session?.mode || 'order', currentIndex: idx, answeredAt,
    }));
    flushPracticeQueue(api.syncPracticeSession, userId);
    setSubmitting(false);
    setTimeout(() => { submitLockRef.current = false; }, 0);
    if (localResult.correct) {
      if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
      autoNextTimer.current = setTimeout(() => next(), 1100);
    }
  };

  const finish = async () => {
    // 完成本轮必须是用户主动确认：未全答完直接拒绝并提示剩余题数，不调接口
    if (!allAnswered) {
      toast(`还有${questions.length - answeredShown}道题未完成`, 'error');
      setSheetOpen(true);
      return;
    }
    if (finishing) return;
    setFinishing(true);
    try {
      await flushPracticeQueue(api.syncPracticeSession, userId);
      if (pendingPracticeCount(sessionId, userId) > 0) {
        toast('进度已保存在本机，联网同步后即可完成本轮', 'success');
        return;
      }
      // 后端再次强制校验（answeredCount < total → 400），通过才 completed=true + completedAt
      const { session: s } = await api.completeSession(sessionId);
      setSession(s);
      removeOfflineSession(sessionId);
      // 全库连刷走完：祝贺 + 三选一（看记录/重开/回首页），不自动建新会话
      if (isFullBank && s?.allAnswered !== false) {
        setCompleted(true);
        toast('恭喜完成本轮顺序刷题', 'success');
        return;
      }
      toast('本轮刷题已完成', 'success');
      navigate('/practice', { replace: true });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setFinishing(false);
    }
  };

  const restart = async () => {
    // 用户主动“重新开始”才从第1题重开：删旧会话建全新同模式全库轮次
    try {
      await api.deleteSession(sessionId);
      removeOfflineSession(sessionId);
      removePracticeQueue(sessionId);
      const { session: s } = await api.createSession({ mode: session?.mode || 'order' });
      navigate(`/practice/s/${s._id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const toggleFav = async () => {
    if (!q) return;
    try {
      if (favorited) { await api.removeFavorite(q._id); setFavorited(false); }
      else { await api.addFavorite(q._id); setFavorited(true); toast('已收藏', 'success'); }
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async () => {
    try {
      await api.deleteSession(sessionId);
      removeOfflineSession(sessionId);
      removePracticeQueue(sessionId);
      toast('已删除该刷题记录', 'success');
      navigate('/practice', { replace: true });
    } catch (e) { toast(e.message, 'error'); }
  };

  if (loading) return <PageLoading />;
  if (notFound) return (<div><TopBar title="刷题" /><Empty text="该刷题记录不存在或已删除" action={<button className="btn-primary mx-auto mt-4" onClick={() => navigate('/practice')}>返回刷题</button>} /></div>);
  if (!questions.length) return (<div><TopBar title="刷题" /><Empty text="暂无题目" /></div>);
  // 全库连刷走完 1200/1200：完成态（三选一），不自动建新会话
  if (completed) {
    return (
      <div>
        <TopBar title={session?.title || modeName} back={false} />
        <div className="px-4 pb-6">
          <div className="card p-6 text-center">
            <p className="text-[20px] font-bold text-ink">恭喜完成本轮顺序刷题</p>
            <p className="mt-2 text-[14px] text-sub">
              共 {questions.length} 题 · 已答 {answeredShown} · 答对 {okShown} · 答错 {badShown}
            </p>
            <div className="mt-5 space-y-2.5">
              <button className="btn-primary w-full" onClick={() => { setCompleted(false); setSheetOpen(true); }}>查看答题记录</button>
              <button className="btn-secondary w-full" onClick={restart}>重新开始</button>
              <button className="btn-ghost w-full" onClick={() => navigate('/', { replace: true })}>返回首页</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar
        title={session?.title || modeName}
        right={
          <div className="flex items-center gap-2">
            <button onClick={toggleFav} className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm" aria-label="收藏">
              <svg width="17" height="17" viewBox="0 0 24 24" fill={favorited ? '#F5A623' : 'none'} stroke={favorited ? '#F5A623' : '#86868B'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
            </button>
            <button onClick={() => setSheetOpen(true)} className="flex h-9 items-center rounded-full bg-white px-3.5 text-[13px] font-semibold text-ink shadow-sm">
              {doneCount}/{questions.length}
            </button>
          </div>
        }
      />
      {!online && (
        <p className="mx-4 mb-2 rounded-xl bg-warn/[0.08] px-3 py-2 text-center text-[12px] text-warn">
          当前离线，进度将在联网后自动同步
        </p>
      )}
      <div className="min-h-[60vh] overflow-hidden px-4 pb-[176px]">
        <QuestionCard
          q={q}
          dir={dir}
          index={idx}
          total={questions.length}
          value={cur.submitted ? cur.answer : input}
          onChange={(v) => {
            // 未提交时同步记草稿（按题存），切题回来还能接着选
            if (!cur.submitted && qid) draftsRef.current[qid] = Array.isArray(v) ? [...v] : v;
            setInput(v);
          }}
          onSubmit={submit}
          submitted={cur.submitted}
          result={result}
        />
      </div>

      <div className={`fixed inset-x-0 bottom-[calc(68px+var(--safe-area-bottom))] z-30 transition-transform duration-200 ${keyboardOpen ? 'translate-y-[calc(100%+24px)]' : ''}`} aria-hidden={keyboardOpen}>
        <div className="mx-auto w-full max-w-xl bg-bg/90 px-4 pb-2 pt-1 backdrop-blur-xl">
          <p className="mb-2 h-4 text-center text-[12px] text-sub">
            {doneCount > 0 ? `已答 ${doneCount} · 答对 ${okCount}` : ' '}
          </p>
          <div className="flex gap-3">
            <button className="btn-secondary h-[52px] flex-1" disabled={idx === 0 || submitting || finishing} onClick={prev}>上一题</button>
            <button className="btn-primary h-[52px] flex-1" disabled={submitting || finishing} onClick={next}>
              {idx + 1 >= questions.length ? '完成' : '下一题'}
            </button>
          </div>
        </div>
      </div>

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={`答题卡（已答 ${answeredShown}/${questions.length}）`}>
        <div className="mb-3 flex items-center gap-4 px-1 text-[12px] text-sub">
          <span>已答 <b className="text-ink">{answeredShown}</b></span>
          <span>未答 <b className="text-ink">{questions.length - answeredShown}</b></span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-ok" />答对 {okShown}</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-bad" />答错 {badShown}</span>
        </div>
        {allAnswered && (
          <p className="mb-3 rounded-2xl bg-ok/[0.08] p-3 text-center text-[13px] font-semibold text-ok">
            全部题目已完成，确认无误后点击“完成本轮”
          </p>
        )}
        {!allAnswered && (
          <p className="mb-3 rounded-2xl bg-black/[0.03] p-3 text-center text-[13px] text-sub">
            还有{questions.length - answeredShown}道题未完成
          </p>
        )}
        <div className="grid max-h-[46vh] grid-cols-5 gap-2.5 overflow-y-auto pr-0.5">
          {questions.map((item, i) => {
            const st = states[String(item._id)];
            const answered = !!st?.submitted;
            const graded = answered && st.autoGraded;
            return (
              <button
                key={item._id}
                onClick={() => { setSheetOpen(false); goto(i); }}
                aria-label={`第${i + 1}题${answered ? (graded ? (st.correct ? '已答对' : '已答错') : '已作答') : '未作答'}`}
                className={`flex h-11 items-center justify-center rounded-full text-[14px] font-semibold ${
                  i === idx ? 'ring-2 ring-ink ring-offset-1' : ''
                } ${graded && st.correct ? 'bg-ok text-white' : graded && st.correct === false ? 'bg-bad text-white' : answered ? 'bg-ink text-white' : 'border border-line bg-white text-sub'}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex gap-2.5">
          <button className="btn-secondary flex-1 !py-2.5 text-[13px]" onClick={() => { setSheetOpen(false); }}>继续刷题</button>
          {/* 完成本轮只在全部答完时出现；未完成只有“继续刷题” */}
          {allAnswered ? (
            <button className="btn-primary flex-1 !py-2.5 text-[13px]" disabled={finishing} onClick={finish}>
              {finishing ? '提交中…' : '完成本轮'}
            </button>
          ) : null}
        </div>
        <div className="mt-2.5">
          <button className="w-full text-center text-[12px] text-faint" onClick={remove}>删除本轮</button>
        </div>
      </Modal>
    </div>
  );
}

function pickAnswers(states) {
  const o = {};
  for (const [k, v] of Object.entries(states || {})) {
    if (v && v.submitted) o[k] = {
      answer: v.answer ?? null, correct: v.correct ?? null, autoGraded: !!v.autoGraded,
      correctAnswer: v.correctAnswer ?? null, textAnswer: v.textAnswer || '',
      answeredAt: v.answeredAt || '', pending: !!v.pending, submitted: true,
    };
  }
  return o;
}
