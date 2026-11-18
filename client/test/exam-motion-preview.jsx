import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { api } from '../src/api.js';
import { AuthProvider } from '../src/auth.jsx';
import { ToastProvider } from '../src/Toast.jsx';
import { ConfirmProvider } from '../src/components/Confirm.jsx';
import { StudentShell } from '../src/layouts/StudentShell.jsx';
import Exams from '../src/pages/Exams.jsx';
import ExamDetail from '../src/pages/ExamDetail.jsx';
import ExamEntry from '../src/components/ExamEntry.jsx';
import ExamResult from '../src/pages/ExamResult.jsx';
import '../src/index.css';

// Local-only harness, not a production route or a second implementation of the page.
if (!import.meta.env.DEV) throw new Error('Local preview only');
document.documentElement.style.setProperty('--safe-area-top', '34px');
Object.keys(api).forEach(key => { if (typeof api[key] === 'function') api[key] = async () => { throw new Error('本地预览未启用该接口'); }; });
const items = Array.from({ length: 12 }, (_, i) => ({ questionId: 'q' + i, type: 'single', stem: `预览题目 ${i+1}：物联网中用于采集环境信息的设备是什么？`, options: ['传感器', '显示器', '打印机', '音箱'], score: 2 }));
const exams = ['system', 'teacher', 'custom'].map((kind, i) => ({ _id: 'preview-' + i, kind, title: ['物联网中级工模拟试卷 401～600', '班级综合训练 · 较长试卷标题与手机端换行预览', '我的专项练习'][i], totalCount: 12, durationMin: 30, items, myAttempt: { status: 'submitted', score: 20 } }));
window.previewCalls = { starts: 0, submissions: [], abandoned: 0 };
window.previewApi = api;
// Avoid replacing a real cached user even in the local browser.
api.me = async () => { throw new Error('Preview needs no login'); };
api.exams = async () => ({ exams });
api.notices = async () => ({ notices: [] });
api.abandonInProgressExams = async () => ({ abandonedCount: 0 });
api.noticeReadExam = async () => ({});
api.examDetail = async id => { await new Promise(r => setTimeout(r, 200)); return { exam: exams.find(e => e._id === id) }; };
api.startExam = async id => { window.previewCalls.starts++; return { remainingSec: 1800 }; };
api.abandonExam = async () => { window.previewCalls.abandoned++; return {}; };
api.abandonExamBeacon = () => {};
api.submitExam = async (id, answers) => { window.previewCalls.submissions.push({id,answers}); return { attempt: {} }; };
api.deleteCustomExam = async () => ({});
api.examResult = async id => ({ exam: exams.find(e => e._id === id), attempt: { score: 20, totalScore: 24, correctCount: 10, totalCount: 12, accuracy: 83, durationSec: 219 }, detail: [], ranking: { available: true, total: 3, list: [], myRank: 2 } });
api.examAttempts = async () => { await new Promise(r => setTimeout(r, 800)); return { ranking: { total: 3, list: [
  { userId: 'a', rank: 1, name: '预览同学甲', score: 24, durationSec: 219 },
  { userId: 'b', rank: 2, name: '较长姓名的预览同学乙', score: 22, durationSec: 3819, mine: true },
  { userId: 'c', rank: 3, name: '预览同学丙', score: 20, durationSec: 600 },
] } }; };
function RouteProbe() { const location = useLocation(); return <output hidden data-testid="route">{location.pathname}</output>; }
createRoot(document.getElementById('root')).render(<React.StrictMode><MemoryRouter initialEntries={[new URLSearchParams(window.location.search).get('entry') || '/exams']}><ToastProvider><AuthProvider><ConfirmProvider>
  <div style={{position:'fixed',inset:'0 0 auto',zIndex:120,height:34,background:'#1d1d1f',color:'white',fontSize:12,textAlign:'center',padding:8}}>本地交互预览 · 示例数据 · 不连接真实考试</div>
  <RouteProbe />
  <Routes><Route element={<StudentShell />}><Route path="/exams" element={<Exams />} /><Route path="/exams/:id" element={<ExamEntry />} /><Route path="/exams/:id/result" element={<ExamResult />} /></Route></Routes>
</ConfirmProvider></AuthProvider></ToastProvider></MemoryRouter></React.StrictMode>);
