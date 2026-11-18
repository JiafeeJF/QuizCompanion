// Run against Vite. Set PLAYWRIGHT_MODULE / BROWSER_EXECUTABLE if not installed locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = process.env.PREVIEW_URL || 'http://127.0.0.1:5173/exam-motion-preview.html';
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    for (const width of [320, 390, 430, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(url);
      const classCard = page.getByRole('button').filter({ hasText: '班级综合训练' });
      await classCard.click();
      await page.getByTestId('printing-paper').waitFor();
      await page.getByTestId('paper-preview-content').getByText('题目', {exact:true}).waitFor();
      const printedText = await page.getByTestId('printing-paper').textContent();
      assert.match(printedText, /题目/); assert.match(printedText, /时长/); assert.match(printedText, /总分/);
      if (width === 390) {
        await page.waitForTimeout(260);
        await page.screenshot({ path: '.tmp-exam-printing-facts.png' });
      }
      const paperBounds = await page.getByTestId('printing-paper').boundingBox();
      assert.ok(paperBounds.x >= 0 && paperBounds.x + paperBounds.width <= width);
      await page.getByText('预览同学甲', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('route').textContent(), '/exams');
      assert.equal(await page.evaluate(() => window.previewCalls.starts), 0);
      assert.equal(await page.locator('[role="tablist"]').count(), 1);
      assert.equal(await page.locator('nav[aria-label="主导航"]').count(), 1);
      assert.equal(await page.evaluate(() => document.getElementById('root').inert), true);
      const bounds = await page.getByRole('dialog').boundingBox();
      assert.equal(bounds.y, 0); assert.equal(bounds.height, 844);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `.tmp-exam-inline-${width}.png`, fullPage: true });
      const listScroll = await page.evaluate(() => window.scrollY);
      await page.getByTestId('exam-detail-scroll').evaluate(el => { el.scrollTop = 500; });
      assert.equal(await page.evaluate(() => window.scrollY), listScroll);
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name: '返回模考列表' }).click();
        if (i === 0) {
          await page.waitForTimeout(70);
          assert.equal(await page.getByRole('button',{name:'取消',exact:true}).count(), 0);
          if (width === 390) await page.screenshot({ path: '.tmp-exam-closing.png' });
        }
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.getElementById('root').inert), false);
        assert.equal(await page.evaluate(() => window.scrollY), listScroll);
        await classCard.click();
        await page.getByRole('button', { name: '开始答题', exact: true }).waitFor();
      }
      await page.getByRole('button', { name: '开始答题', exact: true }).click();
      await page.getByRole('button', { name: '答题卡', exact: true }).waitFor();
      assert.equal(await page.getByTestId('route').textContent(), '/exams');
      assert.equal(await page.getByTestId('printing-paper').count(), 1);
      assert.equal(await page.evaluate(() => window.previewCalls.starts), 1);
      await page.getByRole('button', { name: /传感器/ }).first().click();
      await page.getByText('已答 1/12', { exact: true }).waitFor();
      for (let i = 0; i < 5; i++) {
        await page.getByRole('button', { name: '答题卡', exact: true }).click();
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('dialog', { name: '答题卡', exact: true }).waitFor({ state: 'detached' });
        assert.equal(await page.evaluate(() => document.documentElement.style.overflow), 'hidden');
      }
      await page.getByRole('button', { name: '退出', exact: true }).click();
      await page.getByRole('button', { name: '继续作答', exact: true }).click();
      await page.getByRole('dialog', { name: '确认退出考试？', exact: true }).waitFor({ state: 'detached' });
      await page.getByText('已答 1/12', { exact: true }).waitFor();
      await page.getByRole('button', { name: '退出', exact: true }).click();
      await page.getByRole('button', { name: '确认退出', exact: true }).click();
      await page.getByText('模拟考试', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.previewCalls.abandoned), 1);
      await page.getByRole('button', { name: '删除组卷', exact: true }).click();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('button').filter({ hasText: '401～600' }).click();
      await page.getByRole('button', { name: '开始答题', exact: true }).waitFor();
      assert.equal(await page.getByText('班级排名', { exact: true }).count(), 0);
      assert.equal(await page.getByTestId('route').textContent(), '/exams');
      await page.getByRole('button', { name: '开始答题', exact: true }).click();
      await page.getByRole('button', { name: /传感器/ }).first().click();
      await page.getByRole('button', { name: '答题卡', exact: true }).click();
      await page.getByRole('dialog', { name: '答题卡', exact: true }).getByRole('button', { name: '交卷', exact: true }).click();
      await page.getByText('考试成绩', { exact: true }).waitFor();
      assert.equal(await page.getByTestId('route').textContent(), '/exams');
      assert.equal(await page.getByTestId('printing-paper').count(), 1);
      const submission = await page.evaluate(() => window.previewCalls.submissions[0]);
      assert.equal(submission.id, 'preview-0'); assert.equal(submission.answers[0].questionId, 'q0'); assert.equal(submission.answers[0].answer, 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}: fullscreen overlay, route unchanged, close/restore, rankings, answer/abandon/submit, dialogs, no overflow/errors`);
      await page.close();
    }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await page.goto(url);
    const card = page.getByRole('button').filter({ hasText: '401～600' });
    await card.evaluate(el => { el.click(); el.click(); el.click(); });
    await page.getByRole('button', { name: '开始答题', exact: true }).click();
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: '答题卡', exact: true }).click();
      await page.getByRole('dialog', { name: '答题卡', exact: true }).waitFor();
      await page.evaluate(async () => { const { consumeNativeBack } = await import('/src/utils/nativeBack.js'); consumeNativeBack(); });
      await page.getByRole('dialog', { name: '答题卡', exact: true }).waitFor({ state: 'detached' });
    }
    assert.equal(await page.getByTestId('route').textContent(), '/exams');
    console.log('PASS reduced motion, rapid toggle, native back closes overlay first x8');
    await page.goto(url);
    await page.evaluate(async () => {
      const api = window.previewApi; const original = api.examDetail;
      api.examDetail = async id => { if (id === 'preview-0') await new Promise(r => setTimeout(r, 1300)); return original(id); };
    });
    await page.getByRole('button').filter({hasText:'401～600'}).click();
    await page.getByRole('status',{name:'正在加载试卷'}).waitFor();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'detached'});
    await page.getByRole('button').filter({hasText:'班级综合训练'}).click();
    await page.getByText('预览同学甲', {exact:true}).waitFor();
    await page.waitForTimeout(1500);
    assert.equal(await page.getByRole('dialog').count(),1);
    assert.match(await page.getByRole('dialog').getAttribute('aria-label'),/班级综合训练/);
    await page.getByRole('button',{name:'返回模考列表'}).click();
    await page.getByRole('dialog').waitFor({state:'detached'});
    await page.evaluate(()=>{window.previewApi.examDetail=async()=>{throw new Error('预览断网重试')};});
    await page.getByRole('button').filter({hasText:'401～600'}).click();
    await page.getByText('预览断网重试',{exact:true}).waitFor();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'detached'});
    assert.equal(await page.getByTestId('route').textContent(),'/exams');
    console.log('PASS slow response cannot overwrite another exam, network error can collapse, no navigation');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
