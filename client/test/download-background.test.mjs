import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';

// Run with Playwright installed, or WLBD_PLAYWRIGHT_PATH pointing to its ESM entry.
let chromium;
try { ({ chromium } = await import(process.env.WLBD_PLAYWRIGHT_PATH || 'playwright')); } catch {}

test('generative background preserves downloads and handles GPU fallback and lifecycle', { skip: !chromium }, async () => {
  let downloads = 0;
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push(req.url);
    if (req.url === '/api/app/version') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ version: '1.6.6', size: 25000000, updatedAt: '2026-10-07', notes: '测试版本说明', downloadPath: '/downloads/demo.apk' }));
    } else if (req.url === '/api/app/version/download-count') {
      downloads++;
      res.end('{}');
    } else {
      try {
        const name = req.url === '/' ? 'download.html' : req.url.slice(1);
        if (!/^[a-zA-Z0-9.-]+$/.test(name)) throw new Error('invalid path');
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : 'text/html');
        res.end(await readFile(new URL(`../public/${name}`, import.meta.url)));
      } catch { res.statusCode = 404; res.end(); }
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.WLBD_CHROME_PATH ? { executablePath: process.env.WLBD_CHROME_PATH } : {}) });
    for (const backend of ['webgl2', 'webgl', 'fallback']) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({backend}) => {
        window.drawCount = 0;
        window.shaderErrors = [];
        for (const proto of [window.WebGLRenderingContext?.prototype,window.WebGL2RenderingContext?.prototype]) {
          if (!proto) continue;
          const original = proto.drawArrays;
          const info = proto.getShaderInfoLog;
          const linkInfo = proto.getProgramInfoLog;
          proto.getProgramInfoLog = function(...args) { const result=linkInfo.apply(this,args); if(result)window.shaderErrors.push(result); return result; };
          proto.getShaderInfoLog = function(...args) { const result=info.apply(this,args); if(result)window.shaderErrors.push(result); return result; };
          proto.drawArrays = function(...args) { window.drawCount++; return original.apply(this,args); };
        }
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(name,...args) {
          if ((backend !== 'webgl2' && name === 'webgl2') || (backend === 'fallback' && name === 'webgl')) return null;
          return original.call(this,name,...args);
        };
      }, {backend});
      await page.goto('http://127.0.0.1:' + server.address().port + '/');
      await page.waitForFunction(() => document.querySelector('.generative-background')?.dataset.renderer);
      assert.equal(await page.locator('.generative-background').getAttribute('data-renderer'),backend,JSON.stringify(await page.evaluate(()=>window.shaderErrors)));
      await page.waitForTimeout(1100);
      if (backend !== 'fallback') {
        const before = await page.evaluate(() => window.drawCount);
        await page.waitForTimeout(350);
        assert.ok(await page.evaluate(() => window.drawCount) > before);
        const resizeResult = await page.evaluate(() => {
          const host = document.querySelector('.generative-background');
          const canvas = host.querySelector('canvas');
          const count = window.drawCount;
          host.style.height = '810px';
          window.dispatchEvent(new Event('resize'));
          const result = { repainted: window.drawCount > count,
            alpha: canvas.getContext(host.dataset.renderer).getContextAttributes().alpha };
          host.style.height = '';
          window.dispatchEvent(new Event('resize'));
          return result;
        });
        assert.equal(resizeResult.repainted, true, 'resize repaints synchronously without waiting for animation frames');
        assert.equal(resizeResult.alpha, true, 'discarded buffers reveal the light background instead of black');
        assert.ok(await page.locator('canvas').evaluate(c => c.width / c.clientWidth) >= 1.2, 'Retina canvas must not be upscaled from sub-native resolution');
        await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
        const hidden = await page.evaluate(() => window.drawCount);
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => window.drawCount),hidden);
        await page.evaluate(() => {delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
        await page.emulateMedia({reducedMotion:'reduce'});
        const still = await page.evaluate(() => window.drawCount);
        await page.waitForTimeout(350);
        assert.equal(await page.evaluate(() => window.drawCount),still,'reduced motion is completely static');
      }
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor),'rgb(251, 251, 252)');
      if (process.env.WLBD_DEMO_SCREENSHOT_DIR) await page.screenshot({path:process.env.WLBD_DEMO_SCREENSHOT_DIR+'/generative-'+backend+'.png'});
      for (const [width,height] of [[390,844],[393,852],[412,915]]) {
        await page.setViewportSize({width,height});
        await page.waitForTimeout(80);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
        assert.equal(await page.locator('#dl').evaluate(el => {const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;}),true);
        if (backend !== 'fallback') {
          assert.ok(await page.locator('canvas').evaluate(c=>c.width*c.height) <= 2502000);
          assert.ok(await page.locator('canvas').evaluate(c=>c.width/c.clientWidth) >= 1.4, 'mobile Retina resolution stays sharp');
        }
      }
      if (process.env.WLBD_DEMO_SCREENSHOT_DIR) await page.screenshot({path:process.env.WLBD_DEMO_SCREENSHOT_DIR+'/generative-'+backend+'-mobile.png'});
      if (backend === 'webgl2') {
        await page.evaluate(() => document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
        await page.waitForFunction(() => document.querySelector('.generative-background').dataset.renderer === 'fallback');
      }
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      assert.equal(await page.locator('canvas').count(),0);
      await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
      await page.waitForFunction(() => document.querySelector('.generative-background').dataset.renderer);
      assert.equal(await page.locator('canvas').count(),1);
      await page.route('**/downloads/demo.apk',route=>route.abort());
      const [tracking]=await Promise.all([page.waitForRequest('**/api/app/version/download-count'),page.locator('#dl').click()]);
      assert.equal(tracking.method(),'POST');
      assert.deepEqual(errors,[]);
      await page.close();
    }
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
