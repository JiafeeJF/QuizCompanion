import mongoose from 'mongoose';

/**
 * AppVersion（APP 版本管理）
 * - 每次上传一条记录；latest=true 的是当前最新版（同一时刻仅一条）
 * - 文件落盘 /opt/wlbd/downloads（nginx 直接静态托管下载，Node 只提供元信息与上传）
 */
const appVersionSchema = new mongoose.Schema(
  {
    version: { type: String, required: true, trim: true }, // 语义化版本，如 1.0.3
    notes: { type: String, default: '', maxlength: 1000 }, // 更新说明
    fileName: { type: String, required: true }, // 服务器磁盘文件名，如 wlbd-1.0.3.apk
    originalName: { type: String, default: '' }, // 上传时的原始文件名
    size: { type: Number, required: true }, // 字节
    downloads: { type: Number, default: 0 }, // 下载计数
    latest: { type: Boolean, default: false, index: true },
    publishAt: { type: Date, default: null, index: true },
    publishedAt: { type: Date, default: null },
    forceUpdate: { type: Boolean, default: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

export const AppVersion = mongoose.model('AppVersion', appVersionSchema);
