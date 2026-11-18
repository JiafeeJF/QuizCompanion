import bcrypt from 'bcryptjs';
import { User } from './models/User.js';

/** 客观题判分：单选/判断/多选。fill/short 不自动判（correct=false，需人工/仅展示答案） */
export function gradeAnswer(question, userAnswer) {
  const type = question.type;
  if (type === 'single' || type === 'judge') {
    const a = Number(userAnswer);
    return Number.isFinite(a) && a === Number(question.answer);
  }
  if (type === 'multiple') {
    const ua = (Array.isArray(userAnswer) ? userAnswer : []).map(Number).sort((x, y) => x - y);
    const ra = (Array.isArray(question.answer) ? question.answer : []).map(Number).sort((x, y) => x - y);
    return ua.length === ra.length && ua.every((v, i) => v === ra[i]);
  }
  return false;
}

export async function hashPassword(password) {
  return bcrypt.hash(String(password), 10);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(String(password || ''), hash || '');
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

export function validPassword(password) {
  // 注册/改密：至少 6 位（考证类应用降低门槛，强调可用性）
  return String(password || '').length >= 6;
}

export async function findUserByEmail(email) {
  return User.findOne({ email: String(email || '').trim().toLowerCase() });
}

/** Fisher-Yates 洗牌抽样（不改变原数组） */
export function sampleArray(arr, n) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, Math.min(n, a.length)));
}

export function genCode(len = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function genToken(len = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
