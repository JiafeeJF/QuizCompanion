/** 头像工具：本地压缩成小 dataURL 再上传，节省服务器内存/流量 */
const AVATAR_SIZE = 160; // 输出正方形边长
const AVATAR_QUALITY = 0.72; // jpeg 质量

/** 读图片文件 -> 压缩 -> dataURL(jpeg)。非图片/超大文件直接抛错 */
export async function compressAvatar(file) {
  if (!file || !file.type?.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，请换一张');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('图片读取失败'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth || 0, img.naturalHeight || 0);
    if (!side) throw new Error('图片读取失败');
    // 中心正方形裁剪，避免头像被拉伸
    const sx = ((img.naturalWidth || 0) - side) / 2;
    const sy = ((img.naturalHeight || 0) - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return canvas.toDataURL('image/jpeg', AVATAR_QUALITY);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 头像展示组件：有图显示图，无图显示首字 */
export function Avatar({ user, size = 56, className = '' }) {
  const px = typeof size === 'number' ? size : 56;
  const fontSize = Math.round(px * 0.38);
  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt="头像"
        width={px}
        height={px}
        style={{ width: px, height: px }}
        loading="lazy"
        decoding="async"
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const ch = (user?.name || user?.email || '学')[0].toUpperCase();
  return (
    <span
      style={{ width: px, height: px, fontSize }}
      className={`flex shrink-0 items-center justify-center rounded-full bg-ink font-bold text-white ${className}`}
    >
      {ch}
    </span>
  );
}
