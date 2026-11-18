import { Router } from 'express';
import { ClassModel } from '../models/Class.js';
import { User } from '../models/User.js';
import { Exam, ExamAttempt } from '../models/Exam.js';
import { PracticeRecord, WrongBook } from '../models/Practice.js';
import { authRequired, publicUser, requireRole } from '../auth.js';
import { genCode } from '../utils.js';
import { sensitiveWriteLimit, auditLog } from '../security.js';
import { isObjectId, safeKeyword } from '../validate.js';
import { emitUserEvent } from '../realtime.js';

const router = Router();
// 班级写操作分组限流（创建/加入/解散防刷；查询不限）
router.use(sensitiveWriteLimit);

/** 教师：创建班级 POST /api/classes { name, desc } */
router.post('/', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const { name, desc = '' } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写班级名称' });
    let code = genCode();
    while (await ClassModel.findOne({ code })) code = genCode();
    const cls = await ClassModel.create({
      name: String(name).trim().slice(0, 40),
      desc: String(desc || '').slice(0, 200),
      code,
      teacherId: req.user._id,
    });
    req.user.classId = cls._id;
    await req.user.save();
    emitUserEvent(req.user._id, 'class:joined', { classId: String(cls._id), name: cls.name });
    res.json({ class: cls });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '创建班级失败' });
  }
});

/** 教师/管理员：我的班级列表 */
router.get('/mine', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { teacherId: req.user._id };
    const classes = await ClassModel.find(filter).sort({ createdAt: -1 }).lean();
    const withCount = await Promise.all(
      classes.map(async (c) => ({
        ...c,
        studentCount: await User.countDocuments({ classId: c._id, role: 'student' }),
      }))
    );
    res.json({ classes: withCount });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** 学员：输入班级码加入 POST /api/classes/join { code }（班级码 6 位白名单格式） */
router.post('/join', authRequired, async (req, res) => {
  try {
    const code = safeKeyword(req.body?.code, 10).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) return res.status(404).json({ error: '班级码无效' });
    const cls = await ClassModel.findOne({ code, enabled: true });
    if (!cls) return res.status(404).json({ error: '班级码无效' });
    req.user.classId = cls._id;
    await req.user.save();
    emitUserEvent(req.user._id, 'class:joined', { classId: String(cls._id), name: cls.name });
    auditLog({ action: 'class.join', operatorId: req.user._id, targetId: cls._id, ip: req.ip });
    res.json({ class: cls, user: publicUser(req.user) });
  } catch (e) {
    res.status(500).json({ error: '加入失败' });
  }
});

/** 学员：退出班级 */
router.post('/leave', authRequired, async (req, res) => {
  try {
    req.user.classId = null;
    await req.user.save();
    emitUserEvent(req.user._id, 'class:removed', { classId: null });
    res.json({ user: publicUser(req.user) });
  } catch (e) {
    res.status(500).json({ error: '操作失败' });
  }
});

/** GET /api/classes/:id 班级详情（含学员数） */
router.get('/:id', authRequired, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id).populate('teacherId', 'name email').lean();
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    const studentCount = await User.countDocuments({ classId: cls._id, role: 'student' });
    res.json({ class: { ...cls, studentCount } });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** PUT /api/classes/:id 教师改班级信息 */
router.put('/:id', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const { name, desc, enabled } = req.body || {};
    if (name !== undefined) cls.name = String(name).trim().slice(0, 40) || cls.name;
    if (desc !== undefined) cls.desc = String(desc).slice(0, 200);
    if (enabled !== undefined) cls.enabled = !!enabled;
    await cls.save();
    res.json({ class: cls });
  } catch (e) {
    res.status(500).json({ error: '保存失败' });
  }
});

/** DELETE /api/classes/:id 解散班级（仅创建教师本人/Admin；所有学生+教师本人自动退出，考试数据保留可查） */
router.delete('/:id', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
      return res.status(403).json({ error: '只能解散自己创建的班级' });
    }
    const r = await User.updateMany({ classId: cls._id }, { $set: { classId: null } });
    await cls.deleteOne();
    auditLog({ action: 'class.dismiss', operatorId: req.user._id, targetId: cls._id, ip: req.ip, detail: `removed=${r.modifiedCount || 0}` });
    res.json({ ok: true, removedStudents: r.modifiedCount || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '解散班级失败' });
  }
});

/**
 * GET /api/classes/:id/students 学员数据（教师看自己班级）
 * ?sort=accuracy|done|wrong&order=desc|asc
 */
router.get('/:id/students', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const students = await User.find({ classId: cls._id, role: 'student' })
      .select('name email createdAt isMember memberExpireAt')
      .sort({ createdAt: 1 })
      .lean();
    const ids = students.map((s) => s._id);
    const [accRows, doneRows, wrongRows, examRows] = await Promise.all([
      PracticeRecord.aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: '$userId', total: { $sum: 1 }, correct: { $sum: { $cond: [{ $eq: ['$result', 'correct'] }, 1, 0] } } } },
      ]),
      PracticeRecord.aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: { userId: '$userId', q: '$questionId' } } },
        { $group: { _id: '$_id.userId', done: { $sum: 1 } } },
      ]),
      WrongBook.aggregate([
        { $match: { userId: { $in: ids }, mastered: false } },
        { $group: { _id: '$userId', wrong: { $sum: 1 } } },
      ]),
      ExamAttempt.aggregate([
        { $match: { userId: { $in: ids }, status: 'submitted' } },
        { $group: { _id: '$userId', exams: { $sum: 1 }, avgScore: { $avg: '$score' } } },
      ]),
    ]);
    const acc = new Map(accRows.map((r) => [String(r._id), r]));
    const done = new Map(doneRows.map((r) => [String(r._id), r.done]));
    const wrong = new Map(wrongRows.map((r) => [String(r._id), r.wrong]));
    const exam = new Map(examRows.map((r) => [String(r._id), r]));
    let list = students.map((s) => {
      const a = acc.get(String(s._id));
      const total = a?.total || 0;
      const correct = a?.correct || 0;
      return {
        ...s,
        answerCount: total,
        accuracy: total ? Math.round((correct / total) * 100) : 0,
        doneQuestions: done.get(String(s._id)) || 0,
        wrongCount: wrong.get(String(s._id)) || 0,
        examCount: exam.get(String(s._id))?.exams || 0,
        avgScore: Math.round((exam.get(String(s._id))?.avgScore || 0) * 10) / 10,
      };
    });
    const { sort = 'accuracy', order = 'desc' } = req.query;
    const key = ['accuracy', 'doneQuestions', 'wrongCount', 'examCount'].includes(sort) ? sort : 'accuracy';
    const dir = order === 'asc' ? 1 : -1;
    list.sort((a, b) => (a[key] - b[key]) * dir);
    res.json({ students: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/classes/:id/overview 班级数据概览 */
router.get('/:id/overview', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id);
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const students = await User.find({ classId: cls._id, role: 'student' }).select('_id').lean();
    const ids = students.map((s) => s._id);
    const exams = await Exam.find({ kind: 'teacher', classId: cls._id }).select('_id title status').lean();
    const [accAgg, attempts] = await Promise.all([
      PracticeRecord.aggregate([
        { $match: { userId: { $in: ids } } },
        { $group: { _id: null, total: { $sum: 1 }, correct: { $sum: { $cond: [{ $eq: ['$result', 'correct'] }, 1, 0] } } } },
      ]),
      ExamAttempt.find({ examId: { $in: exams.map((e) => e._id) }, status: 'submitted' }).lean(),
    ]);
    const total = accAgg[0]?.total || 0;
    const correct = accAgg[0]?.correct || 0;
    const submittedBy = new Set(attempts.map((a) => String(a.userId)));
    const avgScore =
      attempts.length ? Math.round((attempts.reduce((s, a) => s + a.score, 0) / attempts.length) * 10) / 10 : 0;
    res.json({
      overview: {
        studentCount: students.length,
        examCount: exams.length,
        participatedCount: submittedBy.size,
        participateRate: students.length ? Math.round((submittedBy.size / students.length) * 100) : 0,
        avgScore,
        accuracy: total ? Math.round((correct / total) * 100) : 0,
        answerCount: total,
      },
      exams,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取失败' });
  }
});

/** 教师：本班考试列表 GET /api/classes/:id/exams（越权收敛：教师只能看自己班） */
router.get('/:id/exams', authRequired, requireRole('teacher', 'admin'), async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ error: '班级不存在' });
    const cls = await ClassModel.findById(req.params.id).select('_id teacherId').lean();
    if (!cls) return res.status(404).json({ error: '班级不存在' });
    if (req.user.role === 'teacher' && String(cls.teacherId) !== String(req.user._id)) {
      return res.status(403).json({ error: '权限不足' });
    }
    const exams = await Exam.find({ kind: 'teacher', classId: req.params.id }).sort({ createdAt: -1 }).lean();
    const withStats = await Promise.all(
      exams.map(async (e) => ({
        ...e,
        items: undefined,
        submittedCount: await ExamAttempt.countDocuments({ examId: e._id, status: 'submitted' }),
      }))
    );
    res.json({ exams: withStats });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

export default router;
