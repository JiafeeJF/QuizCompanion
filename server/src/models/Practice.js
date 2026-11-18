import mongoose from 'mongoose';

/**
 * PracticeRecord（练习记录）：顺序/随机/章节练习每答一题记一条
 * - result: correct 正确 / wrong 错误
 * - mode: order 顺序 / random 随机 / chapter 章节
 * - sessionId: 所属刷题会话（会话化刷题写入；老接口写入的为 null，继续保留查询兼容）
 */
const practiceRecordSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', index: true },
    mode: { type: String, enum: ['order', 'random', 'chapter'], default: 'order' },
    result: { type: String, enum: ['correct', 'wrong'], required: true },
    userAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'PracticeSession', default: null, index: true },
    clientEventId: { type: String, default: null },
    answeredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

practiceRecordSchema.index({ userId: 1, createdAt: -1 });
practiceRecordSchema.index({ userId: 1, questionId: 1 });
practiceRecordSchema.index(
  { userId: 1, clientEventId: 1 },
  { unique: true, partialFilterExpression: { clientEventId: { $type: 'string' } } }
);

/**
 * WrongBook（错题本）：每题一条（upsert），附带最新一次错误答案与次数
 * - 若某题之后答对，可选择移除（前端调用 DELETE）或保留
 */
const wrongSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', index: true },
    count: { type: Number, default: 1 },
    lastAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    mastered: { type: Boolean, default: false },
  },
  { timestamps: true }
);

wrongSchema.index({ userId: 1, questionId: 1 }, { unique: true });

/** Favorite（收藏） */
const favoriteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true, index: true },
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', index: true },
  },
  { timestamps: true }
);

favoriteSchema.index({ userId: 1, questionId: 1 }, { unique: true });
favoriteSchema.index({ userId: 1, createdAt: -1 });

/**
 * PracticeSession（刷题会话）：一轮刷题的整体进度（断点续刷）
 * - questionIds：建会话时一次确定题目与顺序，恢复时绝不重新抽题
 * - source：self 学生自主（默认，走免费/会员门）/ teacher 教师布置（按教师设置执行，不限会员）
 * - examId：教师任务绑定（来源 Exam.kind=teacher， 교사선물 확인용）
 * - rangeDesc：教师指定范围描述（如“第301～500题”），透出给学生看
 * - userAnswers：{ [questionId]: { answer, correct, autoGraded, correctAnswer, textAnswer, at } }
 *   其中 correctAnswer/textAnswer 为判分接口回的正确答案快照，恢复已答题展示用
 * - currentIndex：当前进行到第几题（恢复后直接定位）
 * - completed=true 的不再出现在“继续刷题”，只在历史中查看
 * - PracticeRecord 负责每题答题历史，本模型只负责“进行到哪里”
 * - 教师任务不消耗免费额度：自主与任务分属不同 source，后续额度统计按 source 分开即可
 */
const sessionAnswerSchema = new mongoose.Schema(
  {
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
    correct: { type: Boolean, default: null },
    autoGraded: { type: Boolean, default: false },
    correctAnswer: { type: mongoose.Schema.Types.Mixed, default: null },
    textAnswer: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const practiceSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mode: { type: String, enum: ['order', 'random', 'chapter'], required: true, index: true },
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null, index: true },
    title: { type: String, default: '' },
    questionIds: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }], default: [] },
    // 来源标记：self 学生自主 / teacher 教师布置（教师任务跳过会员门）
    source: { type: String, enum: ['self', 'teacher'], default: 'self', index: true },
    examId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null, index: true },
    rangeDesc: { type: String, default: '' },
    // 进度唯一性业务键：同一学生同一业务对象（顺序/随机/章节/教师任务）至多一条未完成进度。
    // 未完成时携带业务键并由部分唯一索引兜底并发；完成/删除后置空，释放槽位允许重新开始。
    // 字段无 index:true（复合唯一索引已覆盖，避免自动建单列索引与之冲突）。
    dedupeKey: { type: String, default: null },
    currentIndex: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    wrongCount: { type: Number, default: 0 },
    userAnswers: { type: Map, of: sessionAnswerSchema, default: {} },
    completed: { type: Boolean, default: false, index: true },
    completedAt: { type: Date, default: null },
    lastAccessedAt: { type: Date, default: Date.now, index: true },
    progressUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

practiceSessionSchema.index({ userId: 1, completed: 1, lastAccessedAt: -1 });
// 进度唯一性：同一用户+业务键只允许一条未完成进度（并发由索引兜底）。
// 未完成重复键需先 find 复用；本索引是最后一道防线。
// 注意：partial 与 sparse 不可混用；旧数据缺键由后端回填逻辑兜底，库里不依赖 sparse。
practiceSessionSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { completed: false, dedupeKey: { $type: 'string' } } }
);

export const PracticeRecord = mongoose.model('PracticeRecord', practiceRecordSchema);
export const WrongBook = mongoose.model('WrongBook', wrongSchema);
export const Favorite = mongoose.model('Favorite', favoriteSchema);
export const PracticeSession = mongoose.model('PracticeSession', practiceSessionSchema);
