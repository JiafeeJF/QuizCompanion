import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]

assert.ok(script, 'platform redirect script should exist in index.html')

function redirectedPath({ userAgent, hostname = 'iot.wakaibg5.top', pathname = '/', protocol = 'https:' }) {
  let destination = null
  const context = {
    navigator: { userAgent },
    location: {
      hostname,
      pathname,
      protocol,
      replace(value) {
        destination = value
      },
    },
  }

  vm.runInNewContext(script, context)
  return destination
}

test('Android and HarmonyOS web browsers go to the APK download page', () => {
  assert.equal(redirectedPath({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)' }), 'https://download.wakaibg5.top')
  assert.equal(redirectedPath({ userAgent: 'Mozilla/5.0 (OpenHarmony 5.0; ArkWeb)' }), 'https://download.wakaibg5.top')
})

test('the native Android shell never redirects to the download page', () => {
  assert.equal(
    redirectedPath({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; wv)',
      hostname: 'localhost',
      protocol: 'http:',
    }),
    null,
  )
})

test('a well-formed hidden mobile admin path bypasses the Android download redirect', () => {
  assert.equal(
    redirectedPath({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)',
      pathname: '/m/' + 'a'.repeat(32),
    }),
    null,
  )
  assert.equal(
    redirectedPath({ userAgent: 'Mozilla/5.0 (Linux; Android 15)', pathname: '/m/short' }),
    'https://download.wakaibg5.top',
  )
})

test('iOS and desktop browsers do not redirect', () => {
  assert.equal(redirectedPath({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), null)
  assert.equal(redirectedPath({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), null)
})
