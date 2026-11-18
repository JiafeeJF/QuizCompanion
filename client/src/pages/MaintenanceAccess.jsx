import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { Modal } from '../components/ui.jsx';
import AltchaWidget from '../components/AltchaWidget.jsx';
import { DISABLE_CAPTCHA } from '../config.js';

export default function MaintenanceAccess() {
  const { accessId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { login } = useAuth();
  const [valid, setValid] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.maintenanceAccess(accessId).then(() => setValid(true)).catch(() => setValid(false)); }, [accessId]);
  const submit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return toast('请填写管理员账号和密码', 'error');
    if (DISABLE_CAPTCHA) return doLogin();
    setCaptcha(null); setVerifyOpen(true);
  };
  const doLogin = async () => {
    if (!DISABLE_CAPTCHA && !captcha) return toast('请先完成人机验证', 'error');
    setBusy(true);
    try { await login(email.trim(), password, captcha?.captchaToken || '', accessId); setVerifyOpen(false); navigate('/', { replace: true }); }
    catch (e) { toast(e.message, 'error'); }
    finally { setBusy(false); }
  };
  if (valid === null) return <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] text-sm text-sub">正在验证入口…</div>;
  if (!valid) return <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-6 text-center"><div><p className="text-[22px] font-bold text-ink">入口不可用</p><p className="mt-2 text-[14px] text-sub">该维护访问地址已失效。</p><button className="btn-secondary mt-6" onClick={() => navigate('/login', { replace: true })}>返回登录</button></div></div>;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-6 py-12">
      <main className="w-full max-w-sm rounded-[28px] bg-white p-7 shadow-[0_18px_60px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
        <p className="text-[12px] font-semibold tracking-[0.18em] text-faint">物联宝典 · 维护访问</p>
        <h1 className="mt-3 text-[25px] font-bold text-ink">管理员登录</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-sub">仅限管理员在维护期间模拟学员端访问。</p>
        <form onSubmit={submit} className="mt-7 space-y-3">
          <input className="input-field" type="email" placeholder="管理员邮箱" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <input className="input-field" type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          <button className="btn-primary w-full !py-3.5" disabled={busy}>进入学员端</button>
        </form>
        <button className="mt-5 w-full text-center text-[13px] font-semibold text-sub" onClick={() => navigate('/login', { replace: true })}>返回维护页</button>
      </main>
      <Modal open={verifyOpen} onClose={() => { if (!busy) { setVerifyOpen(false); setCaptcha(null); } }} title="人机验证">
        <p className="mb-4 text-[13px] text-sub">完成验证后进入学员端</p>
        <div className="space-y-4"><AltchaWidget onVerified={setCaptcha} /><button className="btn-primary w-full" disabled={busy || !captcha} onClick={doLogin}>{busy ? '登录中…' : '确认并登录'}</button></div>
      </Modal>
    </div>
  );
}
