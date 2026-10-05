import { createApp, h, nextTick, reactive } from 'vue'
import EmailReader from '../src/components/mail/EmailReader.vue'
import { api } from '../src/api/client.js'
import { extractOtp, htmlToText } from '../src/utils/otp.js'
import { extractMagicLink } from '../src/utils/magicLink.js'
import { buildMailDocument } from '../src/utils/mailDocument.js'
import '../src/styles/base.css'

const result = document.querySelector('#result')
const passed = []
let app
function equal(actual, expected, name) {
  if (actual !== expected) throw new Error(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  passed.push(name)
}
function ok(condition, name) { equal(!!condition, true, name) }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, name) {
  for (let i = 0; i < 60; i++) {
    if (check()) return
    await wait(25)
  }
  throw new Error(`Timed out: ${name}`)
}
const magic = 'https://example.com/magic-link#synthetic:dGVzdEBleGFtcGxlLmNvbQ=='
const image = `${location.origin}/tests/pixel.svg`

try {
  equal(extractOtp({ html: '<style>.p{color:#154027}</style><p>验证码</p><div hidden>888888</div><p>154027</p><img src="https://example.com/987654.png">' }), '154027', 'Visible HTML code')
  equal(extractOtp({ text: 'View this email in your browser.', html: '<p>验证码：</p><b>154027</b>' }), '154027', 'HTML is checked even with a text part')
  equal(extractOtp({ html: '<p>Please use the code below to validate your email address.</p><p>985-667</p>' }), '985667', 'Grouped HTML code')
  equal(extractOtp({ html: '<p>Your verification code:</p><table><tr><td>1</td><td>5</td><td>4</td><td>0</td><td>2</td><td>7</td></tr></table>' }), '154027', 'Code split across table cells')
  equal(extractOtp({ html: '<p>Your code is <span>154</span><span>027</span></p>' }), '154027', 'Code split across inline elements')
  equal(extractMagicLink({ html: `<a href="https://example.com/help?token=bad">Help</a><a href="${magic}">Sign in</a>` }), magic, 'HTML login link')
  equal(extractMagicLink({ html: '<a href="https://example.com/verify?token=a%2Bb&amp;next=%2Fhome">Verify email</a>' }), 'https://example.com/verify?token=a%2Bb&next=%2Fhome', 'Decode HTML entities but preserve URL encoding')
  equal(extractMagicLink({ html: '<a href="javascript:alert(1)">Sign in</a>' }), null, 'Unsafe URL rejected')
  equal(htmlToText('<p>First</p><p>Second<br>Third</p>'), 'First\n\nSecond\nThird', 'Paragraphs retained')
  ok(htmlToText(`<p>Open <a href="${magic}">Sign in</a></p>`).includes(magic), 'Text view retains link destination')
  const isolated = buildMailDocument('<meta http-equiv="refresh" content="0;url=https://example.com"><script>alert(1)</script><a href="javascript:alert(1)" onclick="alert(1)">link</a>')
  ok(!isolated.includes('<script') && !isolated.includes('onclick') && !isolated.includes('http-equiv="refresh"') && !isolated.includes('javascript:'), 'Active content removed')
  ok(isolated.includes("default-src 'none'") && isolated.includes("form-action 'none'"), 'CSP preserved')

  let clipboard = ''
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { clipboard = text } } })
  const pending = new Map()
  api.getEmail = (_mailbox, id) => new Promise(resolve => pending.set(id, resolve))
  const props = reactive({ mailboxId: 'test-mailbox', emailId: 'old', address: 'test@example.com' })
  app = createApp({ render: () => h(EmailReader, props) })
  app.mount('#reader')
  await nextTick()
  props.emailId = 'new'
  await nextTick()
  const longHtml = `<style>p{margin:12px 0}</style><p>验证码：154027</p><a href="${magic}">Sign in</a><img src="${image}" width="600" height="400"><script>parent.__mailScriptExecuted=true</script>${'<p>Long mail body</p>'.repeat(120)}<p id="last">LAST-LINE</p>`
  pending.get('new')({ subject: 'New message', sender: 'sender@example.com', body_text: '', body_html: longHtml, received_at: '2026-01-01T00:00:00Z' })
  await until(() => document.querySelector('.mail-frame')?.contentDocument?.querySelector('#last'), 'Reader frame')
  pending.get('old')({ subject: 'Stale message', body_text: 'Old body' })
  await wait(150)
  equal(document.querySelector('.subj').textContent, 'New message', 'Late old response ignored')
  equal(window.__mailScriptExecuted, undefined, 'Mail script never ran')
  let frame = document.querySelector('.mail-frame')
  ok(!frame.sandbox.contains('allow-scripts'), 'No script sandbox permission')
  const height = frame.getBoundingClientRect().height
  ok(height > 1000, 'Long body expands the frame')
  await wait(150)
  ok(Math.abs(frame.getBoundingClientRect().height - height) < 2, 'Frame height does not grow in a loop')
  ok(frame.contentDocument.querySelector('#last').getBoundingClientRect().bottom <= frame.clientHeight + 2, 'Last line is visible without clipping')
  ok(!frame.contentDocument.querySelector('img').naturalWidth, 'Remote images blocked by default')
  ok(document.documentElement.scrollWidth <= innerWidth + 1, 'Narrow viewport has no page overflow')
  document.querySelector('.login-link button').click()
  await wait(10)
  equal(clipboard, magic, 'Copy button copies complete magic link')
  document.querySelector('.otp button').click()
  await wait(10)
  equal(clipboard, '154027', 'Copy button copies code')
  Array.from(document.querySelectorAll('.body-bar button')).find(b => b.textContent.includes('显示远程图片')).click()
  await until(() => document.querySelector('.mail-frame')?.contentDocument?.querySelector('img')?.naturalWidth, 'Allow local test image')
  frame = document.querySelector('.mail-frame')
  await wait(100)
  ok(frame.contentDocument.querySelector('#last').getBoundingClientRect().bottom <= frame.clientHeight + 2, 'Image load keeps last line visible')
  Array.from(document.querySelectorAll('.seg button')).find(b => b.textContent.includes('纯文本')).click()
  await nextTick()
  ok(document.querySelector('.mail-text').textContent.includes('LAST-LINE'), 'Text view includes final paragraph')
  Array.from(document.querySelectorAll('.seg button')).find(b => b.textContent.includes('HTML')).click()
  await until(() => document.querySelector('.mail-frame')?.contentDocument?.querySelector('#last'), 'Switch back to HTML')
  result.dataset.status = 'passed'
  result.textContent = `${passed.length} assertions passed\n${passed.join('\n')}`
} catch (error) {
  result.dataset.status = 'failed'
  result.textContent = `${error.stack}\nPassed:\n${passed.join('\n')}`
} finally {
  app?.unmount()
}
