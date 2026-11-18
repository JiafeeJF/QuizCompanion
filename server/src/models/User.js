import mongoose from 'mongoose';

/**
 * User（用户）
 * - role: student 学员 / teacher 教师 / admin 管理员（含超级管理员）
 * - isSuperAdmin=true + role=admin：系统最高权限超级管理员，只能由启动初始化创建
 * - 会员状态由 isMember + memberExpireAt 判定（memberActive 为虚拟字段）
 */
const userSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    // 头像：前端压缩后的 dataURL（jpeg ≤ ~100KB），存用户文档避免服务器存原图
    avatar: { type: String, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher', 'admin'], default: 'student', index: true },
    status: { type: String, enum: ['active', 'banned'], default: 'active', index: true },
    // 会员
    isMember: { type: Boolean, default: false },
    mailExpiringSentAt: { type: Date, default: null },
    memberExpireAt: { type: Date, default: null },
    // 超级管理员：系统保底最高权限账号（role 仍为 admin），只能由启动初始化创建
    isSuperAdmin: { type: Boolean, default: false, index: true },
    // 班级归属（学员加入的班级，教师可挂多个则存主班级，这里统一单班级简化）
    classId: { type: mongoose.Schema.Types.ObjectId, ref: 'Class', default: null, index: true },
    // 登录态版本：修改密码后 +1，旧 JWT 自动失效（见 auth.js payload.v 校验）
    tokenVersion: { type: Number, default: 0 },
    // 换绑邮箱验证码（内存/简易存储：存 DB 保证重启不丢失）
    emailChangeCode: { type: String, default: null },
    emailChangeCodeExpireAt: { type: Date, default: null },
    emailChangeTarget: { type: String, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.virtual('memberActive').get(function () {
  if (!this.isMember) return false;
  if (this.memberExpireAt && this.memberExpireAt < new Date()) return false;
  return true;
});

export const User = mongoose.model('User', userSchema);
