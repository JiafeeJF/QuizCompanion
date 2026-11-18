const SESSION_PREFIX = 'wlbd_session_';
const PROGRESS_PREFIX = 'wlbd_progress_';
const QUEUE_KEY = 'wlbd_practice_sync_queue_v1';
let flushing = null;
let flushingUser = '';

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function readOfflineSession(id) {
  const base = readJson(`${SESSION_PREFIX}${id}`, null);
  const progress = readJson(`${PROGRESS_PREFIX}${id}`, null);
  if (!base && !progress) return null;
  return { ...(base || {}), ...(progress || {}), questions: base?.questions || progress?.questions || [] };
}

export function writeOfflineSession(id, snapshot) {
  const cachedAt = new Date().toISOString();
  const existing = readJson(`${SESSION_PREFIX}${id}`, null);
  const questions = Array.isArray(snapshot.questions) ? snapshot.questions : [];
  // 题目正文体积最大且答题期间不变，只在首次缓存或题目集合变化时写入。
  if (questions.length && (!existing || existing.userId !== snapshot.userId || existing.questions?.length !== questions.length)) {
    writeJson(`${SESSION_PREFIX}${id}`, { userId: snapshot.userId, questions, cachedAt });
  }
  const { questions: ignored, ...progress } = snapshot;
  writeJson(`${PROGRESS_PREFIX}${id}`, { ...progress, cachedAt });
}

export function removeOfflineSession(id) {
  try {
    localStorage.removeItem(`${SESSION_PREFIX}${id}`);
    localStorage.removeItem(`${PROGRESS_PREFIX}${id}`);
  } catch {}
}

export function listOfflineSessions(userId = '') {
  const rows = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(SESSION_PREFIX)) continue;
      const id = key.slice(SESSION_PREFIX.length);
      const value = readOfflineSession(id);
      if (value?.session && String(value.userId || '') === String(userId || '') && Array.isArray(value.questions) && value.questions.length) rows.push(value.session);
    }
  } catch {}
  return rows.sort((a, b) => new Date(b.localUpdatedAt || b.updatedAt || 0) - new Date(a.localUpdatedAt || a.updatedAt || 0));
}

export function createPracticeEvent({ userId, sessionId, questionId, answer, mode, currentIndex, answeredAt }) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { eventId: random, userId: String(userId || ''), sessionId, questionId, answer, mode, currentIndex, answeredAt: answeredAt || new Date().toISOString() };
}

export function enqueuePracticeEvent(event) {
  let queue = readJson(QUEUE_KEY, []);
  // 纯位置更新只保留每个会话最新一条，答案事件则全部保留并按序补传。
  if (!event.questionId) queue = queue.filter((item) => item.sessionId !== event.sessionId || item.questionId);
  if (!queue.some((item) => item.eventId === event.eventId)) queue.push(event);
  writeJson(QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent('wlbd:practice-sync-state', { detail: { pending: queue.length } }));
}

export function pendingPracticeCount(sessionId = '', userId = '') {
  const queue = readJson(QUEUE_KEY, []);
  return queue.filter((item) => (!sessionId || item.sessionId === sessionId) && (!userId || item.userId === String(userId))).length;
}

export function removePracticeQueue(sessionId) {
  const queue = readJson(QUEUE_KEY, []).filter((item) => item.sessionId !== sessionId);
  writeJson(QUEUE_KEY, queue);
  window.dispatchEvent(new CustomEvent('wlbd:practice-sync-state', { detail: { pending: queue.length } }));
}

export async function flushPracticeQueue(syncFn, userId = '') {
  if (flushing) {
    if (flushingUser === String(userId || '')) return flushing;
    await flushing;
  }
  flushingUser = String(userId || '');
  flushing = (async () => {
    let queue = readJson(QUEUE_KEY, []);
    let eligible = queue.filter((item) => !userId || item.userId === String(userId));
    while (eligible.length && navigator.onLine !== false) {
      const sessionId = eligible[0].sessionId;
      const batch = eligible.filter((item) => item.sessionId === sessionId).slice(0, 50);
      try {
        const result = await syncFn(sessionId, {
          events: batch.map(({ sessionId: ignoredSession, userId: ignoredUser, ...item }) => item),
          currentIndex: batch[batch.length - 1].currentIndex,
          progressAt: batch[batch.length - 1].answeredAt,
        });
        const sent = new Set(batch.map((item) => item.eventId));
        queue = readJson(QUEUE_KEY, []).filter((item) => !sent.has(item.eventId));
        writeJson(QUEUE_KEY, queue);
        eligible = queue.filter((item) => !userId || item.userId === String(userId));
        window.dispatchEvent(new CustomEvent('wlbd:practice-synced', { detail: { sessionId, result } }));
      } catch {
        break;
      }
    }
    window.dispatchEvent(new CustomEvent('wlbd:practice-sync-state', { detail: { pending: queue.length } }));
    return eligible.length;
  })().finally(() => { flushing = null; flushingUser = ''; });
  return flushing;
}

export function startPracticeSync(syncFn, userId) {
  const run = () => flushPracticeQueue(syncFn, userId);
  window.addEventListener('online', run);
  const timer = setInterval(run, 15_000);
  run();
  return () => { window.removeEventListener('online', run); clearInterval(timer); };
}

export function gradeLocally(question, answer) {
  const autoGraded = ['single', 'multiple', 'judge'].includes(question?.type);
  let correct = null;
  if (question?.type === 'single' || question?.type === 'judge') {
    const value = Number(answer);
    correct = Number.isFinite(value) && value === Number(question.answer);
  } else if (question?.type === 'multiple') {
    const selected = (Array.isArray(answer) ? answer : []).map(Number).sort((a, b) => a - b);
    const expected = (Array.isArray(question.answer) ? question.answer : []).map(Number).sort((a, b) => a - b);
    correct = selected.length === expected.length && selected.every((value, index) => value === expected[index]);
  }
  return { correct, autoGraded, answer: autoGraded ? question.answer ?? null : null, textAnswer: question?.textAnswer || '' };
}
