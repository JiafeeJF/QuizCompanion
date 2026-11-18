import { Server as SocketIOServer } from 'socket.io';

let io = null;

export function initRealtime(httpServer, allowedOrigins) {
  io = new SocketIOServer(httpServer, {
    cors: { origin: [...allowedOrigins], credentials: true },
  });
  return io;
}

export function realtime() {
  if (!io) throw new Error('实时服务尚未初始化');
  return io;
}

export function emitVersionNew(version) {
  if (!io || !version) return;
  io.to('role:student').emit('version:new', {
    version: version.version,
    notes: version.notes || '',
    size: version.size || 0,
    downloadPath: `/downloads/${version.fileName}`,
    forceUpdate: !!version.forceUpdate,
    updatedAt: version.updatedAt,
  });
}

export function emitAnnouncementNew(a) {
  if (!io || !a?._id) return 0;
  const room = io.to('role:student');
  room.emit('announcement:new', {
    announcementId: String(a._id),
    title: a.title || '',
    priority: a.priority || 0,
    createdAt: a.createdAt || null,
  });
  return 1;
}

export function emitAnnouncementUpdated(a, action = 'updated') {
  if (!io || !a?._id) return;
  io.to('role:student').emit(`announcement:${action}`, {
    announcementId: String(a._id),
    title: a.title || '',
    priority: a.priority || 0,
    status: a.status || '',
    updatedAt: a.updatedAt || new Date().toISOString(),
  });
}

export function emitExamPublished(exam) {
  if (!io || !exam?.classId) return;
  io.to(`class:${exam.classId}`).emit('exam:published', {
    examId: String(exam._id),
    title: exam.title,
    scope: exam.scope,
    deadlineAt: exam.deadlineAt || null,
    classId: String(exam.classId),
  });
}

export function emitExamChanged(exam, action) {
  if (!io || !exam?._id || !action) return;
  const payload = {
    examId: String(exam._id),
    title: exam.title || '',
    scope: exam.scope || '',
    status: exam.status || '',
    classId: exam.classId ? String(exam.classId) : null,
    updatedAt: exam.updatedAt || new Date().toISOString(),
  };
  if (exam.classId) io.to(`class:${exam.classId}`).emit(`exam:${action}`, payload);
  else io.to('role:student').emit(`exam:${action}`, payload);
}

export function emitUserEvent(userId, event, payload = {}) {
  if (!io || !userId || !event) return;
  io.to(`user:${userId}`).emit(event, { ...payload, updatedAt: new Date().toISOString() });
}

export function emitMaintenanceChanged(state) {
  if (!io || !state) return;
  const payload = {
    enabled: !!state.enabled,
    message: state.message || '系统维护中，请稍后再试',
    restoreAt: state.restoreAt || '',
    updatedAt: new Date().toISOString(),
  };
  const event = payload.enabled ? 'maintenance:on' : 'maintenance:off';
  io.to('role:student').emit(event, payload);
  // 兼容已连接的旧客户端，避免切换期间出现状态分叉。
  io.to('role:student').emit('maintenance:changed', payload);
}
