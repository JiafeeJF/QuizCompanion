import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, getToken } from './api.js';
import { useAuth } from './auth.jsx';

const MaintenanceContext = createContext({ enabled: false, message: '', restoreAt: '' });
export const useMaintenance = () => useContext(MaintenanceContext);

export function MaintenanceProvider({ children }) {
  const { user, setUser, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [state, setState] = useState({ enabled: false, message: '系统维护中，请稍后再试', restoreAt: '' });
  const previousEnabled = useRef(null);

  const load = async () => {
    try { setState(await api.maintenance()); } catch {}
  };

  useEffect(() => {
    load();
    const onPush = (event) => setState(event.detail || {});
    window.addEventListener('wlbd:maintenance', onPush);
    return () => window.removeEventListener('wlbd:maintenance', onPush);
  }, []);

  // 被维护事件退出后，保留本地凭证并轮询公开状态；维护结束自动恢复登录。
  useEffect(() => {
    if (!state.enabled && previousEnabled.current === true && getToken()) {
      refresh().then((nextUser) => {
        if (nextUser && location.pathname === '/login') navigate('/', { replace: true, state: { maintenanceEnded: true } });
      });
    }
    previousEnabled.current = !!state.enabled;
  }, [state.enabled, refresh, navigate, location.pathname]);

  useEffect(() => {
    if (state.enabled && user && user.role === 'student') {
      setUser(null);
      if (location.pathname !== '/login') navigate('/login', { replace: true, state: { maintenance: true } });
    }
  }, [state.enabled, user, setUser, navigate, location.pathname]);

  useEffect(() => {
    if (!state.enabled) return undefined;
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [state.enabled]);

  const value = useMemo(() => ({ ...state, refresh: load }), [state]);
  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}
