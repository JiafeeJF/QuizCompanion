const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});try{
for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/exam-motion-preview.html');
 await page.evaluate(async()=>{const {api}=await import('/src/api.js');const original=api.examAttempts;api.examAttempts=(...args)=>{window.rankRequestedAt=performance.now();return original(...args);};});
 await page.getByRole('button').filter({hasText:'班级综合训练'}).evaluate(el=>{
  const start=performance.now();window.timelineStart=start;window.paperFrames=[];window.finished=null;let node,detailNode,contentNode;
  const frame=()=>{
   const paper=document.querySelector('[data-testid="printing-paper"]'),preview=document.querySelector('[data-testid="paper-preview-content"]'),detail=document.querySelector('[data-testid="exam-detail-paper"]');
   if(paper&&preview&&detail){
    node||=paper;detailNode||=detail;contentNode||=detail.querySelector('.card');
    const s=getComputedStyle(paper),d=getComputedStyle(detail),p=getComputedStyle(preview);
    const inset=s.clipPath.match(/inset\(([^)]+)/)[1].split(/\s+/).slice(0,4).map(parseFloat);
    const matrix=new DOMMatrixReadOnly(p.transform==='none'?undefined:p.transform);
    window.paperFrames.push({ms:performance.now()-start,top:inset[0],height:innerHeight-inset[0]-inset[2],left:inset[3],opacity:s.opacity,surfaceTransform:s.transform,previewScale:matrix.a,same:paper===node&&detail===detailNode&&(!contentNode||detail.querySelector('.card')===contentNode),prepared:!!detail.querySelector('.card')});
    if(detail.getAttribute('aria-hidden')==='false'){window.finished=performance.now()-start;return;}
   }
   if(performance.now()-start<6000)requestAnimationFrame(frame);
  };requestAnimationFrame(frame);el.click();
 });
 await page.waitForTimeout(650);
 // A viewport update must not restart the timeline or replace either surface.
 await page.setViewportSize({width:width+1,height:844});await page.setViewportSize({width,height:844});
 await page.waitForTimeout(1000);
 await page.screenshot({path:`.tmp-stable-paper-${width}.png`});
 await page.waitForFunction(()=>window.finished!==null);
 const result=await page.evaluate(()=>({frames:window.paperFrames,finished:window.finished,rankAt:window.rankRequestedAt-window.timelineStart}));
 const frames=result.frames,near=t=>frames.reduce((a,b)=>Math.abs(a.ms-t)<Math.abs(b.ms-t)?a:b);
 assert.ok(frames[0].height<2,'initial paper is fully inside slot, no full-page flash');
 assert.ok(near(400).height<near(800).height&&near(800).height<near(1100).height,'continuous downward feed');
 assert.ok(Math.abs(near(400).top-near(1100).top)<1,'stationary paper top');
 assert.ok(frames.every(f=>f.same&&f.opacity==='1'&&f.surfaceTransform==='none'),'one persistent opaque surface; no giant surface transform or replacement');
 assert.ok(frames.every(f=>f.previewScale<=1.001),'real detail content never exceeds its normal size');
 assert.ok(frames.some(f=>f.ms<500&&f.prepared),'real detail mounted before reveal');
 assert.ok(result.rankAt<600,'ranking fetch starts before fullscreen handoff');
 assert.ok(near(1300).height>=330,'paper fully printed before pull');
 assert.ok(result.finished>=1800&&result.finished<=2100,`timeline ${result.finished}`);
 assert.equal(await page.getByTestId('route').textContent(),'/exams');assert.deepEqual(errors,[]);
 console.log(`PASS ${width}: ${Math.round(result.finished)}ms, persistent real content, fixed print edge, text scale <=1, detail/ranking preloaded, resize did not restart`);
 await page.getByRole('button',{name:'返回模考列表'}).click();await page.getByRole('dialog').waitFor({state:'detached'});await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
