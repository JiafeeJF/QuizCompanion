import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { commitBankTmp, saveBankTmp, validateBankPackage } from '../bankStore.js';

const PAGE = 500;

const STEP_DEFS = [
  { id: 'connect', label: '正在连接服务器' },
  { id: 'meta', label: '获取服务器配置' },
  { id: 'check', label: '检查本地题库' },
  { id: 'download', label: '正在下载题库' },
  { id: 'verify', label: '校验题库数据' },
  { id: 'index', label: '建立本地索引' },
  { id: 'ready', label: '准备学习环境' },
];

/**
 * BankInitPanel：题库初始化执行面板（无外壳、无品牌字）。
 * 由 Login 页在登录成功且本地题库缺失/版本过期时内嵌渲染；
 * 步骤全部真实执行：health 探针→bank/meta→版本比对→分页 bank/full→字段校验→本地落盘。
 * 完成后 onDone() 回调由 Login 收尾跳原主页；本组件不自行跳转。
 */
export default function BankInitPanel({ onDone }) {
  const toast = useToast();
  const [doneIdx, setDoneIdx] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);
  const [detail, setDetail] = useState('');
  const [latency, setLatency] = useState(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    run();
    return () => { cancelled.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mark = (idx) => {
    setDoneIdx(idx - 1);
    setActiveIdx(idx);
  };

  async function run() {
    try {
      // 1. 连接服务器（mobile health 探针 + 真实延迟）
      mark(0);
      const t0 = performance.now();
      await api.mobileHealth();
      if (cancelled.current) return;
      const ms = Math.round(performance.now() - t0);
      setLatency(ms);
      setDetail(`服务器连接正常 · ${ms}ms`);

      // 2. 获取服务器配置（题库元信息）
      mark(1);
      const meta = await api.mobileBankMeta();
      if (cancelled.current) return;
      setTotal(meta.total);
      setDetail(`题库版本 ${meta.version} · ${meta.total} 题 · ${meta.chapterCount} 章`);

      // 3. 检查本地题库（版本一致直接回主页，不下载）
      mark(2);
      const localVer = (() => { try { return localStorage.getItem('wlbd_bank_version') || ''; } catch { return ''; } })();
      if (localVer && localVer === meta.version) {
        finish('题库已是最新');
        return;
      }
      setDetail(localVer ? `发现新版本 ${meta.version}，准备更新` : '本地暂无题库，开始下载');

      // 4. 下载题库（分页拉取，真实进度：以实际到达的题目数计算）
      mark(3);
      let skip = 0;
      let chapters = null;
      const all = [];
      let version = meta.version;
      for (;;) {
        const page = await api.mobileBankFull(skip, PAGE);
        if (cancelled.current) return;
        version = page.version || version;
        if (skip === 0 && page.chapters) chapters = page.chapters;
        all.push(...page.questions);
        skip += page.questions.length;
        setDownloaded(all.length);
        setDetail(`已下载 ${all.length} / ${meta.total} 题`);
        if (!page.hasMore || page.questions.length === 0) break;
      }

      // 5. 校验题库数据（数量/章节/字段）
      mark(4);
      setDetail('正在校验题库');
      const pkg = { version, chapters: chapters || [], questions: all };
      const err = validateBankPackage(pkg, meta);
      if (err) throw new Error(`题库校验失败：${err}，正在重新下载`);
      saveBankTmp(pkg);
      setDetail('题库校验完成');

      // 6. 建立本地索引（版本/数量/校验和落盘 + 原子替换，不碰用户学习数据）
      mark(5);
      commitBankTmp(version, { count: all.length, sha256: meta.sha256 || '' });
      setDetail(`本地索引已建立 · ${all.length} 题`);

      // 7. 准备学习环境
      mark(6);
      setDetail('准备完成');
      finish('');
    } catch (e) {
      if (cancelled.current) return;
      const msg = e.message || '网络连接中断';
      setFailed(msg.includes('Failed to fetch') || msg.includes('Network') ? '网络连接中断' : msg);
      setDetail('');
    }
  }

  function finish(msg) {
    setDoneIdx(STEP_DEFS.length - 1);
    setActiveIdx(STEP_DEFS.length);
    if (msg) setDetail(msg);
    setTimeout(() => { if (!cancelled.current) onDone(); }, 900);
  }

  const retry = () => {
    setFailed('');
    setDownloaded(0);
    setDetail('');
    setDoneIdx(-1);
    setActiveIdx(0);
    cancelled.current = false;
    run();
  };

  const pct = total ? Math.round((downloaded / total) * 100) : 0;

  return (
    <div className="mt-4 w-full">
      <p className="text-[13px] text-sub">正在准备学习环境</p>

      <div className="card mt-3 w-full p-5">
        <div className="space-y-2.5">
          {STEP_DEFS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2.5 text-[14px]">
              {i <= doneIdx ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok text-[11px] font-bold text-white">✓</span>
              ) : i === activeIdx && !failed ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-ink" />
              ) : (
                <span className="h-5 w-5 rounded-full border border-line" />
              )}
              <span className={i <= doneIdx ? 'text-ink' : i === activeIdx && !failed ? 'font-medium text-ink' : 'text-faint'}>
                {s.label}
                {s.id === 'connect' && latency != null && i <= doneIdx ? ` · ${latency}ms` : ''}
              </span>
            </div>
          ))}
        </div>

        {(total > 0 && activeIdx >= 3) && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-[13px] text-sub">
              <span>正在下载题库</span>
              <span className="font-semibold tabular-nums text-ink">{pct}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
              <motion.div
                className="h-full rounded-full bg-ink"
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="mt-1.5 text-[12px] tabular-nums text-sub">已下载 {downloaded} / {total} 题</p>
          </div>
        )}

        {detail && !failed && <p className="mt-4 text-center text-[13px] text-sub">{detail}</p>}

        {failed && (
          <div className="mt-4 text-center">
            <p className="text-[14px] font-medium text-bad">{failed}</p>
            <button className="btn-primary mt-4 w-full" onClick={retry}>重新连接</button>
            <button
              className="btn-ghost mt-1 w-full"
              onClick={() => { toast('已跳过下载，下次登录会自动重试', 'info'); onDone(); }}
            >
              稍后重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
