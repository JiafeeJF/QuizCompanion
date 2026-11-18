import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar, AnswerLines } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';

/** 考试成绩 + 错题回顾 */
export default function ExamResult({ examId, onExit, onRetry }) {
  const { id: routeId } = useParams();
  const id = examId || routeId;
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all'); // all | wrong
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.examResult(id);
        setData(d);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) return <PageLoading />;
  if (!data) return (<div><TopBar title="成绩" onBack={onExit} /><Empty text="暂无成绩，先完成考试" action={<button className="btn-primary mx-auto mt-4" onClick={onRetry || (() => navigate(`/exams/${id}`))}>去考试</button>} /></div>);

  const { attempt, detail, exam, ranking } = data;
  const list = detail.filter((d) => (filter === 'wrong' ? !d.correct : true));
  // Use the canonical server-side duration (seconds). The server derives it
  // from submittedAt - startedAt and normalizes legacy records on read.
  const durationSec = Number.isFinite(Number(attempt?.durationSec))
    ? Math.max(0, Math.floor(Number(attempt.durationSec)))
    : null;
  const formatExamDuration = (sec) => {
    if (sec === null || sec === undefined) return '--';
    const n = Math.max(0, Math.floor(Number(sec)));
    if (n < 60) return `${n}秒`;
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = String(n % 60).padStart(2, '0');
    return h > 0 ? `${h}小时${m}分${s}秒` : `${m}分${s}秒`;
  };

  return (
    <div>
      <TopBar title="考试成绩" onBack={onExit} />
      <div className="px-4 pb-6">
        <div className="card p-6 text-center">
          <p className="text-[13px] text-sub">{exam.title}</p>
          <p className="mt-2 text-[52px] font-bold leading-none text-ink">{attempt.score}<span className="text-[18px] text-faint">/{attempt.totalScore}</span></p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[12px] text-sub">
            <div className="min-w-0"><p>答对</p><p className="mt-1 whitespace-nowrap text-[15px] font-semibold text-ink">{attempt.correctCount}/{attempt.totalCount}</p></div>
            <div className="min-w-0"><p>正确率</p><p className="mt-1 whitespace-nowrap text-[15px] font-semibold text-ok">{attempt.accuracy}%</p></div>
            <div className="min-w-0"><p>用时</p><p className="mt-1 whitespace-nowrap text-[15px] font-semibold text-ink">{formatExamDuration(durationSec)}</p></div>
          </div>
          <div className="mt-4 flex gap-2.5">
            <button className="btn-secondary flex-1" onClick={onRetry || (() => navigate(`/exams/${id}`))}>再考一次</button>
            <button className="btn-primary flex-1" onClick={onExit || (() => navigate('/exams'))}>返回列表</button>
          </div>
        </div>

        {exam.kind === 'teacher' && (
          <div className="card mt-5 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold text-ink">班级排名</h2>
              {ranking?.available && <span className="text-[12px] text-faint">共 {ranking.total} 人</span>}
            </div>
            {!ranking ? (
              <div className="mt-4 space-y-2"><div className="skeleton h-5 w-28" /><div className="skeleton h-10 w-full" /></div>
            ) : !ranking.available ? (
              <p className="mt-4 text-[13px] text-sub">当前班级暂不可查看排名</p>
            ) : ranking.list?.length ? (
              <div className="mt-3 space-y-2">
                <p className="text-[14px] text-sub">我的名次：<b className="text-ink">{ranking.myRank ? `第 ${ranking.myRank} 名` : '暂未上榜'}</b></p>
                <div className="divide-y divide-line rounded-xl bg-black/[0.025] px-3">
                  {ranking.list.slice(0, 5).map((row) => (
                    <div key={`${row.rank}-${row.name}`} className={`flex items-center gap-3 py-2.5 text-[13px] ${row.mine ? 'font-semibold text-ink' : 'text-sub'}`}>
                      <span className="w-8 shrink-0 text-center tabular-nums">{row.rank}</span>
                      <span className="min-w-0 flex-1 truncate">{row.mine ? '我' : (row.name || '同学')}</span>
                      <span className="shrink-0 tabular-nums">{row.score} 分</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[13px] text-sub">暂无可用排名数据</p>
            )}
          </div>
        )}

        <div className="mb-2.5 mt-5 flex items-center justify-between">
          <h2 className="section-title">答题回顾</h2>
          <div className="flex gap-2">
            <button onClick={() => setFilter('all')} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${filter === 'all' ? 'bg-ink text-white' : 'bg-white text-sub'}`}>全部</button>
            <button onClick={() => setFilter('wrong')} className={`rounded-full px-4 py-1.5 text-[13px] font-semibold ${filter === 'wrong' ? 'bg-ink text-white' : 'bg-white text-sub'}`}>只看错题</button>
          </div>
        </div>
        <div className="space-y-2.5">
          {list.map((d, i) => (
            <div key={d.questionId} className="card p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className={`chip ${d.correct ? 'bg-ok/[0.1] text-ok' : 'bg-bad/[0.08] text-bad'}`}>{d.correct ? `＋${d.gotScore}` : '0 分'}</span>
                <span className="ml-auto text-[12px] text-faint">第 {i + 1} 题</span>
              </div>
              <p className="text-[14px] font-semibold leading-relaxed text-ink">{d.stem}</p>
              <div className="mt-2 space-y-1.5 text-[13px]">
                <p>
                  <span className="text-sub">你的答案：</span>
                  <AnswerLines type={d.type} answer={d.userAnswer} options={d.options} textAnswer={d.userAnswer} tone={d.correct ? 'ok' : 'bad'} />
                </p>
                {!d.correct && (
                  <p>
                    <span className="text-sub">正确答案：</span>
                    <AnswerLines type={d.type} answer={d.answer} options={d.options} textAnswer={d.textAnswer} tone="ok" />
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
