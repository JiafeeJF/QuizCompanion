import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import GenerativeBackground from '../components/GenerativeBackground.jsx';

const ease = [0.22, 1, 0.36, 1];
const section = (delay = 0) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.65, ease, delay } },
});

/**
 * 公开下载页（/download）：无需登录。
 * 版本信息来自 /api/app/version；APK 直链 /downloads/{fileName} 由 nginx 静态托管。
 * 纯扁平信息流布局，无卡片；黑白克制风格，适配手机（单列）与电脑（居中限宽）。
 * 图标与主站一致：使用 /favicon-192x192.png（2x 用 512），本域直链。
 */
export function DownloadPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/app/version')
      .then((r) => r.json())
      .then((d) => setData(d.version ? d : { version: null }))
      .catch(() => setErr('获取版本信息失败，请稍后重试'));
  }, []);

  const download = async () => {
    if (!data?.version) return;
    setDownloading(true);
    try {
      // 先打点再跳转；打点失败不阻塞下载
      fetch('/api/app/version/download-count', { method: 'POST' }).catch(() => {});
      const a = document.createElement('a');
      a.href = data.downloadPath;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => setDownloading(false), 1500);
    }
  };

  const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
  const isLong = Boolean(data?.notes && data.notes.length > 180);

  return (
    <div className="generative-download-page mx-auto min-h-screen w-full max-w-[640px] bg-bg px-6 py-16 sm:py-24">
      <GenerativeBackground />
      {/* 顶部：网站图标 + 名称 + 一句话介绍 */}
      <motion.header {...section(0.02)} className="flex flex-col items-start">
        <img
          src="/favicon-192x192.png"
          srcSet="/favicon-192x192.png 1x, /favicon-512x512.png 2x"
          sizes="64px"
          width={64}
          height={64}
          alt="物联宝典"
          loading="eager"
          decoding="async"
          className="block aspect-square h-16 w-16 rounded-[18px] border border-black/[0.06] bg-white object-cover"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fb) { img.dataset.fb = '1'; img.src = '/apple-touch-icon.png'; }
            else if (img.dataset.fb === '1') { img.dataset.fb = '2'; img.src = '/favicon-32x32.png'; }
          }}
        />
        <h1 className="mt-6 text-[32px] font-semibold tracking-tight text-ink">物联宝典</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-sub">章节刷题 · 模拟考试 · 错题本</p>
      </motion.header>

      {err ? (
        <motion.p {...section(0.12)} className="mt-14 text-[14px] text-bad">{err}</motion.p>
      ) : !data ? (
        <motion.p {...section(0.12)} className="mt-14 text-[14px] text-sub">加载中…</motion.p>
      ) : data.version === null ? (
        <motion.p {...section(0.12)} className="mt-14 text-[14px] text-sub">暂未发布版本，请稍后再来</motion.p>
      ) : (
        <>
          {/* 版本信息 */}
          <motion.section {...section(0.12)} className="mt-10 flex flex-col items-start">
            <p className="flex items-baseline gap-3">
              <span className="text-[17px] font-semibold text-ink">版本 {data.version}</span>
              <span className="text-[13px] tabular-nums text-faint">{fmtSize(data.size)}</span>
            </p>

            {/* 版本信息：疏朗排布 */}
            <dl className="mt-6 w-full text-[14px]">
              <div className="flex items-baseline justify-between py-2.5">
                <dt className="text-faint">发布时间</dt>
                <dd className="tabular-nums text-ink">{data.updatedAt ? new Date(data.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</dd>
              </div>
              {data.downloads > 0 && (
                <div className="flex items-baseline justify-between border-t border-line py-2.5">
                  <dt className="text-faint">下载次数</dt>
                  <dd className="tabular-nums text-ink">{data.downloads} 次</dd>
                </div>
              )}
            </dl>
          </motion.section>

          {/* 更新日志：展开/收起高度平滑过渡 */}
          {data.notes && (
            <motion.section {...section(0.22)} className="mt-9 border-t border-line pt-8">
              <h2 className="text-[15px] font-semibold text-ink">更新说明</h2>
              <motion.div
                initial={false}
                animate={{ height: 'auto', opacity: 1 }}
                transition={{ duration: 0.5, ease }}
                className="overflow-hidden"
              >
                <AnimatePresence initial={false}>
                  <motion.p
                    key={expanded || !isLong ? 'full' : 'clamp'}
                    initial={{ opacity: 0.35 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.32, ease }}
                    className="mt-3 whitespace-pre-wrap text-[14px] leading-loose text-sub"
                  >
                    {expanded || !isLong ? data.notes : `${data.notes.slice(0, 180)}…`}
                  </motion.p>
                </AnimatePresence>
              </motion.div>
              {isLong && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  aria-expanded={expanded}
                  className="mt-2 text-[13px] font-medium text-ink underline underline-offset-4"
                >
                  {expanded ? '收起' : '展开全部'}
                </button>
              )}
            </motion.section>
          )}

          {/* 主下载按钮 + 安装提示 */}
          <motion.section {...section(0.32)} className="mt-12 flex flex-col items-start">
            <motion.button
              onClick={download}
              disabled={downloading}
              whileTap={downloading ? undefined : { scale: 0.98 }}
              whileHover={downloading ? undefined : { scale: 1.01 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              className="inline-flex w-full items-center justify-center rounded-2xl bg-ink px-6 py-4 text-[15px] font-semibold text-white disabled:cursor-default disabled:opacity-60 sm:w-auto sm:min-w-[260px]"
            >
              {downloading ? '开始下载…' : '立即下载 APK'}
            </motion.button>
            <p className="mt-6 text-[12px] leading-relaxed text-faint">
              仅支持 Android 手机 · 安装时如提示「未知来源」请允许
            </p>
          </motion.section>
        </>
      )}
    </div>
  );
}
