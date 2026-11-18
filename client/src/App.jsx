import React, { lazy, Suspense, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AuthProvider, useAuth } from './auth.jsx';
import { ToastProvider, useToast } from './Toast.jsx';
import { ConfirmProvider } from './components/Confirm.jsx';
import { StudentShell } from './layouts/StudentShell.jsx';
import { TeacherShell } from './layouts/TeacherShell.jsx';
import { AdminShell } from './layouts/AdminShell.jsx';
import { RequireAuth, RequireRole, PageLoading } from './components/guards.jsx';
import { NoticeProvider } from './notices.jsx';
import { StudentAnnouncements } from './announcements.jsx';
import { RealtimeProvider } from './realtime.jsx';
import { MaintenanceProvider } from './maintenance.jsx';
import { RealtimeUpdateModal, ExamRealtimeRefresh } from './components/RealtimeOverlays.jsx';
import AddToHomeAutoPrompt from './components/AddToHomeAutoPrompt.jsx';
import BrandSplash from './components/BrandSplash.jsx';
import ExamEntry from './components/ExamEntry.jsx';
import { api, isAppEnv } from './api.js';
import { DOWNLOAD_SITE_URL } from './config.js';
import { consumeNativeBack } from './utils/nativeBack.js';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import MaintenanceAccess from './pages/MaintenanceAccess.jsx';
const TicketsPage = lazy(() => import('./pages/Tickets.jsx').then((m) => ({ default: m.Tickets })));
const TicketNewPage = lazy(() => import('./pages/Tickets.jsx').then((m) => ({ default: m.TicketNew })));
const TicketDetailPage = lazy(() => import('./pages/Tickets.jsx').then((m) => ({ default: m.TicketDetail })));
const TeacherHomePage = lazy(() => import('./pages/Teacher.jsx').then((m) => ({ default: m.TeacherHome })));
const CreateExamPage = lazy(() => import('./pages/Teacher.jsx').then((m) => ({ default: m.CreateExam })));
const ClassDetailPage = lazy(() => import('./pages/Teacher.jsx').then((m) => ({ default: m.ClassDetail })));
const TeacherExamDetailPage = lazy(() => import('./pages/Teacher.jsx').then((m) => ({ default: m.TeacherExamDetail })));
const AdminHomePage = lazy(() => import('./pages/Admin.jsx').then((m) => ({ default: m.AdminHome })));
const MobileAdminAccessPage = lazy(() => import('./pages/MobileAdminAccess.jsx'));

const BankInit = lazy(() => import('./pages/BankInit.jsx'));
const Home = lazy(() => import('./pages/Home.jsx'));
const PracticeHome = lazy(() => import('./pages/PracticeHome.jsx'));
const Practice = lazy(() => import('./pages/Practice.jsx'));
const PracticeSession = lazy(() => import('./pages/PracticeSession.jsx'));
const PracticeHistory = lazy(() => import('./pages/PracticeHistory.jsx'));
const Exams = lazy(() => import('./pages/Exams.jsx'));
const CustomExam = lazy(() => import('./pages/CustomExam.jsx'));
const ExamResult = lazy(() => import('./pages/ExamResult.jsx'));
const Bank = lazy(() => import('./pages/Bank.jsx'));
const Mine = lazy(() => import('./pages/Mine.jsx'));
const Share = lazy(() => import('./pages/Share.jsx'));
const Developer = lazy(() => import('./pages/Developer.jsx'));
const Terms = lazy(() => import('./pages/Terms.jsx'));
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const Network = lazy(() => import('./pages/Network.jsx'));
const TeacherMine = lazy(() => import('./pages/teacher/TeacherMine.jsx'));
const AddToHomePage = lazy(() => import('./pages/AddToHome.jsx'));
const NoticesPage = lazy(() => import('./pages/Notices.jsx').then((m) => ({ default: m.Notices })));
const NoticeDetailPage = lazy(() => import('./pages/Notices.jsx').then((m) => ({ default: m.NoticeDetail })));

// iOS 主屏幕应用可能恢复安装时/上次关闭时的 URL。只记录本次页面冷启动是否
// 直接落在注册页，避免影响用户从登录页主动点击“立即注册”的正常流程。
const standaloneRegisterLaunch = (() => {
  try {
    const standalone = window.navigator.standalone === true
      || window.matchMedia?.('(display-mode: standalone)').matches === true;
    return standalone && window.location.pathname === '/register';
  } catch {
    return false;
  }
})();

const withSuspense = (el) => <Suspense fallback={<RouteLoading />}>{el}</Suspense>;

function RouteLoading() {
  return <div className="min-h-[45vh] px-4 pt-8"><div className="skeleton h-8 w-40" /><div className="skeleton mt-4 h-24 w-full" /><div className="skeleton mt-3 h-24 w-full" /></div>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (['/developer', '/terms', '/privacy', '/network'].includes(pathname)) window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}

const STUDENT_TAB_ROOTS = new Set(['/', '/practice', '/exams', '/mine']);

/** Android edge gesture and navigation button share Capacitor's backButton event. */
function AndroidNativeBack() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const locationRef = React.useRef(pathname);
  const userRef = React.useRef(user);
  const lastRootBackRef = React.useRef(0);

  useEffect(() => { locationRef.current = pathname; lastRootBackRef.current = 0; }, [pathname]);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return undefined;
    let active = true;
    let listenerHandle;

    CapacitorApp.addListener('backButton', () => {
      if (!active || consumeNativeBack()) return;

      const path = locationRef.current;
      if (STUDENT_TAB_ROOTS.has(path) || path === '/login' || path === '/teacher' || path === '/admin') {
        const now = Date.now();
        if (now - lastRootBackRef.current <= 1800) {
          CapacitorApp.exitApp();
          return;
        }
        lastRootBackRef.current = now;
        toast('再按一次退出应用', 'info');
        return;
      }

      const historyIndex = Number(window.history.state?.idx);
      if (Number.isFinite(historyIndex) && historyIndex > 0) {
        navigate(-1);
        return;
      }

      const role = userRef.current?.role;
      navigate(role === 'teacher' ? '/teacher' : role === 'admin' ? '/admin' : '/', { replace: true });
    }).then((handle) => {
      if (active) listenerHandle = handle;
      else handle.remove();
    });

    return () => {
      active = false;
      listenerHandle?.remove();
    };
  }, [navigate, toast]);

  return null;
}

function DownloadRedirect() {
  useEffect(() => { window.location.replace(DOWNLOAD_SITE_URL); }, []);
  return <PageLoading label="正在前往下载站" />;
}

/**
 * 三端独立路由：
 * - 学员端 / ：StudentShell（底部四 Tab），仅学员/会员可进
 * - 教师端 /teacher ：TeacherShell（深色顶栏 + 班级/布置/我的），仅教师/管理员可进
 * - 管理后台 /admin ：AdminShell（顶栏 + 总览/题库/用户/班级/试卷），仅管理员可进
 * - /login /register 为公共入口，登录后按角色分流（见 Login.jsx）
 */
function RoleIndex() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.role === 'teacher') return <Navigate to="/teacher" replace />;
  return <Navigate to="/" replace />;
}

function RegisterRoute() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoading />;
  if (standaloneRegisterLaunch) return <Navigate to={user ? '/' : '/login'} replace />;
  return <Register />;
}

/**
 * APP 深链落地：从考试通知邮件点链接唤起 APP 时，MainActivity 把目标路径
 * （/exams/:id 或 /share/:token）写入 localStorage['wlbd_pending_deeplink']。
 * 这里在路由就绪后读出并跳转；未登录会被 RequireAuth 拦到登录页，
 * 登录后 Login.jsx 会回跳原来要去的页面（见 from 逻辑），链路不断。
 * 网页端打开同链接是正常路由，不走这条：只在 pending 存在时才接管。
 */
export function DeepLinkRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const target = consumePendingDeepLink();
    // 深链目标：/exams/:id（考试）或 /share/:token（分享），白名单校验防外部注入
    if (target && (/^\/(exams|share)\/[A-Za-z0-9_-]{6,64}(\?.*)?$/.test(target) || /^\/m\/[A-Za-z0-9_-]{24,128}$/.test(target))) {
      navigate(target, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [navigate]);
  return <PageLoading />;
}

/** 读出并一次性消费 MainActivity 写入的待跳转目标（读后即删，防重复跳转） */
export function consumePendingDeepLink() {
  let target = null;
  try { target = localStorage.getItem('wlbd_pending_deeplink'); } catch {}
  try { localStorage.removeItem('wlbd_pending_deeplink'); } catch {}
  return target;
}

/**
 * 全局深链监听（无 UI，必须挂在 Router 内部）：
 * 之前只有 /deeplink 路由消费 pending，但 MainActivity 唤起 APP 时并不会导航到 /deeplink，
 * APP 停在旧路由，pending 永远没人读——这就是"唤起了但没进考试页"的根因。
 * 现在挂载后即检查一次 + 监听事件 + 每秒轮询兜底（覆盖冷启动时序：MainActivity 在
 * bridge 就绪后才写 localStorage，可能晚于 React 挂载）。
 */
export function DeepLinkListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const tryConsume = () => {
      const target = consumePendingDeepLink();
      if (target && (/^\/(exams|share)\/[A-Za-z0-9_-]{6,64}(\?.*)?$/.test(target) || /^\/m\/[A-Za-z0-9_-]{24,128}$/.test(target))) {
        navigate(target, { replace: true });
        return true;
      }
      return false;
    };
    tryConsume();
    const onEvent = () => tryConsume();
    window.addEventListener('wlbd:deeplink', onEvent);
    window.addEventListener('storage', onEvent);
    const timer = setInterval(tryConsume, 1000);
    return () => {
      window.removeEventListener('wlbd:deeplink', onEvent);
      window.removeEventListener('storage', onEvent);
      clearInterval(timer);
    };
  }, [navigate]);
  return null;
}

function ExamRecoveryCleanup() {
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading || !user) return undefined;
    // A cold start may follow an Android process kill, where no unload
    // callback was delivered. The server is authoritative and clears any
    // unsubmitted attempt before the user can resume normal navigation.
    api.abandonInProgressExams().catch(() => {});
    return undefined;
  }, [loading, user?._id]);
  return null;
}

export default function App() {
  // Capacitor WebView is recreated on every Android cold launch. Keeping the
  // splash at the app root makes it independent of login state and route.
  const [appSplash, setAppSplash] = useState(() => isAppEnv());
  useEffect(() => {
    if (!appSplash) return undefined;
    const timer = setTimeout(() => setAppSplash(false), 1700);
    return () => clearTimeout(timer);
  }, [appSplash]);
  return (
    <>
      <AnimatePresence>
        {appSplash && <BrandSplash key="android-app-splash" />}
      </AnimatePresence>
      <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <ConfirmProvider>
          <MaintenanceProvider>
            <NoticeProvider>
            <RealtimeProvider>
            <RealtimeUpdateModal />
            <ExamRealtimeRefresh />
            <ExamRecoveryCleanup />
            <DeepLinkListener />
            <ScrollToTop />
            <AndroidNativeBack />
            <AddToHomeAutoPrompt />
            <Routes>
              <Route path="/login" element={withSuspense(<Login />)} />
              <Route path="/maintain-access/:accessId" element={withSuspense(<MaintenanceAccess />)} />
              <Route path="/register" element={withSuspense(<RegisterRoute />)} />
              <Route path="/guide/ios-home" element={withSuspense(<AddToHomePage />)} />
              <Route path="/add-to-home" element={withSuspense(<AddToHomePage />)} />
              <Route path="/index" element={withSuspense(<RoleIndex />)} />
              {/* 题库初始化：登录后本地无题库/版本过期才进，其余直接走原主页 */}
              <Route path="/bank-init" element={withSuspense(<RequireAuth><RequireRole roles={['student']}><BankInit /></RequireRole></RequireAuth>)} />

              {/* 学员端 */}
              <Route element={withSuspense(<RequireAuth><RequireRole roles={['student']}><StudentShell /></RequireRole></RequireAuth>)}>
                <Route index element={withSuspense(<StudentAnnouncements><Home /></StudentAnnouncements>)} />
                <Route path="practice" element={withSuspense(<PracticeHome />)} />
                <Route path="practice/history" element={withSuspense(<PracticeHistory />)} />
                <Route path="practice/s/:sessionId" element={withSuspense(<PracticeSession />)} />
                {/* 旧直链兼容：无会话散刷（不落盘会话，仅保留判分/错题/收藏） */}
                <Route path="practice/order" element={withSuspense(<Practice />)} />
                <Route path="practice/random" element={withSuspense(<Practice />)} />
                <Route path="practice/chapter/:id" element={withSuspense(<Practice />)} />
                <Route path="exams" element={withSuspense(<Exams />)} />
                <Route path="exams/custom" element={withSuspense(<CustomExam />)} />
                <Route path="exams/:id" element={<ExamEntry />} />
                <Route path="exams/:id/result" element={withSuspense(<ExamResult />)} />
                <Route path="wrongs" element={withSuspense(<Bank tab="wrong" />)} />
                <Route path="favorites" element={withSuspense(<Bank tab="fav" />)} />
                <Route path="mine" element={withSuspense(<Mine />)} />
                <Route path="notices" element={withSuspense(<StudentAnnouncements><NoticesPage /></StudentAnnouncements>)} />
                <Route path="notices/:id" element={withSuspense(<StudentAnnouncements><NoticeDetailPage /></StudentAnnouncements>)} />
                <Route path="developer" element={withSuspense(<Developer />)} />
                <Route path="terms" element={withSuspense(<Terms />)} />
                <Route path="privacy" element={withSuspense(<Privacy />)} />
                <Route path="network" element={withSuspense(<Network />)} />
                <Route path="share/:token" element={withSuspense(<Share />)} />
                <Route path="tickets" element={withSuspense(<TicketsPage />)} />
                <Route path="tickets/new" element={withSuspense(<TicketNewPage />)} />
                <Route path="tickets/:id" element={withSuspense(<TicketDetailPage />)} />
              </Route>

              {/* 教师端（独立布局 + 独立路由） */}
              <Route path="/teacher" element={withSuspense(<RequireAuth><RequireRole roles={['teacher', 'admin']}><TeacherShell /></RequireRole></RequireAuth>)}>
                <Route index element={withSuspense(<TeacherHomePage />)} />
                <Route path="create-exam" element={withSuspense(<CreateExamPage />)} />
                <Route path="class/:id" element={withSuspense(<ClassDetailPage />)} />
                <Route path="exam/:id" element={withSuspense(<TeacherExamDetailPage />)} />
                <Route path="mine" element={withSuspense(<TeacherMine />)} />
                <Route path="tickets" element={withSuspense(<TicketsPage />)} />
                <Route path="tickets/new" element={withSuspense(<TicketNewPage />)} />
                <Route path="tickets/:id" element={withSuspense(<TicketDetailPage />)} />
              </Route>

              {/* 管理后台（独立布局 + 独立路由） */}
              <Route path="/admin" element={withSuspense(<RequireAuth><RequireRole roles={['admin']}><AdminShell /></RequireRole></RequireAuth>)}>
                <Route index element={withSuspense(<AdminHomePage />)} />
                <Route path=":tab" element={withSuspense(<AdminHomePage />)} />
              </Route>

              {/* Android APK 专用隐藏管理入口；密钥由服务端校验，公开导航不暴露。 */}
              <Route path="/m/:mobileAdminKey" element={withSuspense(<MobileAdminAccessPage />)}>
                <Route element={withSuspense(<AdminShell />)}>
                  <Route index element={withSuspense(<AdminHomePage />)} />
                  <Route path=":tab" element={withSuspense(<AdminHomePage />)} />
                </Route>
              </Route>

              {/* 公开下载页：无需登录 */}
              <Route path="/download" element={withSuspense(<DownloadRedirect />)} />

              {/* 深链落地：APP 被 https://iot.wakaibg5.top/exams/:id 唤起时，
                  MainActivity 把目标写入 localStorage，这里读出并跳到对应考试页 */}
              <Route path="/deeplink" element={withSuspense(<DeepLinkRedirect />)} />

              <Route path="*" element={withSuspense(<Navigate to="/" replace />)} />
            </Routes>
            </RealtimeProvider>
            </NoticeProvider>
          </MaintenanceProvider>
          </ConfirmProvider>
        </AuthProvider>
      </ToastProvider>
      </BrowserRouter>
    </>
  );
}
