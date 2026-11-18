import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { PageLoading } from '../components/guards.jsx';
import { compressAvatar } from '../components/Avatar.jsx';

/**
 * 开发者资料管理（管理后台 · 开发者 Tab）：
 * 名称 / 介绍文案 / 头像（上传压缩或图片链接）/ 抖音 / GitHub
 * 保存后学员端开发者页即时更新（同进程清缓存；多实例 5 分钟内收敛）
 */
export function DevProfileAdmin() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api.adminDevProfile()
      .then((p) => { if (alive) setForm({ name: '', intro: '', avatar: '', tiktok: '', github: '', ...(p || {}) }); })
      .catch((e) => { toast(e.message, 'error'); });
    return () => { alive = false; };
  }, []);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const pickAvatar = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await compressAvatar(file);
      set('avatar', dataUrl);
      setPreviewKey((k) => k + 1);
    } catch (e) { toast(e.message, 'error'); }
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    try {
      const { profile } = await api.saveAdminDevProfile(form);
      setForm({ ...(profile || form) });
      toast('开发者资料已保存，学员端即时更新', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!form) return <PageLoading />;
  return (
    <div>
      <h3 className="section-title mb-3">开发者资料</h3>
      <div className="card space-y-4 p-4">
        <div className="flex items-center gap-4">
          {form.avatar ? (
            <img key={previewKey} src={form.avatar} alt="开发者头像预览" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-[24px] font-bold text-white">
              {(form.name || '开')[0]}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <label className="btn-secondary block cursor-pointer text-center text-[13px]">
              上传头像
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { pickAvatar(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">本地压缩后再上传；或下方直接填图片链接</p>
          </div>
        </div>
        <div>
          <label className="label">开发者名称（最多 20 字）</label>
          <input className="input-field" value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={20} placeholder="物联宝典开发者" />
        </div>
        <div>
          <label className="label">介绍文案（最多 300 字）</label>
          <textarea className="input-field min-h-[90px]" value={form.intro} onChange={(e) => set('intro', e.target.value)} maxLength={300} placeholder="独立完成全部开发工作…" />
        </div>
        <div>
          <label className="label">头像图片链接（选填，留空用首字占位）</label>
          <input className="input-field" value={/^data:image/.test(form.avatar || '') ? '' : (form.avatar || '')} onChange={(e) => set('avatar', e.target.value.trim())} placeholder="https://…" />
        </div>
        <div>
          <label className="label">抖音链接（选填，留空则前端隐藏按钮）</label>
          <input className="input-field" value={form.tiktok} onChange={(e) => set('tiktok', e.target.value.trim())} placeholder="https://…" />
        </div>
        <div>
          <label className="label">GitHub 链接（选填，留空则前端隐藏按钮）</label>
          <input className="input-field" value={form.github} onChange={(e) => set('github', e.target.value.trim())} placeholder="https://…" />
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存'}</button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-faint">保存后学员端「我的 → 开发者」即时展示最新资料；链接留空时对应按钮自动隐藏。</p>
    </div>
  );
}
