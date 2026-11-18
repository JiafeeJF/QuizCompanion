import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const promptSource = await readFile(
  new URL('../src/components/AddToHomeAutoPrompt.jsx', import.meta.url),
  'utf8',
);
const guidePageSource = await readFile(
  new URL('../src/pages/AddToHome.jsx', import.meta.url),
  'utf8',
);
const promptStyles = await readFile(
  new URL('../src/components/AddToHomeAutoPrompt.css', import.meta.url),
  'utf8',
);

test('iOS install prompt is delayed, one-time, and links to the public guide', () => {
  assert.match(promptSource, /setTimeout\(\(\) => setOpen\(true\), 800\)/);
  assert.match(promptSource, /wlbd_ios_install_prompt_seen/);
  assert.match(promptSource, /navigate\('\/guide\/ios-home', \{ state: \{ returnTo:/);
  assert.match(promptSource, /可添加到主屏幕/);
  assert.match(promptSource, /查看添加教程/);
  assert.match(promptSource, /稍后提醒/);
  assert.match(promptSource, /不再提示/);
  assert.match(promptSource, /snoozeIOSInstallGuide/);
  assert.match(promptSource, /neverShowIOSInstallGuide/);
  assert.doesNotMatch(promptSource, /立即安装到桌面/);
  assert.doesNotMatch(promptSource, /<AddToHomeGuide/);
  assert.doesNotMatch(promptSource, /EXCLUDED_PREFIXES = \[[^\]]*'\/teacher'/);
  assert.match(promptSource, /prompt_seen_teacher_v2/);
  assert.match(promptStyles, /align-items: center/);
});

test('finishing the guide returns to its source without clearing authentication', () => {
  assert.match(guidePageSource, /location\.state\?\.returnTo/);
  assert.match(guidePageSource, /navigate\(returnTo, \{ replace: true \}\)/);
  assert.match(guidePageSource, /user\.role === 'admin'/);
  assert.doesNotMatch(guidePageSource, /logout/);
});
