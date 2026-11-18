import React from 'react';
import { motion } from 'framer-motion';
import { TopBar } from '../components/ui.jsx';

const STAGGER = 0.09;
const DUR = 0.5;
const EASE = [0.22, 0.61, 0.36, 1];

function Section({ index, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR, delay: index * STAGGER, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** 使用条款（独立路由 /terms）：扁平文档流，无卡片 */
export default function Terms() {
  return (
    <div>
      <TopBar title="使用条款" />
      <div className="px-6 pb-10">
        <Section index={0}>
          <p className="pt-6 text-[19px] font-semibold text-ink">物联宝典 使用条款</p>
          <p className="mt-1.5 text-[12px] text-faint">最后更新：2026年9月18日</p>
          <p className="mt-4 text-[13.5px] leading-[1.9] text-sub">欢迎使用「物联宝典」（以下简称「本应用」）。请在使用前仔细阅读以下条款。使用本应用即表示您同意本条款。</p>
        </Section>
        <Section index={1}>
          <div className="mt-7 space-y-5 text-[13.5px] leading-[1.9] text-sub">
            <Doc label="服务说明" text="本应用提供物联网中级工相关题库练习、模拟考试、错题本、收藏及班级教学等功能，仅供学习备考使用。" />
            <Doc label="账号责任" text="您应妥善保管账号与密码。因账号泄露、出借或被盗用导致的损失，由您自行承担。" />
            <Doc label="使用规范" text="不得利用本应用从事违法违规活动，不得攻击、干扰服务正常运行，不得批量爬取题库或倒卖内容。" />
            <Doc label="会员与功能" text="部分功能仅对会员开放。会员由管理员开通，具体权限以应用内说明为准。" />
            <Doc label="内容与成绩" text="题库与解析仅供参考，不构成任何考试通过承诺。模拟考试成绩仅用于自我检测。" />
            <Doc label="服务变更" text="我们可能根据需要调整、暂停或终止部分功能，并尽可能提前说明。" />
            <Doc label="免责" text="因网络、设备、不可抗力或第三方原因导致的服务中断或数据异常，在法律允许范围内，本应用不承担责任。" />
            <Doc label="条款更新" text="我们可能更新本条款，更新后继续使用即视为接受修订内容。" />
            <p>如有疑问，可通过应用内反馈或开发者联系方式与我们沟通。</p>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Doc({ label, text }) {
  return (
    <div>
      <p className="font-semibold text-ink">{label}</p>
      <p className="mt-1">{text}</p>
    </div>
  );
}
