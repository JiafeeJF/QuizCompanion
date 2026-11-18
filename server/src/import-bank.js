/**
 * 正式题库导入脚本：question-bank.xls（1200 题）按题号区间划分 8 个章节入库
 *
 * 用法：npm run import:bank [-- /path/to/question-bank.xls]
 *
 * 章节划分：
 *   第1章 职业道德与法律法规       1～60
 *   第2章 计算机基础知识           61～110
 *   第3章 计算机网络基础           111～160
 *   第4章 网络安全与防护           161～200
 *   第5章 电子电工基础             201～250
 *   第6章 物联网通信协议           251～330
 *   第7章 物联网数据格式与云平台   331～390
 *   第8章 综合应用与其他           391～1200
 *
 * 题型判定（按 Excel 实际格式）：
 *   4 个选项 → single（单选），答案 A/B/C/D → 索引 0/1/2/3
 *   2 个选项且为 对/错 → judge（判断），答案 A(对)/B(错) → 0/1
 *
 * 注意：会清空题库及关联数据（章节、试题、练习记录、错题本、收藏、
 * 全部试卷及作答记录），用户/班级/账号不受影响，并重建 2 套系统模拟卷。
 * 先全量校验 Excel，校验通过后才动数据库。
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import * as XLSX from 'xlsx';
import { connectDB } from './db.js';
import { Chapter } from './models/Chapter.js';
import { Question } from './models/Question.js';
import { PracticeRecord, WrongBook, Favorite } from './models/Practice.js';
import { Exam, ExamAttempt } from './models/Exam.js';
import { sampleArray } from './utils.js';

const CHAPTERS = [
  { sort: 1, name: '职业道德与法律法规', from: 1, to: 60 },
  { sort: 2, name: '计算机基础知识', from: 61, to: 110 },
  { sort: 3, name: '计算机网络基础', from: 111, to: 160 },
  { sort: 4, name: '网络安全与防护', from: 161, to: 200 },
  { sort: 5, name: '电子电工基础', from: 201, to: 250 },
  { sort: 6, name: '物联网通信协议', from: 251, to: 330 },
  { sort: 7, name: '物联网数据格式与云平台', from: 331, to: 390 },
  { sort: 8, name: '综合应用与其他', from: 391, to: 1200 },
];

const LETTER_INDEX = { A: 0, B: 1, C: 2, D: 3 };
const SOURCE = 'question-bank.xls';

function chapterOf(no) {
  return CHAPTERS.find((c) => no >= c.from && no <= c.to);
}

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const file = process.argv[2] || path.join(__dirname, '..', '..', 'question-bank.xls');
  if (!fs.existsSync(file)) {
    console.error(`[import] 找不到文件：${file}`);
    process.exit(1);
  }

  // ---------- 1. 读取并全量校验 ----------
  const buf = fs.readFileSync(file);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const data = rows.slice(1).filter((r) => String(r[0]).trim() !== '');
  console.log(`[import] 读取 ${data.length} 行有效数据`);

  const errors = [];
  const seen = new Set();
  const docs = [];

  for (const r of data) {
    const no = Number(String(r[0]).trim());
    const stem = String(r[1] || '').trim();
    const opts = [r[2], r[3], r[4], r[5]].map((x) => String(x ?? '').trim());
    const ansLetter = String(r[6] || '').trim().toUpperCase();
    const tag = `第${r[0]}题`;

    if (!Number.isInteger(no) || no < 1 || no > 1200) { errors.push(`${tag}：编号非法`); continue; }
    if (seen.has(no)) { errors.push(`${tag}：编号重复`); continue; }
    seen.add(no);
    if (!stem) { errors.push(`${tag}：题干为空`); continue; }
    if (!(ansLetter in LETTER_INDEX)) { errors.push(`${tag}：答案非法（${r[6]}）`); continue; }
    const ch = chapterOf(no);
    if (!ch) { errors.push(`${tag}：编号超出章节区间`); continue; }

    const [a, b, c, d] = opts;
    if (c && d) {
      if (!a || !b) { errors.push(`${tag}：四选项题 A/B 为空`); continue; }
      docs.push({ no, ch, type: 'single', stem, options: [a, b, c, d], answer: LETTER_INDEX[ansLetter] });
    } else if (!c && !d && a === '对' && b === '错' && (ansLetter === 'A' || ansLetter === 'B')) {
      docs.push({ no, ch, type: 'judge', stem, options: ['对', '错'], answer: LETTER_INDEX[ansLetter] });
    } else {
      errors.push(`${tag}：选项格式无法识别（C=${c || '空'} D=${d || '空'}）`);
    }
  }

  const missing = [];
  for (let i = 1; i <= 1200; i++) if (!seen.has(i)) missing.push(i);

  console.log(`[import] 校验：可入库 ${docs.length}，错误 ${errors.length}，缺号 ${missing.length}`);
  errors.slice(0, 20).forEach((e) => console.log('  !', e));
  if (missing.length) console.log('  缺失题号：', missing.slice(0, 20).join(','));
  if (errors.length || missing.length || docs.length !== 1200) {
    console.error('[import] 校验未通过，未写入数据库');
    process.exit(1);
  }

  // ---------- 2. 清空题库及关联数据 ----------
  await connectDB();
  console.log('[import] 清空旧题库及关联数据（试题/章节/练习/错题/收藏/试卷/作答）...');
  await Promise.all([
    Question.deleteMany({}),
    Chapter.deleteMany({}),
    PracticeRecord.deleteMany({}),
    WrongBook.deleteMany({}),
    Favorite.deleteMany({}),
    ExamAttempt.deleteMany({}),
    Exam.deleteMany({}),
  ]);

  // ---------- 3. 建章节 ----------
  const idByName = new Map();
  for (const c of CHAPTERS) {
    const ch = await Chapter.create({ name: c.name, sort: c.sort });
    idByName.set(c.name, ch._id);
  }
  console.log('[import] 8 个章节已创建');

  // ---------- 4. 批量入库 ----------
  const BATCH = 500;
  for (let i = 0; i < docs.length; i += BATCH) {
    const batch = docs.slice(i, i + BATCH).map((q) => ({
      chapterId: idByName.get(q.ch.name),
      type: q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      score: 2,
      enabled: true,
      source: SOURCE,
    }));
    await Question.insertMany(batch, { ordered: false });
    console.log(`[import] 已写入 ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
  }

  // ---------- 5. 按章节核对 ----------
  const chapters = await Chapter.find({}).lean();
  const nameById = new Map(chapters.map((c) => [String(c._id), c.name]));
  const agg = await Question.aggregate([{ $group: { _id: '$chapterId', n: { $sum: 1 } } }]);
  console.log('[import] 各章节题数：');
  for (const c of CHAPTERS) {
    const row = agg.find((a) => nameById.get(String(a._id)) === c.name);
    const n = row ? row.n : 0;
    const expect = c.to - c.from + 1;
    console.log(`  第${c.sort}章 ${c.name}：${n}（期望 ${expect}）${n === expect ? '' : '  ← 不符！'}`);
  }
  const typeAgg = await Question.aggregate([{ $group: { _id: '$type', n: { $sum: 1 } } }]);
  console.log('[import] 题型分布：', typeAgg.map((t) => `${t._id}=${t.n}`).join(' '));
  const total = await Question.countDocuments({});
  console.log(`[import] 题库总量：${total}`);

  // ---------- 6. 重建系统模拟卷 ----------
  const pool = await Question.find({ enabled: true }).lean();
  const mkExam = async (title, desc, n, durationMin) => {
    const pick = sampleArray(pool, Math.min(n, pool.length));
    await Exam.create({
      title, desc, kind: 'system', scope: 'exam', status: 'published',
      selectMode: 'fixed', totalCount: pick.length, durationMin,
      items: pick.map((q) => ({
        questionId: q._id, type: q.type, stem: q.stem, options: q.options || [],
        answer: q.answer ?? null, textAnswer: q.textAnswer || '', score: q.score || 2,
      })),
    });
    console.log(`[import] 系统卷已重建：${title}（${pick.length} 题）`);
  };
  await mkExam('物联网中级工全真模拟卷（一）', '系统固定卷：覆盖全部章节，限时 120 分钟，可重复作答。', 100, 120);
  await mkExam('物联网中级工冲刺模拟卷（二）', '系统固定卷：精选高频考点，限时 90 分钟。', 60, 90);

  console.log('[import] 完成！用户/班级/账号不受影响。');
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('[import] 失败：', e);
  process.exit(1);
});
