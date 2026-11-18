import mongoose from 'mongoose';

/**
 * ExamNotice（站内通知：新考试/作业发布提醒，仿 CoupleOrder 新订单提醒）
 * - 发布考试/作业时按班级学生逐人落库（examId+studentId 唯一，重复发布不重推）
 * - APP/网页轮询拉取：未读数打红点 + 考试列表 NEW + 首页弹窗一次
 * - 读后即已读：打开试卷详情页 / 点弹窗"去看看" / 全部已读，三路都会清
 */
const noticeSchema = new mongoose.Schema(
  {
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['exam', 'homework'], default: 'exam', index: true },
    title: { type: String, default: '' },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

noticeSchema.index({ examId: 1, studentId: 1 }, { unique: true });
noticeSchema.index({ studentId: 1, read: 1, createdAt: -1 });
// 过期自动清理：已读 30 天后删除，未读保留（TTL 索引导出）
noticeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const ExamNotice = mongoose.model('ExamNotice', noticeSchema);
