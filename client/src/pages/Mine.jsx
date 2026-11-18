import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api, isAppEnv } from '../api.js';
import { APP_VERSION } from '../config.js';
import { useAuth, memberActive } from '../auth.jsx';
import { useToast } from '../Toast.jsx';
import { TopBar, Card, Modal } from '../components/ui.jsx';
import { Avatar, compressAvatar } from '../components/Avatar.jsx';
import { isIOSWebEnvironment } from '../utils/iosInstall.js';
import { useNativeBackHandler } from '../utils/nativeBack.js';

function fmtDate(d) {
  if (!d) return '长期有效';
  return new Date(d).toLocaleDateString('zh-CN');
}

function fmtSize(n) {
  if (!n) return '';
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/**
 * 语义化版本比较：v1 > v2 返回 1，相等 0，小于 -1（非法格式按相等处理，不误弹）
 * compareVersions 在 Mine 组件内使用，定义提升到模块顶层。
 */
function compareVersions(a, b) {
  const pa = String(a || '').trim();
  const pb = String(b || '').trim();
  const ra = pa.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const rb = pb.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!ra || !rb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(ra[i]) - Number(rb[i]);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export default function Mine() {
  const navigate = useNavigate();
  const { user, logout, refresh } = useAuth();
  const toast = useToast();
  // 网页端无检查更新：入口/请求/弹窗只在安卓 APP 内
  const showUpdate = isAppEnv();
  const showIOSInstallGuide = isIOSWebEnvironment();
  const [upgradeOpen, setUpgradeOpen] = useState(false); // 有新版时才打开
  const [latest, setLatest] = useState(null); // { version, notes }
  const [checking, setChecking] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState(''); // dataURL 预览
  const [avatarDirty, setAvatarDirty] = useState(false); // 头像是否改动过
  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [emailPwd, setEmailPwd] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [classOpen, setClassOpen] = useState(false);
  const [classCode, setClassCode] = useState('');
  const [busy, setBusy] = useState(false);
  const isMember = memberActive(user);

  /**
   * 检查更新（仅安卓 APP）：拉后台最新版 → 高于本地才弹窗；已是最新则 toast
   * 网页端不调用（入口不渲染，静默检查也跳过）。
   */
  const checkUpdate = async ({ manual = false } = {}) => {
    if (!isAppEnv() || checking) return;
    setChecking(true);
    try {
      // 网络/跨域失败抛错 → "检查更新失败"；后端明确无版本(version:null) → "暂无版本信息"
      const v = await api.versionInfo();
      if (!v || !v.version) {
        if (manual) toast('暂无版本信息，请稍后重试', 'error');
        return;
      }
      if (compareVersions(v.version, APP_VERSION) <= 0) {
        if (manual) toast('已是最新版本', 'success');
        return;
      }
      setLatest(v);
      setUpgradeOpen(true);
    } catch {
      if (manual) toast('检查更新失败，请稍后重试', 'error');
    } finally {
      setChecking(false);
    }
  };

  // 不自动检查：仅用户手动点击「检查更新」时调用，版本推送由 Socket.IO 全局处理。

  const openProfile = () => {
    setEditName(user?.name || '');
    setEditAvatar(user?.avatar || '');
    setAvatarDirty(false);
    setProfileOpen(true);
  };

  const pickAvatar = async (file) => {
    if (!file) return;
    try {
      // 本地压缩后再预览/上传：一张头像约 10~30KB，不占服务器内存
      const dataUrl = await compressAvatar(file);
      setEditAvatar(dataUrl);
      setAvatarDirty(true);
    } catch (e) { toast(e.message, 'error'); }
  };

  const saveProfile = async () => {
    const patch = {};
    const n = editName.trim();
    if (!n) return toast('昵称不能为空', 'error');
    if (n !== (user?.name || '')) patch.name = n;
    if (avatarDirty) patch.avatar = editAvatar || '';
    if (!Object.keys(patch).length) { setProfileOpen(false); return; }
    setBusy(true);
    try {
      await api.updateProfile(patch);
      await refresh();
      toast('资料已更新', 'success');
      setProfileOpen(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const submitPwd = async () => {
    if (newPwd.length < 6) return toast('新密码至少 6 位', 'error');
    setBusy(true);
    try {
      await api.changePassword({ oldPassword: oldPwd, newPassword: newPwd });
      toast('密码修改成功', 'success');
      setPwdOpen(false); setOldPwd(''); setNewPwd('');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const requestCode = async () => {
    if (!newEmail.trim()) return toast('请填写新邮箱', 'error');
    if (!emailPwd) return toast('请填写当前密码确认身份', 'error');
    setBusy(true);
    try {
      const r = await api.emailCode({ newEmail: newEmail.trim(), password: emailPwd });
      setCodeSent(true);
      // 演示模式（超管+演示域）后端直接回显 code，自动填入输入框，免去翻邮箱
      if (r?.code) {
        setEmailCode(r.code);
        toast(`演示模式验证码：${r.code}（已自动填入）`, 'success');
      } else {
        toast(r?.message || '验证码已发送到新邮箱，10 分钟内有效', 'success');
      }
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const submitEmail = async () => {
    if (!emailCode.trim()) return toast('请填写验证码', 'error');
    setBusy(true);
    try {
      await api.changeEmail({ newEmail: newEmail.trim(), code: emailCode.trim() });
      await refresh();
      toast('邮箱已更换', 'success');
      setEmailOpen(false); setNewEmail(''); setEmailPwd(''); setEmailCode(''); setCodeSent(false);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const joinClass = async () => {
    if (!classCode.trim()) return toast('请填写班级码', 'error');
    setBusy(true);
    try {
      const { class: cls } = await api.joinClass(classCode.trim());
      await refresh();
      toast(`已加入 ${cls.name}`, 'success');
      setClassOpen(false); setClassCode('');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const leaveClass = async () => {
    try {
      await api.leaveClass();
      await refresh();
      toast('已退出班级', 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <TopBar
        title="我的"
        back={false}
        right={<MineBell />}
      />
      <div className="space-y-3 px-4 pb-6 pt-3">
        {/* 用户卡 */}
        <div className="card flex items-center gap-3.5 p-5">
          <Avatar user={user} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold text-ink">{user?.name || '未命名同学'}</p>
            <p className="truncate text-[13px] text-sub">{user?.email}</p>
          </div>
          <span className={`chip ${isMember ? 'bg-ok/[0.12] text-ok' : 'bg-black/[0.06] text-sub'}`}>
            {isMember ? '会员' : '免费版'}
          </span>
        </div>
        <button className="btn-secondary w-full" onClick={openProfile}>修改资料</button>

        {/* 会员状态 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold text-ink">会员状态</p>
            <span className="text-[13px] text-sub">{isMember ? `到期：${fmtDate(user?.memberExpireAt)}` : '未开通'}</span>
          </div>
          {!isMember && <p className="mt-1.5 text-[13px] leading-relaxed text-sub">自定义组卷与错题导出为会员功能，请联系管理员开通。</p>}
        </div>

        {/* 班级 */}
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <p className="text-[15px] font-bold text-ink">我的班级</p>
            {user?.classId
              ? <button className="text-[13px] text-bad" onClick={leaveClass}>退出</button>
              : <button className="text-[13px] font-semibold text-ink" onClick={() => setClassOpen(true)}>＋ 加入班级</button>}
          </div>
          <p className="mt-1 text-[13px] text-sub">{user?.classId ? '已加入班级（班级考试可见）' : '输入管理员给的班级码加入班级'}</p>
        </div>

        {/* 账号安全 */}
        <div className="card divide-y divide-line">
          <Row label="修改密码" onClick={() => setPwdOpen(true)} />
          <Row label="更换邮箱" desc={user?.email} onClick={() => setEmailOpen(true)} />
          {showUpdate && (
            <Row
              label={checking ? '正在检查更新…' : '检查更新'}
              desc={checking ? '' : `当前 v${APP_VERSION}`}
              onClick={() => { if (!checking) checkUpdate({ manual: true }); }}
            />
          )}
          <Row label="意见反馈" desc="Bug / 建议" onClick={() => navigate('/tickets')} />
          {showIOSInstallGuide && (
            <Row
              label="添加到主屏幕"
              desc="iPhone 教程"
              onClick={() => navigate('/guide/ios-home', { state: { returnTo: '/mine' } })}
            />
          )}
        </div>

        {/* 角色入口：按身份分流到各自独立端 */}
        {user?.role === 'student' && <Row2 label="我的班级考试" desc="班级布置的试卷" onClick={() => navigate('/exams')} />}
        {user?.role === 'teacher' && <Row2 label="进入教师端" desc="班级 · 出卷 · 学员数据" onClick={() => navigate('/teacher')} />}
        {user?.role === 'admin' && <Row2 label="进入管理后台" desc="题库 · 用户 · 统计" onClick={() => navigate('/admin')} />}

        <button
          className="w-full rounded-2xl bg-bad/[0.08] py-3.5 text-[15px] font-semibold text-bad active:scale-[0.99]"
          onClick={() => { logout(); navigate('/login', { replace: true }); }}
        >
          退出登录
        </button>

        {/* 关于与服务：底部弱化小灰字，非按钮非卡片，不抢主功能 */}
        <nav className="flex items-center justify-center gap-4 py-3" aria-label="关于与服务">
          <button onClick={() => navigate('/developer')} className="text-[12px] text-faint active:text-sub">开发者</button>
          <span className="h-3 w-px bg-line" aria-hidden />
          <button onClick={() => navigate('/terms')} className="text-[12px] text-faint active:text-sub">使用条款</button>
          <span className="h-3 w-px bg-line" aria-hidden />
          <button onClick={() => navigate('/privacy')} className="text-[12px] text-faint active:text-sub">隐私政策</button>
          <span className="h-3 w-px bg-line" aria-hidden />
          <button onClick={() => navigate('/network')} className="text-[12px] text-faint active:text-sub">网络检测</button>
        </nav>

        {/* 版权水印：页面底部弱化展示 */}
        <p className="select-none pb-2 pt-1 text-center text-[11px] tracking-wide text-faint/70">© 2026 物联宝典 · 版权所有</p>
      </div>

      {/* 修改资料弹窗：头像 + 昵称 */}
      <Modal open={profileOpen} onClose={() => setProfileOpen(false)} title="修改资料">
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar user={{ name: editName, avatar: editAvatar }} size={64} />
            <div className="min-w-0 flex-1">
              <label className="btn-secondary block cursor-pointer text-center text-[13px]">
                选择头像
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { pickAvatar(e.target.files[0]); e.target.value = ''; }} />
              </label>
              <p className="mt-1.5 text-[12px] leading-relaxed text-faint">自动压缩到约十几 KB，不占服务器空间</p>
            </div>
          </div>
          <div>
            <label className="label">昵称（最多 20 字）</label>
            <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={20} placeholder="怎么称呼你" />
          </div>
          <button className="btn-primary w-full" disabled={busy} onClick={saveProfile}>保存</button>
        </div>
      </Modal>

      {/* 改密弹窗 */}
      <Modal open={pwdOpen} onClose={() => setPwdOpen(false)} title="修改密码">
        <div className="space-y-3">
          <div><label className="label">原密码</label><input type="password" className="input-field" value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} /></div>
          <div><label className="label">新密码（至少 6 位）</label><input type="password" className="input-field" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} /></div>
          <button className="btn-primary w-full" disabled={busy} onClick={submitPwd}>确认修改</button>
        </div>
      </Modal>

      {/* 换邮箱弹窗 */}
      <Modal open={emailOpen} onClose={() => setEmailOpen(false)} title="更换邮箱">
        <div className="space-y-3">
          <div><label className="label">新邮箱</label><input className="input-field" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@example.com" /></div>
          <div><label className="label">当前密码（确认身份）</label><input type="password" className="input-field" value={emailPwd} onChange={(e) => setEmailPwd(e.target.value)} /></div>
          <button className="btn-secondary w-full" disabled={busy} onClick={requestCode}>{busy && !codeSent ? '发送中…' : '获取验证码'}</button>
          {codeSent && (
            <div><label className="label">验证码（10 分钟有效）</label><input className="input-field" value={emailCode} onChange={(e) => setEmailCode(e.target.value)} placeholder="6 位数字" /></div>
          )}
          <button className="btn-primary w-full" disabled={busy || !codeSent} onClick={submitEmail}>确认更换</button>
        </div>
      </Modal>

      {/* 加入班级弹窗 */}
      <Modal open={classOpen} onClose={() => setClassOpen(false)} title="加入班级">
        <div className="space-y-3">
          <div><label className="label">班级码（管理员提供，6 位）</label><input className="input-field uppercase" value={classCode} onChange={(e) => setClassCode(e.target.value.toUpperCase())} placeholder="如 AB12CD" maxLength={6} /></div>
          <button className="btn-primary w-full" disabled={busy} onClick={joinClass}>加入</button>
        </div>
      </Modal>

      {/* 新版本弹窗：仅 APP（网页端 showUpdate=false，不渲染不请求） */}
      {showUpdate && (
        <Modal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} title={`发现新版本 v${latest?.version || ''}`}>
        <div className="space-y-3">
          <p className="text-[13px] text-sub">当前 v{APP_VERSION}{latest?.size ? ` · ${fmtSize(latest.size)}` : ''}</p>
          {latest?.notes && (
            <p className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{latest.notes}</p>
          )}
          <div className="flex gap-2.5">
            <button className="btn-secondary flex-1" onClick={() => setUpgradeOpen(false)}>稍后再说</button>
            <button className="btn-primary flex-1" onClick={() => { setUpgradeOpen(false); api.openApkDownload(latest); }}>立即更新</button>
          </div>
        </div>
        </Modal>
      )}
    </div>
  );
}

function Row({ label, desc, onClick }) {
  return (
    <button onClick={onClick} className="flex min-h-11 w-full items-center gap-2 px-4 py-4 text-left transition active:bg-black/[0.04]">
      <span className="text-[15px] text-ink">{label}</span>
      {desc && <span className="ml-auto max-w-[55%] truncate text-[13px] text-faint">{desc}</span>}
      <span className="text-faint">›</span>
    </button>
  );
}

function Row2({ label, desc, onClick }) {
  return (
    <button onClick={onClick} className="card flex min-h-11 w-full items-center gap-2 p-4 text-left">
      <span className="text-[15px] font-bold text-ink">{label}</span>
      <span className="ml-auto text-[13px] text-faint">{desc}</span>
      <span className="text-faint">›</span>
    </button>
  );
}

/**
 * 「我的」右上角公告铃铛：克制描边图标 + 未读红点（数字>99 显示 99+）
 * 点击仅叠加公告弹窗（不跳转、不卸载「我的」）；无公告 toast 提示。
 * 公告窗关闭后「我的」内容保持原样。
 */
function MineBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false); // 弹窗开关：只做叠加展示
  const [feed, setFeed] = useState([]); // 当前有效公告（弹窗内切换用）
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const toast2 = useToast();
  useNativeBackHandler(open, () => setOpen(false), 100);
  useEffect(() => {
    let alive = true;
    api.announcements().then(({ unread: n = 0 }) => { if (alive) setUnread(n); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 打开弹窗：拉最新有效公告；多条时弹窗内 ‹ › 切换，未读优先
  const openFeed = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { announcements = [] } = await api.announcements().catch(() => ({ announcements: [] }));
      if (!announcements.length) {
        toast2('暂无公告', 'success');
        return;
      }
      const sorted = [...announcements].sort((x, y) => (y.read ? 0 : 1) - (x.read ? 0 : 1));
      setFeed(sorted);
      setIdx(0);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  };

  // 我知道了：标已读 → 切下一条；全部看完则关闭
  const ack = async () => {
    const cur = feed[idx];
    if (!cur) { setOpen(false); return; }
    try { await api.announcementRead(cur._id); } catch {}
    setUnread((n) => Math.max(0, n - 1));
    const rest = feed.filter((a) => String(a._id) !== String(cur._id));
    setFeed(rest.length ? rest : feed.map((a) => (String(a._id) === String(cur._id) ? { ...a, read: true } : a)));
    if (!rest.length) setOpen(false);
    else setIdx(Math.min(idx, rest.length - 1));
  };

  const cur = feed[idx];
  return (
    <>
      <button
        onClick={openFeed}
        className="relative flex h-9 w-9 touch-manipulation items-center justify-center rounded-full bg-white text-ink shadow-sm transition-[transform,opacity] duration-150 ease-out active:scale-95 active:opacity-80"
        aria-label="公告"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.9 1.9 0 003.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold tabular-nums text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && createPortal(
        <div className="safefullscreen fixed inset-0 z-[95] flex items-center justify-center bg-black/40 p-6" onClick={() => setOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[17px] font-bold leading-snug text-ink">{cur?.title || '公告'}</p>
            {cur ? (
              <div className="mt-3 space-y-4">
                {feed.length > 1 && (
                  <p className="text-[12px] tabular-nums text-faint">{idx + 1} / {feed.length}</p>
                )}
                <p className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{cur.content}</p>
                <div className="flex gap-2.5">
                  {feed.length > 1 ? (
                    <>
                      <button className="btn-secondary flex-1" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>上一条</button>
                      <button className="btn-secondary flex-1" disabled={idx >= feed.length - 1} onClick={() => setIdx((i) => Math.min(feed.length - 1, i + 1))}>下一条</button>
                    </>
                  ) : null}
                  <button className="btn-primary flex-1" onClick={ack}>我知道了</button>
                </div>
              </div>
            ) : (
              <p className="mt-3 py-6 text-center text-[14px] text-sub">{loading ? '加载中…' : '暂无公告'}</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
