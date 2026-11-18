const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5173/exam-motion-preview.html');
    await page.evaluate(async()=>{
      const api=window.previewApi;
      for(const key of ['startExam','examResult']) {
        const original=api[key];
        api[key]=async(...args)=>{await new Promise(r=>setTimeout(r,650));return original(...args);};
      }
    });
    await page.getByRole('button').filter({hasText:'401～600'}).click();
    await page.getByTestId('exam-detail-paper').filter({has:page.getByRole('button',{name:'查看上次成绩'})}).waitFor();
    await page.getByRole('button',{name:'查看上次成绩'}).waitFor();
    await page.waitForFunction(()=>document.querySelector('[data-testid="exam-detail-paper"]')?.getAttribute('aria-hidden')==='false');
    await page.evaluate(()=>{
      window.flowSurface=document.querySelector('[data-testid="printing-paper"]');
      window.flowFrames=[]; window.flowRunning=true;
      function check(){
        if(!window.flowRunning)return;
        const node=document.querySelector('[data-testid="printing-paper"]');
        const bottom=document.elementFromPoint(innerWidth/2,innerHeight-10);
        const modal=bottom?.closest('[role="dialog"], .safefullscreen');
        window.flowFrames.push({ok:node===window.flowSurface&&(node.contains(bottom)||!!modal),same:node===window.flowSurface,bottom:bottom?.outerHTML.slice(0,180)});
        requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    });
    await page.getByRole('button',{name:'查看上次成绩'}).click();
    await page.getByText('考试成绩',{exact:true}).waitFor();
    await page.getByRole('button',{name:'再考一次'}).click();
    await page.getByRole('button',{name:'答题卡',exact:true}).waitFor();
    await page.evaluate(async()=>{const {consumeNativeBack}=await import('/src/utils/nativeBack.js');consumeNativeBack();});
    await page.getByRole('button',{name:'继续作答'}).click();
    await page.getByRole('dialog',{name:'确认退出考试？',exact:true}).waitFor({state:'detached'});
    await page.getByRole('button',{name:/交卷（已答/}).click();
    await page.getByText('考试成绩',{exact:true}).waitFor();
    await page.screenshot({path:'.tmp-exam-fullscreen-result.png'});
    const frames=await page.evaluate(()=>{window.flowRunning=false;return window.flowFrames;});
    assert.ok(frames.length>50&&frames.every(f=>f.ok),JSON.stringify({count:frames.length,bad:frames.filter(f=>!f.ok).slice(0,5)}));
    assert.equal(await page.getByTestId('route').textContent(),'/exams');
    assert.equal(await page.evaluate(()=>window.previewCalls.starts),1);
    await page.getByRole('button',{name:'返回列表'}).click();
    await page.getByTestId('printing-paper').waitFor({state:'detached'});
    assert.equal(await page.locator('nav[aria-label="主导航"]').getAttribute('aria-hidden'),'false');
    assert.equal(await page.evaluate(()=>document.getElementById('root').inert),false);
    assert.deepEqual(errors,[]);
    console.log(`PASS ${frames.length} frames: last result → retry → native back confirmation → submit → result stays fullscreen; list restores navigation`);
    await page.goto('http://127.0.0.1:5173/exam-motion-preview.html?entry=/exams/preview-0');
    await page.getByRole('button',{name:'开始答题',exact:true}).waitFor();
    assert.equal(await page.getByTestId('printing-paper').count(),1);
    assert.equal(await page.getByTestId('route').textContent(),'/exams');
    await page.getByRole('button',{name:'开始答题',exact:true}).click();
    await page.getByRole('button',{name:'答题卡',exact:true}).waitFor();
    assert.equal(await page.getByTestId('printing-paper').count(),1);
    assert.equal(await page.evaluate(()=>window.previewCalls.starts),1);
    assert.deepEqual(errors,[]);
    console.log('PASS native/notification direct link opens the same printed fullscreen flow');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
