import React from 'react';
import { useNavigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

const TABS = [
  ['overview', '总览'],
  ['questions', '题库'],
  ['users', '用户'],
  ['classes', '班级'],
  ['exams', '试卷'],
  ['tickets', '工单'],
  ['announcements', '公告'],
  ['dev', '开发者'],
  ['app', '版本'],
];

/**
 * 管理后台独立布局（桌面友好 + 移动端可用）：
 * 顶栏 + 左侧/顶部 Tab 导航，与学员端、教师端完全分离。
 * 顶部安全区由顶栏自身处理，子页面禁止再加顶部安全区 padding。
 */
export function AdminShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tab, mobileAdminKey } = useParams();
  const { logout } = useAuth();
  const current = tab || 'overview';
  const basePath = mobileAdminKey ? `/m/${mobileAdminKey}` : '/admin';

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl bg-bg">
      <div className="sticky top-0 z-40 bg-ink px-4 pb-3 pt-[calc(var(--safe-area-top)+12px)] text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] tracking-widest text-white/50">物联宝典 · 管理后台</p>
            <p className="text-[19px] font-bold">运营管理</p>
          </div>
          <button
            onClick={async () => { await logout(); navigate(mobileAdminKey ? basePath : '/login', { replace: true }); }}
            className="rounded-full bg-white/10 px-4 py-2 text-[13px] font-medium text-white active:bg-white/20"
          >
            退出
          </button>
        </div>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => navigate(k === 'overview' ? basePath : `${basePath}/${k}`)}
              className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-semibold ${
                current === k ? 'bg-white text-ink' : 'bg-white/10 text-white/70'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <main className="px-4 pb-10 pt-4">
        {/* key 保证切换 tab 时各管理页重新加载 */}
        <Outlet key={pathname} />
      </main>
    </div>
  );
}
