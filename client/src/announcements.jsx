import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from './api.js';
import { useNativeBackHandler } from './utils/nativeBack.js';

const DUR = 0.45;
const EASE = [0.22, 0.61, 0.36, 1]; // 与开发者页同一套克制曲线

const AnnounceContext = createContext(null);
export const useAnnouncements = () => useContext(AnnounceContext);

/**
 * 公告弹窗（provide 全局 + 首页自动检查）：
 * - 仅学员端挂载（App.jsx 学员路由内包一层 StudentAnnouncements 即可）
 * - 打开应用/进首页时拉一次有效公告，未读的按优先级取第一条弹窗
 * - 「我知道了」→ 标已读 → 若还有下一条未读则继续弹，否则关闭
 * - 关闭按钮（右上 ×）→ 仅关闭弹窗，不标已读（下次进首页还会弹）
 * - unread 供「我的」铃铛红点用；enterList() 进列表页前把弹窗压住，避免抢焦点
 */
export function AnnouncementProvider({ children }) {
  const [queue, setQueue] = useState([]); // 待弹的未读公告（已按优先级排好）
  const [current, setCurrent] = useState(null);
  const [unread, setUnread] = useState(0);
  const [list, setList] = useState([]);
  const [listStamp, setListStamp] = useState(0); // 列表页读完后刷新用
  const loadingRef = useRef(false);
  const suppressRef = useRef(false); // 进公告列表/详情时压住弹窗

  const refresh = useCallback(async () => {
    if (loadingRef.current) return { unread: 0, list: [] };
    loadingRef.current = true;
    try {
      const { announcements = [], unread: n = 0 } = await api.announcements();
      setUnread(n);
      setList(announcements);
      const un = announcements.filter((a) => !a.read);
      setQueue(un);
      return { unread: n, list: announcements };
    } catch {
      return { unread: 0, list: [] };
    } finally {
      loadingRef.current = false;
    }
  }, []);

  // 实时推送：后台发布/启用公告时立即重拉并弹窗（APP 端经 socket，网页端进首页时拉取）
  useEffect(() => {
    const onPush = async () => {
      if (suppressRef.current) { refresh(); return; }
      const { list } = await refreshRef.current();
      const un = (list || []).filter((a) => !a.read);
      if (un.length) setCurrent((cur) => cur || un[0]);
    };
    window.addEventListener('wlbd:announcements-refresh', onPush);
    return () => window.removeEventListener('wlbd:announcements-refresh', onPush);
  }, [refresh]);
  // 首页挂载即检查一次（与首页数据并行，不阻塞；弹窗晚 600ms 出场，等首页动效落定）
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      if (!alive || suppressRef.current) return;
      const { list } = await refreshRef.current();
      if (!alive || suppressRef.current) return;
      const un = (list || []).filter((a) => !a.read);
      if (un.length) setCurrent(un[0]);
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // 我知道了：标已读 → 弹下一条（若有）
  const ack = async () => {
    if (!current) return;
    const id = String(current._id);
    try { await api.announcementRead(id); } catch {}
    setUnread((n) => Math.max(0, n - 1));
    setQueue((q) => {
      const rest = q.filter((a) => String(a._id) !== id);
      setCurrent(rest[0] || null);
      return rest;
    });
  };

  // 仅关闭：不标已读，下次进首页还会弹
  const dismiss = () => setCurrent(null);

  const value = {
    unread,
    list,
    refresh,
    ack,
    dismiss,
    listStamp,
    bumpList: () => setListStamp((s) => s + 1),
    // 列表页挂载时调用：压住弹窗 + 刷新未读数
    enterList: async () => {
      suppressRef.current = true;
      setCurrent(null);
      const r = await refresh();
      return r;
    },
    leaveList: () => { suppressRef.current = false; },
  };

  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <AnnouncementModal announcement={current} onAck={ack} onClose={dismiss} />
    </AnnounceContext.Provider>
  );
}

/** 学员端路由内包一层即可启用首页弹窗（见 App.jsx） */
export function StudentAnnouncements({ children }) {
  return <AnnouncementProvider>{children}</AnnouncementProvider>;
}

/** 公告弹窗：简约居中 + 遮罩 + 克制动效（与开发者页同一套曲线） */
function AnnouncementModal({ announcement, onAck, onClose }) {
  const [busy, setBusy] = useState(false);
  useNativeBackHandler(!!announcement, onClose, 100);
  const ok = async () => {
    if (busy) return;
    setBusy(true);
    try { await onAck(); } finally { setBusy(false); }
  };
  return (
    <AnimatePresence>
      {announcement && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="safefullscreen fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: DUR, ease: EASE }}
            className="w-full max-w-sm rounded-3xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <p className="min-w-0 flex-1 text-[17px] font-bold leading-snug text-ink">{announcement.title}</p>
              <button onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-[14px] text-sub" aria-label="关闭">✕</button>
            </div>
            <p className="mt-3 max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-sub">
              {announcement.content}
            </p>
            <button className="btn-primary mt-5 w-full" disabled={busy} onClick={ok}>
              {busy ? '请稍候…' : '我知道了'}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
