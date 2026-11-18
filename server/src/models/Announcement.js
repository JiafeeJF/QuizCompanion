import mongoose from 'mongoose';

/**
 * Announcement（公告）
 * - 管理员后台发布；学员在首页弹窗 / 「我的」铃铛入口查看
 * - status: draft 草稿 / active 启用 / closed 停用（activity 由时间窗 + status 共同决定）
 * - priority: 数字越大越优先；同分按生效时间倒序
 * - effectiveAt/staleAt 可选（默认即时生效、长期有效）
 * - 已读与用户关联：AnnouncementRead { announcementId, userId } 唯一
 */
const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', index: true },
    priority: { type: Number, default: 0 },
    effectiveAt: { type: Date, default: null },
    staleAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true }
);

announcementSchema.index({ status: 1, priority: -1, effectiveAt: -1 });

const readSchema = new mongoose.Schema(
  {
    announcementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);
// 同一用户同一公告只记一次已读
readSchema.index({ announcementId: 1, userId: 1 }, { unique: true });

export const Announcement = mongoose.model('Announcement', announcementSchema);
export const AnnouncementRead = mongoose.model('AnnouncementRead', readSchema);
