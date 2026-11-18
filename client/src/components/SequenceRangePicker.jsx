import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * 顺序抽题范围选择器（学员组卷 + 教师出卷共用）：
 * 从当前题库有效题目中，按照题目顺序选择指定范围进行组卷。
 * 题号 = 全库 enabled 按 canonical 顺序的 1-based 序号（与顺序刷题一致）。
 */
export default function SequenceRangePicker({ start, end, onChange, compact = false }) {
  const [total, setTotal] = useState(null);
  const [preview, setPreview] = useState(null);
  const [timer, setTimer] = useState(null);

  useEffect(() => {
    api.sequenceTotal().then(({ total }) => setTotal(total)).catch(() => setTotal(null));
  }, []);

  // 输入防抖后拉范围预览（章节分布辅助信息；校验以提交时后端为准）
  useEffect(() => {
    if (timer) clearTimeout(timer);
    const s = Number(start);
    const e = Number(end);
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api.sequenceRangeInfo(s, e).then(setPreview).catch(() => setPreview(null));
    }, 500);
    setTimer(t);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const s = Number(start);
  const e = Number(end);
  const valid = Number.isInteger(s) && Number.isInteger(e) && s >= 1 && e >= s;
  const count = valid ? e - s + 1 : 0;
  const overTotal = total != null && Number.isInteger(e) && e > total;

  return (
    <div className={compact ? '' : 'card space-y-3 p-4'}>
      {!compact && <label className="label">顺序范围（从当前题库有效题目中，按照题目顺序选择指定范围进行组卷）</label>}
      {total != null && (
        <p className="text-[13px] text-sub">题库共 <b className="text-ink">{total}</b> 题</p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label">开始题号</label>
          <input
            type="number"
            className="input-field"
            min={1}
            max={total || undefined}
            value={start}
            onChange={(ev) => onChange({ start: ev.target.value === '' ? '' : Math.max(0, Number(ev.target.value) || 0), end })}
            placeholder="如 301"
          />
        </div>
        <div>
          <label className="label">结束题号</label>
          <input
            type="number"
            className="input-field"
            min={1}
            max={total || undefined}
            value={end}
            onChange={(ev) => onChange({ start, end: ev.target.value === '' ? '' : Math.max(0, Number(ev.target.value) || 0) })}
            placeholder="如 500"
          />
        </div>
      </div>
      {valid && !overTotal && (
        <p className="rounded-2xl bg-black/[0.03] p-3.5 text-[13px] text-ink">
          第 <b>{s}</b> ～ <b>{e}</b> 题，共 <b>{count}</b> 题
          {preview?.chapters?.length > 0 && (
            <span className="mt-1 block text-[12px] font-normal text-sub">
              题目范围：{preview.chapters.map((c) => `${c.name} ${c.count}题`).join(' → ')}
            </span>
          )}
        </p>
      )}
      {valid && e < s && (
        <p className="text-[13px] text-bad">结束题号不能小于开始题号</p>
      )}
      {overTotal && (
        <p className="text-[13px] text-bad">当前题库共有 {total} 道有效题，结束题号不能超过 {total}。</p>
      )}
    </div>
  );
}

/** 提交前本地校验（后端会再次校验，这里只做即时提示） */
export function validateSequenceInput(start, end, total) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isInteger(s) || !Number.isInteger(e) || start === '' || end === '') return '请填写开始题号和结束题号';
  if (s < 1) return '开始题号不能小于 1';
  if (e < s) return '结束题号不能小于开始题号';
  if (total != null && e > total) return `当前题库共有 ${total} 道有效题，结束题号不能超过 ${total}。`;
  return null;
}
