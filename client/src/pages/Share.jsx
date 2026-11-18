import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../Toast.jsx';
import { TopBar } from '../components/ui.jsx';

export default function Share() {
  const { token } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  React.useEffect(() => {
    (async () => {
      try {
        const { examId } = await api.examShare(token);
        navigate(`/exams/${examId}`, { replace: true });
      } catch (e) {
        toast(e.message, 'error');
        navigate('/exams', { replace: true });
      }
    })();
  }, [token]);

  return (
    <div>
      <TopBar title="打开分享" />
      <p className="px-4 text-[14px] text-sub">正在打开分享的考试…</p>
    </div>
  );
}
