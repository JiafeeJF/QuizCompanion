import mongoose from 'mongoose';

/**
 * ExamNotificationLog（考试邮件通知日志）
 * - type: exam_published 学生发布通知 / exam_summary 教师截止总结
 * - 学生通知：examId + studentId 唯一（同一场考试同一学生只发一次）
 * - 教师总结：examId + type 唯一（同一场考试只总结一次，重启不重发）
 * - 单发（每人一封），收件人互不可见；失败记 error/retryCount，有限重试
 */
const logSchema = new mongoose.Schema(
  {
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    type: { type: String, enum: ['exam_published', 'exam_summary', 'exam_deadline_remind'], required: true, index: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    error: { type: String, default: '' },
    retryCount: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

logSchema.index({ examId: 1, type: 1, studentId: 1 }, { unique: true, sparse: true });
logSchema.index({ status: 1, updatedAt: 1 });

export const ExamNotificationLog = mongoose.model('ExamNotificationLog', logSchema);
