import React, { useState } from 'react';
import { useNavigate, Link, Outlet } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../auth.jsx';
import { ConfirmBar, useConfirm } from './Confirm.jsx';

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

export function Shell() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [confirmState, setConfirmState] = useState(null);
  const path = window.location.pathname;
  const active = (to) => (to === '/' ? path === '/' : path.startsWith(to));

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-bg">
      <main className="px-4 pb-[calc(88px+var(--safe-area-bottom))]">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-xl border-t border-line bg-white/90 pb-[var(--safe-area-bottom)] backdrop-blur-xl">
        <div className="grid grid-cols-4 px-2 pt-1.5">
          {NAV.map((n) => (
            <button
              key={n.to}
              onClick={() => navigate(n.to)}
              className="flex flex-col items-center gap-1 rounded-2xl py-1.5 active:bg-black/[0.04]"
            >
              {n.icon(active(n.to))}
              <span className={`text-[11px] font-medium ${active(n.to) ? 'text-ink' : 'text-faint'}`}>{n.label}</span>
            </button>
          ))}
        </div>
      </nav>
      <ConfirmBar state={confirmState} onClose={() => setConfirmState(null)} />
      {/* 教师/管理员快捷入口（底部上方小浮层按钮由各自页面内提供，这里补全局链接） */}
      {(user?.role === 'teacher' || user?.role === 'admin') && (
        <RoleDock role={user.role} />
      )}
    </div>
  );
}

/** 教师/管理员快捷入口小浮钮 */
function RoleDock({ role }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-[calc(96px+var(--safe-area-bottom))] right-4 z-40 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="flex flex-col gap-2">
            {role === 'teacher' && (
              <>
                <DockBtn label="我的班级" onClick={() => { setOpen(false); navigate('/teacher'); }} />
                <DockBtn label="布置考试" onClick={() => { setOpen(false); navigate('/teacher/create-exam'); }} />
                <DockBtn label="班级数据" onClick={() => { setOpen(false); navigate('/teacher'); }} />
              </>
            )}
            {role === 'admin' && (
              <>
                <DockBtn label="管理后台" onClick={() => { setOpen(false); navigate('/admin'); }} />
                <DockBtn label="题库导入" onClick={() => { setOpen(false); navigate('/admin/questions'); }} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen(!open)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-ink text-white shadow-lg active:scale-95"
        aria-label="管理入口"
      >
        <motion.span animate={{ rotate: open ? 45 : 0 }}>＋</motion.span>
      </button>
    </div>
  );
}

function DockBtn({ label, onClick }) {
  return (
    <button onClick={onClick} className="rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-ink shadow-lg">
      {label}
    </button>
  );
}
