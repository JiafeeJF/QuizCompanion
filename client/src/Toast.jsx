import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ToastContext = createContext(null);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const toast = useCallback((message, type = 'info') => {
    const text = String(message || '').trim();
    if (!text) return;
    const id = Date.now() + Math.random();
    const duration = type === 'error' ? 3500 : type === 'success' ? 1800 : 2400;
    setToasts((t) => {
      if (t.some((x) => x.message === text && x.type === type)) return t;
      return [...t.slice(-2), { id, message: text, type }];
    });
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), duration);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast 挂载在安全区下方，背景透明无色块，PC 端 inset 为 0 无偏移 */}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-area-top)+12px)] z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              role={t.type === 'error' ? 'alert' : 'status'}
              onClick={() => setToasts((items) => items.filter((x) => x.id !== t.id))}
              className={`pointer-events-auto cursor-pointer rounded-2xl px-5 py-3 text-sm font-medium shadow-lg transition active:scale-[0.985] ${
                t.type === 'success' ? 'bg-ok text-white'
                : t.type === 'error' ? 'bg-bad text-white'
                : 'bg-ink text-white'
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
