import { ClassModel } from './models/Class.js';
import { Exam, ExamAttempt } from './models/Exam.js';
import { ExamNotificationLog } from './models/ExamNotificationLog.js';
import { ExamNotice } from './models/ExamNotice.js';
import { pushToStudent } from './noticeBus.js';
import { User } from './models/User.js';
import { sendMail } from './email.js';
import { buildExamPublishedMail, buildExamSummaryMail, buildExamDeadlineRemindMail } from './examMailTemplates.js';

const MAX_RETRY = 3;
const BASE_URL = (process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',')[0].trim();
// 跳板域名：邮件考试链接统一用它（如 https://jump.wakaibg5.top/exam/<id>）。
// 跳板页三段式处理：已装 APP → intent/scheme 唤起 APP，未装 → 自动进网页版，
// 不依赖 App Links 域名验证，邮箱内置浏览器也能用。
const JUMP_BASE = (process.env.JUMP_BASE || 'https://jump.wakaibg5.top').replace(/\/+$/, '');

/** 考试邮件开关：未配置 SMTP 时 sendMail 本就是 mock 打印，不阻塞业务 */
export function mailEnabled() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

function validEmailAddr(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * 发布通知（后台批量）：只查当前 classId 的在籍学生，逐人单发，失败记日志不抛错。
 * 防重：先 upsert pending 占位（examId+studentId 唯一），抢到占位才发；重复发布直接跳过。
 * 同步落站内通知（ExamNotice，同样 examId+studentId 幂等）：APP/网页轮询拉取，仿新订单提醒。
 */
export async function enqueuePublishedNotifications(examId) {
  const exam = await Exam.findById(examId).lean();
  if (!exam || exam.kind !== 'teacher' || !exam.classId) return { queued: 0 };
  const students = await User.find({ classId: exam.classId, role: 'student', status: 'active' })
    .select('_id email name')
    .lean();
  if (!students.length) {
    await Exam.updateOne({ _id: examId }, { $set: { notificationStatus: 'sent', notificationSentAt: new Date() } });
    return { queued: 0 };
  }
  // 站内通知先行（不依赖邮件成败）：逐人 upsert，重复发布天然幂等
  // bulkWrite 的 upserted 可分辨"本次新增"——只给新增的学生实时推送，避免重复发布时全员再弹
  const noticeKind = exam.scope === 'homework' ? 'homework' : 'exam';
  try {
    const bw = await ExamNotice.bulkWrite(
      students.map((st) => ({
        updateOne: {
          filter: { examId, studentId: st._id },
          update: { $setOnInsert: { kind: noticeKind, title: exam.title || '', read: false } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    const freshIds = new Set(Object.values(bw.upsertedIds || {}).map(String));
    if (freshIds.size) {
      const fresh = await ExamNotice.find({ _id: { $in: [...freshIds] } })
        .select('_id examId studentId kind title createdAt')
        .lean();
      for (const n of fresh) {
        pushToStudent(n.studentId, 'notice', {
          noticeId: n._id,
          examId: n.examId,
          kind: n.kind,
          title: n.title,
          createdAt: n.createdAt,
        });
      }
    }
  } catch (e) {
    if (e?.code !== 11000) console.error('[exam-notice] 站内落库失败:', e.message);
  }
  let queued = 0;
  for (const st of students) {
    try {
      const r = await ExamNotificationLog.updateOne(
        { examId, type: 'exam_published', studentId: st._id },
        { $setOnInsert: { email: st.email || '', status: 'pending', retryCount: 0 } },
        { upsert: true }
      );
      if (r.upsertedCount > 0) queued++;
    } catch (e) {
      if (e?.code !== 11000) console.error('[exam-mail] 占位失败:', e.message);
    }
  }
  // 后台发送：不 await 调用方（fire-and-forget），教师接口立即返回
  setImmediate(() => flushPublishedQueue(examId).catch((e) => console.error('[exam-mail]', e.message)));
  return { queued };
}

async function flushPublishedQueue(examId) {
  const exam = await Exam.findById(examId).lean();
  if (!exam) return;
  const [cls, teacher] = await Promise.all([
    ClassModel.findById(exam.classId).select('name').lean(),
    User.findById(exam.createdBy).select('name email').lean(),
  ]);
  const totalScore = (exam.items || []).reduce((s, it) => s + (it.score || 2), 0);
  const pendings = await ExamNotificationLog.find({ examId, type: 'exam_published', status: 'pending' }).lean();
  for (const log of pendings) {
    const st = await User.findById(log.studentId).select('email name classId status role').lean();
    // 发送前复核：仍在该班 + 在籍 + 邮箱有效，否则标记跳过（不重试）
    if (!st || st.role !== 'student' || st.status !== 'active' || String(st.classId) !== String(exam.classId) || !validEmailAddr(st.email)) {
      await ExamNotificationLog.updateOne({ _id: log._id }, { $set: { status: 'failed', error: '学生已不在该班/账号无效/邮箱无效，跳过' } });
      continue;
    }
    // 考试链接走跳板域：已装 APP 唤起 APP，未装自动进网页版（见 jump.html）
    const examUrl = `${JUMP_BASE}/exam/${exam._id}`;
    const { subject, text, html } = buildExamPublishedMail({
      examTitle: exam.title,
      teacherName: teacher?.name || '任课教师',
      className: cls?.name || '班级',
      desc: exam.desc || '',
      durationMin: exam.durationMin,
      totalCount: exam.items?.length || 0,
      totalScore,
      deadlineAt: exam.deadlineAt,
      examUrl,
    });
    const r = await sendMail({ to: st.email, subject, text, html });
    if (r?.failed) {
      const retryCount = (log.retryCount || 0) + 1;
      await ExamNotificationLog.updateOne(
        { _id: log._id },
        { $set: { retryCount, status: retryCount >= MAX_RETRY ? 'failed' : 'pending', error: 'SMTP 发送失败' } }
      );
    } else {
      await ExamNotificationLog.updateOne({ _id: log._id }, { $set: { status: 'sent', sentAt: new Date(), email: st.email } });
    }
  }
  await refreshNotificationStatus(examId);
}

/** 通知聚合状态回写 Exam（教师详情页展示用） */
export async function refreshNotificationStatus(examId) {
  const [sent, failed, pending] = await Promise.all([
    ExamNotificationLog.countDocuments({ examId, type: 'exam_published', status: 'sent' }),
    ExamNotificationLog.countDocuments({ examId, type: 'exam_published', status: 'failed' }),
    ExamNotificationLog.countDocuments({ examId, type: 'exam_published', status: 'pending' }),
  ]);
  const total = sent + failed + pending;
  const status = total === 0 ? 'none' : pending > 0 ? 'sending' : failed > 0 ? (sent > 0 ? 'partial' : 'failed') : 'sent';
  const update = { notificationStatus: status, notificationStats: { total, sent, failed, pending } };
  if (status === 'sent' || status === 'partial') update.notificationSentAt = new Date();
  await Exam.updateOne({ _id: examId }, { $set: update });
  return update;
}

/** 截止总结数据：基于 Exam/Attempt/Class/User 真实数据（不看邮件日志） */
export async function buildSummaryData(examId) {
  const exam = await Exam.findById(examId).lean();
  if (!exam) return null;
  const [cls, teacher, students] = await Promise.all([
    ClassModel.findById(exam.classId).select('name').lean(),
    User.findById(exam.createdBy).select('name email').lean(),
    User.find({ classId: exam.classId, role: 'student', status: 'active' }).select('_id name').lean(),
  ]);
  const attempts = await ExamAttempt.find({ examId }).lean();
  const byUser = new Map();
  for (const a of attempts) {
    const uid = String(a.userId);
    const cur = byUser.get(uid);
    // 取最好一次 submitted；无 submitted 则保留 doing
    if (!cur) byUser.set(uid, a);
    else if (a.status === 'submitted' && (cur.status !== 'submitted' || (a.score || 0) > (cur.score || 0))) byUser.set(uid, a);
  }
  let submitted = 0, doing = 0;
  const scores = [];
  let accSum = 0, accN = 0;
  for (const st of students) {
    const a = byUser.get(String(st._id));
    if (a?.status === 'submitted') {
      submitted++;
      scores.push(a.score || 0);
      accSum += a.accuracy || 0;
      accN++;
    } else if (a?.status === 'doing') doing++;
  }
  const totalStudents = students.length;
  const absent = Math.max(0, totalStudents - submitted - doing);
  const totalScore = (exam.items || []).reduce((s, it) => s + (it.score || 2), 0);
  const avg = scores.length ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;
  const passLine = Math.ceil(totalScore * 0.6);
  const passCount = scores.filter((v) => v >= passLine).length;
  const ranked = [...byUser.entries()]
    .map(([uid, a]) => {
      const st = students.find((s) => String(s._id) === uid);
      return { name: st?.name || '未知', score: a.score || 0, accuracy: a.accuracy || 0, submitted: a.status === 'submitted', submittedAt: a.submittedAt };
    })
    .sort((x, y) => y.score - x.score || new Date(x.submittedAt || 0) - new Date(y.submittedAt || 0));
  let prev = null, prevRank = 0;
  ranked.forEach((r, i) => {
    if (prev && r.score === prev.score) r.rank = prevRank;
    else { r.rank = i + 1; prev = r; prevRank = r.rank; }
  });
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    exam, cls, teacher, students, totalStudents, submitted, doing, absent,
    submitRate: totalStudents ? `${r1((submitted / totalStudents) * 100)}%` : '—',
    totalScore, avg: r1(avg), max: scores.length ? Math.max(...scores) : 0, min: scores.length ? Math.min(...scores) : 0,
    avgAccuracy: accN ? `${r1(accSum / accN)}%` : '—',
    passLine, passCount, passRate: scores.length ? `${r1((passCount / scores.length) * 100)}%` : '—',
    ranking: ranked,
  };
}

/**
 * 截止总结发送（幂等）：examId+type 占位抢锁，抢到才发；发完记 sent。
 * 收件人以库里 exam.createdBy 为准，不信任任何传入参数。
 */
export async function sendSummaryOnce(examId, reason = 'deadline') {
  const exam = await Exam.findById(examId).lean();
  if (!exam || exam.kind !== 'teacher') return { skipped: true };
  const teacher = await User.findById(exam.createdBy).select('name email status').lean();
  if (!teacher || !validEmailAddr(teacher.email)) {
    console.error('[exam-mail] 总结跳过：教师邮箱无效', String(examId));
    return { skipped: true };
  }
  let mine = false;
  try {
    const r = await ExamNotificationLog.updateOne(
      { examId, type: 'exam_summary', studentId: null },
      { $setOnInsert: { email: teacher.email, status: 'pending', retryCount: 0 } },
      { upsert: true }
    );
    mine = r.upsertedCount > 0;
  } catch (e) {
    if (e?.code === 11000) mine = false;
    else throw e;
  }
  // 已有 sent 记录 → 绝不重发（重启补发靠这道闸）
  const done = await ExamNotificationLog.findOne({ examId, type: 'exam_summary', status: 'sent' }).lean();
  if (done) {
    await Exam.updateOne({ _id: examId }, { $set: { summaryStatus: 'sent', summarySentAt: done.sentAt || new Date() } });
    return { skipped: true };
  }
  if (!mine) return { skipped: true };
  const d = await buildSummaryData(examId);
  if (!d) return { skipped: true };
  const { subject, text, html } = buildExamSummaryMail({
    examTitle: exam.title,
    className: d.cls?.name || '班级',
    teacherName: teacher.name || '教师',
    publishedAt: exam.createdAt,
    deadlineAt: exam.deadlineAt,
    durationMin: exam.durationMin,
    totalCount: exam.items?.length || 0,
    totalScore: d.totalScore,
    totalStudents: d.totalStudents,
    submitted: d.submitted,
    doing: d.doing,
    absent: d.absent,
    submitRate: d.submitRate,
    avg: d.avg, max: d.max, min: d.min,
    avgAccuracy: d.avgAccuracy,
    passCount: d.passCount, passRate: d.passRate, passLine: d.passLine,
    ranking: d.ranking,
  });
  const r = await sendMail({ to: teacher.email, subject, text, html });
  if (r?.failed) {
    await ExamNotificationLog.updateOne({ examId, type: 'exam_summary', studentId: null }, { $set: { status: 'failed', error: 'SMTP 发送失败', retryCount: 1 } });
    await Exam.updateOne({ _id: examId }, { $set: { summaryStatus: 'failed' } });
    return { failed: true };
  }
  await ExamNotificationLog.updateOne({ examId, type: 'exam_summary', studentId: null }, { $set: { status: 'sent', sentAt: new Date() } });
  await Exam.updateOne({ _id: examId }, { $set: { summaryStatus: 'sent', summarySentAt: new Date() } });
  console.log(`[exam-mail] 截止总结已发送 (${reason}) ->`, teacher.email);
  return { sent: true };
}

export async function enqueueDeadlineReminders(examId) {
  const { ExamAttempt } = await import('./models/Exam.js');
  const exam = await Exam.findById(examId).lean();
  if (!exam || exam.kind !== 'teacher' || !exam.deadlineAt) return { reminded: 0 };
  if (new Date(exam.deadlineAt).getTime() - Date.now() > 2.5 * 3600 * 1000) return { reminded: 0 };
  const students = await User.find({ classId: exam.classId, role: 'student', status: 'active' }).select('_id email name').lean();
  const done = await ExamAttempt.find({ examId, status: 'submitted' }).select('userId').lean();
  const doneSet = new Set(done.map((a) => String(a.userId)));
  let reminded = 0;
  for (const st of students) {
    if (doneSet.has(String(st._id))) continue;
    if (!validEmailAddr(st.email)) continue;
    try {
      const r = await ExamNotificationLog.updateOne({ examId, type: 'exam_deadline_remind', studentId: st._id }, { $setOnInsert: { email: st.email, status: 'pending', retryCount: 0 } }, { upsert: true });
      if (!r.upsertedCount) continue;
      const { subject, text, html } = buildExamDeadlineRemindMail({ examTitle: exam.title, deadlineAt: exam.deadlineAt, examUrl: JUMP_BASE + '/exam/' + exam._id });
      const res = await sendMail({ to: st.email, subject, text, html });
      await ExamNotificationLog.updateOne({ examId, type: 'exam_deadline_remind', studentId: st._id }, { $set: res?.failed ? { status: 'failed', error: 'SMTP失败' } : { status: 'sent', sentAt: new Date() } });
      if (!res?.failed) reminded++;
    } catch (e) { console.error('[exam-remind]', e.message); }
  }
  return { reminded };
}
