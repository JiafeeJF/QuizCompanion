import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

// Local download-page preview only. Never proxy tracking writes to production.
export default mergeConfig(base, defineConfig({
  plugins: [{
    name: 'download-preview-version',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET' || req.url?.split('?')[0] !== '/api/app/version') return next();
        try {
          const response = await fetch('https://download.wakaibg5.top/api/app/version', { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error('Version unavailable');
          const version = await response.json();
          if (version.downloadPath?.startsWith('/')) version.downloadPath = 'https://download.wakaibg5.top' + version.downloadPath;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(version));
        } catch {
          res.statusCode = 503;
          res.end('{"error":"Preview version unavailable"}');
        }
      });
    },
  }],
}));
