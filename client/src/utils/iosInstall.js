const SNOOZE_KEY = 'wlbd_ios_install_snooze_until';
const NEVER_KEY = 'wlbd_ios_install_never';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export function isStandaloneMode(win = window) {
  try {
    return win.navigator?.standalone === true
      || win.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

export function isIOSDevice(nav = navigator) {
  try {
    const agent = nav.userAgent || '';
    return /iPad|iPhone|iPod/i.test(agent)
      || (/Macintosh/i.test(agent) && Number(nav.maxTouchPoints) > 1);
  } catch {
    return false;
  }
}

export function isIOSWebEnvironment(win = window) {
  try {
    const nativeApp = !!(win.Capacitor?.isNativePlatform?.());
    return isIOSDevice(win.navigator) && !nativeApp && !isStandaloneMode(win);
  } catch {
    return false;
  }
}

export function isInstallGuideWebEnvironment(win = window) {
  try {
    const nativeApp = !!(win.Capacitor?.isNativePlatform?.());
    if (nativeApp || isStandaloneMode(win)) return false;

    const agent = win.navigator?.userAgent || '';
    if (/Android/i.test(agent)) return false;
    if (isIOSDevice(win.navigator)) return true;

    return !/Mobi|Mobile|IEMobile|Opera Mini/i.test(agent);
  } catch {
    return false;
  }
}

export function shouldAutoShowIOSInstallGuide(win = window, now = Date.now()) {
  if (!isInstallGuideWebEnvironment(win)) return false;
  try {
    if (win.localStorage.getItem(NEVER_KEY) === '1') return false;
    const snoozeUntil = Number(win.localStorage.getItem(SNOOZE_KEY) || 0);
    return !Number.isFinite(snoozeUntil) || snoozeUntil <= now;
  } catch {
    return true;
  }
}

export function snoozeIOSInstallGuide(win = window, now = Date.now()) {
  try {
    win.localStorage.setItem(SNOOZE_KEY, String(now + SEVEN_DAYS));
  } catch {}
}

export function neverShowIOSInstallGuide(win = window) {
  try {
    win.localStorage.setItem(NEVER_KEY, '1');
    win.localStorage.removeItem(SNOOZE_KEY);
  } catch {}
}

export const IOS_INSTALL_STORAGE_KEYS = { snooze: SNOOZE_KEY, never: NEVER_KEY };
