import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  neverShowIOSInstallGuide,
  shouldAutoShowIOSInstallGuide,
  snoozeIOSInstallGuide,
} from '../utils/iosInstall.js';
import './AddToHomeAutoPrompt.css';

const EXCLUDED_PREFIXES = ['/guide/ios-home', '/add-to-home', '/admin', '/m/', '/maintain-access', '/download'];
const PROMPT_SEEN_KEYS = {
  student: 'wlbd_ios_install_prompt_seen_v2',
  teacher: 'wlbd_ios_install_prompt_seen_teacher_v2',
};

export default function AddToHomeAutoPrompt() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const secondaryButtonRef = useRef(null);
  const promptSeenKey = pathname.startsWith('/teacher') ? PROMPT_SEEN_KEYS.teacher : PROMPT_SEEN_KEYS.student;

  useEffect(() => {
    if (EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return undefined;
    try {
      if (window.localStorage.getItem(promptSeenKey) === '1') return undefined;
    } catch {
      // Continue in private browsing when local storage cannot be read.
    }
    if (!shouldAutoShowIOSInstallGuide()) return undefined;
    const timer = window.setTimeout(() => setOpen(true), 800);
    return () => window.clearTimeout(timer);
  }, [pathname, promptSeenKey]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    secondaryButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') remindLater();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const rememberPrompt = () => {
    try {
      window.localStorage.setItem(promptSeenKey, '1');
    } catch {
      // The prompt still closes when storage is unavailable (for example private mode).
    }
  };

  const remindLater = () => {
    snoozeIOSInstallGuide();
    setOpen(false);
  };

  const stopPrompting = () => {
    neverShowIOSInstallGuide();
    rememberPrompt();
    setOpen(false);
  };

  const openGuide = () => {
    rememberPrompt();
    setOpen(false);
    navigate('/guide/ios-home', { state: { returnTo: `${pathname}${search}${hash}` } });
  };

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.38, ease: [0.16, 1, 0.3, 1] };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="ios-install-prompt__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) remindLater();
          }}
        >
          <motion.section
            className="ios-install-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-prompt-title"
            aria-describedby="ios-install-prompt-description"
            initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.99 }}
            transition={transition}
          >
            <div className="ios-install-prompt__icon-shell" aria-hidden="true">
              <img src="/apple-touch-icon.png" alt="" />
            </div>
            <div className="ios-install-prompt__copy">
              <h2 id="ios-install-prompt-title">可添加到主屏幕</h2>
              <p id="ios-install-prompt-description">
                因暂无 iOS 原生 App，可将网页添加到主屏幕，使用更方便
              </p>
            </div>
            <div className="ios-install-prompt__actions">
              <button type="button" className="ios-install-prompt__primary" onClick={openGuide}>
                查看添加教程
              </button>
              <div className="ios-install-prompt__dismiss-options" aria-label="自动提示设置">
                <button ref={secondaryButtonRef} type="button" onClick={remindLater}>稍后提醒</button>
                <span aria-hidden="true">·</span>
                <button type="button" onClick={stopPrompting}>不再提示</button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
