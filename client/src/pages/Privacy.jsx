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

/** 隐私政策（独立路由 /privacy）：扁平文档流，无卡片 */
export default function Privacy() {
  return (
    <div>
      <TopBar title="隐私政策" />
      <div className="px-6 pb-10">
        <Section index={0}>
          <p className="pt-6 text-[19px] font-semibold text-ink">物联宝典 隐私政策</p>
          <p className="mt-1.5 text-[12px] text-faint">最后更新：2026年9月18日</p>
          <p className="mt-4 text-[13.5px] leading-[1.9] text-sub">本政策说明我们如何收集、使用与保护您的信息。</p>
        </Section>
        <Section index={1}>
          <div className="mt-7 space-y-5 text-[13.5px] leading-[1.9] text-sub">
            <Doc label="我们收集的信息" text="账号信息：邮箱、密码（加密存储）、昵称等；学习数据：答题记录、错题、收藏、考试成绩、练习进度；设备与日志：基本设备信息、操作日志、用于安全与故障排查；您主动提交的内容：工单反馈、截图等。" />
            <Doc label="信息使用目的" text="提供刷题、考试、班级、会员等核心功能；改进产品体验与安全性；响应您的反馈与客服需求；在获得同意或法律要求的情况下用于其他必要用途。" />
            <Doc label="信息存储与安全" text="密码采用加密存储；采取合理技术措施防止未授权访问、泄露或篡改；数据主要存储于服务端数据库，保留期限与业务需要相关。" />
            <Doc label="信息共享" text="不会出售您的个人信息；仅在必要时与提供基础设施的服务商（如服务器、邮件）共享，且要求其保护数据；依法配合有权机关的合法要求。" />
            <Doc label="您的权利" text="可查询、更正账号信息（如修改邮箱、密码）；可通过工单或联系开发者申请删除账号相关数据（在合法范围内处理）。" />
            <Doc label="未成年人" text="若您为未成年人，请在监护人指导下使用，并确保已获得同意。" />
            <Doc label="政策更新" text="我们可能适时更新本政策，更新后会在应用内展示。继续使用即表示知悉相关变更。" />
            <p>如对隐私有任何疑问，请通过应用内反馈渠道联系我们。</p>
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
