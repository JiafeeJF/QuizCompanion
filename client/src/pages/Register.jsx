import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../auth.jsx';
import { useToast } from '../Toast.jsx';
import { api } from '../api.js';
import { Modal } from '../components/ui.jsx';
import AltchaWidget from '../components/AltchaWidget.jsx';
import { DISABLE_CAPTCHA } from '../config.js';

/**
 * WLBD 注册（CoupleOrder 注册弹窗流程适配版，UI 保持 WLBD 视觉）
 * - 表单：昵称（选填）+ 邮箱 + 密码 + 确认密码，前端先做格式/长度/一致性提示
 * - 点注册 → 弹验证窗口：ALTCHA 人机 → 获取邮箱验证码（60s 倒计时）→ 填码 → 确认注册
 * - 后端终验一切：人机 payload 复验、验证码一次性、邮箱唯一、密码 ≥6 位
 * - 成功自动登录（role=student）进学员端；无配对码；中途关弹窗=放弃本次注册，下次重走流程
 */
export default function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [emailCode, setEmailCode] = useState('');
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);

  const openVerify = (e) => {
    e.preventDefault();
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return toast('邮箱格式不正确', 'error');
    if (password.length < 6) return toast('密码至少 6 位', 'error');
    if (password !== password2) return toast('两次输入的密码不一致', 'error');
    setCaptcha(null);
    setEmailCode('');
    setModalOpen(true);
  };

  const closeVerify = () => {
    if (busy || sending) return;
    setModalOpen(false);
    setCaptcha(null);
    setEmailCode('');
    setCountdown(0);
  };

  const getCode = async () => {
    if (!DISABLE_CAPTCHA && !captcha) return toast('请先完成人机验证', 'error');
    if (countdown > 0) return;
    setSending(true);
    try {
      await api.sendRegisterCode({ email: email.trim(), captchaToken: captcha?.captchaToken || '' });
      toast('验证码已发送，请查收邮箱', 'success');
      setCountdown(60);
      const timer = setInterval(() => setCountdown((v) => {
        if (v <= 1) { clearInterval(timer); return 0; }
        return v - 1;
      }), 1000);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const doRegister = async () => {
    if (!DISABLE_CAPTCHA && !captcha) return toast('请先完成人机验证', 'error');
    if (!emailCode.trim()) return toast('请输入邮箱验证码', 'error');
    setBusy(true);
    try {
      await register(name.trim(), email.trim(), password, emailCode.trim(), captcha?.captchaToken || '');
      setModalOpen(false);
      toast('注册成功，开始刷题吧', 'success');
      // 新用户本地无题库，走初始化页下载（与登录后分支一致）
      navigate('/bank-init', { replace: true });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-white px-6 pt-[calc(var(--safe-area-top)+48px)]">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-[28px] font-bold text-ink">创建账号</h1>
        <p className="mt-2 text-[15px] text-sub">免费注册，全部刷题功能开放</p>
        <form onSubmit={openVerify} className="mt-8 space-y-3">
          <div>
            <label className="label">昵称（选填）</label>
            <input className="input-field" placeholder="怎么称呼你" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} />
          </div>
          <div>
            <label className="label">邮箱</label>
            <input className="input-field" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div>
            <label className="label">密码</label>
            <input className="input-field" type="password" placeholder="至少 6 位" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div>
            <label className="label">确认密码</label>
            <input className="input-field" type="password" placeholder="再次输入密码" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" />
          </div>
          <button className="btn-primary w-full !py-3.5" type="submit">
            注册
          </button>
        </form>
        <p className="mt-6 text-center text-[14px] text-sub">
          已有账号？<Link to="/login" className="font-semibold text-ink">去登录</Link>
        </p>
      </motion.div>

      {/* 注册验证弹窗：人机验证 → 获取验证码 → 填码确认 */}
      <Modal open={modalOpen} onClose={closeVerify} title="完成注册">
        <p className="mb-4 text-[13px] text-sub">完成人机验证后，获取邮箱验证码并输入即可注册</p>
        <div className="space-y-4">
          {DISABLE_CAPTCHA ? null : <AltchaWidget onVerified={setCaptcha} />}
          <div className="flex gap-2">
            <input
              className="input-field min-w-0 flex-1"
              value={emailCode}
              onChange={(e) => setEmailCode(e.target.value)}
              placeholder="请输入 6 位邮箱验证码"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
            <button type="button" className="btn-secondary shrink-0 !px-3 text-[13px]" disabled={sending || countdown > 0} onClick={getCode}>
              {sending ? '发送中…' : countdown > 0 ? `${countdown}s 后重试` : '获取验证码'}
            </button>
          </div>
          <button className="btn-primary w-full" disabled={busy} onClick={doRegister}>
            {busy ? '注册中…' : '确认注册'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
