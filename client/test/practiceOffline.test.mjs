import test from 'node:test';
import assert from 'node:assert/strict';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
  key(index) { return [...this.data.keys()][index] ?? null; }
  clear() { this.data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = new EventTarget();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });

const offline = await import('../src/practiceOffline.js');

test('objective questions are graded locally with server-compatible rules', () => {
  assert.equal(offline.gradeLocally({ type: 'single', answer: 2 }, '2').correct, true);
  assert.equal(offline.gradeLocally({ type: 'judge', answer: 0 }, 1).correct, false);
  assert.equal(offline.gradeLocally({ type: 'multiple', answer: [3, 1] }, [1, 3]).correct, true);
  assert.equal(offline.gradeLocally({ type: 'short', textAnswer: '参考' }, '作答').correct, null);
});

test('session questions and mutable progress are stored separately', () => {
  const questions = [{ _id: 'q1', stem: '题目', answer: 1 }];
  offline.writeOfflineSession('s1', { userId: 'u1', questions, session: { _id: 's1' }, currentIndex: 0, userAnswers: {} });
  const staticBefore = localStorage.getItem('wlbd_session_s1');
  offline.writeOfflineSession('s1', { userId: 'u1', questions, session: { _id: 's1', answeredCount: 1 }, currentIndex: 0, userAnswers: { q1: { answer: 1 } } });
  assert.equal(localStorage.getItem('wlbd_session_s1'), staticBefore);
  assert.equal(offline.readOfflineSession('s1').session.answeredCount, 1);
  assert.deepEqual(offline.listOfflineSessions('u1').map((item) => item._id), ['s1']);
  assert.deepEqual(offline.listOfflineSessions('u2'), []);
});

test('offline events remain queued and reconnect sync is user-scoped', async () => {
  const a = offline.createPracticeEvent({ userId: 'u1', sessionId: 's1', questionId: 'q1', answer: 1, currentIndex: 0 });
  const b = offline.createPracticeEvent({ userId: 'u2', sessionId: 's2', questionId: 'q2', answer: 0, currentIndex: 0 });
  offline.enqueuePracticeEvent(a);
  offline.enqueuePracticeEvent(b);
  navigator.onLine = false;
  await offline.flushPracticeQueue(async () => { throw new Error('must not run offline'); }, 'u1');
  assert.equal(offline.pendingPracticeCount('', 'u1'), 1);

  navigator.onLine = true;
  const calls = [];
  await offline.flushPracticeQueue(async (sessionId, payload) => {
    calls.push({ sessionId, payload });
    return { session: { _id: sessionId } };
  }, 'u1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 's1');
  assert.equal(offline.pendingPracticeCount('', 'u1'), 0);
  assert.equal(offline.pendingPracticeCount('', 'u2'), 1);
});
