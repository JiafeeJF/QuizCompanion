import mongoose from 'mongoose';

/**
 * Class（班级）
 * - code: 6 位班级码（学员输入加入）
 * - teacherId: 创建班级的教师
 */
const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, index: true },
    teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    desc: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ClassModel = mongoose.model('Class', classSchema);
