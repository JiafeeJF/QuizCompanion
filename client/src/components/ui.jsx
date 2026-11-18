import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import memberLockUrl from '../assets/member-lock.png';
import DialogLayer from './DialogLayer.jsx';

export function formatBeijingDateTimeInput(value) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}`;
}

export function parseBeijingDateTimeInput(value) {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return '';
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute))).toISOString();
}

export function formatBeijingDateTime(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value)).replace(/\//g, '-');
}

/** 会员锁图标：统一用 img/-lock-outline_90452.png，不再用 emoji */
export function MemberLock({ size = 18, light = false, className = '' }) {
  return (
    <img
      src={memberLockUrl}
      alt="会员专属"
      width={size}
      height={size}
      draggable={false}
      className={`inline-block shrink-0 align-[-3px] ${className}`}
      style={{ width: size, height: size, ...(light ? { filter: 'brightness(0) invert(1)' } : undefined) }}
    />
  );
}

/** 顶部栏：返回 + 标题 + 右侧插槽（移动端优先）
 * 安全区由本组件统一处理（变量 --safe-area-top），子页面禁止再加顶部安全区 padding，避免双重 padding。 */
export function TopBar({ title, right = null, back = true, transparent = false, onBack }) {
  const navigate = useNavigate();
  return (
    <div
      className={`sticky top-0 z-40 flex items-center gap-2 px-4 pt-[calc(var(--safe-area-top)+8px)] pb-2 ${
        transparent ? '' : 'wlbd-glass border-b border-line/70'
      }`}
    >
      {back && (
        <button
          onClick={onBack || (() => (window.history.length > 1 ? navigate(-1) : navigate('/')))}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink shadow-sm transition active:scale-95"
          aria-label="返回"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold text-ink">{title}</h1>
      {right}
    </div>
  );
}

export function Card({ className = '', children, onClick }) {
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`card w-full p-4 text-left ${className}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onClick(e);
          }
        }}
      >
        {children}
      </div>
    );
  }
  return (
    <div className={`card p-4 ${className}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ value = 0, className = '' }) {
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-black/[0.06] ${className}`}>
      <motion.div
        className="h-full rounded-full bg-ink"
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

export function Stat({ label, value, sub, accent = false }) {
  return (
    <div className="card min-w-0 p-4 text-center">
      <p className={`truncate text-[20px] font-bold leading-none tabular-nums sm:text-[22px] ${accent ? 'text-ok' : 'text-ink'}`}>{value}</p>
      <p className="mt-1.5 text-[12px] text-sub">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-faint">{sub}</p>}
    </div>
  );
}

export function Modal({ open, onClose, title, children }) {
  return <DialogLayer open={open} onClose={onClose} title={title} priority={100} outerClass="z-[90]"
    panelClass="w-full max-w-md rounded-t-3xl bg-white p-5 pb-[calc(var(--safe-area-bottom)+20px)] sm:rounded-3xl sm:pb-5">
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="min-w-0 text-[17px] font-bold text-ink">{title}</h3>
      <button onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-sub" aria-label="关闭">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>{children}
  </DialogLayer>;
}

export function Switch({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors ${checked ? 'bg-ok' : 'bg-black/[0.12]'} ${disabled ? 'opacity-40' : ''}`}
      role="switch"
      aria-checked={checked}
    >
      <span className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-[2px]'}`} />
    </button>
  );
}

/**
 * 结果区答案行：字母 + 选项中文（单选/判断/多选），填空/简答显示文本答案。
 * 用在刷题结算条、错题本、考试回顾等所有判分后展示处。
 */
const LETTERS = 'ABCDEFG';

export function AnswerLines({ type, answer, options = [], textAnswer = '', tone = 'ink' }) {
  const opts = options || [];
  const isMulti = type === 'multiple';
  const isChoice = isMulti || type === 'single' || type === 'judge';
  if (!isChoice) {
    return <span className="font-semibold text-ink">{textAnswer || '—'}</span>;
  }
  const idxs = isMulti
    ? (Array.isArray(answer) ? answer : [])
    : answer === null || answer === undefined ? [] : [Number(answer)];
  if (!idxs.length) return <span className="font-semibold text-ink">未作答</span>;
  const toneCls = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-ink';
  return (
    <span>
      <span className={`font-bold ${toneCls}`}>{idxs.map((i) => LETTERS[Number(i)]).join('')}</span>
      {idxs.map((i) => (
        <span key={i} className="mt-0.5 block font-normal text-ink">
          <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.08] text-[11px] font-bold text-sub">
            {LETTERS[Number(i)]}
          </span>
          {opts[Number(i)] ?? ''}
        </span>
      ))}
    </span>
  );
}

/**
 * 用时格式化（秒 → 中文）：考试/排名/成绩所有展示用时的地方统一用它。
 * - 45 → "45秒"；125 → "2分05秒"；3725 → "1小时2分05秒"
 * - null/undefined/NaN/负数/0 → "--"（绝不出现 NaN 或空白）
 * - 非数字字符串（如 "120"）同样兼容
 */
export function formatDuration(sec) {
  const n = Math.floor(Number(sec));
  if (!Number.isFinite(n) || n <= 0) return '--';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}小时${m}分${ss}秒`;
  if (m > 0) return `${m}分${ss}秒`;
  return `${s}秒`;
}

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (pageSize || 15)));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-4">
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <span className="text-[13px] text-sub">{page} / {pages}</span>
      <button className="btn-ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  );
}
