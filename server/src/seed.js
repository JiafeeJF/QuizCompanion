import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from './db.js';
import { User } from './models/User.js';
import { Chapter } from './models/Chapter.js';
import { Question } from './models/Question.js';
import { Exam } from './models/Exam.js';
import { hashPassword, sampleArray } from './utils.js';

/**
 * 种子数据：账号 + 8 大章节 + 示例题（约 120 道，覆盖 5 种题型）
 * 用法：npm run seed
 * 幂等：重复执行会先清空题库相关集合
 */
const SEED_PWD = process.env.SEED_PASSWORD || '123456';

const CHAPTERS = [
  { name: '物联网概述与体系架构', sort: 1 },
  { name: '感知层技术（传感器/RFID/二维码）', sort: 2 },
  { name: '网络层技术（通信与组网）', sort: 3 },
  { name: '平台层与数据处理', sort: 4 },
  { name: '应用层与典型行业应用', sort: 5 },
  { name: '物联网安全与隐私保护', sort: 6 },
  { name: '嵌入式与边缘计算', sort: 7 },
  { name: '工程实践与项目管理', sort: 8 },
];

// 每章示例题（单选/多选/判断/填空/简答混合），seed 批量生成变体以达到演示体量
const SAMPLES = [
  { type: 'single', stem: '物联网体系架构通常分为哪三层？', options: ['感知层、网络层、应用层', '物理层、链路层、传输层', '采集层、传输层、展示层', '终端层、平台层、业务层'], answer: 0, analysis: '经典三层模型：感知、网络、应用。' },
  { type: 'single', stem: 'RFID 系统中负责读写标签信息的部件是？', options: ['阅读器', '天线', '标签芯片', '中间件'], answer: 0, analysis: '阅读器通过射频信号与标签通信。' },
  { type: 'single', stem: '下列哪种无线技术功耗最低、适合大规模传感组网？', options: ['LoRa', 'Wi-Fi', '蓝牙经典', '4G'], answer: 0, analysis: 'LoRa 属于 LPWAN，低功耗广覆盖。' },
  { type: 'single', stem: 'MQTT 协议的消息传输基于哪种模式？', options: ['发布/订阅', '请求/响应', '广播/组播', '点对点独占'], answer: 0, analysis: 'MQTT 以 Broker 为中心的发布订阅模型。' },
  { type: 'single', stem: 'NB-IoT 的主要优势不包括？', options: ['超高带宽视频传输', '海量连接', '低功耗', '深度覆盖'], answer: 0, analysis: 'NB-IoT 窄带宽，不适合视频。' },
  { type: 'multiple', stem: '物联网感知层的常用技术包括？', options: ['传感器', 'RFID', '二维码', '光纤骨干网'], answer: [0, 1, 2], analysis: '光纤骨干网属于网络层基础设施。' },
  { type: 'multiple', stem: '下列属于 LPWAN 技术的有？', options: ['LoRa', 'NB-IoT', 'Sigfox', 'Wi-Fi 6'], answer: [0, 1, 2], analysis: 'Wi-Fi 6 属于短距高速，不属 LPWAN。' },
  { type: 'multiple', stem: '物联网平台层通常提供哪些能力？', options: ['设备接入管理', '数据存储与分析', '应用使能/API', '芯片流片制造'], answer: [0, 1, 2], analysis: '芯片制造不属于平台层能力。' },
  { type: 'judge', stem: 'ZigBee 适用于低速率、低功耗的短距离无线传感网络。', options: ['对', '错'], answer: 0, analysis: 'ZigBee 典型特征即低功耗短距。' },
  { type: 'judge', stem: '5G 的 mMTC 场景主要面向海量物联网终端连接。', options: ['对', '错'], answer: 0, analysis: 'mMTC 即海量机器类通信。' },
  { type: 'judge', stem: '所有物联网数据都必须上传云端处理，边缘计算没有意义。', options: ['对', '错'], answer: 1, analysis: '边缘计算可降低时延、节省带宽。' },
  { type: 'fill', stem: '物联网的三层架构是____、____和____。', textAnswer: '感知层|网络层|应用层', analysis: '经典三层模型。' },
  { type: 'fill', stem: 'MQTT 中负责消息中转的服务器称为____。', textAnswer: 'Broker|代理服务器|消息代理', analysis: 'Broker 负责主题路由与分发。' },
  { type: 'short', stem: '简述物联网感知层的主要功能。', textAnswer: '采集物理世界信息（温湿度、位置、图像等），经模数转换与初步处理后上传网络层。', analysis: '抓住“采集+上传”两个要点。' },
  { type: 'short', stem: '列举三种物联网典型行业应用并说明价值。', textAnswer: '如智慧农业（环境监测、精准灌溉）、智能制造（设备预测性维护）、智慧物流（货物追踪）等。', analysis: '开放题，言之成理即可。' },
];

async function main() {
  await connectDB();
  console.log('[seed] 清空旧题库数据...');
  await Promise.all([Question.deleteMany({}), Chapter.deleteMany({}), Exam.deleteMany({ kind: 'system' })]);

  console.log('[seed] 创建章节...');
  const chapters = [];
  for (const c of CHAPTERS) chapters.push(await Chapter.create(c));

  console.log('[seed] 生成示例题...');
  // 每章基于 SAMPLES 生成多道题（题干加章节前缀与序号，保证演示体量）
  let n = 0;
  for (const ch of chapters) {
    for (let i = 0; i < SAMPLES.length; i++) {
      const s = SAMPLES[i];
      n++;
      await Question.create({
        chapterId: ch._id,
        type: s.type,
        stem: `【${ch.name}】${s.stem}`,
        options: s.options || [],
        answer: s.answer ?? null,
        textAnswer: s.textAnswer || '',
        analysis: s.analysis || '',
        score: 2,
        source: 'seed',
      });
    }
  }
  console.log(`[seed] 示例题 ${n} 道已写入`);

  console.log('[seed] 创建演示账号...');
  const pwd = await hashPassword(SEED_PWD);
  const superEmail = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const upsert = async (email, patch) => {
    let u = await User.findOne({ email });
    if (!u) u = await User.create({ email, passwordHash: pwd, ...patch });
    else {
      Object.assign(u, patch);
      u.passwordHash = pwd;
      await u.save();
    }
    return u;
  };
  // 演示 admin 永远不是超管；真正的超管只由 server 启动时的 ensureSuperAdmin 创建/认领
  await upsert('admin@wlbd.cn', { name: '演示管理员', role: 'admin', isSuperAdmin: false });
  await upsert('teacher@wlbd.cn', { name: '班主任李老师', role: 'teacher', isSuperAdmin: false });
  await upsert('student@wlbd.cn', { name: '学员小王', role: 'student', isSuperAdmin: false });
  await upsert('member@wlbd.cn', {
    name: '会员小李',
    role: 'student',
    isSuperAdmin: false,
    isMember: true,
    memberExpireAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
  });
  // 若 ENV 超管邮箱恰好撞上某个演示邮箱（比如配成了 admin@wlbd.cn）：只补 isSuperAdmin，不重置该账号密码以外的演示数据
  if (superEmail) {
    const hit = await User.findOne({ email: superEmail });
    if (hit && !hit.isSuperAdmin) {
      hit.isSuperAdmin = true;
      hit.role = 'admin';
      if (hit.status === 'banned') hit.status = 'active';
      await hit.save();
      console.log(`[seed] ${superEmail} 已标记为超级管理员（密码未动，仍为演示密码）`);
    }
  }

  console.log('[seed] 创建系统模拟卷...');
  const pool = await Question.find({ enabled: true }).lean();
  const pick = sampleArray(pool, Math.min(100, pool.length));
  await Exam.create({
    title: '物联网中级工全真模拟卷（一）',
    desc: '系统固定卷：覆盖全部章节，限时 120 分钟，可重复作答。',
    kind: 'system',
    scope: 'exam',
    status: 'published',
    selectMode: 'fixed',
    totalCount: pick.length,
    durationMin: 120,
    showAnalysis: true,
    items: pick.map((q) => ({
      questionId: q._id, type: q.type, stem: q.stem, options: q.options || [],
      answer: q.answer ?? null, textAnswer: q.textAnswer || '', analysis: q.analysis || '', score: q.score || 2,
    })),
  });
  const pick2 = sampleArray(pool, Math.min(60, pool.length));
  await Exam.create({
    title: '物联网中级工冲刺模拟卷（二）',
    desc: '系统固定卷：精选高频考点，限时 90 分钟。',
    kind: 'system',
    scope: 'exam',
    status: 'published',
    selectMode: 'fixed',
    totalCount: pick2.length,
    durationMin: 90,
    showAnalysis: true,
    items: pick2.map((q) => ({
      questionId: q._id, type: q.type, stem: q.stem, options: q.options || [],
      answer: q.answer ?? null, textAnswer: q.textAnswer || '', analysis: q.analysis || '', score: q.score || 2,
    })),
  });

  console.log('[seed] 完成！');
  console.log(`账号（密码 ${SEED_PWD}）：admin@wlbd.cn / teacher@wlbd.cn / student@wlbd.cn / member@wlbd.cn`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
