import React, { useEffect, useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import AltchaWidget from '../components/AltchaWidget.jsx';
import { PageLoading } from '../components/guards.jsx';

function NotFound() {
  return (
    <main className="safefullscreen flex min-h-screen items-center justify-center bg-[#f5f5f7] px-6 text-center">
      <div>
        <p className="text-[40px] font-bold tracking-tight text-ink">404</p>
        <p className="mt-2 text-[14px] text-sub">页面不存在</p>
      </div>
    </main>
  );
}

/** Android 专用管理入口。路径密钥由服务端校验，管理员身份仍由登录和 API 双重校验。 */
export default function MobileAdminAccess() {
  const { mobileAdminKey = '' } = useParams();
  const { user, loading, login } = useAuth();
  const toast = useToast();
  const [access, setAccess] = useState('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captcha, setCaptcha] = useState(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.validateMobileAdminAccess(mobileAdminKey)
      .then(() => { if (alive) setAccess('allowed'); })
      .catch(() => { if (alive) setAccess('denied'); });
    return () => { alive = false; };
  }, [mobileAdminKey]);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) return toast('请填写邮箱和密码', 'error');
    if (!captcha) return toast('请先完成人机验证', 'error');
    setBusy(true);
    try {
      const signedIn = await login(email.trim(), password, captcha.captchaToken || '', '', mobileAdminKey);
      if (signedIn?.role !== 'admin' && !signedIn?.isSuperAdmin) setAccess('denied');
      else toast('管理员登录成功', 'success');
    } catch (error) {
      toast(error.message, 'error');
      setCaptcha(null);
      setCaptchaKey((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  if (access === 'checking' || loading) return <PageLoading label="正在验证入口" />;
  if (access !== 'allowed') return <NotFound />;
  if (user && user.role !== 'admin' && !user.isSuperAdmin) return <NotFound />;
  if (user) return <Outlet />;

  return (
    <main className="safefullscreen flex min-h-screen items-center justify-center bg-[#f5f5f7] px-5 py-10">
      <section className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-[0_18px_55px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.04]">
        <p className="text-[12px] font-semibold tracking-[0.16em] text-faint">物联宝典</p>
        <h1 className="mt-2 text-[26px] font-bold tracking-tight text-ink">运营管理登录</h1>
        <p className="mt-2 text-[13px] leading-6 text-sub">此入口仅允许管理员账号使用。</p>
        <form className="mt-7 space-y-3" onSubmit={submit}>
          <div>
            <label className="label">管理员邮箱</label>
            <input className="input-field" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div>
            <label className="label">密码</label>
            <input className="input-field" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          <div className="pt-1">
            <AltchaWidget key={captchaKey} onVerified={setCaptcha} />
          </div>
          <button className="btn-primary w-full !py-3.5" disabled={busy || !captcha}>
            {busy ? '登录中…' : '进入管理页'}
          </button>
        </form>
      </section>
    </main>
  );
}
