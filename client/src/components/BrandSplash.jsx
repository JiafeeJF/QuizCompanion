import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import GenerativeBackground from './GenerativeBackground.jsx';
import './BrandSplash.css';

// Traced from img/iconiot.png: retain the book, four network nodes and green accent.
export default function BrandSplash() {
  const reduced = useReducedMotion();
  // Android changes the visual viewport once while handing off from the
  // native launch window to WebView. Capture one pixel anchor so the brand
  // never follows that resize during its short playback.
  const [anchorY] = React.useState(() => Math.round((
    window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 800
  ) / 2));
  const ease = [0.22, 1, 0.36, 1];
  const nodes = [[450, 482], [1152, 482], [450, 1120], [1152, 1120]];
  return (
    <motion.div className="brand-splash" role="status" aria-label="物联宝典正在启动"
      style={{ '--brand-splash-anchor-y': `${anchorY}px` }}
      initial={false} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.15 : 0.4 }}>
      <GenerativeBackground startup />
      <div className="brand-splash__wash" aria-hidden="true" />
      <div className="brand-splash__content" aria-hidden="true">
        <svg className="brand-splash__logo" viewBox="280 310 1040 990" fill="none">
          {['M528 560 L568 600', 'M1074 560 L1036 600', 'M530 1040 L640 940', 'M1072 1040 L964 940'].map((d, i) => (
            <motion.path key={d} d={d} stroke="#545e65" strokeWidth="23" strokeLinecap="round"
              initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }}
              transition={{ delay: reduced ? 0 : .18 + i * .05, duration: .42, ease }} />
          ))}
          {nodes.map(([cx, cy], i) => (
            <motion.circle key={i} cx={cx} cy={cy} r="115" fill="#545e65"
              initial={reduced ? false : { opacity: 0, r: 94 }}
              animate={{ opacity: 1, r: 115 }}
              transition={{ duration: .55, delay: reduced ? 0 : .08 + i * .055, ease }} />
          ))}
          <motion.path d="M1044 874 L1044 618 Q1044 594 1019 594 Q896 586 804 643 Q710 586 592 594 Q564 594 564 620 L564 889 Q690 883 804 951 Q925 878 1044 889"
            stroke="#545e65" strokeWidth="24" strokeLinejoin="round" strokeLinecap="round"
            initial={{ pathLength: reduced ? 1 : 0, opacity: reduced ? 1 : 0 }}
            animate={{ pathLength: 1, opacity: 1 }} transition={{ delay: reduced ? 0 : .3, duration: .85, ease }} />
          <motion.circle cx="1044" cy="874" r="51" fill="#79cc9e"
            initial={reduced ? false : { opacity: 0, r: 26 }} animate={{ opacity: 1, r: 51 }}
            transition={{ delay: reduced ? 0 : .95, duration: .4, ease }} />
        </svg>
        <motion.h1 initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: .4, duration: .6, ease }}>物联宝典</motion.h1>
        <motion.p initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: .7, duration: .5 }}>连接知识 · 点亮进步</motion.p>
      </div>
    </motion.div>
  );
}
