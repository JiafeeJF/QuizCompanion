import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion';
import { useNativeBackHandler } from '../utils/nativeBack.js';

const locks = [];
let savedOverflow;

export function useDialogLifecycle(panel, onClose, present, priority) {
  const live = useRef({ onClose, present });
  live.current = { onClose, present };
  const dismiss = () => { if (live.current.present) live.current.onClose?.(); };
  // Consume back throughout exit, so it cannot also leave the underlying exam.
  useNativeBackHandler(true, dismiss, priority);
  useEffect(() => {
    const token = {};
    const previous = document.activeElement;
    if (!locks.length) {
      savedOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    locks.push(token);
    const frame = requestAnimationFrame(() => panel.current?.querySelector('button')?.focus({ preventScroll: true }));
    const keydown = event => {
      if (locks.at(-1) !== token) return;
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key !== 'Tab') return;
      const items = panel.current?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]');
      if (!items?.length) { event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown);
      locks.splice(locks.indexOf(token), 1);
      if (!locks.length) document.documentElement.style.overflow = savedOverflow;
      if (previous?.isConnected) previous.focus?.({ preventScroll: true });
    };
  }, []);
  return dismiss;
}

function Surface({ onClose, title, priority, outerClass, panelClass, children }) {
  const panel = useRef(null);
  const present = useIsPresent();
  const reduced = useReducedMotion();
  const dismiss = useDialogLifecycle(panel, onClose, present, priority);
  return <motion.div className={`safefullscreen fixed inset-0 flex items-end justify-center bg-black/40 sm:items-center ${outerClass}`}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .2 }}
    onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) dismiss(); }}>
    <motion.div ref={panel} role="dialog" aria-modal="true" aria-label={title}
      initial={{ y: reduced ? 0 : 24 }} animate={{ y: 0 }} exit={{ y: reduced ? 0 : 16 }}
      transition={{ duration: reduced ? 0 : .2, ease: [.22, 1, .36, 1] }}
      className={`max-h-[85dvh] overflow-y-auto overscroll-contain ${panelClass}`}
      style={{ pointerEvents: present ? 'auto' : 'none' }}>{children}</motion.div>
  </motion.div>;
}

export default function DialogLayer({ open, ...props }) {
  // Keeping presence outside the condition also retains the scroll lock until exit finishes.
  return createPortal(<AnimatePresence>{open && <Surface key="dialog" {...props} />}</AnimatePresence>, document.body);
}
