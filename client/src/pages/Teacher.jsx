import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { TopBar, Card, Modal, Stat, formatDuration } from '../components/ui.jsx';
import SequenceRangePicker, { validateSequenceInput } from '../components/SequenceRangePicker.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';

/** 教师端页面（由 App.jsx 在 /teacher 独立路由下直接挂载，不再嵌套子 Routes） */
export function TeacherHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const load = async () => {
    try {
      const { classes } = await api.myClasses();
      setClasses(classes);
    } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!name.trim()) return toast('请填写班级名称', 'error');
    try {
      await api.createClass({ name: name.trim(), desc });
      toast('班级创建成功', 'success');
      setCreateOpen(false); setName(''); setDesc('');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  if (loading) return <PageLoading />;

  return (
    <div>
      <TopBar
        title="教师工作台"
        right={<button onClick={() => navigate('create-exam')} className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white">＋ 布置考试</button>}
      />
      <div className="space-y-2.5 px-4 pb-6">
        {classes.length === 0 && <Empty text="还没有班级，先创建一个吧" />}
        {classes.map((c) => (
          <Card key={c._id} onClick={() => navigate(`class/${c._id}`)}>
            <div className="flex items-center justify-between">
              <p className="text-[16px] font-bold text-ink">{c.name}</p>
              <span className="chip bg-ink text-white">码 {c.code}</span>
            </div>
            {c.desc && <p className="mt-1 line-clamp-1 text-[13px] text-sub">{c.desc}</p>}
            <p className="mt-1.5 text-[13px] text-sub">{c.studentCount} 名学员 · 点击管理</p>
          </Card>
        ))}
        <button className="btn-secondary w-full border border-dashed !border-line" onClick={() => setCreateOpen(true)}>＋ 创建班级</button>
      </div>
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="创建班级">
        <div className="space-y-3">
          <div><label className="label">班级名称</label><input className="input-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 25级物联网1班" maxLength={40} /></div>
          <div><label className="label">备注（选填）</label><input className="input-field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} /></div>
          <button className="btn-primary w-full" onClick={create}>创建并生成班级码</button>
        </div>
      </Modal>
    </div>
  );
}

export function ClassDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [cls, setCls] = useState(null);
  const [overview, setOverview] = useState(null);
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [sort, setSort] = useState('accuracy');
  const [tab, setTab] = useState('students');
  const [qrExam, setQrExam] = useState(null);

  const load = async () => {
    try {
      const [{ class: c }, { overview: o }, { exams: ex }] = await Promise.all([
        api.classDetail(id), api.classOverview(id), api.classExams(id),
      ]);
      setCls(c); setOverview(o); setExams(ex);
      const { students: st } = await api.classStudents(id, { sort });
      setStudents(st);
    } catch (e) { toast(e.message, 'error'); }
  };
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    api.classStudents(id, { sort }).then(({ students }) => setStudents(students)).catch(() => {});
  }, [sort]);

  const endExam = async (examId, ended) => {
    try {
      await api.setExamStatus(examId, ended ? 'published' : 'ended');
      toast(ended ? '已重新发布' : '已结束', 'success');
      load();
    } catch (e) { toast(e.message, 'error'); }
  };
  const delExam = async (examId) => {
    if (!(await confirm({ title: '删除考试', message: '将同时删除学员作答记录，确定吗？', confirmText: '删除' }))) return;
    try { await api.deleteTeacherExam(examId); toast('已删除', 'success'); load(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const dismissClass = async () => {
    if (!(await confirm({ title: '解散班级', message: `解散后 ${students.length} 名学员将自动退出班级（学习记录保留），确定吗？`, confirmText: '解散班级' }))) return;
    try {
      const { removedStudents = 0 } = await api.deleteClass(id);
      toast(`班级已解散，${removedStudents} 名成员已退出`, 'success');
      navigate('/teacher', { replace: true });
    } catch (e) { toast(e.message, 'error'); }
  };

  if (!cls) return <PageLoading />;

  return (
    <div>
      <TopBar title={cls.name} />
      <div className="space-y-3 px-4 pb-6">
        {/* 班级码分享 */}
        <div className="card flex items-center justify-between bg-ink p-4 text-white">
          <div>
            <p className="text-[13px] text-white/60">学员凭班级码加入</p>
            <p className="text-[26px] font-bold tracking-[0.2em]">{cls.code}</p>
          </div>
          <button className="rounded-full bg-white px-4 py-2 text-[13px] font-bold text-ink" onClick={() => { navigator.clipboard?.writeText(cls.code); toast('班级码已复制', 'success'); }}>复制</button>
        </div>

        {/* 概览 */}
        {overview && (
          <div className="flex gap-2.5">
            <Stat label="学员" value={overview.studentCount} />
            <Stat label="参与率" value={`${overview.participateRate}%`} />
            <Stat label="平均分" value={overview.avgScore} accent />
            <Stat label="正确率" value={`${overview.accuracy}%`} />
          </div>
        )}

        {/* tabs */}
        <div className="flex gap-2">
          {[['students', '学员数据'], ['exams', `考试管理(${exams.length})`]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${tab === k ? 'bg-ink text-white' : 'bg-white text-sub'}`}>{label}</button>
          ))}
        </div>
        <button className="w-full rounded-2xl bg-bad/[0.08] py-2.5 text-[13px] font-semibold text-bad active:scale-[0.99]" onClick={dismissClass}>解散班级（学员自动退出）</button>

        {tab === 'students' && (
          <>
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              {[['accuracy', '按正确率'], ['doneQuestions', '按刷题量'], ['wrongCount', '按错题数'], ['examCount', '按考试数']].map(([k, label]) => (
                <button key={k} onClick={() => setSort(k)} className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-medium ${sort === k ? 'bg-ink text-white' : 'bg-white text-sub'}`}>{label}</button>
              ))}
            </div>
            {students.map((s, i) => (
              <div key={s._id} className="card flex items-center gap-3 p-4">
                <span className="w-6 text-center text-[14px] font-bold text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-ink">{s.name || '未命名'} <span className="ml-1 text-[12px] font-normal text-faint">{s.email}</span></p>
                  <p className="mt-0.5 text-[12px] text-sub">刷题 {s.doneQuestions} · 正确率 {s.accuracy}% · 错题 {s.wrongCount} · 考试 {s.examCount} 场</p>
                </div>
              </div>
            ))}
            {students.length === 0 && <Empty text="还没有学员加入" />}
          </>
        )}

        {tab === 'exams' && (
          <>
            <button className="btn-primary w-full" onClick={() => navigate('/teacher/create-exam')}>＋ 布置新考试 / 作业</button>
            {exams.map((e) => (
              <div key={e._id} className="card p-4">
                <div className="flex items-center gap-2">
                  {e.scope === 'homework' && <span className="chip bg-warn/[0.12] text-warn">作业</span>}
                  <span className={`chip ${e.status === 'ended' ? 'bg-bad/[0.08] text-bad' : 'bg-ok/[0.1] text-ok'}`}>{e.status === 'ended' ? '已结束' : '进行中'}</span>
                  <span className="ml-auto text-[12px] text-faint">{e.submittedCount} 人已交</span>
                </div>
                <p className="mt-1.5 text-[15px] font-bold text-ink">{e.title}</p>
                <p className="mt-0.5 text-[12px] text-sub">{e.totalCount} 题 · {e.durationMin} 分钟{e.deadlineAt ? ` · 截止 ${new Date(e.deadlineAt).toLocaleString('zh-CN', { hour12: false })}` : ''}</p>
                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => navigate(`/teacher/exam/${e._id}`)}>成绩</button>
                  <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => setQrExam(e)}>分享</button>
                  <button className="btn-secondary flex-1 !py-2 text-[13px]" onClick={() => endExam(e._id, e.status === 'ended')}>{e.status === 'ended' ? '重开' : '结束'}</button>
                  <button className="flex-1 rounded-2xl bg-bad/[0.08] py-2 text-[13px] font-semibold text-bad" onClick={() => delExam(e._id)}>删除</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* 分享弹窗：链接+二维码 */}
      <Modal open={!!qrExam} onClose={() => setQrExam(null)} title="分享考试">
        {qrExam && <ShareExam exam={qrExam} />}
      </Modal>
    </div>
  );
}

export function ShareExam({ exam }) {
  const toast = useToast();
  const link = `${window.location.origin}/share/${exam.shareToken}`;
  return (
    <div className="text-center">
      <div className="mx-auto inline-block rounded-2xl border border-line p-3">
        <QRCodeSVG value={link} size={180} />
      </div>
      <p className="mt-3 break-all rounded-2xl bg-black/[0.03] p-3 text-left text-[12px] text-sub">{link}</p>
      <button className="btn-primary mt-3 w-full" onClick={() => { navigator.clipboard?.writeText(link); toast('链接已复制', 'success'); }}>复制链接</button>
      <p className="mt-2 text-[12px] text-faint">学员扫码/打开链接后登录即可参加</p>
    </div>
  );
}

export function CreateExam() {
  const navigate = useNavigate();
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [classId, setClassId] = useState('');
  const [scope, setScope] = useState('exam');
  const [selectMode, setSelectMode] = useState('random');
  const [totalCount, setTotalCount] = useState(50);
  const [counts, setCounts] = useState({});
  const [seqStart, setSeqStart] = useState(1);
  const [seqEnd, setSeqEnd] = useState(100);
  const [seqTotal, setSeqTotal] = useState(null);
  const [durationMin, setDurationMin] = useState(90);
  const [deadline, setDeadline] = useState('');
  const [shuffleItems, setShuffleItems] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    Promise.all([api.myClasses(), api.chapters(), api.sequenceTotal().catch(() => ({ total: null }))]).then(([{ classes }, { chapters }, { total }]) => {
      setClasses(classes); setChapters(chapters);
      if (classes[0]) setClassId(String(classes[0]._id));
      if (total) setSeqTotal(total);
    }).catch((e) => toast(e.message, 'error'));
  }, []);

  const submit = async () => {
    if (!title.trim()) return toast('请填写标题', 'error');
    if (!classId) return toast('请选择班级', 'error');
    const chapterRules = Object.entries(counts).filter(([, n]) => n > 0).map(([chapterId, count]) => ({ chapterId, count }));
    if (selectMode === 'chapter' && !chapterRules.length) return toast('请设置各章节题量', 'error');
    let sequenceRange = null;
    if (selectMode === 'sequence') {
      const err = validateSequenceInput(seqStart, seqEnd, seqTotal);
      if (err) return toast(err, 'error');
      sequenceRange = { start: Number(seqStart), end: Number(seqEnd) };
    }
    setBusy(true);
    try {
      const { exam, mailQueued } = await api.createTeacherExam({
        title, desc, classId, scope, selectMode, chapterRules, totalCount, sequenceRange,
        durationMin, deadlineAt: deadline ? new Date(deadline).toISOString() : null,
        shuffleItems, status: asDraft ? 'draft' : 'published',
      });
      setDone(exam);
      toast(asDraft ? '已保存草稿（未发布，不发送通知）' : mailQueued ? '考试已发布，通知邮件正在发送' : '考试已发布', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div>
        <TopBar title="发布成功" />
        <div className="px-4 pb-6">
          <ShareExam exam={done} />
          <button className="btn-secondary mt-3 w-full" onClick={() => navigate('/teacher')}>返回工作台</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar title="布置考试 / 作业" />
      <div className="space-y-3 px-4 pb-6">
        <div className="card space-y-3 p-4">
          <div><label className="label">标题</label><input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 第3章随堂测" maxLength={60} /></div>
          <div><label className="label">说明（选填）</label><input className="input-field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="label">班级</label>
              <select className="input-field" value={classId} onChange={(e) => setClassId(e.target.value)}>
                {classes.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">类型</label>
              <select className="input-field" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="exam">考试</option>
                <option value="homework">作业</option>
              </select>
            </div>
          </div>
        </div>
        <div className="card p-4">
          <label className="label">抽题方式</label>
          <div className="flex gap-2">
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${selectMode === 'random' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setSelectMode('random')}>随机抽取</button>
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${selectMode === 'chapter' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setSelectMode('chapter')}>按章节抽取</button>
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${selectMode === 'sequence' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setSelectMode('sequence')}>顺序抽题</button>
          </div>
          {selectMode === 'random' ? (
            <div className="mt-3"><label className="label">题量（5～200）</label><input type="number" className="input-field" min={5} max={200} value={totalCount} onChange={(e) => setTotalCount(Number(e.target.value))} /></div>
          ) : selectMode === 'sequence' ? (
            <div className="mt-3">
              <SequenceRangePicker compact start={seqStart} end={seqEnd} onChange={({ start, end }) => { setSeqStart(start); setSeqEnd(end); }} />
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {chapters.map((c) => (
                <div key={c._id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px]">{c.name}（{c.questionCount}）</span>
                  <input type="number" className="h-9 w-20 rounded-xl border border-line text-center text-[14px]" min={0} max={c.questionCount} value={counts[c._id] || 0} onChange={(e) => setCounts((p) => ({ ...p, [c._id]: Math.max(0, Number(e.target.value) || 0) }))} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card p-4">
          <label className="label">时长（分钟）</label>
          <input type="number" className="input-field" min={5} max={600} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
          <div className="mt-3"><label className="label">截止时间</label><input type="datetime-local" className="input-field" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
          <label className="mt-3 flex items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" checked={shuffleItems} onChange={(e) => setShuffleItems(e.target.checked)} className="h-4 w-4" />
            打乱题目顺序（每位学员顺序不同，防窥屏；内容与判分不变）
          </label>
          <label className="mt-3 flex items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" checked={asDraft} onChange={(e) => setAsDraft(e.target.checked)} className="h-4 w-4" />
            先保存为草稿（不发布，不发送邮件通知）
          </label>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy ? '处理中…' : asDraft ? '保存草稿' : '发布考试'}</button>
      </div>
    </div>
  );
}

export function TeacherExamDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [exam, setExam] = useState(null);
  const [attempts, setAttempts] = useState([]);

  useEffect(() => {
    Promise.all([api.examDetail(id), api.examAttempts(id)])
      .then(([{ exam }, { attempts }]) => { setExam(exam); setAttempts(attempts); })
      .catch((e) => toast(e.message, 'error'));
  }, [id]);

  if (!exam) return <PageLoading />;
  const avg = attempts.length ? (attempts.reduce((s, a) => s + a.score, 0) / attempts.length).toFixed(1) : '—';
  const mailStatus = {
    none: '未发送通知',
    sending: '通知发送中',
    sent: '通知已发送',
    partial: `通知部分发送（成功 ${exam.notificationStats?.sent || 0}/${exam.notificationStats?.total || 0}）`,
    failed: '通知发送失败',
  }[exam.notificationStatus || 'none'];
  const summaryStatus = {
    none: exam.deadlineAt ? '总结待生成（截止后自动发送）' : '未设置截止时间，不生成总结',
    pending: '总结待生成',
    sent: '总结已发送',
    failed: '总结发送失败（将自动重试）',
  }[exam.summaryStatus || 'none'];

  return (
    <div>
      <TopBar title="成绩统计" />
      <div className="space-y-3 px-4 pb-6">
        <div className="card p-4">
          <p className="text-[16px] font-bold">{exam.title}</p>
          <p className="mt-1 text-[13px] text-sub">共 {attempts.length} 人交卷 · 平均分 {avg}</p>
          <p className="mt-1.5 text-[12px] text-faint">邮件通知：{mailStatus} · 截止总结：{summaryStatus}</p>
        </div>
        {attempts.map((a, i) => (
          <div key={a._id} className="card flex items-center gap-3 p-4">
            <span className="w-6 text-center font-bold text-faint">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-bold">{a.userId?.name || '未命名'} <span className="text-[12px] font-normal text-faint">{a.userId?.email}</span></p>
              <p className="text-[12px] text-sub">答对 {a.correctCount}/{a.totalCount} · 正确率 {a.accuracy}% · 用时 {formatDuration(a.durationSec)}</p>
            </div>
            <span className="text-[20px] font-bold">{a.score}</span>
          </div>
        ))}
        {attempts.length === 0 && <Empty text="还没有人交卷" />}
      </div>
    </div>
  );
}
