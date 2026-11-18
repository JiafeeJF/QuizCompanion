import mongoose from 'mongoose';

/**
 * AuditLog（安全审计日志）
 * - 只记操作元数据：operatorUserId/action/targetId/IP/result/timestamp
 * - 绝不记密码/验证码/JWT/Cookie/secret（调用方 auditLog 已做 cleanText 截断）
 */
const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true },
    operatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    targetId: { type: String, default: '' },
    ip: { type: String, default: '' },
    result: { type: String, enum: ['ok', 'fail'], default: 'ok', index: true },
    detail: { type: String, default: '' },
  },
  { timestamps: true }
);

auditSchema.index({ createdAt: -1 });

export const AuditLog = mongoose.model('AuditLog', auditSchema);
