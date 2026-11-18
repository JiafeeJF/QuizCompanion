/** 考试邮件模板：简洁正式、纯内联样式、无 JS，兼容 QQ/163/Gmail/Outlook */
function shell(inner) {
  return `<div style="font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
  <div style="background:#111827;padding:20px 24px;color:#ffffff;">
    <div style="font-size:17px;font-weight:700;">物联宝典</div>
    <div style="font-size:12px;color:#9ca3af;margin-top:2px;">班级考试通知</div>
  </div>
  <div style="padding:24px;">${inner}</div>
  <div style="padding:16px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;line-height:1.8;">
    本邮件由物联宝典自动发送，请勿直接回复。如有疑问请联系任课教师。
  </div>
</div>`;
}

function kvRow(k, v) {
  return `<tr><td style="padding:6px 0;color:#6b7280;font-size:14px;width:110px;">${k}</td><td style="padding:6px 0;color:#111827;font-size:14px;">${v}</td></tr>`;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 学生考试通知：只含考试信息 + 进入考试链接（相对路径，登录后跳转），不含答案/JWT/内部 ID 裸参
 */
export function buildExamPublishedMail({ examTitle, teacherName, className, desc, durationMin, totalCount, totalScore, deadlineAt, examUrl }) {
  const text = `您好，您所在的 ${className} 有一场新的考试《${examTitle}》，请在规定时间内完成。截止：${fmtTime(deadlineAt)}。进入考试：${examUrl}（已安装 APP 会尝试打开 APP，未安装则自动进入网页版）。`;
  const html = shell(`
    <p style="color:#111827;font-size:15px;line-height:1.9;margin:0 0 12px;">您好，您所在的 <b>${esc(className)}</b> 有一场新的考试，请在规定时间内完成。</p>
    <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;">${[
      kvRow('考试名称', esc(examTitle)),
      kvRow('任课教师', esc(teacherName)),
      kvRow('考试时长', `${durationMin} 分钟`),
      kvRow('题目数量', `${totalCount} 题`),
      kvRow('总分', `${totalScore} 分`),
      kvRow('截止时间', fmtTime(deadlineAt)),
      desc ? kvRow('考试说明', esc(desc)) : '',
    ].join('')}</table>
    <a href="${esc(examUrl)}" style="display:block;text-align:center;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:13px 0;border-radius:10px;">进入考试</a>
    <p style="color:#9ca3af;font-size:12px;margin:12px 0 0;">已安装 APP 的手机点击会尝试打开 APP；未安装则自动在浏览器中打开网页版，登录后进入同一考试。</p>
  `);
  return { subject: `【物联宝典】您有一场新的考试待完成：《${examTitle}》`, text, html };
}

/** 教师截止总结：基本信息 + 参与情况 + 成绩统计 + 排名（仅发给创建教师，不发学生） */
export function buildExamSummaryMail({ examTitle, className, teacherName, publishedAt, deadlineAt, durationMin, totalCount, totalScore, totalStudents, submitted, doing, absent, submitRate, avg, max, min, avgAccuracy, passCount, passRate, passLine, ranking }) {
  const rows = (ranking || []).slice(0, 50).map((r) => `
    <tr>
      <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;">${r.rank}</td>
      <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;">${esc(r.name)}${r.submitted ? '' : '（未提交）'}</td>
      <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;color:#111827;font-size:13px;text-align:right;">${r.score} 分</td>
      <td style="padding:7px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:13px;text-align:right;">${r.accuracy}%</td>
    </tr>`).join('');
  const text = `《${examTitle}》已截止：班级 ${totalStudents} 人，已提交 ${submitted} 人，进行中 ${doing} 人，未参加 ${absent} 人，完成率 ${submitRate}%。平均 ${avg}，最高 ${max}，最低 ${min}，及格 ${passCount} 人（${passRate}）。`;
  const html = shell(`
    <p style="color:#111827;font-size:15px;font-weight:700;margin:0 0 4px;">《${esc(examTitle)}》考试总结</p>
    <p style="color:#6b7280;font-size:13px;margin:0 0 12px;">${esc(className)} · 任课教师 ${esc(teacherName)}</p>
    <table style="width:100%;border-collapse:collapse;margin:4px 0 8px;">${[
      kvRow('发布时间', fmtTime(publishedAt)),
      kvRow('截止时间', fmtTime(deadlineAt)),
      kvRow('考试时长', `${durationMin} 分钟`),
      kvRow('总题数 / 总分', `${totalCount} 题 / ${totalScore} 分`),
      kvRow('班级人数', `${totalStudents} 人`),
      kvRow('已提交', `${submitted} 人`),
      kvRow('进行中', `${doing} 人`),
      kvRow('未参加', `${absent} 人`),
      kvRow('完成率', submitRate),
      kvRow('平均分', avg),
      kvRow('最高 / 最低', `${max} / ${min}`),
      kvRow('平均正确率', avgAccuracy),
      kvRow(`及格（≥${passLine}）`, `${passCount} 人 · ${passRate}`),
    ].join('')}</table>
    <p style="color:#111827;font-size:14px;font-weight:700;margin:12px 0 4px;">学生排名</p>
    <table style="width:100%;border-collapse:collapse;">${rows || '<tr><td style="color:#9ca3af;font-size:13px;">暂无作答数据</td></tr>'}</table>
  `);
  return { subject: `【物联宝典】考试总结：《${examTitle}》已截止`, text, html };
}

export function buildExamDeadlineRemindMail({ examTitle, deadlineAt, examUrl }) {
  const text = `提醒：《${examTitle}》即将截止（${fmtTime(deadlineAt)}），你尚未交卷，请尽快完成。进入考试：${examUrl}`;
  const html = shell(`<p style="color:#111827;font-size:15px;">你好，你的考试 <b>${esc(examTitle)}</b> 即将截止（${fmtTime(deadlineAt)}），你尚未交卷。</p><a href="${esc(examUrl)}" style="display:block;text-align:center;background:#111827;color:#fff;text-decoration:none;padding:13px 0;border-radius:10px;">立即去交卷</a>`);
  return { subject: `【物联宝典】考试截止提醒：《${examTitle}》`, text, html };
}
