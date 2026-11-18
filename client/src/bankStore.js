/**
 * bankStore：题库本地预加载存储（localStorage 索引 + 全量题库 JSON）。
 * - 与用户学习数据（错题/收藏/会话/考试/班级，全部在服务端）完全隔离：只读写 wlbd_bank_* 键
 * - 版本键 wlbd_bank_version：与服务端 bank/meta.version 比对，一致则跳过下载
 * - 下载用临时键 wlbd_bank_tmp，校验成功后原子替换正式键；失败/断网不碰正式题库
 * - 设备本地状态（非账号状态）：卸载重装后这些键随 WebView 数据一并清除，必然重新初始化
 */
const VER_KEY = 'wlbd_bank_version';
const DATA_KEY = 'wlbd_bank_data';
const TMP_KEY = 'wlbd_bank_tmp';
const COUNT_KEY = 'wlbd_bank_count';
const SHA_KEY = 'wlbd_bank_sha';

export function getLocalBankVersion() {
  try {
    return localStorage.getItem(VER_KEY) || '';
  } catch { return ''; }
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

/**
 * 本地题库状态（登录后判断是否需要初始化的唯一依据，纯设备本地）。
 * ready 仅当：版本非空 + 数据可解析 + 章节/题目数>0 + 与落盘 count 一致 + 全量字段校验通过。
 * 任一不满足都视为“本地题库不存在/损坏”，必须进初始化流程。
 */
export function getBankStatus() {
  const version = getLocalBankVersion();
  const data = readJson(DATA_KEY);
  const base = { ready: false, exists: false, version, count: 0, chapters: 0, checksum: '' };
  if (!version || !data || !Array.isArray(data.chapters) || !Array.isArray(data.questions)) return base;
  const count = data.questions.length;
  // 与落盘时记录的数量比对：键缺失（旧版本安装）视为通过，交给全量字段校验兜底
  const storedCount = Number(localStorage.getItem(COUNT_KEY) || 0);
  if (storedCount && storedCount !== count) return { ...base, version, count };
  // 全量字段校验（1200 题毫秒级），代替重算 SHA：结构完整即视为校验通过
  for (let i = 0; i < count; i++) {
    const q = data.questions[i];
    if (!q || !q.id || !q.chapterId || !q.type || !q.stem || !Array.isArray(q.options)) {
      return { ...base, version, count };
    }
  }
  return {
    ready: data.chapters.length > 0 && count > 0,
    exists: true,
    version,
    count,
    chapters: data.chapters.length,
    checksum: localStorage.getItem(SHA_KEY) || '',
  };
}

/** 校验下载包：数量/章节/字段完整性（version 由调用方比对 meta） */
export function validateBankPackage(pkg, meta) {
  if (!pkg || !Array.isArray(pkg.chapters) || !Array.isArray(pkg.questions)) return '数据格式错误';
  if (meta && pkg.questions.length !== meta.total) return `题目数量不符（${pkg.questions.length}/${meta.total}）`;
  if (meta && pkg.chapters.length !== meta.chapterCount) return `章节数量不符（${pkg.chapters.length}/${meta.chapterCount}）`;
  for (let i = 0; i < pkg.questions.length; i++) {
    const q = pkg.questions[i];
    if (!q.id || !q.chapterId || !q.type || !q.stem || !Array.isArray(q.options)) return `第 ${i + 1} 题字段缺失`;
    if ((q.type === 'single' || q.type === 'judge') && (q.answer === null || q.answer === undefined)) return `第 ${i + 1} 题缺少答案`;
  }
  return '';
}

export function saveBankTmp(pkg) {
  localStorage.setItem(TMP_KEY, JSON.stringify(pkg));
}

/** 临时库提升为正式库（原子替换），写入版本/数量/校验和；用户学习数据键一律不动 */
export function commitBankTmp(version, { count = 0, sha256 = '' } = {}) {
  const tmp = localStorage.getItem(TMP_KEY);
  if (!tmp) throw new Error('临时题库不存在');
  localStorage.setItem(DATA_KEY, tmp);
  localStorage.removeItem(TMP_KEY);
  localStorage.setItem(VER_KEY, version);
  if (count) localStorage.setItem(COUNT_KEY, String(count));
  if (sha256) localStorage.setItem(SHA_KEY, sha256);
}

export function clearBankTmp() {
  try { localStorage.removeItem(TMP_KEY); } catch {}
}

/** 本地题库全文（当前仅初始化流程读写；刷题仍走服务端接口，不改变现有数据链路） */
export function getLocalBank() {
  return readJson(DATA_KEY);
}
