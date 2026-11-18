import mongoose from 'mongoose';

/**
 * Ticket（工单反馈：Bug / 建议 / 其他）
 * - 状态机：pending 待处理 → processing 处理中 → replied 已回复 → closed 已关闭
 * - 图片：前端压缩后的 dataURL（jpeg ≤ ~100KB），最多 3 张，跟随工单文档走
 * - 回复：内嵌数组，管理员回复 + 用户追加说明都记一条（role 区分）
 */
const ticketTypeList = ['bug', 'suggest', 'other'];
const ticketStatusList = ['pending', 'processing', 'replied', 'closed'];

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'admin'], required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    authorName: { type: String, default: '' },
    content: { type: String, default: '' },
    // 用户追加说明时可带图（同样 dataURL，最多 3 张/条）
    images: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false }, _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userName: { type: String, default: '' },
    userEmail: { type: String, default: '' },
    type: { type: String, enum: ticketTypeList, default: 'bug', index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    desc: { type: String, required: true, trim: true, maxlength: 5000 },
    images: { type: [String], default: [] },
    status: { type: String, enum: ticketStatusList, default: 'pending', index: true },
    // 用户是否已读最新管理员回复（学员端“有新回复”红点用）
    userSeenAt: { type: Date, default: null },
    lastAdminReplyAt: { type: Date, default: null },
    lastReplyMailAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ userId: 1, createdAt: -1 });

ticketSchema.add({ messages: { type: [messageSchema], default: [] } });

export const TICKET_TYPES = ticketTypeList;
export const TICKET_STATUS = ticketStatusList;
export const Ticket = mongoose.model('Ticket', ticketSchema);
