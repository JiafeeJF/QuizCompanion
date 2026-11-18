import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RequireAuth, RequireRole } from '../components/guards.jsx';
import BankInitPanel from '../components/BankInitPanel.jsx';
import { useAuth } from '../auth.jsx';

/**
 * BankInit：题库初始化路由壳（独立访问入口，如 from 直链/刷新）。
 * 登录页内的过渡动画版走 Login.jsx 内嵌 BankInitPanel；此处仅兜底：
 * 复用登录页白底视觉（原 App 样式），完成后回原主页。
 */
function BankInitBody() {
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => {
    if (user && user.role !== 'student') navigate(user.role === 'admin' ? '/admin' : '/teacher', { replace: true });
  }, [user, navigate]);
  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-white px-6 pt-[calc(var(--safe-area-top)+48px)]">
      <h1 className="text-[32px] font-bold leading-tight text-ink">物联宝典</h1>
      <p className="mt-2 text-[15px] text-sub">章节刷题 · 模拟考试 · 错题本</p>
      <BankInitPanel onDone={() => navigate('/', { replace: true })} />
    </div>
  );
}

export default function BankInit() {
  return (
    <RequireAuth>
      <RequireRole roles={['student']}>
        <BankInitBody />
      </RequireRole>
    </RequireAuth>
  );
}
