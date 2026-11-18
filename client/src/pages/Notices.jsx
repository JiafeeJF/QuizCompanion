import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar } from '../components/ui.jsx';
import { PageLoading, Empty } from '../components/guards.jsx';
import { useAnnouncements } from '../announcements.jsx';

const STAGGER = 0.06;
const DUR = 0.45;
const EASE = [0.22, 0.61, 0.36, 1];

function fmtTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * 公告列表页（/notices）：与首页弹窗共用同一套数据
 * - 进页压住首页弹窗（enterList），离开恢复（leaveList）
 * - 点单条 → 详情页；详情页打开即标已读
 */
export function Notices() {
  const navigate = useNavigate();
  const toast = useToast();
  const { enterList, leaveList, listStamp, refresh } = useAnnouncements();
  const [list, setList] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { list: l } = await enterList().catch(() => ({ list: [] }));
      if (alive) setList(l || []);
    })();
    return () => { leaveList(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 从详情页返回/标已读后刷新
  useEffect(() => {
    if (list === null) return;
    refresh().then(({ list: l }) => setList(l || [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listStamp]);

  if (list === null) return <PageLoading />;
  return (
    <div>
      <TopBar title="公告" />
      <div className="space-y-2.5 px-4 pb-6">
        {list.length === 0 && <Empty text="暂无公告" />}
        {list.map((a, i) => (
          <motion.button
            key={a._id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR, delay: Math.min(i * STAGGER, 0.3), ease: EASE }}
            onClick={() => navigate(`/notices/${a._id}`)}
            className="card block w-full p-4 text-left"
          >
            <div className="flex items-center gap-2">
              {!a.read && <span className="h-2 w-2 shrink-0 rounded-full bg-bad" />}
              <span className="ml-auto shrink-0 text-[12px] text-faint">{fmtTime(a.createdAt)}</span>
            </div>
            <p className={`mt-1.5 truncate text-[15px] ${a.read ? 'font-medium text-sub' : 'font-bold text-ink'}`}>{a.title}</p>
            <p className="mt-0.5 line-clamp-1 text-[13px] text-faint">{String(a.content || '').split('\n')[0]}</p>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

/** 公告详情页（/notices/:id）：打开即标已读，返回列表不再红点 */
export function NoticeDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { enterList, leaveList, bumpList } = useAnnouncements();
  const [a, setA] = useState(null);

  useEffect(() => {
    let alive = true;
    enterList().catch(() => {});
    api.announcementDetail(id)
      .then(({ announcement }) => {
        if (!alive) return;
        setA(announcement);
        // 打开即已读：静默标已读 + 刷新列表红点
        api.announcementRead(id).then(() => bumpList()).catch(() => {});
      })
      .catch((e) => { if (alive) { toast(e.message, 'error'); setA(false); } });
    return () => { leaveList(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (a === null) return <PageLoading />;
  if (a === false) return (<div><TopBar title="公告详情" /><Empty text="公告不存在或已过期" /></div>);
  return (
    <div>
      <TopBar title="公告详情" />
      <div className="px-4 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR, ease: EASE }}
          className="card p-5"
        >
          <p className="text-[17px] font-bold leading-snug text-ink">{a.title}</p>
          <p className="mt-1.5 text-[12px] text-faint">{fmtTime(a.createdAt)}</p>
          <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-sub">{a.content}</p>
        </motion.div>
      </div>
    </div>
  );
}
