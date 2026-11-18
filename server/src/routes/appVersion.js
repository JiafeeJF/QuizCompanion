import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AppVersion } from '../models/AppVersion.js';
import { authRequired, requireRole } from '../auth.js';
import { adminStrictLimit, auditLog, rateLimit } from '../security.js';
import { emitVersionNew } from '../realtime.js';
import { isObjectId } from '../validate.js';
const router = Router();

/**
 * APP 版本管理（仅超管上传）
 * - APK 落盘 DOWNLOAD_DIR（默认 /opt/wlbd/downloads），nginx 静态托管直链下载
 * - Node 侧只管元数据（版本号/说明/最新标记/下载计数），下载本身不走 Node，
 *   大文件不占 Node 内存与连接；计数通过前端先打点再跳转
 */
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '/opt/wlbd/downloads';
const MAX_APK_MB = Number(process.env.MAX_APK_MB || 200);
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const apkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DOWNLOAD_DIR),
    // 先落盘临时名，校验通过后再改成正式名，防未校验文件被直链访问
    filename: (req, file, cb) => cb(null, `tmp-${crypto.randomBytes(8).toString('hex')}.apk`),
  }),
  limits: { fileSize: MAX_APK_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '');
    const okExt = /\.apk$/i.test(name);
    const okMime = [
      'application/vnd.android.package-archive',
      'application/octet-stream', // 部分 Windows 浏览器对 apk 给这个
      'application/java-archive',
    ].includes(file.mimetype);
    cb(okExt && okMime ? null : new Error('仅支持 .apk 文件'), okExt && okMime);
  },
});

const publicReadLimit = rateLimit({ scope: 'appversion-read', windowMs: 60 * 1000, max: 120, message: '请求过于频繁' });

/** 语义化版本校验：1.2.3 / 1.2.3-beta.1 */
function validVersion(v) {
  return /^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.-]{1,20})?$/.test(String(v || '').trim());
}

/** POST /api/admin/app-versions 上传新版本（multipart: file + version + notes + makeLatest） */
router.post('/app-versions', authRequired, requireRole('admin'), (req, res) => {
  if (!req.user.isSuperAdmin) return res.status(403).json({ error: '仅超级管理员可上传 APK' });
  apkUpload.single('file')(req, res, async (err) => {
    try {
      if (err) {
        const msg = err?.code === 'LIMIT_FILE_SIZE' ? `文件超过 ${MAX_APK_MB}MB 限制` : (err.message || '上传失败');
        return res.status(400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: '请选择 APK 文件' });
      const { version, notes = '', makeLatest = 'true', publishAt = '', forceUpdate = 'false' } = req.body || {};
      if (!validVersion(version)) return res.status(400).json({ error: '版本号格式应为 x.y.z（如 1.0.3）' });
      const makeLatestBool = String(makeLatest) !== 'false';
      const publishDate = publishAt ? new Date(publishAt) : null;
      if (publishAt && Number.isNaN(publishDate?.getTime())) return res.status(400).json({ error: '发布时间格式不正确' });
      const now = new Date();
      const publishNow = makeLatestBool && (!publishDate || publishDate <= now);

      // 二次校验：磁盘文件必须以 PK 头（0x504B）开头，防改后缀的假 APK
      const fd = fs.openSync(req.file.path, 'r');
      const buf = Buffer.alloc(2);
      fs.readSync(fd, buf, 0, 2, 0);
      fs.closeSync(fd);
      if (buf.toString('hex') !== '504b') {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: '文件不是合法的 APK（缺少 ZIP 头）' });
      }

      // 正式文件名：wlbd-{version}.apk；同版本重复上传覆盖
      const fileName = `wlbd-${version}.apk`;
      const finalPath = path.join(DOWNLOAD_DIR, fileName);
      fs.renameSync(req.file.path, finalPath);
      const stat = fs.statSync(finalPath);

      // 设为最新：把其它 latest 清掉；同版本号旧记录直接替换
      if (publishNow) await AppVersion.updateMany({}, { $set: { latest: false } });
      const old = await AppVersion.findOne({ version });
      if (old) await old.deleteOne();
      const doc = await AppVersion.create({
        version,
        notes: String(notes).slice(0, 1000),
        fileName,
        originalName: String(req.file.originalname || '').slice(0, 120),
        size: stat.size,
        latest: publishNow,
        publishAt: makeLatestBool && publishDate && publishDate > now ? publishDate : null,
        publishedAt: publishNow ? now : null,
        forceUpdate: String(forceUpdate) === 'true',
        uploadedBy: req.user._id,
      });
      auditLog({ action: 'admin.upload-apk', operatorId: req.user._id, detail: `v${version} ${fileName} ${stat.size}B` });
      if (publishNow) emitVersionNew(doc.toObject());
      res.json({ version: doc });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: '上传失败' });
    }
  });
});

/** POST /api/admin/app-versions/notify-latest 手动补推最新版（超管；直接写库后没走上传推送时用） */
router.post('/app-versions/notify-latest', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: '仅超级管理员可操作' });
    const latest = await AppVersion.findOne({ latest: true }).lean();
    if (!latest) return res.status(404).json({ error: '暂无版本' });
    emitVersionNew(latest);
    auditLog({ action: 'admin.notify-version', operatorId: req.user._id, detail: 'v' + latest.version });
    res.json({ ok: true, version: latest.version });
  } catch (e) {
    res.status(500).json({ error: '推送失败' });
  }
});

/** GET /api/admin/app-versions 版本列表（管理端） */
router.get('/app-versions', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const [list, latest] = await Promise.all([
      AppVersion.find().sort({ createdAt: -1 }).limit(50).populate('uploadedBy', 'name email').lean(),
      AppVersion.findOne({ latest: true }).lean(),
    ]);
    res.json({ list, latest });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** DELETE /api/admin/app-versions/:id 删除历史版本（当前 latest 不可删，先传新的） */
router.delete('/app-versions/:id', authRequired, requireRole('admin'), async (req, res) => {
  try {
    if (!req.user.isSuperAdmin) return res.status(403).json({ error: '仅超级管理员可删除版本' });
    if (!isObjectId(req.params.id)) return res.status(400).json({ error: '参数非法' });
    const doc = await AppVersion.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: '版本不存在' });
    if (doc.latest) return res.status(400).json({ error: '当前最新版本不可删除，请先上传新版本' });
    const p = path.join(DOWNLOAD_DIR, doc.fileName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
    await doc.deleteOne();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除失败' });
  }
});

// ---------- 公开接口（下载页用，无需登录，挂 /api/app）----------
export const appPublicRouter = Router();

/** GET /api/app/version 最新版本信息（公开） */
appPublicRouter.get('/version', publicReadLimit, async (req, res) => {
  try {
    const now = new Date();
    const latest = await AppVersion.findOne({
      latest: true,
      $or: [{ publishAt: null }, { publishAt: { $lte: now } }],
    }).lean();
    if (!latest) return res.json({ version: null });
    res.json({
      version: latest.version,
      notes: latest.notes,
      forceUpdate: !!latest.forceUpdate,
      size: latest.size,
      downloads: latest.downloads,
      updatedAt: latest.updatedAt,
      // 相对路径：前端按当前域名拼 /downloads/{fileName}，换域名零改动
      downloadPath: `/downloads/${latest.fileName}`,
    });
  } catch (e) {
    res.status(500).json({ error: '获取失败' });
  }
});

/** POST /api/app/version/download-count 下载打点（公开， fire-and-forget） */
appPublicRouter.post('/version/download-count', publicReadLimit, async (req, res) => {
  try {
    await AppVersion.updateOne({ latest: true }, { $inc: { downloads: 1 } });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // 打点失败不影响下载
  }
});

export const DOWNLOAD_DIR_CONFIG = { DOWNLOAD_DIR, MAX_APK_MB };
export default router;
