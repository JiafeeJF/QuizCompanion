import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken, isAppEnv } from './api.js';
import { useAuth } from './auth.jsx';
import { useToast } from './Toast.jsx';
import { APP_VERSION } from './config.js';
import { startPracticeSync } from './practiceOffline.js';

const RealtimeContext = createContext(null);
export const useRealtime = () => useContext(RealtimeContext);

function socketUrl() {
  const env = import.meta.env.VITE_API_BASE;
  if (env) return String(env).replace(/\/$/, '');
  return isAppEnv() ? 'https://iot.wakaibg5.top' : window.location.origin;
}

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/** 登录用户实时事件：网页端和 APP 均连接，用于维护状态与业务通知。 */
export function RealtimeProvider({ children }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [version, setVersion] = useState(null);
  const [examEvent, setExamEvent] = useState(null);
  const seenRef = useRef(new Set());
  const socketRef = useRef(null);

  useEffect(() => {
    if (!user || !getToken()) return undefined;
    return startPracticeSync(api.syncPracticeSession, user._id || user.id);
  }, [user]);

  // Android 启动即补查一次，网页端不请求版本接口也不弹版本提示。
  useEffect(() => {
    if (!isAppEnv()) return undefined;
    let alive = true;
    api.versionInfo().then((payload) => {
      if (alive && payload?.version && compareVersions(payload.version, APP_VERSION) > 0) setVersion(payload);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!user || !getToken()) return undefined;
    const socket = io(socketUrl(), {
      auth: { token: getToken() },
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = socket;
    socket.on('version:new', (payload) => {
      if (!isAppEnv()) return;
      if (!payload?.version || payload.version === APP_VERSION || seenRef.current.has(`v:${payload.version}`)) return;
      seenRef.current.add(`v:${payload.version}`);
      setVersion(payload);
    });
    socket.on('announcement:new', (payload) => {
      if (!payload?.announcementId || seenRef.current.has(`a:${payload.announcementId}`)) return;
      seenRef.current.add(`a:${payload.announcementId}`);
      toast(`新公告：${payload.title || ''}`, 'success');
      window.dispatchEvent(new CustomEvent('wlbd:announcements-refresh', { detail: payload }));
    });
    const onAnnouncementUpdated = (payload) => {
      const key = `a:update:${payload?.announcementId}:${payload?.updatedAt || ''}`;
      if (!payload?.announcementId || seenRef.current.has(key)) return;
      seenRef.current.add(key);
      toast('公告已更新', 'success');
      window.dispatchEvent(new CustomEvent('wlbd:announcements-refresh', { detail: payload }));
    };
    socket.on('announcement:updated', onAnnouncementUpdated);
    socket.on('announcement:deleted', onAnnouncementUpdated);
    socket.on('exam:published', (payload) => {
      if (!payload?.examId || seenRef.current.has(`e:${payload.examId}`)) return;
      seenRef.current.add(`e:${payload.examId}`);
      setExamEvent(payload);
      toast(`新${payload.scope === 'homework' ? '作业' : '考试'}：${payload.title}`, 'success');
      window.dispatchEvent(new CustomEvent('wlbd:exams-refresh', { detail: payload }));
    });
    const onExamChanged = (payload) => {
      const key = `e:${payload?.examId}:${payload?.updatedAt || ''}`;
      if (!payload?.examId || seenRef.current.has(key)) return;
      seenRef.current.add(key);
      toast(payload.status === 'ended' ? `考试已结束：${payload.title || ''}` : '试卷已更新', 'success');
      window.dispatchEvent(new CustomEvent('wlbd:exams-refresh', { detail: payload }));
    };
    socket.on('exam:ended', onExamChanged);
    socket.on('exam:deleted', onExamChanged);
    const onTicket = (payload) => {
      const key = `t:${payload?.ticketId}:${payload?.updatedAt || ''}`;
      if (!payload?.ticketId || seenRef.current.has(key)) return;
      seenRef.current.add(key);
      toast(payload.status ? `工单状态已更新：${payload.status}` : '工单收到新回复', 'success');
      window.dispatchEvent(new CustomEvent('wlbd:tickets-refresh', { detail: payload }));
    };
    socket.on('ticket:replied', onTicket);
    socket.on('ticket:status_changed', onTicket);
    const onUserState = (payload) => {
      api.me().then(({ user: next }) => setUser(next)).catch(() => {});
      window.dispatchEvent(new CustomEvent('wlbd:user-state-refresh', { detail: payload }));
    };
    socket.on('member:updated', onUserState);
    socket.on('class:joined', onUserState);
    socket.on('class:removed', onUserState);
    const onMaintenance = (payload) => {
      window.dispatchEvent(new CustomEvent('wlbd:maintenance', { detail: payload }));
    };
    socket.on('maintenance:on', onMaintenance);
    socket.on('maintenance:off', onMaintenance);
    socket.on('maintenance:changed', onMaintenance);
    socket.on('connect', () => {
      // 重连后补拉关键状态，覆盖断线期间丢失的事件。
      if (socket.active) {
        api.me().then(({ user: next }) => setUser(next)).catch(() => {});
        window.dispatchEvent(new CustomEvent('wlbd:exams-refresh'));
        window.dispatchEvent(new CustomEvent('wlbd:announcements-refresh'));
        window.dispatchEvent(new CustomEvent('wlbd:tickets-refresh'));
      }
    });
    return () => {
      socket.off('maintenance:on', onMaintenance);
      socket.off('maintenance:off', onMaintenance);
      socket.off('maintenance:changed', onMaintenance);
      socket.off('announcement:updated', onAnnouncementUpdated);
      socket.off('announcement:deleted', onAnnouncementUpdated);
      socket.off('exam:ended', onExamChanged);
      socket.off('exam:deleted', onExamChanged);
      socket.off('ticket:replied', onTicket);
      socket.off('ticket:status_changed', onTicket);
      socket.off('member:updated', onUserState);
      socket.off('class:joined', onUserState);
      socket.off('class:removed', onUserState);
      socket.disconnect(); socketRef.current = null;
    };
  }, [user, toast, setUser]);

  const value = useMemo(() => ({ version, examEvent, clearVersion: () => setVersion(null) }), [version, examEvent]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
