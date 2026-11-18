import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'altcha';
import 'altcha/altcha.css';
import { api } from '../api.js';

/**
 * ALTCHA 人机验证挂件（自 CoupleOrder 移植，WLBD 登录阶段使用）
 * - 先用 api.captchaChallenge() 拉取挑战 JSON，再以字符串形式喂给 widget：
 *   App 端（Capacitor 原生）WebView 下相对 URL 无效，必须走绝对地址，而 widget 的
 *   challenge 属性只认同源相对路径，所以改走“手动拉取 + JSON 注入”，Web/App 通吃
 * - 求解完成后 onVerified({ captchaToken: payload })，调用方随登录表单提交
 * - WLBD 视觉：沿用 altcha 默认浅色样式，与 WLBD 白底表单融合（不引入 CoupleOrder 品牌色）
 */
export default function AltchaWidget({ onVerified }) {
  const ref = useRef(null);
  const cbRef = useRef(onVerified);
  cbRef.current = onVerified;
  const [challengeJson, setChallengeJson] = useState('');
  const [loadError, setLoadError] = useState('');

  const onVerifiedCb = useCallback((payload) => cbRef.current?.(payload), []);

  // 手动拉取挑战（走 api.js 的绝对地址逻辑，原生 App 可达后端）
  useEffect(() => {
    let cancelled = false;
    api.captchaChallenge()
      .then((ch) => {
        if (cancelled) return;
        setChallengeJson(JSON.stringify(ch));
      })
      .catch(() => {
        if (!cancelled) setLoadError('人机验证加载失败，请检查网络后重试');
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element || !challengeJson) return undefined;
    const handleVerified = (event) => {
      const detail = event.detail || {};
      onVerifiedCb({ captchaToken: detail.payload || '' });
    };
    // 求解过期/失败/重置时清掉已验状态，避免按钮一直灰色或拿着过期 token 提交
    const handleStateChange = (event) => {
      const st = event.detail?.state;
      if (st && st !== 'verified') onVerifiedCb(null);
    };
    element.addEventListener('verified', handleVerified);
    element.addEventListener('statechange', handleStateChange);
    return () => {
      element.removeEventListener('verified', handleVerified);
      element.removeEventListener('statechange', handleStateChange);
    };
  }, [onVerifiedCb, challengeJson]);

  if (loadError) {
    return <p className="text-[13px] text-bad">{loadError}</p>;
  }
  if (!challengeJson) {
    return <p className="text-[13px] text-sub">人机验证加载中…</p>;
  }
  // key 保证挑战字符串就绪后再挂载 widget，避免空 challenge 初始化失败
  return <altcha-widget key={challengeJson.slice(0, 32)} ref={ref} challenge={challengeJson} verifyurl="" name="altcha" />;
}
