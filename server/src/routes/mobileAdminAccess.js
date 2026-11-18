import { Router } from 'express';
import { rateLimit } from '../security.js';
import { isValidMobileAdminKey } from '../mobileAdminAccess.js';

const router = Router();
const accessLimit = rateLimit({
  scope: 'mobile-admin-access',
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: '请求过于频繁，请稍后再试',
});

router.get('/access/:key', accessLimit, (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!isValidMobileAdminKey(req.params.key)) return res.status(404).json({ error: '接口不存在' });
  return res.json({ ok: true });
});

export default router;
