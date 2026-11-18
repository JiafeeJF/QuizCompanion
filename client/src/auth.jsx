import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
const CACHED_USER_KEY = 'wlbd_user';

function cacheUser(user) {
  try {
    if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(CACHED_USER_KEY);
  } catch {}
}

function readCachedUser() {
  try { return JSON.parse(localStorage.getItem(CACHED_USER_KEY) || 'null'); } catch { return null; }
}

/**
 * WLBD Auth（CoupleOrder 登录状态管理适配版）
 * - 启动/刷新：api.me() 恢复用户（Cookie 自动携带为主，localStorage token 回退）→ F5 不掉线
 * - 全局 401：api.js 广播 wlbd:unauthorized → 清用户态；守卫自动回 /login，不出现“看着登录了但全 401”
 * - login(email, password, captchaToken)：人机验证 payload 随登录提交，后端必验
 * - logout：调后端清 Cookie + 清本地 token/用户态，/ /teacher /admin 立刻不可访
 * - WLBD 角色/会员/班级原样保留：只解决“你是谁”，“能去哪”仍由 RequireRole + 三端 Shell 决定
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
      cacheUser(user);
      return user;
    } catch (error) {
      if (getToken() && (navigator.onLine === false || error?.isNetworkError)) {
        const cached = readCachedUser();
        if (cached) { setUser(cached); return cached; }
      }
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // token/Cookie 失效（过期/被踢/后端重启清密钥）：清用户态，守卫自动跳登录页
  useEffect(() => {
    const onUnauthorized = () => { setUser(null); cacheUser(null); };
    window.addEventListener('wlbd:unauthorized', onUnauthorized);
    return () => window.removeEventListener('wlbd:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email, password, captchaToken, accessId = '', mobileAdminKey = '') => {
    const data = await api.login({ email, password, captchaToken, accessId, mobileAdminKey });
    if (accessId) sessionStorage.setItem('wlbd_maintenance_student_view', '1');
    else sessionStorage.removeItem('wlbd_maintenance_student_view');
    // 双通道持久化：localStorage 存 token（旧端兼容）+ 后端已写 HttpOnly Cookie（自动携带）
    setToken(data.token);
    setUser(data.user);
    cacheUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password, emailCode, captchaToken) => {
    const data = await api.register({ name, email, password, emailCode, captchaToken });
    // 注册即自动登录：与 login 同一认证系统（JWT/Cookie/me/401），新用户 role=student 进学员端
    setToken(data.token);
    setUser(data.user);
    cacheUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // 后端不可达也照常清本地态：退出必须成功，不能卡住
    }
    sessionStorage.removeItem('wlbd_maintenance_student_view');
    setToken('');
    setUser(null);
    cacheUser(null);
  }, []);

  const value = { user, loading, login, register, logout, refresh, setUser };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function memberActive(user) {
  if (!user) return false;
  if (user.memberActive !== undefined) return !!user.memberActive;
  if (!user.isMember) return false;
  if (user.memberExpireAt && new Date(user.memberExpireAt) < new Date()) return false;
  return true;
}
