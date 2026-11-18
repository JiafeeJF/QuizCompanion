import mongoose from 'mongoose';

/** Chapter（章节）：物联网中级工题库只按章节分类 */
const chapterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sort: { type: Number, default: 0 },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

chapterSchema.index({ sort: 1, name: 1 });

export const Chapter = mongoose.model('Chapter', chapterSchema);
