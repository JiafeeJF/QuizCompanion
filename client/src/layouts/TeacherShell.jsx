import React from 'react';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

/**
 * 教师端独立布局：深色顶栏 + 三 Tab（班级 / 布置 / 我的）
 * 独立于学员端，与管理后台互不影响。
 * 顶部安全区由顶栏自身处理，子页面禁止再加顶部安全区 padding。
 */
const TABS = [
  { to: '/teacher', label: '班级', end: true, icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 10h8M8 14h5" /></svg>
  ) },
  { to: '/teacher/create-exam', label: '布置', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
  ) },
  { to: '/teacher/mine', label: '我的', icon: (a) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a ? '#1D1D1F' : '#AEAEB2'} strokeWidth={a ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>
  ) },
];

export function TeacherShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const active = (t) => (t.end ? pathname === t.to : pathname.startsWith(t.to));

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-bg">
      {/* 教师端顶栏：自身处理顶部安全区 */}
      <div className="sticky top-0 z-40 bg-ink px-4 pb-3 pt-[calc(var(--safe-area-top)+12px)] text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] tracking-widest text-white/50">物联宝典 · 教师端</p>
            <p className="text-[19px] font-bold">教学工作台</p>
          </div>
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            className="rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium text-white active:bg-white/20"
          >
            退出
          </button>
        </div>
      </div>
      <main className="px-4 pb-[calc(88px+var(--safe-area-bottom))] pt-3">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-xl border-t border-line bg-white/90 pb-[var(--safe-area-bottom)] backdrop-blur-xl">
        <div className="grid grid-cols-3 px-2 pt-1.5">
          {TABS.map((t) => (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className="flex flex-col items-center gap-1 rounded-2xl py-1.5 active:bg-black/[0.04]"
            >
              {t.icon(active(t))}
              <span className={`text-[11px] font-medium ${active(t) ? 'text-ink' : 'text-faint'}`}>{t.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
