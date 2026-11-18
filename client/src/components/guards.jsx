import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return children;
}

export function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  const maintenanceStudentView = sessionStorage.getItem('wlbd_maintenance_student_view') === '1';
  const allowedMaintenanceAdmin = maintenanceStudentView && user.role === 'admin' && roles.includes('student');
  if (!roles.includes(user.role) && !allowedMaintenanceAdmin) {
    // 角色不符时按“就近端”分流，避免学员/教师/管理员互相串端：
    // 学员 -> /，教师 -> /teacher，管理员 -> /admin
    const target = user.role === 'admin' ? '/admin' : user.role === 'teacher' ? '/teacher' : '/';
    if (loc.pathname !== target) return <Navigate to={target} replace />;
    return children;
  }
  return children;
}

export function PageLoading({ label = '加载中' }) {
  return (
    <div className="wlbd-loader-fade flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status" aria-label={label}>
      <div className="flex items-center gap-2" aria-hidden="true">
        <span className="wlbd-loader-dot h-2.5 w-2.5 rounded-full bg-ink" />
        <span className="wlbd-loader-dot d2 h-2.5 w-2.5 rounded-full bg-ink" />
        <span className="wlbd-loader-dot d3 h-2.5 w-2.5 rounded-full bg-ink" />
      </div>
      {label ? <p className="select-none text-[12px] tracking-wide text-faint">{label}</p> : null}
    </div>
  );
}

export function Empty({ text = '暂无数据', action = null }) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm text-sub">{text}</p>
      {action}
    </div>
  );
}

export function Spinner({ size = 'h-5 w-5' }) {
  return <div className={`${size} animate-spin rounded-full border-2 border-line border-t-ink`} />;
}
