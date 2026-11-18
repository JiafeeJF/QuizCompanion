import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';
import './AddToHomeGuide.css';

const FRAMES = [
  {
    step: 1,
    image: '/install-guide/n1.jpg',
    audio: '/install-guide/audio/01-share.mp3',
    title: ['打开', '分享菜单'],
    body: ['首先，', '请点击浏览器右下角的更多按钮。'],
    speech: '首先，请点击浏览器右下角的更多按钮。',
    alt: 'Safari 页面底部工具栏，箭头指向更多按钮',
    focus: { x: 52, y: 91, scale: 1.72 },
  },
  {
    step: 2,
    image: '/install-guide/n2.jpg',
    audio: '/install-guide/audio/02-share-menu.mp3',
    title: ['选择', '共享'],
    body: ['在弹出的菜单里，', '点击共享。'],
    speech: '然后选择共享。',
    alt: 'Safari 更多菜单，箭头指向共享选项',
    focus: { x: 53, y: 64, scale: 1.68 },
  },
  {
    step: 3,
    image: '/install-guide/n3.jpg',
    audio: '/install-guide/audio/03-expand.mp3',
    title: ['展开', '完整菜单'],
    body: ['共享面板打开后，', '点击“查看更多”，', '展开完整的操作列表。'],
    speech: '共享面板打开后，点击“查看更多”，展开完整的操作列表。',
    alt: 'iOS 共享面板，箭头指向查看更多',
    focus: { x: 55, y: 100, scale: 1.9 },
  },
  {
    step: 3,
    image: '/install-guide/n4.jpg',
    audio: '/install-guide/audio/04-add-home.mp3',
    title: ['添加到', '主屏幕'],
    body: ['找到列表底部的', '添加到主屏幕并点击。'],
    speech: '找到以后，点添加到主屏幕。',
    alt: '展开后的 iOS 共享面板，箭头指向添加到主屏幕',
    focus: { x: 45, y: 100, scale: 1.9 },
  },
  {
    step: 4,
    image: '/install-guide/n5.jpg',
    audio: '/install-guide/audio/05-confirm.mp3',
    title: ['确认名称', '并添加'],
    body: ['保持“作为网页 App 打开”开启，', '再点右上角添加。'],
    speech: '确认名称后，保持作为网页 App 打开，然后点右上角添加。',
    alt: '添加到主屏幕确认页，箭头指向添加按钮和网页 App 开关',
    focus: { x: 50, y: 10, scale: 1.55 },
  },
  {
    step: 5,
    image: '/install-guide/n6.jpg',
    audio: '/install-guide/audio/06-complete.mp3',
    title: ['完成', '随时打开'],
    body: ['回到桌面，', '就能看到物联宝典图标了。'],
    speech: '回到桌面，就能看到物联宝典图标了。',
    alt: 'iPhone 桌面上的物联宝典图标',
    focus: { x: 32, y: 17, scale: 1.62 },
  },
];

const EASE = [0.16, 1, 0.3, 1];
const STEP_ACTION_DELAY = 3000;
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];
const INTRO_AUDIO = '/install-guide/audio/00-intro.mp3';
const INTRO_SPEECH = '很抱歉，受运营经费限制，我们暂时无法提供 iOS 原生应用。为了方便 iPhone 用户使用，您可以将物联宝典添加到主屏幕，使用体验接近 App。受 iOS 系统限制，需要按接下来的步骤手动完成。';
const INTRO_CUES = [
  { text: '很抱歉，', start: 0.323, end: 0.937 },
  { text: '受运营经费限制，', start: 1.444, end: 2.809 },
  { text: '我们暂时无法提供 iOS 原生应用。', start: 3.295, end: 6.276 },
  { text: '为了方便 iPhone 用户使用，', start: 7.093, end: 8.822 },
  { text: '您可以将物联宝典添加到主屏幕，', start: 9.25, end: 11.742 },
  { text: '使用体验接近 App。', start: 12.28, end: 13.972 },
  { text: '受 iOS 系统限制，', start: 14.772, end: 16.429 },
  { text: '需要按接下来的步骤手动完成。', start: 16.965, end: 19.628 },
];
const INTRO_TITLE_CUES = INTRO_CUES.slice(0, 1);
const INTRO_BODY_CUES = INTRO_CUES.slice(1, 6);
const INTRO_NOTE_CUES = INTRO_CUES.slice(6);
const INTRO_END_TIME = INTRO_CUES.at(-1).end;
const INTRO_REVEAL_TIMES = INTRO_CUES.flatMap(({ text, start, end }) => (
  [...text].map((_, index, characters) => start + (((index + 1) / characters.length) * (end - start)))
));

const formatPlaybackRate = (rate) => `${rate.toFixed(2).replace(/0$/, '')}×`;

function KineticLine({ parts, className = '', label }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      className={className}
      aria-label={label || parts.join('')}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.055 } },
      }}
    >
      {parts.map((part, index) => (
        <motion.span
          aria-hidden="true"
          className="a2hs-kinetic-part"
          key={`${part}-${index}`}
          variants={{
            hidden: { opacity: 0, y: reduceMotion ? 0 : 8 },
            visible: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0.01 : 0.46, ease: EASE } },
          }}
        >
          {part}
        </motion.span>
      ))}
    </motion.span>
  );
}

function KineticCharacters({ cues, playbackTime, className = '' }) {
  const reduceMotion = useReducedMotion();
  const text = cues.map((cue) => cue.text).join('');
  const tokens = cues.flatMap(({ text: cueText, start, end }, cueIndex) => {
    let cueCharacterIndex = 0;
    const cueCharacters = [...cueText];
    return (cueText.match(/[A-Za-z0-9]+| +|./gu) || []).map((token, tokenIndex) => ({
      key: `${cueIndex}-${tokenIndex}-${token}`,
      characters: [...token].map((character) => {
        const index = cueCharacterIndex;
        cueCharacterIndex += 1;
        return {
          character,
          revealAt: start + (((index + 1) / cueCharacters.length) * (end - start)),
        };
      }),
    }));
  });
  return (
    <span className={className} aria-label={text}>
      {tokens.map((token) => (
        <span
          aria-hidden="true"
          className="a2hs-kinetic-token"
          key={token.key}
        >
          {token.characters.map(({ character, revealAt }, index) => {
            const visible = reduceMotion || playbackTime >= revealAt;
            return (
              <motion.span
                className="a2hs-kinetic-char"
                key={`${character}-${index}-${revealAt}`}
                initial={false}
                animate={visible
                  ? { opacity: 1, y: 0, scale: 1 }
                  : { opacity: 0, y: '0.42em', scale: 0.96 }}
                transition={{
                  duration: reduceMotion ? 0.01 : 0.32,
                  ease: EASE,
                }}
              >
                {character === ' ' ? '\u00a0' : character}
              </motion.span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export default function AddToHomeGuide({ mode = 'modal', onClose }) {
  const [showIntro, setShowIntro] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [muted, setMuted] = useState(false);
  const [introNarrating, setIntroNarrating] = useState(false);
  const [introPlaybackTime, setIntroPlaybackTime] = useState(0);
  const [stepLocked, setStepLocked] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const closeButtonRef = useRef(null);
  const audioRef = useRef(null);
  const speechUtteranceRef = useRef(null);
  const mutedRef = useRef(false);
  const playbackRateRef = useRef(1);
  const playedFramesRef = useRef(new Set());
  const introAdvanceTimerRef = useRef(null);
  const stepAdvanceTimerRef = useRef(null);
  const skipNextPlaybackRef = useRef(false);
  const reduceMotion = useReducedMotion();
  const frame = FRAMES[frameIndex];
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const audioSupported = typeof window !== 'undefined' && 'Audio' in window;
  const narrationSupported = audioSupported || speechSupported;

  useEffect(() => {
    FRAMES.forEach(({ image }) => {
      const preload = new Image();
      preload.src = image;
    });
    if (audioSupported) {
      const audio = new window.Audio();
      audio.preload = 'auto';
      audioRef.current = audio;
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      audioRef.current = null;
    };
  }, [audioSupported]);

  const stopNarration = useCallback(() => {
    if (introAdvanceTimerRef.current) {
      window.clearTimeout(introAdvanceTimerRef.current);
      introAdvanceTimerRef.current = null;
    }
    if (stepAdvanceTimerRef.current) {
      window.clearTimeout(stepAdvanceTimerRef.current);
      stepAdvanceTimerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      try { audio.currentTime = 0; } catch {}
    }
    if (speechSupported) window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
  }, [speechSupported]);

  const startTutorial = useCallback(() => {
    stopNarration();
    setIntroNarrating(false);
    setStepLocked(narrationSupported);
    setDirection(1);
    setFrameIndex(0);
    setShowIntro(false);
  }, [narrationSupported, stopNarration]);

  const speakFallback = useCallback((text, onEnd) => {
    if (!speechSupported) {
      onEnd?.();
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /^zh(-|_)CN/i.test(voice.lang))
      || voices.find((voice) => /^zh/i.test(voice.lang))
      || null;
    utterance.lang = 'zh-CN';
    utterance.rate = 0.86 * playbackRateRef.current;
    utterance.pitch = 1;
    utterance.volume = mutedRef.current ? 0 : 1;
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      onEnd?.();
    };
    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [speechSupported]);

  const playNarration = useCallback((source, fallbackText, onEnd) => {
    stopNarration();
    const isIntro = source === INTRO_AUDIO;
    if (isIntro) setIntroPlaybackTime(0);
    const audio = audioRef.current;
    if (!audioSupported || !audio) {
      if (isIntro) setIntroPlaybackTime(INTRO_END_TIME);
      speakFallback(fallbackText, onEnd);
      return;
    }
    let fallbackStarted = false;
    const fallback = () => {
      if (fallbackStarted) return;
      fallbackStarted = true;
      audio.pause();
      if (isIntro) setIntroPlaybackTime(INTRO_END_TIME);
      speakFallback(fallbackText, onEnd);
    };
    audio.src = source;
    audio.muted = mutedRef.current;
    audio.playbackRate = playbackRateRef.current;
    audio.onended = onEnd || null;
    audio.onerror = fallback;
    audio.play().catch(fallback);
  }, [audioSupported, speakFallback, stopNarration]);

  useEffect(() => {
    if (!voiceEnabled || !showIntro || muted || !audioSupported) return undefined;
    let animationFrame;
    let visibleCharacters = -1;
    const followAudio = () => {
      const audio = audioRef.current;
      if (audio?.src.includes(INTRO_AUDIO)) {
        const currentTime = audio.currentTime;
        const nextVisibleCharacters = INTRO_REVEAL_TIMES.filter((time) => time <= currentTime).length;
        if (nextVisibleCharacters !== visibleCharacters) {
          visibleCharacters = nextVisibleCharacters;
          setIntroPlaybackTime(currentTime);
        }
      }
      animationFrame = window.requestAnimationFrame(followAudio);
    };
    animationFrame = window.requestAnimationFrame(followAudio);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [audioSupported, muted, showIntro, voiceEnabled]);

  const advanceAfterIntro = useCallback(() => {
    setIntroNarrating(false);
    introAdvanceTimerRef.current = window.setTimeout(startTutorial, 420);
  }, [startTutorial]);

  const advanceAfterFrame = useCallback(() => {
    playedFramesRef.current.add(frameIndex);
    stepAdvanceTimerRef.current = window.setTimeout(() => {
      stepAdvanceTimerRef.current = null;
      if (frameIndex >= FRAMES.length - 1) {
        setStepLocked(false);
        return;
      }
      setDirection(1);
      setFrameIndex((current) => Math.min(FRAMES.length - 1, current + 1));
    }, STEP_ACTION_DELAY);
  }, [frameIndex]);

  useEffect(() => {
    if (!voiceEnabled) return undefined;
    if (skipNextPlaybackRef.current) {
      skipNextPlaybackRef.current = false;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      const frameAlreadyPlayed = !showIntro && playedFramesRef.current.has(frameIndex);
      if (showIntro) setIntroNarrating(true);
      if (!showIntro) setStepLocked(!frameAlreadyPlayed);
      playNarration(
        showIntro ? INTRO_AUDIO : frame.audio,
        showIntro ? INTRO_SPEECH : frame.speech,
        showIntro ? advanceAfterIntro : frameAlreadyPlayed ? undefined : advanceAfterFrame,
      );
    }, 120);
    return () => {
      window.clearTimeout(timer);
      stopNarration();
    };
  }, [advanceAfterFrame, advanceAfterIntro, frame.audio, frame.speech, playNarration, showIntro, stopNarration, voiceEnabled]);

  useEffect(() => () => stopNarration(), [stopNarration]);

  useEffect(() => {
    if (mode !== 'modal') return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowRight' && !showIntro && !stepLocked) goTo(frameIndex + 1);
      if (event.key === 'ArrowRight' && showIntro && !narrationSupported) startTutorial();
      if (event.key === 'ArrowLeft' && !showIntro && !stepLocked) goBack();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  // goTo intentionally reads the current render's frame index for keyboard navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameIndex, mode, narrationSupported, onClose, showIntro, startTutorial, stepLocked]);

  const goTo = (nextIndex) => {
    const bounded = Math.max(0, Math.min(FRAMES.length - 1, nextIndex));
    if (bounded === frameIndex) return;
    if (stepLocked) return;
    stopNarration();
    setDirection(bounded > frameIndex ? 1 : -1);
    setFrameIndex(bounded);
  };

  const goBack = () => {
    if (stepLocked) return;
    if (frameIndex > 0) {
      goTo(frameIndex - 1);
    }
  };

  const closeForNow = () => {
    stopNarration();
    onClose?.();
  };

  const toggleVoice = () => {
    if (!narrationSupported) return;
    if (!voiceEnabled) {
      mutedRef.current = false;
      setMuted(false);
      if (showIntro) setIntroNarrating(true);
      skipNextPlaybackRef.current = true;
      setVoiceEnabled(true);
      playNarration(
        showIntro ? INTRO_AUDIO : frame.audio,
        showIntro ? INTRO_SPEECH : frame.speech,
        showIntro ? advanceAfterIntro : undefined,
      );
      return;
    }
    const nextMuted = !muted;
    mutedRef.current = nextMuted;
    const audio = audioRef.current;
    if (audio) audio.muted = nextMuted;
    if (speechUtteranceRef.current) speechUtteranceRef.current.volume = nextMuted ? 0 : 1;
    if (!nextMuted && audio && audio.src && audio.paused && !audio.ended) {
      audio.play().catch(() => audio.onerror?.());
    }
    setMuted(nextMuted);
  };

  const cyclePlaybackRate = () => {
    const currentIndex = PLAYBACK_RATES.indexOf(playbackRate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
    playbackRateRef.current = nextRate;
    setPlaybackRate(nextRate);
    if (audioRef.current) audioRef.current.playbackRate = nextRate;
  };

  const slideVariants = useMemo(() => ({
    enter: (dir) => ({ opacity: 0, x: reduceMotion ? 0 : dir * 22 }),
    center: { opacity: 1, x: 0 },
    exit: (dir) => ({ opacity: 0, x: reduceMotion ? 0 : dir * -18 }),
  }), [reduceMotion]);

  const shell = (
    <motion.section
      className={`a2hs-guide ${mode === 'page' ? 'a2hs-guide--page' : 'a2hs-guide--modal'}`}
      role={mode === 'modal' ? 'dialog' : 'main'}
      aria-modal={mode === 'modal' ? 'true' : undefined}
      aria-label="添加到主屏幕教程"
      initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.42, ease: EASE }}
      onClick={(event) => event.stopPropagation()}
    >
      <header className="a2hs-header">
        <div>
          <p className="a2hs-eyebrow">添加到主屏幕</p>
          <p className="a2hs-progress" aria-live="polite">{showIntro ? '开始前' : `步骤 ${frame.step} / 5`}</p>
        </div>
        <div className="a2hs-header-actions">
          {narrationSupported && (
            <button
              type="button"
              className="a2hs-speed"
              onClick={cyclePlaybackRate}
              aria-label={`播放速度，当前 ${formatPlaybackRate(playbackRate)}，点击切换`}
              title="点击切换播放速度"
            >
              {formatPlaybackRate(playbackRate)}
            </button>
          )}
          {!showIntro && (
            <button
              type="button"
              className={`a2hs-voice ${voiceEnabled && !muted ? 'is-on' : ''}`}
              onClick={toggleVoice}
              disabled={!narrationSupported}
              aria-label={!narrationSupported ? '语音不可用' : muted ? '取消静音' : '静音'}
              aria-pressed={muted}
              title={!narrationSupported ? '语音不可用' : muted ? '取消静音' : '静音'}
            >
              {muted ? <VolumeX size={20} strokeWidth={2.2} /> : <Volume2 size={20} strokeWidth={2.2} />}
            </button>
          )}
          <button ref={closeButtonRef} type="button" className="a2hs-close" onClick={closeForNow} aria-label="关闭教程">
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="a2hs-stage">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          {showIntro ? (
            <motion.div
              className="a2hs-intro"
              key="intro"
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduceMotion ? 0.01 : 0.4, ease: EASE }}
            >
              <AnimatePresence mode="wait" initial={false}>
                {!voiceEnabled ? (
                  <motion.p
                    key="voice-hint"
                    id="a2hs-voice-hint"
                    className="a2hs-voice-hint"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                    transition={{ duration: reduceMotion ? 0.01 : 0.22, ease: EASE }}
                  >
                    先开启语音，跟随讲解更轻松
                  </motion.p>
                ) : (
                  <motion.div
                    key="intro-message"
                    className="a2hs-intro-message"
                    initial={reduceMotion ? false : { opacity: 0, scale: 0.94, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ duration: reduceMotion ? 0.01 : 0.58, ease: EASE }}
                  >
                    <img className="a2hs-intro-icon" src="/apple-touch-icon.png" alt="物联宝典" />
                    <div className="a2hs-intro-copy">
                      <KineticCharacters
                        className="a2hs-intro-title a2hs-char-line"
                        cues={INTRO_TITLE_CUES}
                        playbackTime={introPlaybackTime}
                      />
                      <KineticCharacters
                        className="a2hs-intro-body a2hs-char-line"
                        cues={INTRO_BODY_CUES}
                        playbackTime={introPlaybackTime}
                      />
                    </div>
                    <p className="a2hs-ios-note">
                      <KineticCharacters
                        cues={INTRO_NOTE_CUES}
                        playbackTime={introPlaybackTime}
                      />
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div
              className="a2hs-slide"
              key={frameIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduceMotion ? 0.01 : 0.36, ease: EASE }}
              drag={reduceMotion ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.14}
              onDragEnd={(_, info) => {
                if (info.offset.x < -48) goTo(frameIndex + 1);
                if (info.offset.x > 48) goBack();
              }}
            >
              <div className="a2hs-copy" key={`copy-${frameIndex}`}>
                <KineticLine className="a2hs-title" parts={frame.title} />
                <KineticLine className="a2hs-body" parts={frame.body} />
              </div>
              <figure className="a2hs-figure">
                <div className="a2hs-image-wrap">
                  <motion.img
                    src={frame.image}
                    alt={frame.alt}
                    draggable="false"
                    className="a2hs-image"
                    style={{ transformOrigin: `${frame.focus.x}% ${frame.focus.y}%` }}
                    initial={{ scale: 1 }}
                    animate={{ scale: reduceMotion ? 1 : frame.focus.scale }}
                    transition={reduceMotion
                      ? { duration: 0.01 }
                      : {
                        delay: 0.52,
                        type: 'spring',
                        stiffness: 92,
                        damping: 20,
                        mass: 0.82,
                      }}
                  />
                </div>
                <figcaption className="a2hs-device-caption">测试机型：iPhone 17 Pro</figcaption>
              </figure>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="a2hs-controls">
        {showIntro ? (
          <button
            type="button"
            className={`a2hs-start ${narrationSupported && !voiceEnabled ? 'is-suggested' : ''}`}
            onClick={narrationSupported ? toggleVoice : startTutorial}
            disabled={narrationSupported && voiceEnabled}
            aria-describedby={narrationSupported ? (voiceEnabled ? 'a2hs-start-status' : 'a2hs-voice-hint') : undefined}
          >
            {!narrationSupported ? '开始教程' : !voiceEnabled ? '开启语音' : introNarrating ? '开场语音播报中…' : '即将开始…'}
          </button>
        ) : (
          <>
            <div className="a2hs-dots" aria-label={`教程画面 ${frameIndex + 1} / ${FRAMES.length}`}>
              {FRAMES.map((item, index) => (
                <button
                  type="button"
                  key={`${item.image}-${index}`}
                  className={index === frameIndex ? 'is-active' : ''}
                  onClick={() => goTo(index)}
                  disabled={stepLocked}
                  aria-label={`查看第 ${item.step} 步${item.step === 3 ? `画面 ${index === 2 ? 1 : index === 3 ? 2 : ''}` : ''}`}
                  aria-current={index === frameIndex ? 'step' : undefined}
                />
              ))}
            </div>
            <div className="a2hs-nav">
              <button type="button" className="a2hs-prev" onClick={goBack} disabled={stepLocked || frameIndex === 0}>上一步</button>
              {frameIndex < FRAMES.length - 1 ? (
                <button type="button" className="a2hs-next" onClick={() => goTo(frameIndex + 1)} disabled={stepLocked}>
                  {stepLocked ? '请跟随操作…' : '下一步'}
                </button>
              ) : (
                <button type="button" className="a2hs-next" onClick={closeForNow} disabled={stepLocked}>
                  {stepLocked ? '请跟随操作…' : '完成'}
                </button>
              )}
            </div>
          </>
        )}
        {showIntro && narrationSupported && (
          <p id="a2hs-start-status" className="a2hs-start-status" aria-live="polite">
            开场语音结束后将自动开始教程
          </p>
        )}
      </footer>
    </motion.section>
  );

  if (mode === 'page') return <div className="a2hs-page-shell">{shell}</div>;
  return <div className="a2hs-overlay" role="presentation" onClick={closeForNow}>{shell}</div>;
}
