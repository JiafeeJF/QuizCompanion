import { Router } from 'express';
import { getDevProfile, setDevProfileRaw } from '../models/AppSetting.js';
import { authRequired, requireRole } from '../auth.js';
import { cleanText, sensitiveWriteLimit } from '../security.js';

const router = Router();

/** 服务器固定所在地（对外展示用） */
const SERVER_LOCATION = '日本大阪';

/** 内网/回环 IP 直接判未知，不浪费第三方查询 */
function isPrivateIp(ip) {
  const v = String(ip || '').trim();
  if (!v) return true;
  if (v === '::1' || v === '::ffff:127.0.0.1' || v === '127.0.0.1') return true;
  const v4 = v.replace(/^::ffff:/, '');
  return (
    /^10\./.test(v4) ||
    /^192\.168\./.test(v4) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v4) ||
    /^fc00:|^fe80:/i.test(v)
  );
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = fwd || req.ip || '';
  return raw.replace(/^::ffff:/, '');
}

/** 轻量 ping：只返回服务端时间，前端用往返耗时算延迟 */
router.get('/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), serverLocation: SERVER_LOCATION });
});

/**
 * GET /api/meta/network 一次返回延迟测试所需的全部信息：
 * { serverLocation, serverTime, clientIp, geo: { country, region, city, label } }
 * 归属地走 ip-api（免费、无需 key），2.5s 超时熔断，失败即未知，不阻塞主流程。
 */
router.get('/network', async (req, res) => {
  const ip = clientIp(req);
  let geo = { country: '', region: '', city: '', label: '未知' };
  if (!isPrivateIp(ip)) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 2500);
      const r = await fetch(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=status,country,regionName,city,query`,
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      const j = await r.json().catch(() => ({}));
      if (j && j.status === 'success') {
        const parts = [j.country, j.regionName, j.city].filter(Boolean);
        geo = {
          country: j.country || '',
          region: j.regionName || '',
          city: j.city || '',
          label: parts.length ? parts.join(' ') : '未知',
        };
      }
    } catch {
      // 超时/限流/断网一律未知，前端显示兜底文案
    }
  }
  res.json({
    ok: true,
    serverLocation: SERVER_LOCATION,
    serverTime: new Date().toISOString(),
    clientIp: ip || '',
    geo,
  });
});

/**
 * GET /api/meta/developer 开发者资料（公开，未登录可读；404 兜底保证前端永不转圈）
 * 前端优先读这个接口；失败时用 config.js 默认值。
 */
router.get('/developer', async (req, res) => {
  try {
    const profile = await getDevProfile();
    res.json({ ok: true, profile });
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

/** GET /api/meta/admin/developer 读取开发者资料（管理员） */
router.get('/admin/developer', authRequired, requireRole('admin'), async (req, res) => {
  try {
    const profile = await getDevProfile();
    res.json({ ok: true, profile });
  } catch {
    res.status(500).json({ error: '获取失败' });
  }
});

/**
 * PUT /api/meta/admin/developer 保存开发者资料（管理员）
 * { name, intro, avatar, tiktok, github }：文案前后去空格，长度白名单；
 * avatar 仅接受 jpeg/png/webp 的 dataURL（前端压缩后约十几 KB）或 http(s) 链接；
 * 链接仅做长度校验 + 去空格，打开走 target=_blank。
 */
router.put('/admin/developer', authRequired, requireRole('admin'), sensitiveWriteLimit, async (req, res) => {
  try {
    const { name = '', intro = '', avatar = '', tiktok = '', github = '' } = req.body || {};
    const clean = {
      name: cleanText(name, 20) || '物联宝典开发者',
      intro: cleanText(intro, 300) || '',
      tiktok: String(tiktok || '').trim().slice(0, 300),
      github: String(github || '').trim().slice(0, 300),
    };
    const av = String(avatar || '').trim();
    if (av && !/^data:image\/(jpeg|png|webp);base64,/.test(av) && !/^https?:\/\//.test(av)) {
      return res.status(400).json({ error: '头像仅支持图片链接或上传图片' });
    }
    if (av.length > 200 * 1024) return res.status(400).json({ error: '头像过大，请压缩后上传（≤150KB）' });
    clean.avatar = av.slice(0, 200 * 1024);
    await setDevProfileRaw(clean);
    res.json({ ok: true, profile: clean });
  } catch {
    res.status(500).json({ error: '保存失败' });
  }
});

export default router;
