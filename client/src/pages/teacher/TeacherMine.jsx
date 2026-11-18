import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth, memberActive } from '../../auth.jsx';
import { useToast } from '../../Toast.jsx';
import { TopBar, Card } from '../../components/ui.jsx';
import { isInstallGuideWebEnvironment } from '../../utils/iosInstall.js';

/**
 * 教师端「我的」页（独立于学员端 Mine）：
 * 仅展示教师身份、退出登录，不混入学员功能。
 */
export default function TeacherMine() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const toast = useToast();
  const showInstallGuide = isInstallGuideWebEnvironment();

  return (
    <div>
      <div className="card flex items-center gap-3.5 p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ink text-[22px] font-bold text-white">
          {(user?.name || user?.email || '师')[0].toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold text-ink">{user?.name || '未命名教师'}</p>
          <p className="truncate text-[13px] text-sub">{user?.email}</p>
        </div>
        <span className="chip bg-ink text-white">教师</span>
      </div>

      <div className="card mt-3 divide-y divide-line">
        <button onClick={() => navigate('/teacher')} className="flex w-full items-center px-4 py-4 text-left active:bg-black/[0.02]">
          <span className="text-[15px] text-ink">我的班级</span>
          <span className="ml-auto text-faint">›</span>
        </button>
        <button onClick={() => navigate('/teacher/create-exam')} className="flex w-full items-center px-4 py-4 text-left active:bg-black/[0.02]">
          <span className="text-[15px] text-ink">布置考试 / 作业</span>
          <span className="ml-auto text-faint">›</span>
        </button>
        <button onClick={() => navigate('/teacher/tickets')} className="flex w-full items-center px-4 py-4 text-left active:bg-black/[0.02]">
          <span className="text-[15px] text-ink">意见反馈</span>
          <span className="ml-auto text-[13px] text-faint">Bug / 建议</span>
          <span className="text-faint">›</span>
        </button>
        {showInstallGuide && (
          <button
            onClick={() => navigate('/guide/ios-home', { state: { returnTo: '/teacher/mine' } })}
            className="flex w-full items-center px-4 py-4 text-left active:bg-black/[0.02]"
          >
            <span className="text-[15px] text-ink">添加到主屏幕</span>
            <span className="ml-auto text-[13px] text-faint">iPhone 教程</span>
            <span className="text-faint">›</span>
          </button>
        )}
      </div>

      <button
        className="mt-3 w-full rounded-2xl bg-bad/[0.08] py-3.5 text-[15px] font-semibold text-bad active:scale-[0.99]"
        onClick={() => { logout(); navigate('/login', { replace: true }); }}
      >
        退出登录
      </button>
      <p className="mt-4 text-center text-[12px] text-faint">教师端 · 班级教学专用 · 与学员端相互独立</p>
    </div>
  );
}
