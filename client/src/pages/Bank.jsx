import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar, Card, AnswerLines } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import QuestionCard from '../components/QuestionCard.jsx';

const TYPE_NAME = { single: '单选', multiple: '多选', judge: '判断', fill: '填空', short: '简答' };

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('表格文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 错题本 / 收藏 共用
 * - 列表（每题卡片标注所属章节） + 逐题回顾（正确答案字母 + 选项中文）
 */
export default function Bank({ tab }) {
  const navigate = useNavigate();
  const toast = useToast();
  const isWrong = tab !== 'fav';
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = async (pg = 1) => {
    setLoading(true);
    try {
      const params = { page: pg, pageSize: 20 };
      const data = isWrong ? await api.wrongs(params) : await api.favorites(params);
      setItems(data.list);
      setTotal(data.total);
      setPage(pg);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const qOf = (it) => it.questionId;

  const remove = async (qid) => {
    try {
      if (isWrong) await api.masterWrong(qid);
      else await api.removeFavorite(qid);
      toast(isWrong ? '已标记掌握' : '已取消收藏', 'success');
      setItems((prev) => prev.filter((it) => String(qOf(it)?._id) !== String(qid)));
      if (sel && String(qOf(sel)?._id) === String(qid)) setSel(null);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const exportTable = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const blob = await api.exportWrongsXlsx();
      if (Capacitor.isNativePlatform()) {
        const data = await blobToBase64(blob);
        const date = new Date().toISOString().slice(0, 10);
        const fileName = `物联宝典错题本-${date}.xlsx`;
        const documentPath = `物联宝典/${fileName}`;
        try {
          await Filesystem.writeFile({
            path: documentPath,
            data,
            directory: Directory.Documents,
            recursive: true,
          });
          toast(`已保存到本机 Documents/物联宝典/${fileName}`, 'success');
          return;
        } catch {
          // Older Android versions can restrict public Documents writes.
          // Fall back to the system file/share sheet without failing export.
        }
        await Filesystem.writeFile({
          path: fileName,
          data,
          directory: Directory.Cache,
        });
        const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
        await Share.share({
          title: '物联宝典错题本',
          text: '错题本 Excel 表格',
          files: [uri],
          dialogTitle: '导出错题',
        });
        toast('请选择保存到本机或分享', 'success');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wrong-book.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('已导出', 'success');
    } catch (e) {
      toast(e?.message || '导出失败，请稍后重试', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <TopBar
        title={isWrong ? '错题本' : '我的收藏'}
        back={false}
        right={isWrong ? <button onClick={exportTable} disabled={exporting} className="rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-55">{exporting ? '导出中' : '导出'}</button> : null}
      />
      <div className="px-4">
        {loading ? <PageLoading /> : items.length === 0 ? (
          <Empty text={isWrong ? '暂无错题，继续保持' : '还没有收藏题目'} />
        ) : (
          <div className="space-y-2.5 pb-4">
            {items.map((it) => {
              const q = qOf(it);
              if (!q) return null;
              const chapterName = it.chapterId?.name || (typeof q.chapterId === 'object' ? q.chapterId?.name : '') || '未归类';
              return (
                <Card key={q._id} onClick={() => setSel(sel && String(qOf(sel)?._id) === String(q._id) ? null : it)}>
                  <div className="flex items-center gap-2 text-[12px] text-faint">
                    <span className="chip bg-black/[0.05] text-sub">{chapterName}</span>
                    <span className="chip bg-black/[0.05] text-sub">{TYPE_NAME[q.type] || q.type}</span>
                    {isWrong && <span className="ml-auto text-bad">错 {it.count} 次</span>}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[15px] font-semibold leading-relaxed text-ink">{q.stem}</p>
                  {sel && String(qOf(sel)?._id) === String(q._id) ? (
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      <MiniReview q={q} myAnswer={it.lastAnswer} />
                      <button
                        className="btn-secondary mt-3 w-full !py-2.5 text-[13px]"
                        onClick={() => remove(q._id)}
                      >
                        {isWrong ? '已掌握，移出错题本' : '取消收藏'}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-right text-[12px] font-medium text-faint">展开查看解析 ›</p>
                  )}
                </Card>
              );
            })}
            <p className="py-2 text-center text-[12px] text-faint">共 {total} 道</p>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniReview({ q, myAnswer }) {
  const showMine = myAnswer !== undefined && myAnswer !== null;
  return (
    <div className="space-y-2.5">
      {/* 选项全文：字母 + 选项中文（单选/判断/多选全部列出，不省略） */}
      {['single', 'multiple', 'judge'].includes(q.type) && (
        <div className="rounded-2xl bg-black/[0.03] p-3.5">
          <p className="mb-2 text-[13px] font-medium text-sub">选项</p>
          <div className="space-y-2">
            {(q.options || []).map((opt, i) => {
              const inAnswer = q.type === 'multiple'
                ? (Array.isArray(q.answer) ? q.answer.includes(i) : false)
                : Number(q.answer) === i;
              return (
                <div key={i} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-[13px] leading-relaxed ${inAnswer ? 'border-ok bg-ok/[0.08]' : 'border-line bg-white'}`}>
                  <span className={`mt-[1px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${inAnswer ? 'bg-ok text-white' : 'bg-black/[0.06] text-sub'}`}>
                    {'ABCDEFG'[i]}
                  </span>
                  <span className="text-ink">{opt}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* 我的答案（错题本特有：当时选错了什么） */}
      {showMine && (
        <div className="rounded-2xl bg-bad/[0.06] p-3.5 text-[13px] leading-relaxed">
          <p>
            <span className="text-sub">我的答案：</span>
            <AnswerLines type={q.type} answer={myAnswer} options={q.options} textAnswer={typeof myAnswer === 'string' ? myAnswer : ''} tone="bad" />
          </p>
        </div>
      )}
      <div className="rounded-2xl bg-black/[0.03] p-3.5 text-[13px] leading-relaxed">
        <p>
          <span className="text-sub">正确答案：</span>
          <AnswerLines type={q.type} answer={q.answer} options={q.options} textAnswer={q.textAnswer} tone="ok" />
        </p>
      </div>
    </div>
  );
}
