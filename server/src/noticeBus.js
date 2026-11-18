/**
 * 实时事件总线（SSE 推送用，替代通知轮询）
 * - 发布考试/作业时 pushExamNotice() 把事件扇出到在线学生的 stream
 * - notices.js 的 /stream 订阅；进程内 Map，单实例够用（多实例部署再换 Redis pub/sub）
 */
const channels = new Map(); // studentId(String) -> Set<res>

export function subscribeStudent(studentId, res) {
  const key = String(studentId);
  if (!channels.has(key)) channels.set(key, new Set());
  channels.get(key).add(res);
}

export function unsubscribeStudent(studentId, res) {
  const key = String(studentId);
  const set = channels.get(key);
  if (!set) return;
  set.delete(res);
  if (!set.size) channels.delete(key);
}

export function onlineCount() {
  let n = 0;
  for (const set of channels.values()) n += set.size;
  return n;
}

/** 给某学生推一条 SSE 事件（写失败/背压直接丢弃，不阻塞发布流程） */
export function pushToStudent(studentId, event, data) {
  const set = channels.get(String(studentId));
  if (!set || !set.size) return 0;
  let n = 0;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...set]) {
    try {
      if (res.writableEnded || res.destroyed) { set.delete(res); continue; }
      res.write(payload);
      n++;
    } catch {
      try { set.delete(res); } catch {}
    }
  }
  if (!set.size) channels.delete(String(studentId));
  return n;
}
