import mongoose from 'mongoose';

/**
 * Exam（试卷）
 * - kind: system 系统固定卷 / teacher 教师布置（含作业） / custom 会员自定义卷
 * - scope: exam 考试（计分+排名） / homework 作业（只统计完成度）
 * - selectMode: random 随机抽取 / chapter 按章节抽取
 * - items: 抽题时落盘的题 snapshot（含正确答案，保证考试期间题库变更不影响）
 * - shareToken: 分享码，用于链接/二维码免登录入口页识别（仍需登录后作答）
 */
const examItemSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    type: { type: String, required: true },
    stem: { type: String, required: true },
    options: { type: [String], default: [] },
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
    textAnswer: { type: String, default: '' },
    analysis: { type: String, default: '' },
    score: { type: Number, default: 2 },
  },
  { _id: false }
);

const examSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    desc: { type: String, default: '' },
    kind: { type: String, enum: ['system', 'teacher', 'custom'], required: true, index: true },
    scope: { type: String, enum: ['exam', 'homework'], default: 'exam' },
    status: { type: String, enum: ['draft', 'published', 'ended'], default: 'published', index: true },
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // 抽题规则
    selectMode: { type: String, enum: ['random', 'chapter', 'sequence', 'fixed'], default: 'random' },
    // 顺序抽题范围（仅 selectMode=sequence 时有效）：全库 enabled 按 canonical 顺序的 1-based 闭区间
    sequenceRange: {
      type: new mongoose.Schema({ start: { type: Number }, end: { type: Number } }, { _id: false }),
      default: undefined,
    },
    chapterRules: {
      type: [{ chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter' }, count: Number }],
      default: [],
    },
    totalCount: { type: Number, default: 0 },
    durationMin: { type: Number, default: 90 },
    deadlineAt: { type: Date, default: null },
    showAnalysis: { type: Boolean, default: true },
    allowRedo: { type: Boolean, default: true },
    // 打乱题目顺序：examDetail 按“本人稳定种子”重排 items，每人顺序独立且刷新不变；
    // 判分/排名只按 questionId 对齐，不受顺序影响
    shuffleItems: { type: Boolean, default: false },
    shareToken: { type: String, default: null, index: true, sparse: true },
    // 邮件通知状态（教师详情页展示；防重复发送的聚合视图，明细见 ExamNotificationLog）
    notificationStatus: { type: String, enum: ['none', 'sending', 'sent', 'partial', 'failed'], default: 'none', index: true },
    notificationSentAt: { type: Date, default: null },
    notificationStats: {
      type: new mongoose.Schema({ total: Number, sent: Number, failed: Number, pending: Number }, { _id: false }),
      default: undefined,
    },
    // 截止总结状态（定时任务幂等闸，明细见 ExamNotificationLog type=exam_summary）
    summaryStatus: { type: String, enum: ['none', 'pending', 'sent', 'failed'], default: 'none', index: true },
    summarySentAt: { type: Date, default: null },
    items: { type: [examItemSchema], default: [] },
  },
  { timestamps: true }
);

examSchema.index({ kind: 1, status: 1 });
examSchema.index({ classId: 1, status: 1 });

/**
 * ExamAttempt（考试作答）
 * - answers: [{ questionId, answer, correct, score }]
 * - status: doing 进行中 / submitted 已交卷
 */
const attemptSchema = new mongoose.Schema(
  {
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    answers: {
      type: [
        {
          questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
          answer: { type: mongoose.Schema.Types.Mixed, default: null },
          correct: { type: Boolean, default: false },
          score: { type: Number, default: 0 },
        },
      ],
      default: [],
    },
    questionOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    score: { type: Number, default: 0 },
    totalScore: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    totalCount: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    status: { type: String, enum: ['doing', 'submitted', 'abandoned'], default: 'doing', index: true },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    durationSec: { type: Number, default: 0 },
  },
  { timestamps: true }
);

attemptSchema.index({ examId: 1, userId: 1, status: 1 });
// 同一学生同一试卷至多一条未交卷记录：重复点击开始考试直接恢复（并发由索引兜底）
attemptSchema.index(
  { examId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { status: 'doing' } }
);

export const Exam = mongoose.model('Exam', examSchema);
export const ExamAttempt = mongoose.model('ExamAttempt', attemptSchema);
