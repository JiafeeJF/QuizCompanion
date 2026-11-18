import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../auth.jsx';
import { api, isAppEnv } from '../api.js';
import { useToast } from '../Toast.jsx';
import { Modal, formatBeijingDateTime } from '../components/ui.jsx';
import AltchaWidget from '../components/AltchaWidget.jsx';
import BrandSplash from '../components/BrandSplash.jsx';
import { DISABLE_CAPTCHA } from '../config.js';
import BankInitPanel from '../components/BankInitPanel.jsx';
import { getBankStatus } from '../bankStore.js';
import { useMaintenance } from '../maintenance.jsx';


/**
 * WLBD 登录（CoupleOrder 登录交互逻辑适配版，UI 保持 WLBD 视觉）
 * - 表单：邮箱 + 密码（WLBD 业务不变，不引入配对码/情侣绑定）
 * - 提交先弹人机验证弹窗（CoupleOrder VerifyModal 流程简化版）：验证通过才真正调登录
 * - loading/错误/分流：busy 锁按钮，人机失败/密码错误 toast 明示；
 *   成功后按 WLBD role 分流 student→/ teacher→/teacher admin→/admin（from 回跳优先）
 * - 移动端：安全区 + 白底表单 + 按钮常驻可视，不引入 CoupleOrder 品牌色/文案
 */
export default function Login() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { login } = useAuth();
  const toast = useToast();
  const maintenance = useMaintenance();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [verifying, setVerifying] = useState(false);
  // 登录成功后本机题库需初始化时：登录页原地过渡为初始化面板（品牌字上移动画），不整页跳转
  const [init, setInit] = useState(false);
  const [brandLift, setBrandLift] = useState(false);
  // 网页登录页保留开屏；安卓已由 App 根层播放，避免未登录时连续播放两次。
  const [splash, setSplash] = useState(() => !isAppEnv());
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcements, setAnnouncements] = useState([]);
  const [refreshingMaintenance, setRefreshingMaintenance] = useState(false);
  useEffect(() => {
    if (!splash) return undefined;
    const t = setTimeout(() => setSplash(false), 1700);
    return () => clearTimeout(t);
  }, [splash]);

  const openAnnouncements = async () => {
    try {
      const data = await api.maintenanceAnnouncements();
      setAnnouncements(data.announcements || []);
      setAnnouncementOpen(true);
    } catch (e) { toast(e.message, 'error'); }
  };

  const refreshMaintenance = async () => {
    setRefreshingMaintenance(true);
    try { await maintenance.refresh?.(); } finally { setRefreshingMaintenance(false); }
  };

  const gotoAfterLogin = (user) => {
    const from = loc.state?.from;
    // 学员端先判断本机题库状态（设备本地，与账号无关）；需初始化时忽略 from 回跳，
    // 初始化完成后再回原目标。否则从守卫跳来的用户 from='/' 会绕过题库检查直接进主页
    // ——这正是卸载重装后不触发下载的根因。
    if (user.role === 'student') {
      const st = getBankStatus();
      if (!st.ready) {
        setInit(true);
        return;
      }
      if (from && from !== '/login' && from !== '/register' && from !== '/bank-init') {
        navigate(from, { replace: true });
        return;
      }
      navigate('/', { replace: true });
      return;
    }
    if (user.role === 'admin') navigate('/admin', { replace: true });
    else if (user.role === 'teacher') navigate('/teacher', { replace: true });
    else navigate('/', { replace: true });
  };

  const onInitDone = () => {
    setInit(false);
    const from = loc.state?.from;
    if (from && from !== '/login' && from !== '/register' && from !== '/bank-init') navigate(from, { replace: true });
    else navigate('/', { replace: true });
  };

  // 第一步：表单校验通过 → 弹人机验证（CoupleOrder：先填表后验证，避免无意义求解消耗）
  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return toast('请填写邮箱和密码', 'error');
    if (DISABLE_CAPTCHA) { doLogin(); return; }
    setCaptcha(null);
    setVerifyOpen(true);
  };

  // 第二步：人机通过 + 点确认 → 真正登录（本地关闭验证时直接登录）
  const doLogin = async () => {
    if (!DISABLE_CAPTCHA && !captcha) return toast('请先完成人机验证', 'error');
    setVerifying(true);
    setBusy(true);
    try {
      const user = await login(email.trim(), password, captcha?.captchaToken || '');
      setVerifyOpen(false);
      toast('欢迎回来', 'success');
      gotoAfterLogin(user);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setVerifying(false);
      setBusy(false);
    }
  };

  if (maintenance.enabled) {
    return (
      <MaintenanceView
        state={maintenance}
        onRefresh={refreshMaintenance}
        refreshing={refreshingMaintenance}
        onAnnouncements={openAnnouncements}
        announcementOpen={announcementOpen}
        announcements={announcements}
        onCloseAnnouncements={() => setAnnouncementOpen(false)}
      />
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-xl bg-white px-6 pt-[calc(var(--safe-area-top)+48px)]">
      <AnimatePresence>
        {splash && <BrandSplash key="splash" />}
      </AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={splash ? { opacity: 0, y: 16 } : { opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <AnimatePresence>
          {!init && (
            <motion.p key="eyebrow" exit={{ opacity: 0, transition: { duration: 0.3 } }} className="text-[13px] font-semibold tracking-widest text-sub">
              IOT · 中级工
            </motion.p>
          )}
        </AnimatePresence>

        {/* 原登录页的品牌字本体（同元素/字体/字号不变）：需要初始化时经 layout 动画平滑移到屏幕中央并保持 */}
        <motion.h1
          layout
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className={`whitespace-nowrap text-[32px] font-bold leading-tight text-ink ${init ? '!mt-0' : 'mt-2'}`}
        >
          物联宝典
        </motion.h1>

        <AnimatePresence>
          {!init && (
            <motion.div key="form" exit={{ opacity: 0, transition: { duration: 0.3 } }}>
              <p className="mt-2 text-[15px] text-sub">章节刷题 · 模拟考试 · 错题本</p>
              {maintenance.enabled && (
                <div className="mt-5 rounded-2xl border border-warn/20 bg-warn/[0.08] p-4">
                  <p className="text-[15px] font-bold text-ink">系统维护中</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-sub">{maintenance.message || '系统维护中，请稍后再试'}</p>
                  {maintenance.restoreAt && <p className="mt-1 text-[12px] text-faint">预计恢复（北京时间）：{formatBeijingDateTime(maintenance.restoreAt)}</p>}
                  <button type="button" className="btn-secondary mt-3 w-full !py-2.5 text-[13px]" onClick={openAnnouncements}>查看公告</button>
                </div>
              )}
              {!maintenance.enabled && loc.state?.maintenanceEnded && <p className="mt-5 rounded-2xl bg-ok/[0.08] p-3 text-center text-[13px] text-ok">维护已结束，请重新登录</p>}
              <form onSubmit={submit} className="mt-8 space-y-3">
                <div>
                  <label className="label">邮箱</label>
                  <input className="input-field" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div>
                  <label className="label">密码</label>
                  <input className="input-field" type="password" placeholder="至少 6 位" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                <button className="btn-primary w-full !py-3.5" disabled={busy}>
                  {busy ? '登录中…' : '登录'}
                </button>
              </form>
              <p className="mt-6 text-center text-[14px] text-sub">
                还没有账号？<Link to="/register" className="font-semibold text-ink">立即注册</Link>
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 初始化面板：挂载即开始真实下载（不等动画），内容 0.8s 后淡入，品牌字保持居中 */}
        {init && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.4 }}
            className="w-full"
          >
            <BankInitPanel onDone={onInitDone} />
          </motion.div>
        )}
      </motion.div>

      <Modal open={announcementOpen} onClose={() => setAnnouncementOpen(false)} title="系统公告">
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {announcements.length === 0 && <p className="py-8 text-center text-[13px] text-sub">暂无公告</p>}
          {announcements.map((a) => (
            <article key={a._id} className="rounded-2xl bg-black/[0.03] p-4">
              <p className="text-[15px] font-bold text-ink">{a.title}</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-sub">{a.content}</p>
            </article>
          ))}
        </div>
      </Modal>

      {/* 人机验证弹窗：验证通过后点确认才登录，关闭即取消本次登录 */}
      <Modal open={verifyOpen} onClose={() => { if (!verifying) { setVerifyOpen(false); setCaptcha(null); } }} title="人机验证">
        <p className="mb-4 text-[13px] text-sub">完成验证后即可登录</p>
        <div className="space-y-4">
          <AltchaWidget onVerified={setCaptcha} />
          <button className="btn-primary w-full" disabled={verifying || !captcha} onClick={doLogin}>
            {verifying ? '登录中…' : '确认并登录'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function MaintenanceView({ state, onRefresh, refreshing, onAnnouncements, announcementOpen, announcements, onCloseAnnouncements }) {
  return (
    <div className="safefullscreen flex min-h-screen w-full items-center justify-center bg-[#f5f5f7] px-6 py-12 text-ink">
      <main className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04]" aria-hidden="true">
          <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v4" /><path d="M12 17v4" /><path d="m4.22 4.22 2.83 2.83" /><path d="m16.95 16.95 2.83 2.83" /><path d="M3 12h4" /><path d="M17 12h4" /><path d="m4.22 19.78 2.83-2.83" /><path d="m16.95 7.05 2.83-2.83" />
          </svg>
        </div>
        <p className="mt-8 text-[12px] font-semibold tracking-[0.18em] text-faint">物联宝典</p>
        <h1 className="mt-3 text-[28px] font-bold tracking-tight text-ink">系统维护中</h1>
        <p className="mx-auto mt-4 max-w-[290px] text-[15px] leading-7 text-sub">{state.message || '系统维护中，请稍后再试'}</p>
        {state.restoreAt && (
          <p className="mt-3 text-[13px] text-faint">预计恢复（北京时间） · {formatBeijingDateTime(state.restoreAt)}</p>
        )}
        <div className="mx-auto mt-8 flex max-w-[260px] flex-col items-center gap-4">
          <button type="button" className="btn-primary w-full !py-3.5" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? '检查中…' : '刷新试试'}
          </button>
          <button type="button" className="text-[14px] font-semibold text-sub transition-colors active:text-ink" onClick={onAnnouncements}>查看公告</button>
        </div>
        <p className="mt-16 text-[12px] text-faint">物联宝典 · IOT 中级工</p>
      </main>
      <Modal open={announcementOpen} onClose={onCloseAnnouncements} title="系统公告">
        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {announcements.length === 0 && <p className="py-8 text-center text-[13px] text-sub">暂无公告</p>}
          {announcements.map((a) => (
            <article key={a._id} className="rounded-2xl bg-black/[0.03] p-4 text-left">
              <p className="text-[15px] font-bold text-ink">{a.title}</p>
              <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-sub">{a.content}</p>
            </article>
          ))}
        </div>
      </Modal>
    </div>
  );
}
