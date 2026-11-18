import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** Notifications and native deep links use the same list-owned exam surface. */
export default function ExamEntry() {
  const { id } = useParams();
  return <Navigate to="/exams" replace state={{ openExamId: id }} />;
}
