import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('exam mode hides the shared student navigation with a transform', async () => {
  const shell = await readFile(new URL('../src/layouts/StudentShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /translate-y-full/);
  assert.match(shell, /translate-y-0/);
  assert.match(shell, /duration-300/);
  assert.match(shell, /setImmersive\(false\)[\s\S]*window\.scrollTo/);
  assert.doesNotMatch(shell, /!immersive\s*&&\s*\(/);
});

test('exam answering never depends on the browser fullscreen API', async () => {
  const exam = await readFile(new URL('../src/pages/ExamDetail.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(exam, /requestFullscreen|exitFullscreen|webkitRequestFullscreen|webkitExitFullscreen|fullscreenchange/);
  assert.match(exam, /setImmersive\(true\)/);
  assert.match(exam, /setImmersive\(false\)/);
  assert.match(exam, /wlbd:exam-immersive/);
});
