import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getToken } from './api.js';
import { Modal } from './components/ui.jsx';

const NoticeCtx = createContext({ unread: 0, refresh: async () => 0, live: false });

/**
 * 站内通知（仿 CoupleOrder 新订单提醒）：
 * - 学员登录后建 SSE 长连（/api/notices/stream）：老师发布 → 秒级推 notice 事件 → 首页弹窗
 * - SSE 连上即推 unread 事件对齐红点；notice 事件只含新增（重复发布不重推由后端保证）
 * - 兜底：SSE 失败/断开 → 降级 60s 轮询；切后台关流、回前台重连（省电 + 防僵尸连接）
 * - 弹窗同考试只弹一次/设备；教师/管理员不连（通知只发学生）
 */
const SEEN_KEY = 'wlbd_notice_seen';
const POLL_MS = 60 * 1000;

function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch { return {}; }
}

function currentRole() {
  try { return JSON.parse(localStorage.getItem('wlbd_user') || '{}')?.role || ''; } catch { return ''; }
}

export function NoticeProvider({ children }) {
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const [live, setLive] = useState(false);
  const [popup, setPopup] = useState(null); // { examId, kind, title }
  const seenRef = useRef(loadSeen());
  const popupRef = useRef(null);
  popupRef.current = popup;

  const markSeenLocal = useCallback((examId) => {
    seenRef.current[String(examId)] = 1;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenRef.current)); } catch {}
  }, []);

  const maybePopup = useCallback((examId, kind, title) => {
    const id = String(examId || '');
    if (!id || seenRef.current[id] || popupRef.current) return;
    setPopup({ examId: id, kind: kind === 'homework' ? 'homework' : 'exam', title: title || '有新的考试待完成' });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { count } = await api.noticeUnreadCount();
      setUnread(Number(count) || 0);
      return Number(count) || 0;
    } catch {
      return 0;
    }
  }, []);

  // 降级轮询（SSE 不可用时）：发现本地没弹过的未读 → 拉详情弹提醒
  const pollOnce = useCallback(async () => {
    try {
      const { count } = await api.noticeUnreadCount();
      setUnread(Number(count) || 0);
      if (Number(count) > 0) {
        const { notices } = await api.notices(10);
        const fresh = (notices || []).find(
          (n) => !n.read && n.examStatus === 'active' && !seenRef.current[String(n.examId)]
        );
        if (fresh) maybePopup(fresh.examId, fresh.kind, fresh.title);
      }
    } catch {
      // 401/断网：静默，下轮再试
    }
  }, [maybePopup]);

  // 实时流：EventSource + 后台关闭/前台重连；失败自动降级轮询
  useEffect(() => {
    let alive = true;
    let es = null;
    let pollTimer = null;
    let retryTimer = null;
    let sseOk = false;

    const startPollFallback = () => {
      if (!alive || pollTimer) return;
      pollOnce();
      pollTimer = setInterval(() => { if (alive && !sseOk) pollOnce(); }, POLL_MS);
    };

    const connect = () => {
      if (!alive || es) return;
      // 只有学生建流；未登录/非学生直接走轻轮询（401 静默）
      if (currentRole() !== 'student') { startPollFallback(); return; }
      const token = getToken();
      if (!token) { startPollFallback(); return; }
      if (typeof EventSource === 'undefined') { startPollFallback(); return; }
      try {
        es = new EventSource(`/api/notices/stream?token=${encodeURIComponent(token)}`);
      } catch { startPollFallback(); return; }

      es.addEventListener('unread', (ev) => {
        if (!alive) return;
        try {
          const d = JSON.parse(ev.data || '{}');
          if (typeof d.count === 'number') setUnread(d.count);
        } catch {}
      });
      es.addEventListener('notice', (ev) => {
        if (!alive) return;
        try {
          const d = JSON.parse(ev.data || '{}');
          if (d?.examId) {
            setUnread((v) => v + 1);
            maybePopup(d.examId, d.kind, d.title);
          }
        } catch {}
      });
      es.onopen = () => { sseOk = true; setLive(true); };
      es.onerror = () => {
        // 401/断网/代理掐流：关掉走降级轮询，30s 后重试点流（token 刷新后可恢复）
        sseOk = false;
        setLive(false);
        try { es.close(); } catch {}
        es = null;
        startPollFallback();
        if (alive && !retryTimer) {
          retryTimer = setTimeout(() => { retryTimer = null; if (alive) connect(); }, 30000);
        }
      };
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // 回前台：流断了就重连 + 拉一次对齐（覆盖后台期间的新发布）
        if (!es) connect();
        pollOnce();
      } else if (es) {
        try { es.close(); } catch {}
        es = null;
        sseOk = false;
        setLive(false);
      }
    };

    // 首连延迟 3s（等登录态/路由就绪，避免开屏即弹）
    const boot = setTimeout(connect, 3000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(boot);
      if (retryTimer) clearTimeout(retryTimer);
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      try { es?.close(); } catch {}
      es = null;
    };
  }, [maybePopup, pollOnce]);

  const goExam = useCallback(async () => {
    if (!popup) return;
    const { examId } = popup;
    markSeenLocal(examId);
    setPopup(null);
    try { await api.noticeReadExam(examId); } catch {}
    setUnread((v) => Math.max(0, v - 1));
    navigate(`/exams/${examId}`);
  }, [popup, navigate, markSeenLocal]);

  const later = useCallback(async () => {
    if (!popup) return;
    const { examId } = popup;
    markSeenLocal(examId);
    setPopup(null);
    try { await api.noticeReadExam(examId); } catch {}
    setUnread((v) => Math.max(0, v - 1));
  }, [popup, markSeenLocal]);

  const value = useMemo(() => ({ unread, refresh, live }), [unread, refresh, live]);

  return (
    <NoticeCtx.Provider value={value}>
      {children}
      {/* 新考试/作业提醒弹窗：仿新订单——标题+副标题+双按钮，不自动消失 */}
      <Modal open={!!popup} onClose={later} title={popup?.kind === 'homework' ? '新作业提醒' : '新考试提醒'}>
        <p className="text-[16px] font-bold leading-snug text-ink">{popup?.title || '有新的考试待完成'}</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-sub">
          老师发布了新的{popup?.kind === 'homework' ? '作业' : '考试'}，请在截止前完成
        </p>
        <div className="mt-5 flex gap-2.5">
          <button className="btn-secondary flex-1" onClick={later}>稍后</button>
          <button className="btn-primary flex-1" onClick={goExam}>去看看</button>
        </div>
      </Modal>
    </NoticeCtx.Provider>
  );
}

export function useNotices() {
  return useContext(NoticeCtx);
}
