import test from 'node:test'
import assert from 'node:assert/strict'
import { extractOtp } from '../src/utils/otp.js'
import { extractMagicLink } from '../src/utils/magicLink.js'

const magic = 'https://claude.ai/magic-link#synthetic-token:dGVzdEBleGFtcGxlLmNvbQ=='
const tracking = 'https://url.example.com/ls/click?upn=synthetic-206051-123456'
const image = 'https://cdn.example.com/d4ef4a73d51fe844/b7626bee-28ca-4e2f-b25b-7d81af34e7a1/206x51.png'

for (const [name, input, expected] of [
  ['Chinese ChatGPT email with image and tracking links', { text: `ChatGPT [${image}]\n\n输入此临时验证码以继续：\n\n154027\n\n如果并非你本人尝试创建账户，请忽略此邮件。\nChatGPT [${tracking}]` }, '154027'],
  ['SpaceXAI grouped code', { text: 'VALIDATE YOUR EMAIL\nPlease use the code below to validate\nyour email address.\n\n985-667\n\n© 2026 SpaceXAI LLC' }, '985667'],
  ['Words after keyword do not hide code', { text: 'Your verification code to continue is shown below:\n\n154027' }, '154027'],
  ['Leading zeros', { text: '验证码：001234' }, '001234'],
  ['Four digits', { text: 'PIN: 8432' }, '8432'],
  ['Eight digits', { text: 'Your security code is 12345678' }, '12345678'],
  ['Mixed alphanumeric', { text: 'Code: ab12CD' }, 'AB12CD'],
  ['Grouped by space', { text: 'Your code is 985 667' }, '985667'],
  ['Separate digits', { text: 'Your code is 1 5 4 0 2 7' }, '154027'],
  ['Non-breaking hyphen', { text: 'Your code is 985‑667' }, '985667'],
  ['Code before keyword', { subject: '154027 is your verification code' }, '154027'],
  ['Subject code', { subject: '验证码：154027', text: 'Welcome!' }, '154027'],
  ['Zero code is valid', { text: 'Your code is 000000' }, '000000'],
  ['Long prose before isolated code', { subject: 'Verify your email', text: `${'Welcome. '.repeat(50)}\n\n154027` }, '154027'],
  ['Skip image numbers', { text: `Verification code\n[${image}]\n[${tracking}]` }, null],
  ['No codes in magic-link tokens', { text: `Sign in\nhttps://example.com/magic-link#12345678:154027` }, null],
  ['Do not extract embedded IDs', { text: 'Your code is in this link: https://example.com/verify?id=154027\nref abc154027def' }, null],
  ['No ordinary numbers in notices', { text: 'Order shipped\n154027' }, null],
  ['Skip labelled order number', { text: 'Your verification code:\nOrder number: 456789\n\n154027' }, '154027'],
  ['No dates', { text: 'Verification code expires on 2026-10-06.' }, null],
  ['No phone number', { text: 'Verification code help\nPhone: 555-123-4567' }, null],
  ['No year-only fallback', { subject: 'Validate your email', text: '2026' }, null],
  ['No dollar amount', { text: 'Verification code help costs $1234 USD.' }, null],
  ['Empty input', {}, null],
]) {
  test(name, () => assert.equal(extractOtp(input), expected))
}

test('Claude magic link preserves the entire fragment and padding', () => {
  const text = `Claude [${image}]\nSign in to Claude.ai\nClick the button below to finish signing in. This link expires in 10 minutes.\n\nSign in\n[${magic}]\n\nNeed a hand? Contact Support [${tracking}]\nPrivacy [${tracking}]`
  assert.equal(extractMagicLink({ text }), magic)
  assert.equal(extractOtp({ text }), null)
})

test('URL query encoding is not rewritten', () => {
  const url = 'https://example.com/verify?token=abc%2Bdef%3D&next=%2Fhome#state:abc='
  assert.equal(extractMagicLink({ text: `[${url}]` }), url)
})

test('Labelled tracking wrapper is copied, not fetched', () => {
  assert.equal(extractMagicLink({ text: `Verify your email\n[${tracking}]` }), tracking)
})

test('Skip support, image, tracking pixel and plain login navigation', () => {
  for (const text of [
    `Sign in\n[${image}]`, `Help\n[${tracking}]`,
    'Sign in\nhttps://example.com/wf/open?token=123',
    'Sign in\nhttps://example.com/login',
    'Privacy\nhttps://example.com/verify?token=abc',
    'javascript:alert(1)', 'Sign in\nhttps://user:password@example.com/login?token=abc',
  ]) assert.equal(extractMagicLink({ text }), null, text)
})
