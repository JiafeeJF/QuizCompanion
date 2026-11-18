import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRealtime } from '../realtime.jsx';
import { api } from '../api.js';
import { useNativeBackHandler } from '../utils/nativeBack.js';

/** APP 实时新版本弹窗：只由 Socket.IO version:new 触发，不在「我的」自动检查 */
export function RealtimeUpdateModal() {
  const { version, clearVersion } = useRealtime() || {};
  useNativeBackHandler(!!version, () => {
    if (!version?.forceUpdate) clearVersion?.();
  }, 110);
  if (!version) return null;
  return (
    <div className="safefullscreen fixed inset-0 z-[96] flex items-center justify-center bg-black/40 p-6" onClick={version.forceUpdate ? undefined : clearVersion}>
      <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-sm rounded-3xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-[17px] font-bold text-ink">发现新版本 v{version.version}</p>
        {version.notes && <p className="mt-3 max-h-[35vh] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{version.notes}</p>}
        <div className="mt-5 flex gap-2.5">
          {!version.forceUpdate && <button className="btn-secondary flex-1" onClick={clearVersion}>稍后再说</button>}
          <button className="btn-primary flex-1" onClick={() => { api.openApkDownload(version); clearVersion(); }}>立即更新</button>
        </div>
      </motion.div>
    </div>
  );
}

/** 教师发布后，考试列表页监听刷新；同时 RealtimeProvider 已 toast 通知 */
export function ExamRealtimeRefresh() {
  const navigate = useNavigate();
  useEffect(() => {
    const onRefresh = () => {
      if (window.location.pathname === '/exams') navigate('/exams', { replace: true });
    };
    window.addEventListener('wlbd:exams-refresh', onRefresh);
    return () => window.removeEventListener('wlbd:exams-refresh', onRefresh);
  }, [navigate]);
  return null;
}
