import React, { useEffect, useState, useRef } from 'react';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { formatBeijingDateTime, parseBeijingDateTimeInput } from '../components/ui.jsx';

/**
 * APP 版本管理（/admin/app）：仅超管可上传（后端二次校验）。
 * 上传走 XMLHttpRequest 拿进度；APK 直链由 nginx 托管 /downloads/。
 */
export function AppVersionsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [makeLatest, setMakeLatest] = useState(true);
  const [publishAt, setPublishAt] = useState('');
  const [schedule, setSchedule] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(-1); // -1 空闲，0-100 上传中
  const fileRef = useRef(null);

  const load = () => api.adminAppVersions().then(setData).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const upload = () => {
    if (!file) return toast('请选择 .apk 文件', 'error');
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}(-[0-9A-Za-z.-]+)?$/.test(version.trim())) {
      return toast('版本号格式应为 x.y.z，如 1.0.3', 'error');
    }
    if (makeLatest && schedule && !publishAt) return toast('请选择发布时间', 'error');
    const fd = new FormData();
    fd.append('file', file);
    fd.append('version', version.trim());
    fd.append('notes', notes.trim());
    fd.append('makeLatest', makeLatest ? 'true' : 'false');
    fd.append('publishAt', makeLatest && schedule ? parseBeijingDateTimeInput(publishAt) : '');
    fd.append('forceUpdate', makeLatest && forceUpdate ? 'true' : 'false');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', (window.location.origin) + '/api/admin/app-versions');
    xhr.setRequestHeader('Authorization', `Bearer ${localStorage.getItem('wlbd_token') || ''}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      setProgress(-1);
      let d = {};
      try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        toast(`上传成功：v${d.version?.version} 已${makeLatest ? (schedule ? '安排发布' : '发布') : '存为历史版本'}`, 'success');
        setFile(null); setVersion(''); setNotes(''); setMakeLatest(true); setPublishAt(''); setSchedule(false); setForceUpdate(false);
        if (fileRef.current) fileRef.current.value = '';
        load();
      } else {
        toast(d.error || '上传失败', 'error');
      }
    };
    xhr.onerror = () => { setProgress(-1); toast('网络错误，上传失败', 'error'); };
    setProgress(0);
    xhr.send(fd);
  };

  const del = async (id, v) => {
    if (!(await confirm({ title: '删除版本', message: `确定删除 v${v} 吗？文件也会一并删除。`, confirmText: '删除' }))) return;
    try { await api.adminDeleteAppVersion(id); toast('已删除', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  if (!data) return <PageLoading />;
  const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

  return (
    <div>
      <div className="card p-4">
        <h3 className="mb-3 text-[15px] font-bold">上传新版本</h3>
        <div className="space-y-3">
          <div>
            <label className="label">APK 文件（≤200MB）</label>
            <input ref={fileRef} type="file" accept=".apk" className="input-field !py-2 text-[13px]"
              onChange={(e) => setFile(e.target.files[0] || null)} />
            {file && <p className="mt-1 text-[12px] text-sub">{file.name} · {fmtSize(file.size)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">版本号（x.y.z）</label>
              <input className="input-field" placeholder="如 1.0.3" value={version} maxLength={20}
                onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div>
              <label className="label">设为最新版</label>
              <button onClick={() => setMakeLatest(!makeLatest)}
                className={`flex h-[42px] w-full items-center justify-center rounded-xl text-[13px] font-semibold ${makeLatest ? 'bg-ok/[0.12] text-ok' : 'bg-black/[0.05] text-sub'}`}>
                {makeLatest ? '是：替换当前最新版' : '否：仅存为历史'}
              </button>
            </div>
          </div>
          <div>
            <label className="label">更新说明（选填）</label>
            <textarea className="input-field min-h-[70px]" placeholder="本次更新内容…" value={notes} maxLength={1000}
              onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="label">发布方式</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setMakeLatest(true); setSchedule(false); }} className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold ${makeLatest && !schedule ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>立即发布</button>
              <button type="button" onClick={() => { setMakeLatest(true); setSchedule(true); }} className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold ${makeLatest && schedule ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>定时发布</button>
              <button type="button" onClick={() => { setMakeLatest(false); setSchedule(false); }} className={`flex-1 rounded-2xl py-2.5 text-[13px] font-semibold ${!makeLatest ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`}>存为历史</button>
            </div>
          </div>
          {makeLatest && schedule && (
            <div>
              <label className="label">发布时间（北京时间）</label>
              <input type="datetime-local" className="input-field" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            </div>
          )}
          {makeLatest && (
            <button type="button" onClick={() => setForceUpdate((v) => !v)} className={`flex items-center justify-between rounded-2xl px-3.5 py-3 text-left text-[13px] font-semibold ${forceUpdate ? 'bg-bad/[0.1] text-bad' : 'bg-black/[0.05] text-sub'}`}>
              <span>强制更新</span><span>{forceUpdate ? '开启' : '关闭'}</span>
            </button>
          )}
          {progress >= 0 && (
            <div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="mt-1 text-center text-[12px] text-sub">上传中 {progress}%</p>
            </div>
          )}
          <button className="btn-primary w-full" disabled={progress >= 0} onClick={upload}>
            {progress >= 0 ? '上传中…' : '上传 APK'}
          </button>
        </div>
      </div>

      <h3 className="section-title mb-2 mt-5">当前最新版</h3>
      {data.latest ? (
        <div className="card p-4">
          <div className="flex items-center gap-2">
            <span className="chip bg-ok/[0.12] text-ok">v{data.latest.version}</span>
            {data.latest.forceUpdate && <span className="chip bg-bad/[0.1] text-bad">强制更新</span>}
            <span className="text-[12px] text-faint">{fmtSize(data.latest.size)}</span>
            <span className="ml-auto text-[12px] text-faint">{data.latest.downloads} 次下载</span>
          </div>
          {data.latest.notes && <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-sub">{data.latest.notes}</p>}
          <p className="mt-2 text-[12px] text-faint">下载地址：/downloads/{data.latest.fileName}</p>
        </div>
      ) : (
        <Empty text="还没有上传过版本" />
      )}

      <h3 className="section-title mb-2 mt-5">历史版本（{data.list.length}）</h3>
      {data.list.length === 0 ? <Empty text="暂无记录" /> : (
        <div className="card divide-y divide-line">
          {data.list.map((v) => (
            <div key={v._id} className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold">
                  v{v.version} {v.latest && <span className="chip ml-1 bg-ok/[0.12] !px-1.5 !py-0.5 text-[10px] text-ok">最新</span>}
                </p>
                <p className="truncate text-[12px] text-faint">
                  {fmtSize(v.size)} · {formatBeijingDateTime(v.createdAt)} · {v.downloads} 次下载
                  {!v.latest && v.publishAt && !v.publishedAt && ` · 计划 ${formatBeijingDateTime(v.publishAt)}`}
                  {v.uploadedBy?.name ? ` · ${v.uploadedBy.name}` : ''}
                </p>
              </div>
              {!v.latest && (
                <button className="shrink-0 text-[13px] text-bad" onClick={() => del(v._id, v.version)}>删除</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
