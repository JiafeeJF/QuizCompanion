import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { useAuth, memberActive } from '../auth.jsx';
import { TopBar, Card, Modal } from '../components/ui.jsx';
import SequenceRangePicker, { validateSequenceInput } from '../components/SequenceRangePicker.jsx';
import { PageLoading } from '../components/guards.jsx';

/** 自定义组卷：选章节+题量 / 全库随机 / 顺序范围（会员；免费学生进页即提示并跳回） */
export default function CustomExam() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [chapters, setChapters] = useState([]);
  const [mode, setMode] = useState('chapter');
  const [title, setTitle] = useState('');
  const [totalCount, setTotalCount] = useState(50);
  const [durationMin, setDurationMin] = useState(90);
  const [counts, setCounts] = useState({});
  const [seqStart, setSeqStart] = useState(1);
  const [seqEnd, setSeqEnd] = useState(100);
  const [seqTotal, setSeqTotal] = useState(null);
  const [shuffleItems, setShuffleItems] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberActive(user)) {
      toast('该功能为会员专属功能', 'error');
      navigate('/exams', { replace: true });
      return;
    }
    api.chapters().then(({ chapters }) => setChapters(chapters)).catch((e) => toast(e.message, 'error'));
    api.sequenceTotal().then(({ total }) => setSeqTotal(total)).catch(() => {});
  }, []);

  const setCount = (id, v) => {
    const n = Math.max(0, Number(v) || 0);
    setCounts((prev) => ({ ...prev, [id]: n }));
  };
  const sum = Object.values(counts).reduce((s, n) => s + n, 0);

  const submit = async () => {
    if (!title.trim()) return toast('请填写试卷标题', 'error');
    const chapterRules = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([chapterId, count]) => ({ chapterId, count }));
    if (mode === 'chapter' && !chapterRules.length) return toast('请为至少一个章节设置题量', 'error');
    if (mode === 'random' && (!totalCount || totalCount < 5)) return toast('题量至少 5 道', 'error');
    let sequenceRange = null;
    if (mode === 'sequence') {
      const err = validateSequenceInput(seqStart, seqEnd, seqTotal);
      if (err) return toast(err, 'error');
      sequenceRange = { start: Number(seqStart), end: Number(seqEnd) };
    }
    setBusy(true);
    try {
      const { exam } = await api.createCustomExam({
        title, selectMode: mode, chapterRules, totalCount, sequenceRange, durationMin, shuffleItems,
      });
      toast('组卷成功', 'success');
      navigate(`/exams/${exam._id}`, { replace: true });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <TopBar title="自定义组卷" />
      <div className="space-y-3 px-4 pb-6">
        <div className="card p-4">
          <label className="label">试卷标题</label>
          <input className="input-field" placeholder="如：网络层专项突破卷" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
        </div>
        <div className="card p-4">
          <label className="label">组卷方式</label>
          <div className="flex gap-2">
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${mode === 'chapter' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setMode('chapter')}>按章节抽题</button>
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${mode === 'random' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setMode('random')}>全库随机</button>
            <button className={`flex-1 rounded-2xl py-2.5 text-[14px] font-semibold ${mode === 'sequence' ? 'bg-ink text-white' : 'bg-black/[0.05] text-sub'}`} onClick={() => setMode('sequence')}>顺序抽题</button>
          </div>
        </div>
        {mode === 'chapter' ? (
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="label !mb-0">各章节题量</label>
              <span className="text-[13px] font-semibold text-ink">共 {sum} 题</span>
            </div>
            <div className="space-y-2">
              {chapters.map((c) => (
                <div key={c._id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{c.name}（{c.questionCount}）</span>
                  <div className="flex items-center gap-1">
                    <button className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-[16px]" onClick={() => setCount(c._id, (counts[c._id] || 0) - 5)}>−</button>
                    <input className="h-8 w-14 rounded-xl border border-line text-center text-[14px]" type="number" min={0} max={c.questionCount} value={counts[c._id] || 0} onChange={(e) => setCount(c._id, e.target.value)} />
                    <button className="flex h-8 w-8 items-center justify-center rounded-full bg-black/[0.05] text-[16px]" onClick={() => setCount(c._id, (counts[c._id] || 0) + 5)}>＋</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : mode === 'sequence' ? (
          <SequenceRangePicker start={seqStart} end={seqEnd} onChange={({ start, end }) => { setSeqStart(start); setSeqEnd(end); }} />
        ) : (
          <div className="card p-4">
            <label className="label">总题量（5～200）</label>
            <input className="input-field" type="number" min={5} max={200} value={totalCount} onChange={(e) => setTotalCount(Number(e.target.value))} />
          </div>
        )}
        <div className="card p-4">
          <label className="label">考试时长（分钟）</label>
          <input className="input-field" type="number" min={5} max={600} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} />
          <label className="mt-3 flex items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" checked={shuffleItems} onChange={(e) => setShuffleItems(e.target.checked)} className="h-4 w-4" />
            打乱题目顺序（抽题后随机排序再考试）
          </label>
        </div>
        <button className="btn-primary w-full" disabled={busy} onClick={submit}>{busy ? '组卷中…' : '生成试卷'}</button>
      </div>
    </div>
  );
}
