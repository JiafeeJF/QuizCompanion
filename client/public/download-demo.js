// Decorative, isolated UI mirror. No routes, storage, authentication or API calls.
export function mountDownloadDemo(host) {
  if (!host) return () => {};
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('inert', '');
  const card = (body, extra = '') => `<div class="wd-card ${extra}">${body}</div>`;
  const row = (title, subtitle, key) => `<div class="wd-row" ${key ? `data-target="${key}"` : ''}><div><b>${title}</b><small>${subtitle}</small></div><span>›</span></div>`;
  const tabs = '<div class="wd-tabs"><b>继续 / 顺序随机</b><b class="wd-active">章节练习</b></div>';
  const question = (second = false) => card(`<div class="wd-meta"><span>单选</span><span data-counter>${second ? '2' : '1'} / 20</span></div><h3>${second ? '物联网中，传感器主要承担什么作用？' : '物联网的基本特征是什么？'}</h3><div class="wd-options">${(second ? ['感知与采集信息', '仅存储历史数据', '替代通信网络', '显示网页内容'] : ['全面感知、可靠传输、智能处理', '仅依靠人工记录数据', '只支持本地设备通信', '不需要传感器采集']).map((s, i) => `<div class="wd-option" data-target="answer-${i}"><i>${'ABCD'[i]}</i>${s}</div>`).join('')}</div><div class="wd-feedback">回答正确 · 继续保持</div>`, 'wd-question');
  const screens = {
    home: `<small>下午好</small><h2>继续加油</h2>${card('<div class="wd-row"><div><b>继续练习</b><small>顺序刷题 · 已做 713 / 1200</small></div><strong data-target="continue">继续</strong></div><div class="wd-progress"><i></i></div>')}<div class="wd-grid">${card('<b>顺序刷题</b><small>按题库顺序</small>')}${card('<b>随机刷题</b><small>随机抽题</small>')}${card('<b>章节练习</b><small>按章节突破</small>', 'wd-chapter')}${card('<b>模拟考试</b><small>全真组卷</small>')}</div><h3>学习进度</h3><div class="wd-stats"><div><b>716</b><small>累计答题</small></div><div><b>88%</b><small>正确率</small></div><div><b>20</b><small>错题</small></div></div>${card(row('错题本', '20 道待巩固') + row('收藏', '重点题目随时回顾'))}`,
    chapters: `${tabs}<div class="wd-scroll-content">${card(row('物联网基础', '已完成 60 / 200 题') + row('感知与识别技术', '已完成 42 / 200 题') + row('网络与通信技术', '已完成 28 / 200 题', 'chapter') + row('数据处理与应用', '共 200 题') + row('设备安装与调试', '共 200 题') + row('安全与维护', '共 200 题'))}</div>`,
    loading: '<div class="wd-loading"><i></i><small>正在准备题目</small></div>',
    question: question(),
    next: question(true),
    exam: '<div class="wd-tabs"><b class="wd-active">全部</b><b>系统卷</b><b>班级</b><b>我的</b></div>' + card(row('物联网中级工模拟考试', '200 题 · 120 分钟', 'exam') + '<div class="wd-meta"><span>系统卷</span><span>已考 92 分</span></div>') + card(row('章节综合测试', '100 题 · 60 分钟') + '<div class="wd-meta"><span>系统卷</span><span>已考 88 分</span></div>'),
    result: card('<small>本次成绩</small><div class="wd-score">92<small>分</small></div><div class="wd-stats"><div><b>184 / 200</b><small>答对</small></div><div><b>92%</b><small>正确率</small></div><div><b>36分18秒</b><small>用时</small></div></div><div class="wd-progress"><i style="width:92%"></i></div><small>每一次练习，都在进步</small>'),
    bank: card('<div class="wd-meta"><span>网络与通信技术</span><span>错 1 次</span></div><h3 data-target="review">物联网中的感知层负责什么？</h3><small>展开查看解析 ›</small><div class="wd-explanation">正确答案：信息采集与感知。<br/>感知层通过传感器识别和采集环境信息。</div>') + card(row('无线传感器网络的组成', '感知与识别技术')),
    favorites: card(row('物联网的基本特征是什么？', '物联网基础 · 单选')) + card(row('传感器主要承担什么作用？', '感知与识别技术 · 单选')) + '<small>共 2 道收藏题目</small>',
  };
  host.innerHTML = `<div class="wd-stage"><div class="wd-app"><div class="wd-status"><span>9:41</span><span>••• ▰</span></div><div class="wd-heading">物联宝典</div><div class="wd-viewport">${Object.entries(screens).map(([name, html]) => `<div class="wd-screen" data-screen="${name}" ${name === 'home' ? '' : 'hidden'}>${html}</div>`).join('')}</div><div class="wd-nav"><span data-target="home" class="wd-active">首页</span><span data-target="practice">刷题</span><span data-target="exams">模考</span><span data-target="mine">我的</span></div><div class="wd-home-indicator"></div><div class="wd-sheet" hidden><b>答题卡</b><small>已答 2 / 20 题</small><div>${Array.from({ length: 20 }, (_, i) => `<i class="${i < 2 ? 'wd-done' : ''}">${i + 1}</i>`).join('')}</div></div><div class="wd-touch"><i></i></div></div></div><div class="wd-veil"></div>`;
  const app = host.querySelector('.wd-app');
  const touch = host.querySelector('.wd-touch');
  const sheet = host.querySelector('.wd-sheet');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 700px)');
  const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 2 || navigator.connection?.saveData;
  let current = 'home', elapsed = 0, previous = 0, timer = 0, nextEvent = 0, disposed = false;
  const animation = (el, frames, duration = 420) => {
    if (!el || reduced.matches || disposed) return;
    const a = el.animate(frames, { duration: lowPower ? Math.min(duration, 240) : duration, easing: 'cubic-bezier(.22,1,.36,1)' });
    a.onfinish = () => a.cancel();
  };
  function show(name, title, nav = 'practice') {
    if (name !== current) {
      host.querySelector(`[data-screen="${current}"]`).hidden = true;
      const screen = host.querySelector(`[data-screen="${name}"]`);
      screen.hidden = false;
      animation(screen, [{ opacity: .6, transform: `translateX(${mobile.matches ? 8 : 18}px)` }, { opacity: 1, transform: 'translateX(0)' }]);
      current = name;
    }
    host.querySelector('.wd-heading').textContent = title;
    host.querySelectorAll('.wd-nav span').forEach(el => el.classList.toggle('wd-active', el.dataset.target === nav));
  }
  function tap(selector) {
    const target = host.querySelector(`[data-screen="${current}"] ${selector}`) || host.querySelector(selector);
    if (!target) return;
    const rect = target.getBoundingClientRect(), frame = app.getBoundingClientRect();
    touch.style.transform = `translate(${(rect.left + rect.width / 2 - frame.left) * app.offsetWidth / frame.width}px,${(rect.top + rect.height / 2 - frame.top) * app.offsetHeight / frame.height}px)`;
    animation(touch, [{ opacity: 0 }, { opacity: .65, offset: .35 }, { opacity: 0 }], 1000);
    animation(touch.firstElementChild, [{ transform: 'scale(.65)', opacity: .6 }, { transform: 'scale(1.8)', opacity: 0 }], 950);
    animation(target, [{ transform: 'scale(1)' }, { transform: 'scale(.975)', offset: .55 }, { transform: 'scale(1)' }], 700);
  }
  function answer() {
    const screen = host.querySelector(`[data-screen="${current}"]`);
    screen.classList.add('wd-answered');
  }
  const events = [
    [2200, () => tap('[data-target="practice"]')],
    [3000, () => show('chapters', '刷题')],
    [4800, () => { tap('[data-target="chapter"]'); const list = host.querySelector('.wd-scroll-content'); list.style.transform = 'translateY(-64px)'; }],
    [6900, () => tap('[data-target="chapter"]')],
    [7800, () => show('loading', '章节练习')],
    [8900, () => show('question', '章节练习')],
    [11200, () => tap('[data-target="answer-0"]')],
    [11900, answer],
    [14700, () => show('next', '章节练习')],
    [16300, () => tap('[data-target="answer-0"]')],
    [17000, answer],
    [18800, () => { tap('[data-counter]'); sheet.hidden = false; animation(sheet, [{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], 600); }],
    [21300, () => { sheet.hidden = true; tap('[data-target="exams"]'); }],
    [22100, () => show('exam', '模拟考试', 'exams')],
    [24200, () => tap('[data-target="exam"]')],
    [25000, () => show('result', '考试成绩', 'exams')],
    [28200, () => show('bank', '错题本', 'mine')],
    [29600, () => tap('[data-target="review"]')],
    [30300, () => host.querySelector('.wd-explanation').classList.add('wd-open')],
    [32300, () => show('favorites', '我的收藏', 'mine')],
    [34800, () => tap('[data-target="home"]')],
    [35600, () => show('home', '物联宝典', 'home')],
  ];
  function tick() {
    const now = performance.now();
    elapsed += now - previous;
    previous = now;
    while (nextEvent < events.length && elapsed >= events[nextEvent][0]) events[nextEvent++][1]();
    if (elapsed >= 38000) {
      elapsed %= 38000;
      nextEvent = 0;
      host.querySelectorAll('.wd-answered').forEach(el => el.classList.remove('wd-answered'));
      host.querySelector('.wd-scroll-content').style.transform = '';
      host.querySelector('.wd-explanation').classList.remove('wd-open');
    }
    timer = window.setTimeout(tick, lowPower ? 220 : 100);
  }
  function resume() {
    clearTimeout(timer);
    const pause = document.hidden || reduced.matches;
    host.classList.toggle('wd-paused', pause);
    host.classList.toggle('wd-lite', lowPower || mobile.matches);
    host.getAnimations({ subtree: true }).forEach(a => pause ? a.pause() : a.play());
    if (!pause && !disposed) { previous = performance.now(); timer = window.setTimeout(tick, 100); }
  }
  document.addEventListener('visibilitychange', resume);
  reduced.addEventListener('change', resume);
  mobile.addEventListener('change', resume);
  resume();
  return () => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', resume);
    reduced.removeEventListener('change', resume);
    mobile.removeEventListener('change', resume);
    host.getAnimations({ subtree: true }).forEach(a => a.cancel());
    host.replaceChildren();
  };
}
