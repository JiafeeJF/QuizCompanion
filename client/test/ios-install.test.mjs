import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInstallGuideWebEnvironment,
  isIOSWebEnvironment,
  neverShowIOSInstallGuide,
  shouldAutoShowIOSInstallGuide,
  snoozeIOSInstallGuide,
} from '../src/utils/iosInstall.js';

function fakeWindow({ userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', standalone = false, native = false } = {}) {
  const values = new Map();
  return {
    navigator: { userAgent, maxTouchPoints: 5, standalone },
    matchMedia: () => ({ matches: standalone }),
    Capacitor: native ? { isNativePlatform: () => true } : undefined,
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
}

test('install guide is eligible only in an iOS browser outside standalone and native app modes', () => {
  assert.equal(isIOSWebEnvironment(fakeWindow()), true);
  assert.equal(isIOSWebEnvironment(fakeWindow({ standalone: true })), false);
  assert.equal(isIOSWebEnvironment(fakeWindow({ native: true })), false);
  assert.equal(isIOSWebEnvironment(fakeWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })), false);
});

test('automatic prompt supports iOS and desktop web, while excluding Android web', () => {
  assert.equal(isInstallGuideWebEnvironment(fakeWindow()), true);
  assert.equal(isInstallGuideWebEnvironment(fakeWindow({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  })), true);
  assert.equal(isInstallGuideWebEnvironment(fakeWindow({
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 Mobile Safari/537.36',
  })), false);
  assert.equal(isInstallGuideWebEnvironment(fakeWindow({ standalone: true })), false);
  assert.equal(isInstallGuideWebEnvironment(fakeWindow({ native: true })), false);
});

test('seven-day snooze and permanent opt-out suppress only automatic prompts', () => {
  const win = fakeWindow();
  const now = Date.UTC(2026, 9, 4);
  assert.equal(shouldAutoShowIOSInstallGuide(win, now), true);
  snoozeIOSInstallGuide(win, now);
  assert.equal(shouldAutoShowIOSInstallGuide(win, now + 6 * 24 * 60 * 60 * 1000), false);
  assert.equal(shouldAutoShowIOSInstallGuide(win, now + 8 * 24 * 60 * 60 * 1000), true);
  neverShowIOSInstallGuide(win);
  assert.equal(shouldAutoShowIOSInstallGuide(win, now + 30 * 24 * 60 * 60 * 1000), false);
});
