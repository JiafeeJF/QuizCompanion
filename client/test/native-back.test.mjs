import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('android native back is gated to the native Android platform', async () => {
  const app = await read('../src/App.jsx');
  assert.match(app, /Capacitor\.isNativePlatform\(\)/);
  assert.match(app, /Capacitor\.getPlatform\(\)\s*!==\s*['"]android['"]/);
  assert.match(app, /addListener\(['"]backButton['"]/);
  assert.match(app, /new Set\(\[['"]\/['"], ['"]\/practice['"], ['"]\/exams['"], ['"]\/mine['"]\]\)/);
  assert.match(app, /再按一次退出应用/);
  assert.match(app, /CapacitorApp\.exitApp\(\)/);
});

test('overlays consume native back before route navigation', async () => {
  const app = await read('../src/App.jsx');
  const modal = await read('../src/components/ui.jsx');
  const confirm = await read('../src/components/Confirm.jsx');
  assert.match(app, /consumeNativeBack\(\)/);
  const layer = await read('../src/components/DialogLayer.jsx');
  assert.match(modal, /DialogLayer open=\{open\}[\s\S]*priority=\{100\}/);
  assert.match(confirm, /DialogLayer open=\{!!state\}[\s\S]*priority=\{110\}/);
  assert.match(layer, /useNativeBackHandler\(true, dismiss, priority\)/);
});

test('answering an exam sends native back through the existing leave flow', async () => {
  const exam = await read('../src/pages/ExamDetail.jsx');
  assert.match(exam, /useNativeBackHandler\(started, requestLeave, 50\)/);
  assert.match(exam, /const requestLeave = \(\) =>/);
  assert.match(exam, /abandonAttempt\(false\)/);
  assert.match(exam, /navigate\(['"]\/exams['"], \{ replace: true \}\)/);
});
