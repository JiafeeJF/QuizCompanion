import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { AnswerLines } from './ui.jsx';

/**
 * 题目卡片（练习/考试/错题/收藏复用）
 * props:
 * - q: { type, stem, options, score }
 * - value: 用户当前选择（number | number[] | null）
 * - onChange(v)
 * - onSubmit(v) 点击提交（多选题确认）
 * - submitted: 是否已提交（展示对错）
 * - result: { correct, answer, textAnswer, autoGraded }
 * - revealAnswer: 直接显示答案（收藏页回顾）
 * - index, total
 * - dir: 切题滑入方向，1 = 下一题（从右侧滑入），-1 = 上一题（从左侧滑入）
 * - slide: 是否启用横向滑入动画。复用该卡片的长列表页（考试整卷、错题展开）
 *   请传 slide={false}，避免整页题目同时横滑造成晃动
 */
const LETTERS = 'ABCDEFG';

export default function QuestionCard({ q, index, total, value, onChange, onSubmit, submitted, result, revealAnswer = false, dir = 1, slide = true }) {
  const isMultiple = q.type === 'multiple';
  // 判分在途（submitted=true 但 result=null）：选项只显示“已选”（黑），
  // 不显示对错；结论条不渲染 —— 杜绝 result 为 null 时 Boolean 默认 false 导致的先错后对闪烁
  const grading = submitted && !result && !revealAnswer;
  const showResult = (submitted && !!result) || revealAnswer;
  const correctAnswer = result?.answer ?? q.answer ?? null;
  const isCorrect = result?.correct;
  const [shaking, setShaking] = useState(false);

  if (!q) return null;

  const pick = (i) => {
    if (showResult) return;
    if (isMultiple) {
      const arr = Array.isArray(value) ? [...value] : [];
      const pos = arr.indexOf(i);
      if (pos >= 0) arr.splice(pos, 1);
      else arr.push(i);
      arr.sort((a, b) => a - b);
      onChange(arr);
    } else {
      onChange(i);
      // 单选/判断立即提交
      onSubmit?.(i);
    }
  };

  const confirmMultiple = () => {
    if (!value || !value.length) {
      setShaking(true);
      setTimeout(() => setShaking(false), 400);
      return;
    }
    onSubmit?.(value);
  };

  const optionState = (i) => {
    if (!showResult) {
      const picked = isMultiple ? (value || []).includes(i) : value === i;
      return picked ? 'picked' : 'normal';
    }
    const ca = Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer];
    const picked = isMultiple ? (value || []).includes(i) : value === i;
    if (ca.includes(i)) return 'correct';
    if (picked) return 'wrong';
    return 'normal';
  };

  const typeName = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' }[q.type] || q.type;

  return (
    <motion.div
      /* 卡片外壳保持挂载，切题动画只作用于内部内容，避免整个卡片短暂消失。 */
      animate={shaking ? { x: [0, -6, 6, -4, 0] } : undefined}
      transition={shaking ? { duration: 0.28 } : undefined}
      className="card w-full min-w-0 overflow-hidden p-5"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="chip bg-black/[0.05] text-sub">{typeName}</span>
        <span className="chip bg-black/[0.05] text-sub">{q.score || 2} 分</span>
        <span className="ml-auto text-[13px] font-medium text-faint">
          {index + 1} / {total}
        </span>
      </div>

      <motion.div
        key={q._id}
        // 只让题目内容横向移动，题号栏保持固定，且不改变透明度。
        initial={{ x: dir > 0 ? 30 : -30 }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 30, mass: 0.8 }}
      >
      <p className="whitespace-pre-wrap text-[16px] font-semibold leading-relaxed text-ink">{q.stem}</p>

      {q.type === 'fill' || q.type === 'short' ? (
        <div className="mt-4">
          <textarea
            className="input-field min-h-[90px]"
            placeholder="写下你的答案…"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            disabled={showResult}
          />
          {!showResult && (
            <button className="btn-primary mt-3 w-full" onClick={() => onSubmit?.(value)}>
              提交答案
            </button>
          )}
          {showResult && result && !result.autoGraded && (
            <div className="mt-3 rounded-2xl bg-black/[0.03] p-4">
              <p className="text-[13px] font-medium text-sub">参考答案</p>
              <p className="mt-1 whitespace-pre-wrap text-[14px] text-ink">{result.textAnswer || q.textAnswer}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {(q.options || []).map((opt, i) => {
            const st = optionState(i);
            const base = 'flex min-h-11 w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.985]';
            const styles = {
              normal: 'border-line bg-white active:bg-black/[0.02]',
              picked: 'border-ink bg-ink/[0.03]',
              correct: 'border-ok bg-ok/[0.08]',
              wrong: 'border-bad bg-bad/[0.08]',
            };
            return (
              <button
                key={i}
                type="button"
                className={`${base} ${styles[st]}`}
                onClick={() => pick(i)}
                disabled={showResult}
                aria-pressed={isMultiple ? (value || []).includes(i) : value === i}
              >
                <span
                  className={`mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${
                    st === 'correct'
                      ? 'bg-ok text-white'
                      : st === 'wrong'
                      ? 'bg-bad text-white'
                      : st === 'picked'
                      ? 'bg-ink text-white'
                      : 'bg-black/[0.06] text-sub'
                  }`}
                >
                  {LETTERS[i]}
                </span>
                <span className="text-[15px] leading-relaxed text-ink">{opt}</span>
                {st === 'correct' && (
                  <svg className="ml-auto mt-1 shrink-0 text-ok" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                )}
                {st === 'wrong' && (
                  <svg className="ml-auto mt-1 shrink-0 text-bad" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                )}
              </button>
            );
          })}
          {isMultiple && !showResult && (
            <button type="button" className="btn-primary w-full" onClick={confirmMultiple}>
              确认提交（{LETTERS[(value || [])[0]] ?? ''}{(value || []).length > 1 ? '等多选' : ''}）
            </button>
          )}
        </div>
      )}

      {showResult && (result?.autoGraded !== false) && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="overflow-hidden">
          <div className={`mt-4 rounded-2xl p-4 ${isCorrect ? 'bg-ok/[0.08]' : 'bg-bad/[0.06]'}`}>
            <p className={`text-[14px] font-bold ${isCorrect ? 'text-ok' : 'text-bad'}`}>
              {isCorrect ? '回答正确' : '回答错误'}
            </p>
            {/* 结算行：你的答案 + 正确答案都带字母和选项中文 */}
            <div className="mt-1.5 space-y-1.5 text-[13px]">
              <p>
                <span className="text-sub">你的答案：</span>
                <AnswerLines
                  type={q.type}
                  answer={isMultiple ? (value ?? []) : value}
                  options={q.options}
                  textAnswer={typeof value === 'string' ? value : ''}
                  tone={isCorrect ? 'ok' : 'bad'}
                />
              </p>
              {!isCorrect && (
                <p>
                  <span className="text-sub">正确答案：</span>
                  <AnswerLines type={q.type} answer={correctAnswer} options={q.options} textAnswer={result?.textAnswer || q.textAnswer} tone="ok" />
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {showResult && result && result.autoGraded === false && (
        <div className="mt-3 rounded-2xl bg-warn/[0.08] p-4">
          <p className="text-[13px] font-bold text-warn">主观题：已提交，等待教师批阅/对照参考答案自评</p>
        </div>
      )}
      </motion.div>
    </motion.div>
  );
}
