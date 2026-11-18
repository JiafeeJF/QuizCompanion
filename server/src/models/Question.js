import mongoose from 'mongoose';

/**
 * Question（试题）
 * - type: single 单选 / multiple 多选 / judge 判断 / fill 填空 / short 简答
 * - 选择/判断类：options 数组 + answer 为正确选项索引（多选为索引数组）
 * - 填空/简答：textAnswer 文本答案（判分仅客观题自动判）
 */
const questionSchema = new mongoose.Schema(
  {
    chapterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true, index: true },
    type: {
      type: String,
      enum: ['single', 'multiple', 'judge', 'fill', 'short'],
      required: true,
      index: true,
    },
    stem: { type: String, required: true },
    options: { type: [String], default: [] },
    // 单选/判断：Number；多选：Number[]
    answer: { type: mongoose.Schema.Types.Mixed, default: null },
    textAnswer: { type: String, default: '' },
    analysis: { type: String, default: '' },
    difficulty: { type: Number, min: 1, max: 5, default: 3 },
    score: { type: Number, default: 2 },
    enabled: { type: Boolean, default: true, index: true },
    // 导入来源追踪
    source: { type: String, default: '' },
  },
  { timestamps: true }
);

questionSchema.index({ chapterId: 1, type: 1, enabled: 1 });
questionSchema.index({ stem: 'text' });

export const Question = mongoose.model('Question', questionSchema);
