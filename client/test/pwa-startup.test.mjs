import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/site.webmanifest', import.meta.url), 'utf8'));
const appSource = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const guideSource = fs.readFileSync(new URL('../src/components/AddToHomeGuide.jsx', import.meta.url), 'utf8');
const promptSource = fs.readFileSync(new URL('../src/components/AddToHomeAutoPrompt.jsx', import.meta.url), 'utf8');
const teacherMineSource = fs.readFileSync(new URL('../src/pages/teacher/TeacherMine.jsx', import.meta.url), 'utf8');

test('PWA always starts within the student app root scope', () => {
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});

test('public add-to-home guide is available without authentication', () => {
  assert.match(appSource, /path="\/guide\/ios-home"/);
  assert.match(appSource, /path="\/add-to-home"/);
  assert.match(appSource, /<AddToHomePage\s*\/>/);
  assert.ok(appSource.indexOf('path="/guide/ios-home"') < appSource.indexOf('{/* 学员端 */}'));
});

test('teacher mine exposes the public install guide with a teacher return path', () => {
  assert.match(teacherMineSource, /isInstallGuideWebEnvironment/);
  assert.match(teacherMineSource, /添加到主屏幕/);
  assert.match(teacherMineSource, /iPhone 教程/);
  assert.match(teacherMineSource, /navigate\('\/guide\/ios-home', \{ state: \{ returnTo: '\/teacher\/mine' \} \}\)/);
});

test('iOS install guide keeps the supplied screenshot sequence while prompt owns opt-out controls', () => {
  for (let index = 1; index <= 6; index += 1) {
    assert.match(guideSource, new RegExp(`/install-guide/n${index}\\.jpg`));
  }
  assert.equal((guideSource.match(/focus: \{ x:/g) || []).length, 6);
  assert.match(guideSource, /<motion\.img/);
  assert.match(guideSource, /transformOrigin: `\$\{frame\.focus\.x\}% \$\{frame\.focus\.y\}%`/);
  assert.match(guideSource, /animate=\{\{ scale: reduceMotion \? 1 : frame\.focus\.scale \}\}/);
  assert.match(guideSource, /type: 'spring'/);
  assert.match(guideSource, /开启语音/);
  assert.match(guideSource, /先开启语音，跟随讲解更轻松/);
  assert.doesNotMatch(guideSource, /建议先开启语音/);
  assert.match(guideSource, /<AnimatePresence mode="wait" initial=\{false\}>/);
  assert.match(guideSource, /exit=\{\{ opacity: 0, y:/);
  assert.match(guideSource, /scale: 0\.94/);
  assert.match(guideSource, /duration: reduceMotion \? 0\.01 : 0\.58/);
  assert.match(guideSource, /function KineticCharacters/);
  assert.match(guideSource, /aria-label=\{text\}/);
  assert.match(guideSource, /aria-hidden="true"/);
  assert.match(guideSource, /const INTRO_CUES = \[/);
  assert.match(guideSource, /playbackTime >= revealAt/);
  assert.match(guideSource, /audio\.currentTime/);
  assert.match(guideSource, /requestAnimationFrame\(followAudio\)/);
  assert.match(guideSource, /className="a2hs-intro-title a2hs-char-line"[\s\S]*cues=\{INTRO_TITLE_CUES\}/);
  assert.match(guideSource, /className="a2hs-intro-body a2hs-char-line"[\s\S]*cues=\{INTRO_BODY_CUES\}/);
  assert.match(guideSource, /开始教程/);
  assert.match(guideSource, /开场语音结束后将自动开始教程/);
  assert.match(guideSource, /onClick=\{narrationSupported \? toggleVoice : startTutorial\}/);
  assert.match(guideSource, /disabled=\{narrationSupported && voiceEnabled\}/);
  assert.match(guideSource, /showIntro \? advanceAfterIntro/);
  assert.match(guideSource, /STEP_ACTION_DELAY = 3000/);
  assert.match(guideSource, /disabled=\{stepLocked\}/);
  assert.match(guideSource, /audio\.pause\(\)/);
  assert.match(guideSource, /audio\.play\(\)\.catch/);
  assert.match(guideSource, /const PLAYBACK_RATES = \[1, 1\.25, 1\.5, 1\.75, 2\]/);
  assert.match(guideSource, /const cyclePlaybackRate = \(\) =>/);
  assert.match(guideSource, /PLAYBACK_RATES\[\(currentIndex \+ 1\) % PLAYBACK_RATES\.length\]/);
  assert.match(guideSource, /点击切换播放速度/);
  assert.match(guideSource, /audio\.playbackRate = playbackRateRef\.current/);
  assert.match(guideSource, /utterance\.rate = 0\.86 \* playbackRateRef\.current/);
  assert.doesNotMatch(guideSource, /speechSynthesis\.pause\(\)/);
  assert.match(guideSource, /import \{ Volume2, VolumeX \} from 'lucide-react'/);
  assert.match(guideSource, /aria-pressed=\{muted\}/);
  assert.match(guideSource, /audio\.muted = mutedRef\.current/);
  assert.match(guideSource, /audio\.muted = nextMuted/);
  assert.match(guideSource, /setStepLocked\(!frameAlreadyPlayed\)/);
  assert.match(guideSource, /playedFramesRef\.current\.add\(frameIndex\)/);
  assert.match(guideSource, /frameAlreadyPlayed \? undefined : advanceAfterFrame/);
  assert.match(guideSource, /if \(stepLocked\) return/);
  assert.match(guideSource, /disabled=\{stepLocked \|\| frameIndex === 0\}/);
  assert.match(guideSource, /受 iOS 系统限制/);
  assert.match(guideSource, /需要按接下来的步骤手动完成/);
  assert.match(guideSource, /测试机型：iPhone 17 Pro/);
  assert.doesNotMatch(guideSource, /立即安装到桌面/);
  assert.doesNotMatch(guideSource, /不再提示/);
  assert.doesNotMatch(guideSource, /7 天内不再提示/);
  assert.match(promptSource, /稍后提醒/);
  assert.match(promptSource, /不再提示/);
  assert.match(promptSource, /shouldAutoShowIOSInstallGuide/);
});

test('iOS install guide ships every recorded narration file', () => {
  const files = [
    '00-intro.mp3',
    '01-share.mp3',
    '02-share-menu.mp3',
    '03-expand.mp3',
    '04-add-home.mp3',
    '05-confirm.mp3',
    '06-complete.mp3',
  ];
  for (const file of files) {
    const audioUrl = new URL(`../public/install-guide/audio/${file}`, import.meta.url);
    assert.equal(fs.existsSync(audioUrl), true, `missing narration file: ${file}`);
    assert.match(guideSource, new RegExp(file.replace('.', '\\.')));
  }
});

test('standalone register startup is guarded without removing the register route', () => {
  assert.match(appSource, /navigator\.standalone/);
  assert.match(appSource, /display-mode: standalone/);
  assert.match(appSource, /standaloneRegisterLaunch/);
  assert.match(appSource, /path="\/register"/);
  assert.match(appSource, /<RegisterRoute\s*\/>/);
});
