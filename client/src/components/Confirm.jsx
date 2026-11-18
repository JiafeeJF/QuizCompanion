import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import DialogLayer from './DialogLayer.jsx';

const ConfirmContext = createContext(null);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const pending = useRef(null);
  const confirm = useCallback((options = {}) => {
    if (pending.current) return Promise.resolve(false);
    return new Promise((resolve) => { pending.current = resolve; setState({ ...options }); });
  }, []);
  const close = (v) => {
    const resolve = pending.current;
    pending.current = null;
    resolve?.(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmBar state={state} onClose={close} emit={close} />
    </ConfirmContext.Provider>
  );
}

export function ConfirmBar({ state, onClose, emit }) {
  const close = (v) => (emit ? emit(v) : onClose?.(v));
  return <DialogLayer open={!!state} onClose={() => close(false)} title={state?.title || '请确认'} priority={110}
    outerClass="z-[95] p-4" panelClass="w-full max-w-sm rounded-3xl bg-white p-5">
            <h3 className="text-[16px] font-bold text-ink">{state?.title || '请确认'}</h3>
            {state?.message && <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{state?.message}</p>}
            <div className="mt-4 flex gap-2.5">
              <button className="btn-secondary flex-1" onClick={() => close(false)}>
                {state?.cancelText || '取消'}
              </button>
              <button className="btn-primary flex-1" onClick={() => close(true)}>
                {state?.confirmText || '确定'}
              </button>
            </div>
  </DialogLayer>;
}
