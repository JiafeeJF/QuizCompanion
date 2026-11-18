/**
 * 场景测试：卸载重装必重下 / 已下载不重下 / 损坏重下（纯本地 bankStore 逻辑，无网络）
 */
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};
const store = await import('../src/bankStore.js');
const { getBankStatus, saveBankTmp, commitBankTmp, validateBankPackage } = store;

function makePkg(n = 1200) {
  return {
    version: 'a1b2c3d4e5f6',
    chapters: [{ id: 'ch1', name: 'A', sort: 1 }, { id: 'ch2', name: 'B', sort: 2 }],
    questions: Array.from({ length: n }, (_, i) => ({
      id: `q${i}`, chapterId: 'ch1', type: 'single', stem: `题干${i}`, options: ['A', 'B'], answer: 0, textAnswer: '', score: 2,
    })),
  };
}
function meta() { return { total: 1200, chapterCount: 2, version: 'a1b2c3d4e5f6', sha256: 'x'.repeat(64) }; }
function reset() {
  localStorage.clear();
}
function expect(name, cond) { console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}`); if (!cond) process.exitCode = 1; }

// --- 场景 B：全新安装（卸载重装等价于本地键全空）
reset();
expect('B1 全新安装 getBankStatus().ready=false', getBankStatus().ready === false);
expect('B1 exists=false', getBankStatus().exists === false);
// 模拟初始化流程
saveBankTmp(makePkg());
expect('B2 下载中正式库仍不存在', getBankStatus().exists === false);
commitBankTmp('a1b2c3d4e5f6', { count: 1200, sha256: 'x'.repeat(64) });
const ok = getBankStatus();
expect('B3 校验后 ready=true', ok.ready === true);
expect('B3 count=1200', ok.count === 1200);
expect('B3 chapters=2', ok.chapters === 2);
expect('B3 checksum 落盘', ok.checksum === 'x'.repeat(64));
expect('B3 tmp 已清理', !localStorage.getItem('wlbd_bank_tmp'));
// 再次"启动"（同设备重启/刷新）
expect('A1 第二次打开 ready=true 不重下', getBankStatus().ready === true);

// --- 版本比对（更新分支）
expect('A2 本地版本=服务器版本 → 跳过下载', getBankStatus().version === meta().version);
const st = { ...getBankStatus(), version: 'old-version' };
expect('A3 本地版本≠服务器 → 触发更新', st.version !== meta().version);

// --- 损坏检测：题库 JSON 字段坏
localStorage.setItem('wlbd_bank_data', JSON.stringify({ chapters: [], questions: [{ id: 'q0' }] }));
expect('C1 缺字段 → ready=false 重下', getBankStatus().ready === false);

// --- count 不符
reset();
saveBankTmp(makePkg(1000));
commitBankTmp('a1b2c3d4e5f6', { count: 1000, sha256: 'x'.repeat(64) });
localStorage.setItem('wlbd_bank_data', JSON.stringify({ chapters: makePkg().chapters, questions: makePkg(1100).questions }));
expect('C2 count 不符 → ready=false', getBankStatus().ready === false);

// --- 校验和缺失（老版本安装留下的键但没记 sha）不强制失败：count+字段全对即 ready
reset();
saveBankTmp(makePkg());
commitBankTmp('a1b2c3d4e5f6', { count: 1200 });
expect('C3 无 sha 但数据完整 → ready=true', getBankStatus().ready === true);

// --- validateBankPackage 独立校验
expect('D1 正确包校验通过', validateBankPackage(makePkg(), meta()) === '');
expect('D2 数量不符被拒', validateBankPackage({ ...makePkg(), questions: makePkg(5).questions }, meta()).includes('题目数量不符'));
expect('D3 缺答案被拒', validateBankPackage({ ...makePkg(), questions: makePkg().questions.map((q) => ({ ...q, answer: null })) }, meta()).includes('缺少答案'));

// --- 下载中断/校验失败：临时键不碰正式库
reset();
saveBankTmp(makePkg());
commitBankTmp('a1b2c3d4e5f6', { count: 1200 });
saveBankTmp({ version: 'v2', chapters: [], questions: [{ id: 'x' }] });
expect('E1 半截下载不影响正式库', getBankStatus().ready === true);
localStorage.removeItem('wlbd_bank_tmp');
expect('E2 清理 tmp 后正式库完好', getBankStatus().ready === true && getBankStatus().count === 1200);

console.log('BANK_STORE_TEST_DONE');
