import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { animate, motion, useIsPresent, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from 'framer-motion';
import { api } from '../api.js';
import ExamDetail, { ExamOverview } from '../pages/ExamDetail.jsx';
import ExamResult from '../pages/ExamResult.jsx';
import { useDialogLifecycle } from './DialogLayer.jsx';

const clamp = n => Math.max(0, Math.min(1, n));
const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
const FULL_DURATION = 1.94;

export default function ExamPaperOverlay({ exam: summary, origin, onClose }) {
  const [screen, setScreen] = useState('overview');
  const leaveHandlerRef = useRef(null);
  const scroll = useRef(null);
  const showScreen = next => {
    if (scroll.current) scroll.current.scrollTop = 0;
    setScreen(next);
  };
  const reduced = useReducedMotion();
  const present = useIsPresent();
  const progress = useMotionValue(0);
  const [exam, setExam] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [ready, setReady] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const pending = useRef(null);
  const activeAnimation = useRef(null);
  const presentRef = useRef(present);
  presentRef.current = present;
  const milestones = useRef({ revealed: false, ready: false });
  const panel = useRef(null);
  const closeButton = useRef(null);
  const header = useRef(null);
  const [headerHeight, setHeaderHeight] = useState(60);
  useLayoutEffect(() => {
    const measure = () => setHeaderHeight(header.current?.getBoundingClientRect().height || 60);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header.current);
    return () => observer.disconnect();
  }, []);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const paperWidth = Math.min(396, origin?.width || 320, viewport.width - 56);
  const paperHeight = Math.min(340, viewport.height - 112);
  const paperLeft = (viewport.width - paperWidth) / 2;
  const printerTop = (viewport.height - paperHeight - 56) / 2;
  const paperTop = printerTop + 56;
  // Minimum physical paper scale to cover the viewport: no extra overshoot multiplier.
  const coverScale = Math.max(viewport.width / paperWidth, viewport.height / paperHeight);
  const paperClip = useTransform(progress, p => {
    const feed = clamp((p - .1) / .5);
    const pull = smooth((p - .77) / .23);
    const scale = 1 + (coverScale - 1) * pull;
    const centerY = (paperTop + paperHeight / 2) * (1 - pull) + viewport.height / 2 * pull + Math.sin(pull * Math.PI) * 8;
    const left = Math.max(0, (viewport.width - paperWidth * scale) / 2);
    const top = p <= .77 ? paperTop : Math.max(0, centerY - paperHeight * scale / 2);
    const bottom = p <= .77 ? viewport.height - paperTop - paperHeight * feed : Math.max(0, viewport.height - centerY - paperHeight * scale / 2);
    return `inset(${top}px ${left}px ${Math.max(0, bottom)}px ${left}px round ${16 * (1 - pull)}px)`;
  });
  const maskOpacity = useTransform(progress, [0, .1], [0, 1]);
  const printerOpacity = useTransform(progress, [0, .1, .77, .84], [0, 1, 1, 0]);
  const initialContentScale = paperWidth / Math.min(672, viewport.width);
  const contentScale = useTransform(progress, p => initialContentScale + (1 - initialContentScale) * smooth((p - .77) / .23));
  const contentY = useTransform(progress, p => {
    const pull = smooth((p - .77) / .23);
    return (paperTop - headerHeight) * (1 - pull) + Math.sin(pull * Math.PI) * 8;
  });
  const headerOpacity = useTransform(progress, [.8, 1], [0, 1]);
  const actionOpacity = useTransform(progress, [.77, .9], [1, 0]);
  useMotionValueEvent(progress, 'change', p => {
    if (!presentRef.current) return;
    if (p >= .79 && !milestones.current.revealed) { milestones.current.revealed = true; setRevealed(true); }
    if (p >= 1 && !milestones.current.ready) { milestones.current.ready = true; setReady(true); }
  });
  useEffect(() => { if (!present) activeAnimation.current?.stop(); }, [present]);

  useEffect(() => {
    const root = document.getElementById('root');
    const previous = root?.inert;
    if (root) root.inert = true;
    return () => { if (root) root.inert = previous; };
  }, []);
  const dismiss = useDialogLifecycle(panel, () => {
    if (screen === 'answer') leaveHandlerRef.current?.();
    else onClose();
  }, present, 80);
  useEffect(() => { if (ready) closeButton.current?.focus({ preventScroll: true }); }, [ready]);

  // One owner drives progress. Async data is committed once BEFORE any paper is visible.
  // StrictMode cleanup stops its own controller; it never rewinds the motion value.
  useEffect(() => {
    let alive = true;
    let controller;
    let frame;
    setError('');
    pending.current ||= api.examDetail(summary._id);
    const prepare = async () => {
      try {
        const machine = progress.get() < .1
          ? (activeAnimation.current = controller = animate(progress, .1, { duration: reduced ? 0 : (.1 - progress.get()) * FULL_DURATION, ease: 'linear' }))
          : Promise.resolve();
        const [result] = await Promise.all([pending.current, machine]);
        if (!alive || !presentRef.current) return;
        if (!result.exam) throw new Error('试卷不存在或暂不可查看');
        setExam(result.exam);
        api.noticeReadExam(summary._id).catch(() => {});
        // Commit the immutable real-content snapshot before starting its reveal.
        frame = requestAnimationFrame(() => {
          if (!alive || !presentRef.current) return;
          if (reduced) progress.set(1);
          else activeAnimation.current = controller = animate(progress, 1, { duration: (1 - progress.get()) * FULL_DURATION, ease: 'linear' });
        });
      } catch (err) {
        if (alive) setError(err.message || '试卷信息加载失败');
      }
    };
    prepare();
    return () => { alive = false; cancelAnimationFrame(frame); controller?.stop?.(); };
  }, [summary._id, retry, reduced, progress]);

  return createPortal(<motion.div ref={panel} role="dialog" aria-modal="true" aria-label={`${summary.title} · 考试详情`}
    aria-busy={!exam && !error} className="fixed inset-0 z-[80] overflow-hidden" onClick={e => e.stopPropagation()}>
    <motion.div className="absolute inset-0" initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .28 }}>
      <motion.div className="absolute inset-0 bg-black/35" style={{ opacity: maskOpacity }} />
    </motion.div>
    <motion.div className="absolute inset-0" initial={{ y: 0, opacity: 1 }} exit={reduced ? {opacity:0} : ready ? {y:'100%'} : {opacity:0}} transition={{ duration: reduced ? 0 : .28 }}>
      <motion.div data-testid="printing-paper" className="absolute inset-0 overflow-hidden bg-white" style={{ clipPath: paperClip }}>
        {/* Prepared inside the SAME opaque paper surface, never mounted at handoff. */}
        <motion.div data-testid="exam-detail-paper" aria-hidden={!ready} inert={ready ? undefined : ''} className="absolute inset-0 bg-white"
          style={{pointerEvents:ready ? 'auto':'none'}}>
          <div ref={scroll} className={`h-full overscroll-contain ${ready ? 'overflow-y-auto' : 'overflow-hidden'}`} data-testid="exam-detail-scroll">
            {screen === 'overview' && <>
            <motion.div ref={header} style={{opacity:headerOpacity}} className="wlbd-glass sticky top-0 z-10 border-b border-line/70"><div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pb-2 pt-[calc(var(--safe-area-top)+8px)]">
              <button ref={closeButton} onClick={dismiss} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink shadow-sm active:scale-95" aria-label="返回模考列表"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg></button>
              <h2 className="text-[19px] font-bold text-ink">考试详情</h2>
            </div></motion.div>
            <motion.div data-testid="paper-preview-content" style={{scale:contentScale,y:contentY,transformOrigin:'top center'}} className="mx-auto w-full max-w-2xl space-y-3 px-4 pt-3 pb-[calc(var(--safe-area-bottom)+24px)]">
              {exam && <ExamOverview exam={exam} presentationReady={revealed}
                onStart={()=>showScreen('answer')}
                onResult={()=>showScreen('result')} />}
            </motion.div>
            </>}
            {screen === 'answer' && <div className="mx-auto min-h-full w-full max-w-2xl pb-[var(--safe-area-bottom)]"><ExamDetail examId={summary._id} initialExam={exam} autoStart onExit={onClose} onResult={()=>showScreen('result')} leaveHandlerRef={leaveHandlerRef} /></div>}
            {screen === 'result' && <div className="mx-auto min-h-full w-full max-w-2xl pb-[var(--safe-area-bottom)]"><ExamResult examId={summary._id} onExit={onClose} onRetry={()=>showScreen('answer')} /></div>}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
    <motion.div data-testid="printer-body" aria-hidden="true" className="pointer-events-none absolute z-[2] h-16 rounded-2xl border border-black/10 bg-[#EDEDEE] shadow-lg"
      style={{top:printerTop,left:paperLeft-12,width:paperWidth+24,opacity:printerOpacity}}>
      <div className="absolute inset-x-3 top-2 flex items-center justify-between rounded-lg border border-white/80 bg-white/60 px-3 py-1.5"><span className="text-[11px] font-semibold tracking-wider text-sub">试卷打印</span><span className="h-1.5 w-1.5 rounded-full bg-ok/70" /></div>
      <div className="absolute inset-x-2 bottom-1 h-2 rounded-full bg-[#343436] shadow-inner" />
    </motion.div>
    <motion.div aria-hidden={ready} inert={ready ? '' : undefined} className="absolute right-4 z-[6] flex items-center gap-2" style={{top:'calc(var(--safe-area-top) + 16px)',opacity:actionOpacity,pointerEvents:ready?'none':'auto'}}>
      {!exam && <p className="rounded-full bg-white px-3 py-2 text-[12px] text-sub" role="status" aria-label="正在加载试卷">{error || '正在读取试卷信息…'}</p>}
      {error && <button className="min-h-11 rounded-full bg-white px-4 text-[13px] shadow-sm" onClick={()=>{pending.current=null;setRetry(x=>x+1);}}>重试</button>}
      <button className="min-h-11 rounded-full bg-white px-4 text-[13px] shadow-sm" onClick={dismiss}>取消</button>
    </motion.div>
  </motion.div>,document.body);
}
