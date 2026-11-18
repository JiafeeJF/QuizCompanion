import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entryFiles = [
  '../index.html',
  '../public/download.html',
  '../public/jump.html',
];

test('every HTML entry locks the viewport to the device width', async () => {
  for (const relativePath of entryFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    const viewport = source.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)["']/i)?.[1] || '';
    assert.match(viewport, /width=device-width/);
    assert.match(viewport, /initial-scale=1(?:\.0)?/);
    assert.match(viewport, /minimum-scale=1(?:\.0)?/);
    assert.match(viewport, /maximum-scale=1(?:\.0)?/);
    assert.match(viewport, /user-scalable=no/);
    assert.match(viewport, /viewport-fit=cover/);
  }
});

test('iOS form controls use a 16px font to prevent focus zoom', async () => {
  const styles = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(styles, /@supports \(-webkit-touch-callout: none\)/);
  assert.match(styles, /input:not\(\[type='checkbox'\]\)/);
  assert.match(styles, /textarea,/);
  assert.match(styles, /select \{/);
  assert.match(styles, /font-size: 16px !important/);
  assert.match(styles, /touch-action: pan-x pan-y/);
});
