import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { memberActive } from '../auth.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { TopBar, Card, Modal, Stat, Pager, Switch, formatBeijingDateTimeInput, parseBeijingDateTimeInput } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { AppVersionsAdmin } from './AppVersions.jsx';
import { TicketsAdmin } from './TicketsAdmin.jsx';
import { DevProfileAdmin } from './DevProfileAdmin.jsx';
import { AnnouncementsAdmin } from './AnnouncementsAdmin.jsx';


/** 会员状态文案（与 memberActive() 同口径）：有效绿/过期红/长期有效不判过期 */
function memberText(u) {
  if (!u.isMember) return '';
  if (memberActive(u)) {
    const tail = u.memberExpireAt ? `会员至 ${new Date(u.memberExpireAt).toLocaleDateString('zh-CN')}` : '会员长期有效';
    return <span className="text-ok">{' · '}{tail}</span>;
  }
  return <span className="text-bad"> · 会员已过期</span>;
}

export function AdminHome() {
  const { tab = 'overview' } = useParams();
  return (
    <div>
      {(tab === 'overview' || !tab) && <Overview />}
      {tab === 'questions' && <QuestionsAdmin />}
      {tab === 'users' && <UsersAdmin />}
      {tab === 'classes' && <ClassesAdmin />}
      {tab === 'exams' && <ExamsAdmin />}
      {tab === 'tickets' && <TicketsAdmin />}
      {tab === 'announcements' && <AnnouncementsAdmin />}
      {tab === 'dev' && <DevProfileAdmin />}
      {tab === 'app' && <AppVersionsAdmin />}
    </div>
  );
}

function Overview() {
  const toast = useToast();
  const [data, setData] = useState(null);
  useEffect(() => {
    api.adminStats().then(setData).catch((e) => toast(e.message, 'error'));
  }, []);
  if (!data) return <PageLoading />;
  const s = data.stats;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <MiniStat label="注册用户" value={s.users} sub={`会员 ${s.members}`} />
        <MiniStat label="题库总量" value={s.questions} sub={`${s.chapters} 个章节`} />
        <MiniStat label="班级" value={s.classes} />
        <MiniStat label="试卷" value={s.exams} sub={`交卷 ${s.attempts} 次`} />
      </div>
      <MaintenancePanel />
      <h3 className="section-title mb-2 mt-5">题型分布</h3>
      <div className="card divide-y divide-line">
        {data.questionTypes.map((t) => (
          <div key={t._id} className="flex items-center justify-between px-4 py-3 text-[14px]">
            <span>{{ single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' }[t._id] || t._id}</span>
            <b>{t.count}</b>
          </div>
        ))}
      </div>
      <h3 className="section-title mb-2 mt-5">最新注册</h3>
      <div className="card divide-y divide-line">
        {data.recentUsers.map((u) => (
          <div key={u._id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0"><p className="truncate text-[14px] font-semibold">{u.name || '未命名'}</p><p className="truncate text-[12px] text-faint">{u.email}</p></div>
            <span className="chip bg-black/[0.05] text-sub">{{ student: '学员', teacher: '教师', admin: '管理' }[u.role]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MaintenancePanel() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.adminMaintenance().then(setState).catch((e) => toast(e.message, 'error')); }, []);
  if (!state) return null;
  const save = async (patch) => {
    const next = { ...state, ...patch };
    setState(next); setSaving(true);
    try {
      const saved = await api.saveAdminMaintenance(patch);
      setState(saved);
      toast(Object.prototype.hasOwnProperty.call(patch, 'enabled') ? (saved.enabled ? '维护模式已开启' : '维护模式已关闭') : '维护设置已保存', 'success');
    }
    catch (e) { toast(e.message, 'error'); }
    finally { setSaving(false); }
  };
  const accessUrl = state.enabled && state.accessId ? `${window.location.origin}/maintain-access/${state.accessId}` : '';
  const regenerate = async () => {
    try { setState(await api.regenerateAdminMaintenanceAccess()); toast('测试访问路径已重新生成，旧路径已失效', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="card mt-4 border-warn/30 bg-warn/[0.04] p-4">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1"><p className="text-[15px] font-bold text-ink">维护模式</p><p className="mt-0.5 text-[12px] text-sub">开启后学员会返回登录页，管理员仍可操作后台</p></div>
        <Switch checked={!!state.enabled} disabled={saving} onChange={(enabled) => save({ enabled })} />
      </div>
      <div className="mt-3 space-y-2.5">
        <label className="label">维护说明</label>
        <textarea className="input-field min-h-[72px]" value={state.message || ''} onChange={(e) => setState((p) => ({ ...p, message: e.target.value }))} onBlur={() => save({ message: state.message })} maxLength={200} placeholder="系统维护中，请稍后再试" />
        <label className="label">预计恢复时间（可选）</label>
        <input type="datetime-local" className="input-field" value={formatBeijingDateTimeInput(state.restoreAt)} onChange={(e) => save({ restoreAt: parseBeijingDateTimeInput(e.target.value) })} />
        {state.enabled && accessUrl && (
          <div className="mt-4 border-t border-line pt-3">
            <label className="label">维护期测试员入口</label>
            <div className="flex gap-2"><input readOnly className="input-field min-w-0 flex-1 text-[12px]" value={accessUrl} /><button className="btn-secondary shrink-0 !px-3 text-[12px]" onClick={() => { navigator.clipboard?.writeText(accessUrl); toast('链接已复制', 'success'); }}>复制</button></div>
            <button className="mt-2 text-[12px] font-semibold text-sub" onClick={regenerate}>重新生成路径</button>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }) {
  return (
    <div className="card p-4">
      <p className="text-[26px] font-bold leading-none">{value}</p>
      <p className="mt-1.5 text-[13px] text-sub">{label}{sub ? ` · ${sub}` : ''}</p>
    </div>
  );
}

const TYPE_NAME = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };

function QuestionsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [chapters, setChapters] = useState([]);
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [chapterId, setChapterId] = useState('');
  const [type, setType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [edit, setEdit] = useState(null); // null=关闭，{}=新建
  const [importOpen, setImportOpen] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const loadChapters = () => api.adminChapters().then(({ chapters }) => setChapters(chapters)).catch(() => {});
  const load = async (pg = 1) => {
    try {
      const params = { page: pg, pageSize: 15 };
      if (chapterId) params.chapterId = chapterId;
      if (type) params.type = type;
      if (keyword.trim()) params.keyword = keyword.trim();
      const d = await api.adminQuestions(params);
      setList(d.list); setTotal(d.total); setPage(d.page);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { loadChapters(); load(1); }, []);
  useEffect(() => { load(1); }, [chapterId, type]);

  const save = async (form) => {
    try {
      if (form._id) await api.adminUpdateQuestion(form._id, form);
      else await api.adminCreateQuestion(form);
      toast('已保存', 'success');
      setEdit(null); load(page);
    } catch (e) { toast(e.message, 'error'); }
  };
  const del = async (id) => {
    if (!(await confirm({ title: '删除题目', message: '确定删除这道题吗？', confirmText: '删除' }))) return;
    try { await api.adminDeleteQuestion(id); toast('已删除', 'success'); load(page); }
    catch (e) { toast(e.message, 'error'); }
  };
  const doImport = async (file) => {
    try {
      const r = await api.adminImport(file);
      setImportResult(r);
      toast(`导入完成：成功 ${r.ok}，失败 ${r.failed}`, r.failed ? 'error' : 'success');
      load(1);
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="mb-2.5 flex gap-2">
        <button className="btn-primary flex-1 !py-2.5 text-[14px]" onClick={() => setEdit({})}>＋ 新增题目</button>
        <button className="btn-secondary flex-1 !py-2.5 text-[14px]" onClick={() => setImportOpen(true)}>Excel/CSV 导入</button>
      </div>
      <div className="mb-2.5 flex gap-2">
        <input className="input-field" placeholder="搜索题干…" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <button className="btn-secondary shrink-0" onClick={() => load(1)}>搜</button>
      </div>
      <div className="no-scrollbar mb-2.5 flex gap-2 overflow-x-auto">
        <Chip2 label="全部题型" active={!type} onClick={() => setType('')} />
        {Object.entries(TYPE_NAME).map(([k, v]) => <Chip2 key={k} label={v} active={type === k} onClick={() => setType(k)} />)}
      </div>
      <select className="input-field mb-2.5" value={chapterId} onChange={(e) => setChapterId(e.target.value)}>
        <option value="">全部章节</option>
        {chapters.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
      </select>
      <ChapterManager chapters={chapters} onChange={loadChapters} />
      {list.map((q) => (
        <div key={q._id} className="card mb-2 p-3.5">
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <span>{q.chapterId?.name || ''}</span><span>·</span><span>{TYPE_NAME[q.type]}</span>
            <span className="ml-auto flex gap-1.5">
              <button className="font-semibold text-ink" onClick={() => setEdit(q)}>编辑</button>
              <button className="font-semibold text-bad" onClick={() => del(q._id)}>删除</button>
            </span>
          </div>
          <p className="mt-1 line-clamp-2 text-[14px] font-semibold">{q.stem}</p>
        </div>
      ))}
      <Pager page={page} pageSize={15} total={total} onPage={(p) => { setPage(p); load(p); }} />

      {edit !== null && <QuestionEditor initial={edit} chapters={chapters} onClose={() => setEdit(null)} onSave={save} />}
      <Modal open={importOpen} onClose={() => { setImportOpen(false); setImportResult(null); }} title="题库导入">
        <TemplateBox />
        <label className="btn-secondary mt-3 w-full cursor-pointer">
          选择 .xlsx / .csv 文件
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files[0] && doImport(e.target.files[0])} />
        </label>
        {importResult && (
          <div className="mt-3 rounded-2xl bg-black/[0.03] p-3.5 text-[13px] leading-relaxed">
            <p>共 {importResult.total} 行 · 成功 {importResult.ok} · 失败 {importResult.failed}</p>
            {importResult.errors?.map((er, i) => <p key={i} className="text-bad">第 {er.line} 行：{er.error}</p>)}
          </div>
        )}
      </Modal>
    </div>
  );
}

function TemplateBox() {
  const [tpl, setTpl] = useState(null);
  useEffect(() => { api.adminImportTemplate().then(setTpl).catch(() => {}); }, []);
  if (!tpl) return null;
  return (
    <div className="rounded-2xl bg-black/[0.03] p-3.5 text-[12px] leading-relaxed text-sub">
      <p className="font-bold text-ink">列：{tpl.columns.join(' / ')}</p>
      <p className="mt-1">题型：{tpl.typeValues}</p>
      <p>单选 {tpl.answerFormat.single} · 多选 {tpl.answerFormat.multiple} · 判断 {tpl.answerFormat.judge}</p>
      <p className="mt-1">{tpl.note}</p>
    </div>
  );
}

function ChapterManager({ chapters, onChange }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const add = async () => {
    if (!name.trim()) return toast('请填写章节名', 'error');
    try { await api.adminCreateChapter({ name: name.trim(), sort: chapters.length }); setName(''); onChange(); toast('已添加', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  const toggle = async (c) => {
    try { await api.adminUpdateChapter(c._id, { enabled: !c.enabled }); onChange(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const del = async (c) => {
    try { await api.adminDeleteChapter(c._id); onChange(); toast('已删除', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="card mb-2.5 p-3.5">
      <button className="flex w-full items-center justify-between text-[14px] font-bold" onClick={() => setOpen(!open)}>
        章节管理（{chapters.length}）<span className="text-faint">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          {chapters.map((c) => (
            <div key={c._id} className="flex items-center gap-2 text-[13px]">
              <span className={`min-w-0 flex-1 truncate ${c.enabled ? '' : 'text-faint line-through'}`}>{c.name}</span>
              <button className="text-ink" onClick={() => toggle(c)}>{c.enabled ? '停用' : '启用'}</button>
              <button className="text-bad" onClick={() => del(c)}>删除</button>
            </div>
          ))}
          <div className="flex gap-2">
            <input className="input-field !py-2" placeholder="新章节名" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary shrink-0 !py-2 text-[13px]" onClick={add}>添加</button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({ initial, chapters, onClose, onSave }) {
  const isNew = !initial._id;
  const [form, setForm] = useState({
    chapterId: initial.chapterId?._id || initial.chapterId || chapters[0]?._id || '',
    type: initial.type || 'single',
    stem: initial.stem || '',
    options: initial.options?.length ? initial.options : ['', '', '', ''],
    answer: initial.answer ?? 0,
    textAnswer: initial.textAnswer || '',
    score: initial.score || 2,
  });
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setOpt = (i, v) => setForm((p) => ({ ...p, options: p.options.map((o, j) => (j === i ? v : o)) }));

  return (
    <Modal open onClose={onClose} title={isNew ? '新增题目' : '编辑题目'}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className="label">章节</label>
            <select className="input-field" value={form.chapterId} onChange={(e) => set('chapterId', e.target.value)}>
              {chapters.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">题型</label>
            <select className="input-field" value={form.type} onChange={(e) => set('type', e.target.value)}>
              {Object.entries(TYPE_NAME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div><label className="label">题干</label><textarea className="input-field min-h-[80px]" value={form.stem} onChange={(e) => set('stem', e.target.value)} /></div>
        {(form.type === 'single' || form.type === 'multiple') && (
          <div>
            <label className="label">选项（至少 2 个非空）</label>
            <div className="space-y-2">
              {form.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 text-center text-[13px] font-bold text-sub">{'ABCDEF'[i]}</span>
                  <input className="input-field" value={o} onChange={(e) => setOpt(i, e.target.value)} />
                </div>
              ))}
            </div>
            <label className="label mt-2">正确答案（单选填序号 0 起；多选填如 0,2）</label>
            <input className="input-field" value={Array.isArray(form.answer) ? form.answer.join(',') : form.answer} onChange={(e) => {
              const v = e.target.value;
              set('answer', form.type === 'multiple' ? v.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) : Number(v));
            }} placeholder={form.type === 'multiple' ? '如 0,1,2' : '如 0（=A）'} />
          </div>
        )}
        {form.type === 'judge' && (
          <div><label className="label">正确答案（0=对，1=错）</label>
            <select className="input-field" value={form.answer} onChange={(e) => set('answer', Number(e.target.value))}>
              <option value={0}>对</option><option value={1}>错</option>
            </select>
          </div>
        )}
        {(form.type === 'fill' || form.type === 'short') && (
          <div><label className="label">参考答案</label><textarea className="input-field min-h-[80px]" value={form.textAnswer} onChange={(e) => set('textAnswer', e.target.value)} /></div>
        )}
        <div><label className="label">分值</label><input type="number" className="input-field" min={1} value={form.score} onChange={(e) => set('score', Number(e.target.value))} /></div>
        <button className="btn-primary w-full" onClick={() => onSave({ ...form, _id: initial._id, options: form.options.filter((o) => o.trim()) })}>保存</button>
      </div>
    </Modal>
  );
}

function Chip2({ label, active, onClick }) {
  return <button onClick={onClick} className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium ${active ? 'bg-ink text-white' : 'bg-white text-sub'}`}>{label}</button>;
}

function UsersAdmin() {
  const toast = useToast();
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [role, setRole] = useState('');
  const [keyword, setKeyword] = useState('');
  const [edit, setEdit] = useState(null);

  const load = async (pg = 1) => {
    try {
      const params = { page: pg, pageSize: 15 };
      if (role) params.role = role;
      if (keyword.trim()) params.keyword = keyword.trim();
      const d = await api.adminUsers(params);
      setList(d.list); setTotal(d.total); setPage(d.page);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(1); }, [role]);
  // 删除用户后刷新列表（UserEditor 内删除成功后广播）
  useEffect(() => {
    const h = () => { setEdit(null); load(page); };
    window.addEventListener('wlbd:admin-users-changed', h);
    return () => window.removeEventListener('wlbd:admin-users-changed', h);
  }, [page]);

  const save = async (id, patch) => {
    try {
      await api.adminUpdateUser(id, patch);
      toast('已保存', 'success');
      setEdit(null); load(page);
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="mb-2.5 flex gap-2">
        <input className="input-field" placeholder="按邮箱搜索…" value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load(1)} />
        <button className="btn-secondary shrink-0" onClick={() => load(1)}>搜</button>
      </div>
      <div className="mb-2.5 flex gap-2">
        {[['', '全部'], ['student', '学员'], ['teacher', '教师'], ['admin', '管理']].map(([k, v]) => (
          <Chip2 key={k} label={v} active={role === k} onClick={() => setRole(k)} />
        ))}
      </div>
      {list.map((u) => (
        <div key={u._id} className="card mb-2 p-3.5">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-bold">{u.name || '未命名'} <span className="font-normal text-faint">{u.email}</span></p>
              <p className="mt-0.5 text-[12px] text-sub">
                {u.isSuperAdmin ? '超级管理员' : { student: '学员', teacher: '教师', admin: '管理' }[u.role]}
                {memberText(u)}
                {u.status === 'banned' ? ' · 已封禁' : ''}
                {u.classId ? ` · ${u.classId.name || ''}` : ''}
              </p>
            </div>
            {u.isSuperAdmin
              ? <span className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[12px] font-semibold text-white">锁定</span>
              : <button className="shrink-0 font-semibold text-ink text-[13px]" onClick={() => setEdit(u)}>管理</button>}
          </div>
        </div>
      ))}
      <Pager page={page} pageSize={15} total={total} onPage={(p) => { setPage(p); load(p); }} />
      {edit && <UserEditor user={edit} onClose={() => setEdit(null)} onSave={save} />}
    </div>
  );
}

function UserEditor({ user, onClose, onSave }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status);
  const [isMember, setIsMember] = useState(!!user.isMember);
  const [expire, setExpire] = useState(user.memberExpireAt ? new Date(user.memberExpireAt).toISOString().slice(0, 10) : '');
  const [newPwd, setNewPwd] = useState('');
  const resetPwd = async () => {
    try { await api.adminResetPassword(user._id, newPwd || '123456'); toast('密码已重置', 'success'); setNewPwd(''); }
    catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={`管理 ${user.email}`}>
      <div className="space-y-3">
        <div><label className="label">角色</label>
          <select className="input-field" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="student">学员</option><option value="teacher">教师</option><option value="admin">超级管理员</option>
          </select>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3.5 text-[14px]">
          <span>账号状态：{status === 'banned' ? '已封禁' : '正常'}</span>
          <Switch checked={status !== 'banned'} onChange={(v) => setStatus(v ? 'active' : 'banned')} />
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-black/[0.03] p-3.5 text-[14px]">
          <span>会员</span>
          <Switch checked={isMember} onChange={setIsMember} />
        </div>
        {isMember && (
          <div><label className="label">到期时间（留空=长期）</label><input type="date" className="input-field" value={expire} onChange={(e) => setExpire(e.target.value)} /></div>
        )}
        <button className="btn-primary w-full" onClick={() => onSave(user._id, { role, status, isMember, memberExpireAt: isMember && expire ? new Date(expire).toISOString() : (isMember ? user.memberExpireAt : null) })}>保存</button>
        <div className="rounded-2xl bg-black/[0.03] p-3.5">
          <label className="label">重置密码</label>
          <div className="flex gap-2">
            <input className="input-field" placeholder="新密码（默认123456）" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
            <button className="btn-secondary shrink-0" onClick={resetPwd}>重置</button>
          </div>
        </div>
        <button
          className="w-full rounded-2xl bg-bad/[0.08] py-3 text-[14px] font-semibold text-bad active:scale-[0.98]"
          onClick={async () => {
            const ok = await confirm({
              title: '删除用户',
              message: `确定删除 ${user.email} 吗？\n其练习/错题/收藏/考试记录将一并清除，账号立即退出登录。教师名下班级将转交给你。`,
              confirmText: '删除',
            });
            if (!ok) return;
            try {
              await api.adminDeleteUser(user._id);
              toast('已删除，该账号已退出登录', 'success');
              onClose();
              // 列表刷新由父组件 load 触发：关闭后重新加载
              window.dispatchEvent(new CustomEvent('wlbd:admin-users-changed'));
            } catch (e) { toast(e.message, 'error'); }
          }}
        >
          删除用户
        </button>
      </div>
    </Modal>
  );
}

function ClassesAdmin() {
  const { mobileAdminKey } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [classes, setClasses] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const load = () => {
    Promise.all([api.adminClasses(), api.adminTeachers()]).then(([{ classes }, { teachers }]) => {
      setClasses(classes); setTeachers(teachers);
    }).catch((e) => toast(e.message, 'error'));
  };
  useEffect(() => { load(); }, []);
  const delClass = async (c) => {
    const ok = await confirm({
      title: '删除班级',
      message: `确定删除「${c.name}」吗？\n该班学员将自动退出班级，该班的教师考试及作答记录将一并删除（系统卷不受影响），不可恢复。`,
      confirmText: '删除',
    });
    if (!ok) return;
    try {
      const r = await api.adminDeleteClass(c._id);
      toast(r?.deletedExams ? `已删除，同时清理教师卷 ${r.deletedExams} 份` : '已删除', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="space-y-2.5">
      <h3 className="section-title">班级（{classes.length}）</h3>
      {classes.map((c) => (
        <div key={c._id} className="card flex items-center gap-2 p-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold">{c.name} <span className="ml-1 font-mono text-[13px] text-sub">{c.code}</span></p>
            <p className="mt-0.5 text-[12px] text-sub">教师：{c.teacherId?.name || ''}（{c.teacherId?.email || ''}）</p>
          </div>
          <button className="shrink-0 font-semibold text-bad text-[13px]" onClick={() => delClass(c)}>删除</button>
        </div>
      ))}
      <h3 className="section-title pt-2">教师（{teachers.length}）</h3>
      {teachers.map((t) => (
        <div key={t._id} className="card flex items-center justify-between p-3.5">
          <div><p className="text-[14px] font-bold">{t.name || '未命名'}</p><p className="text-[12px] text-faint">{t.email}</p></div>
          <Link to={mobileAdminKey ? `/m/${mobileAdminKey}/users` : '/admin/users'} className="text-[13px] font-semibold text-ink">管理 ›</Link>
        </div>
      ))}
    </div>
  );
}

function ExamsAdmin() {
  const toast = useToast();
  const confirm = useConfirm();
  const [exams, setExams] = useState([]);
  const [kind, setKind] = useState('');
  const [sysOpen, setSysOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [totalCount, setTotalCount] = useState(100);
  const [durationMin, setDurationMin] = useState(120);
  const load = () => api.adminExams(kind ? { kind } : {}).then(({ exams }) => setExams(exams)).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, [kind]);
  const createSys = async () => {
    if (!title.trim()) return toast('请填写标题', 'error');
    try {
      await api.adminCreateSystemExam({ title, totalCount, durationMin });
      toast('系统卷已创建', 'success');
      setSysOpen(false); setTitle(''); load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const toggle = async (e) => {
    try { await api.adminUpdateExam(e._id, { status: e.status === 'published' ? 'ended' : 'published' }); load(); }
    catch (err) { toast(err.message, 'error'); }
  };
  const del = async (e) => {
    if (!(await confirm({ title: '删除试卷', message: '将同时删除作答记录，确定吗？', confirmText: '删除' }))) return;
    try { await api.adminDeleteExam(e._id); load(); } catch (err) { toast(err.message, 'error'); }
  };
  return (
    <div>
      <div className="mb-2.5 flex gap-2">
        <button className="btn-primary flex-1 !py-2.5 text-[14px]" onClick={() => setSysOpen(true)}>＋ 新建系统卷</button>
      </div>
      <div className="mb-2.5 flex gap-2">
        {[['', '全部'], ['system', '系统卷'], ['teacher', '教师卷'], ['custom', '自定义']].map(([k, v]) => (
          <Chip2 key={k} label={v} active={kind === k} onClick={() => setKind(k)} />
        ))}
      </div>
      {exams.map((e) => (
        <div key={e._id} className="card mb-2 p-3.5">
          <div className="flex items-center gap-2 text-[12px] text-faint">
            <span>{{ system: '系统卷', teacher: '教师卷', custom: '自定义' }[e.kind]}</span>
            <span>·</span><span>{e.status === 'published' ? '已发布' : e.status === 'ended' ? '已结束' : '草稿'}</span>
            <span className="ml-auto">{e.items?.length ?? e.totalCount} 题</span>
          </div>
          <p className="mt-1 text-[15px] font-bold">{e.title}</p>
          <p className="mt-0.5 text-[12px] text-sub">{e.classId ? `班级：${e.classId.name}` : '全员可见'}{e.createdBy ? ` · ${e.createdBy.name || e.createdBy.email}` : ''}</p>
          <div className="mt-2 flex gap-2">
            <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => toggle(e)}>{e.status === 'published' ? '下架' : '发布'}</button>
            <button className="flex-1 rounded-2xl bg-bad/[0.08] py-2 text-[13px] font-semibold text-bad" onClick={() => del(e)}>删除</button>
          </div>
        </div>
      ))}
      {exams.length === 0 && <Empty text="暂无试卷" />}
      <Modal open={sysOpen} onClose={() => setSysOpen(false)} title="新建系统固定卷">
        <div className="space-y-3">
          <div><label className="label">标题</label><input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 全真模拟卷（三）" /></div>
          <div className="grid grid-cols-2 gap-2.5">
            <div><label className="label">题量</label><input type="number" className="input-field" value={totalCount} onChange={(e) => setTotalCount(Number(e.target.value))} /></div>
            <div><label className="label">时长（分钟）</label><input type="number" className="input-field" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} /></div>
          </div>
          <button className="btn-primary w-full" onClick={createSys}>创建（全库随机抽题）</button>
        </div>
      </Modal>
    </div>
  );
}
