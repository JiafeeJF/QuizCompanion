import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { TopBar } from '../components/ui.jsx';
import { DEV_CONFIG } from '../config.js';

const STAGGER = 0.09;
const DUR = 0.5;
const EASE = [0.22, 0.61, 0.36, 1];

function Section({ index, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR, delay: index * STAGGER, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** 延迟分档：良好 <150ms；一般 <400ms；较差 ≥400ms/失败 */
function gradeOf(ms) {
  if (ms == null) return { label: '较差', cls: 'text-bad' };
  if (ms < 150) return { label: '良好', cls: 'text-ok' };
  if (ms < 400) return { label: '一般', cls: 'text-warn' };
  return { label: '较差', cls: 'text-bad' };
}

/**
 * 网络检测页（独立路由 /network）：扁平信息流，无卡片。
 * 一次请求即返回全部（服务器地点 + 归属地 + 延迟）；再次测试需手动点击。
 */
export default function Network() {
  const [phase, setPhase] = useState('idle'); // idle 未测 / testing / done
  const [geo, setGeo] = useState('---');
  const [rtt, setRtt] = useState(null);
  const busyRef = useRef(false);

  const pingOnce = async (timeoutMs = 3000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const t0 = performance.now();
    try {
      // 浏览器/APP 无法发 ICMP ping；用用户本地到生产域名的健康接口请求测量真实链路 RTT。
      const res = await fetch(`https://iot.wakaibg5.top/api/health?network_probe=${Date.now()}-${Math.random()}`, {
        method: 'GET',
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      await res.arrayBuffer();
      return Math.round(performance.now() - t0);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const run = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase('testing');
    // 单次统一检测：归属地只查一次 + 4 次 ping 取中位数（并行，失败各自兜底）
    const geoP = api.metaNetwork()
      .then((d) => {
        const label = d?.geo?.label;
        setGeo(label && label !== '未知' ? label : '---');
      })
      .catch(() => setGeo('---'));
    const [a, b, c, d] = await Promise.all([pingOnce(), pingOnce(), pingOnce(), pingOnce()]);
    await geoP;
    const samples = [a, b, c, d].filter((v) => v != null).sort((x, y) => x - y);
    setRtt(samples.length ? samples[Math.floor(samples.length / 2)] : null);
    setPhase('done');
    busyRef.current = false;
  };

  // 进入即自动检测一次（归属地随本次展示，不另做轮询）
  React.useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const grade = phase === 'done' ? gradeOf(rtt) : null;
  return (
    <div>
      <TopBar title="网络检测" />
      <div className="space-y-7 px-6 pb-10">
        <Section index={0}>
          <div className="pt-6 text-center">
            <p className="text-[40px] font-semibold tabular-nums leading-none text-ink">
              {phase === 'done' ? (rtt == null ? '---' : rtt) : phase === 'testing' ? '···' : '---'}
              <span className="ml-1 text-[15px] font-normal text-faint">ms</span>
            </p>
            <p className={`mt-2.5 text-[13px] font-semibold ${phase === 'done' ? grade.cls : 'text-faint'}`}>
              {phase === 'done' ? grade.label : '检测中'}
            </p>
          </div>
        </Section>
        <Section index={1}>
          <div className="bg-line" style={{ height: 1 }} />
          <dl className="mt-5 space-y-2.5 text-[13px]">
            <InfoRow label="服务器" value={DEV_CONFIG.serverLocation || '---'} />
            <InfoRow label="我的 IP 位置" value={phase === 'idle' ? '---' : geo} />
            <InfoRow label="延迟" value={phase === 'done' ? (rtt == null ? '超时' : `${rtt}ms`) : '---'} />
          </dl>
          <button
            onClick={run}
            disabled={phase === 'testing'}
            className="mt-7 w-full rounded-2xl bg-ink py-3 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {phase === 'testing' ? '测试中…' : phase === 'done' ? '重新测试' : '开始测试'}
          </button>
          <p className="mt-3 text-center text-[12px] leading-relaxed text-faint">延迟为当前设备到服务器的多次请求中位数；位置仅在测试时查询一次。</p>
        </Section>
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sub">{label}</dt>
      <dd className="max-w-[62%] truncate font-medium text-ink">{value}</dd>
    </div>
  );
}
