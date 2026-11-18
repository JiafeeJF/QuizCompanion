import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar, Modal } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import QuestionCard from '../components/QuestionCard.jsx';

/**
 * 刷题答题页：/practice/order 顺序 / /practice/random 随机 / /practice/chapter/:id 章节
 * - 逐题作答，单选/判断点选即判；多选确认后判；填空/简答提交后展示参考答案
 * - 答对自动 1.2s 后下一题；答错停留看正确答案
 * - 切题时回到顶部：新题高度与旧题不同时，若保留原 scrollY，
 *   视觉上就是“自己往下跳了一点”，所以每次 idx 变化都把纵向滚动清零
 */
const PAGE = 20;

export default function Practice() {
  const { id: chapterId } = useParams();
  const path = window.location.pathname;
  const mode = path.includes('/random') ? 'random' : chapterId ? 'chapter' : 'order';
  const navigate = useNavigate();
  const toast = useToast();

  const [questions, setQuestions] = useState([]);
  const [skip, setSkip] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [value, setValue] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [favorited, setFavorited] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [answers, setAnswers] = useState([]); // 每题对错记录（答题卡）
  const [submitting, setSubmitting] = useState(false);
  const [chapterName, setChapterName] = useState('');
  // 切题滑入方向：下一题从右侧进（dir=1），上一题从左侧进（dir=-1）
  const [dir, setDir] = useState(1);
  // 答对自动下一题的定时器：手动切题时清掉，避免“连跳两题”
  const autoNextTimer = useRef(null);

  const title = mode === 'random' ? '随机练习' : mode === 'chapter' ? chapterName || '章节练习' : '顺序练习';

  const load = useCallback(
    async (reset = false) => {
      const sk = reset ? 0 : skip;
      try {
        if (mode === 'chapter' && !chapterId) return;
        const params = { mode, limit: PAGE };
        if (mode === 'order') params.skip = sk;
        if (mode === 'chapter') params.chapterId = chapterId;
        const data = await api.questions(params);
        setQuestions((prev) => (reset ? data.questions : [...prev, ...data.questions]));
        setSkip(sk + PAGE);
        setHasMore(data.hasMore && data.questions.length === PAGE);
        if (mode === 'chapter' && reset && data.questions.length) {
          // 章节名从章节列表取
          api.chapters().then(({ chapters }) => {
            const c = chapters.find((x) => String(x._id) === String(chapterId));
            if (c) setChapterName(c.name);
          }).catch(() => {});
        }
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [mode, chapterId, skip]
  );

  useEffect(() => {
    setQuestions([]); setSkip(0); setIdx(0); setAnswers([]);
    setValue(null); setSubmitted(false); setResult(null);
    setLoading(true);
    window.scrollTo(0, 0);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, chapterId]);

  // 切题回到顶部：用 rAF 等新题 DOM 落位后再滚，避免被滑入动画带偏
  useEffect(() => {
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(raf);
  }, [idx]);

  // 切换题目时清掉“答对自动下一题”定时器，避免手动点下一题后定时器又跳一题
  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
  }, [idx]);

  const q = questions[idx];

  // 收藏状态
  useEffect(() => {
    if (!q) return;
    setValue(null); setSubmitted(false); setResult(null);
    api.checkFavorites([q._id]).then(({ favorited }) => setFavorited(favorited.includes(String(q._id)))).catch(() => setFavorited(false));
  }, [idx, questions.length]);

  const submit = async (ans) => {
    if (!q || submitted || submitting) return;
    setSubmitting(true);
    try {
      const r = await api.answer({ questionId: q._id, answer: ans ?? value, mode });
      setResult(r);
      setSubmitted(true);
      setAnswers((prev) => {
        const next = [...prev];
        next[idx] = r.autoGraded ? (r.correct ? 'ok' : 'bad') : 'done';
        return next;
      });
      if (r.correct) {
        if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
        autoNextTimer.current = setTimeout(() => next(), 1100);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const next = () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    setDir(1);
    if (idx + 1 < questions.length) {
      setIdx(idx + 1);
    } else if (hasMore) {
      load().then(() => setIdx(idx + 1));
    } else {
      toast('本组题目已刷完', 'success');
    }
  };
  const prev = () => {
    if (idx > 0) {
      if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
      setDir(-1);
      setIdx(idx - 1);
    }
  };

  const toggleFav = async () => {
    if (!q) return;
    try {
      if (favorited) { await api.removeFavorite(q._id); setFavorited(false); }
      else { await api.addFavorite(q._id); setFavorited(true); toast('已收藏', 'success'); }
    } catch (e) { toast(e.message, 'error'); }
  };

  if (loading) return <PageLoading />;
  if (!questions.length) return (<div><TopBar title={title} /><Empty text="暂无题目" /></div>);

  const doneCount = answers.filter(Boolean).length;
  const okCount = answers.filter((a) => a === 'ok').length;

  return (
    <div>
      <TopBar
        title={title}
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
      {/*
        不用 AnimatePresence 包题面：
        popLayout/wait 模式在新旧题交替时会让容器高度瞬间塌陷再撑开，
        浏览器按比例顺延滚动条，视觉上就是“切题往下跳一点”。
        这里直接 key 切换原地替换，只有入场滑入、没有退场塌陷，高度只增不闪。
      */}
      <div className="min-h-[60vh] overflow-hidden px-4 pb-[176px]">
        <QuestionCard
          key={q._id}
          q={q}
          dir={dir}
          index={idx}
          total={questions.length}
          value={value}
          onChange={setValue}
          onSubmit={submit}
          submitted={submitted}
          result={result}
        />
      </div>

      {/* 底部固定操作栏：位置固定，不随题面高度变化 */}
      {/* 底部固定操作栏：bottom 抬高避开学员端 Tab + 底部安全区 */}
      <div className="fixed inset-x-0 bottom-[calc(68px+var(--safe-area-bottom))] z-30">
        <div className="mx-auto w-full max-w-xl bg-bg/90 px-4 pb-2 pt-1 backdrop-blur-xl">
          <p className="mb-2 h-4 text-center text-[12px] text-sub">
            {doneCount > 0 ? `已答 ${doneCount} · 答对 ${okCount}` : ' '}
          </p>
          <div className="flex gap-3">
            <button className="btn-secondary h-[52px] flex-1" disabled={idx === 0} onClick={prev}>上一题</button>
            <button className="btn-primary h-[52px] flex-1" onClick={next}>
              {idx + 1 >= questions.length && !hasMore ? '完成' : '下一题'}
            </button>
          </div>
        </div>
      </div>

      {/* 答题卡 */}
      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={`答题卡（已答 ${doneCount}）`}>
        <div className="grid grid-cols-5 gap-2.5">
          {questions.map((item, i) => {
            const st = answers[i];
            return (
              <button
                key={item._id}
                onClick={() => { setDir(i >= idx ? 1 : -1); setIdx(i); setSheetOpen(false); }}
                className={`flex h-11 items-center justify-center rounded-xl text-[14px] font-semibold ${
                  i === idx ? 'ring-2 ring-ink ring-offset-1' : ''
                } ${st === 'ok' ? 'bg-ok text-white' : st === 'bad' ? 'bg-bad text-white' : st ? 'bg-black/[0.08] text-ink' : 'bg-black/[0.04] text-sub'}`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}

// 占位：避免 PracticeHome 的 navigate 目标缺失时报错（路由已配置，此导出仅保留兼容）
export function PracticeAlias() {
  const navigate = useNavigate();
  useEffect(() => { navigate('/practice', { replace: true }); }, [navigate]);
  return null;
}
