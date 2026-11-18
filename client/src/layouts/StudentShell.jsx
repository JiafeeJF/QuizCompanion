import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { useNotices } from '../notices.jsx';

const NAV = [
  { to: '/', label: '首页', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5L12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
  ) },
  { to: '/practice', label: '刷题', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20V4a1 1 0 00-1-1H6.5A2.5 2.5 0 004 5.5v14z" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" /></svg>
  ) },
  { to: '/exams', label: '模考', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h11" /></svg>
  ) },
  { to: '/mine', label: '我的', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>
  ) },
];

/**
 * 学员端独立布局：底部四 Tab 导航（首页 / 刷题 / 模考 / 我的）
 * 与教师端、管理后台完全分离，不再混入教师/管理员快捷入口。
 * 顶部安全区由各页面 TopBar/页头处理，Shell 只处理底部导航安全区，避免双重 padding。
 */
export function StudentShell() {
  const navigate = useNavigate();
  const { unread } = useNotices();
  const [examActive, setImmersive] = useState(false);
  // 网页与 APP 共用：开始考试后仅将底栏滑出，不调用浏览器全屏。
  useEffect(() => {
    const onImmersive = (e) => {
      setImmersive(!!(e && e.detail && e.detail.active));
    };
    window.addEventListener('wlbd:exam-immersive', onImmersive);
    return () => window.removeEventListener('wlbd:exam-immersive', onImmersive);
  }, []);
  // 兜底：切 Tab 即恢复（防事件丢失导致导航条长隐）
  const goTab = (to) => {
    setImmersive(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    navigate(to);
  };
  const { pathname: path } = useLocation();
  // Direct exam links and result routes also keep navigation hidden throughout
  // loading and submission, independent of component mount/unmount events.
  const immersive = examActive || /^\/exams\/(?!custom(?:\/|$))[^/]+(?:\/result)?\/?$/.test(path);
  useEffect(() => {
    setImmersive(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [path]);
  const active = (to) => (to === '/' ? path === '/' : path.startsWith(to));
  const activeIndex = Math.max(0, NAV.findIndex((n) => active(n.to)));

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-bg sm:max-w-2xl">
      {/* 内容区只负责底部留白，横向内边距由各页面/TopBar 自己控制（统一 px-4），
          避免 Shell 一层 + 页面一层造成 16px vs 32px 不一致 */}
      <main className={`w-full min-w-0 transition-[padding-bottom] duration-300 ease-out ${immersive ? 'pb-6' : 'pb-[calc(88px+var(--safe-area-bottom))]'}`}>
        <Outlet />
      </main>
      <nav
        className={`wlbd-glass fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-xl border-t pb-[var(--safe-area-bottom)] transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform sm:max-w-2xl ${immersive ? 'pointer-events-none translate-y-full opacity-0' : 'translate-y-0 opacity-100'}`}
        aria-label="主导航"
        aria-hidden={immersive}
      >
        <div className="relative grid grid-cols-4 px-2 pt-1.5">
          <span className="wlbd-nav-slider absolute left-2 top-1.5 h-11 w-[calc((100%-1rem)/4)] rounded-2xl bg-black/[0.045]" style={{ transform: `translateX(${activeIndex * 100}%)` }} aria-hidden="true" />
          {NAV.map((n) => (
            <button
              key={n.to}
              onClick={() => goTab(n.to)}
              className="relative z-10 flex min-h-11 flex-col items-center gap-1 rounded-2xl py-1.5 transition active:scale-[0.98]"
            >
              {n.icon(active(n.to))}
              <span className={`text-[11px] font-medium ${active(n.to) ? 'text-ink' : 'text-faint'}`}>{n.label}</span>
              {/* 新考试/作业未读红点（只打在模考 Tab） */}
              {n.to === '/exams' && unread > 0 && (
                <span className="absolute right-1/2 top-0.5 flex h-[18px] min-w-[18px] translate-x-5 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold tabular-nums text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
