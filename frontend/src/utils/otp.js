import { htmlToText } from './mailContent.js'
export { htmlToText } from './mailContent.js'

const KEYWORDS = /验证码|校验码|动态码|确认码|激活码|驗證碼|驗證代碼|\b(?:verification|security|authentication|confirmation|login|sign[- ]?in|one[- ]time|temporary|access)\s+(?:pass)?code\b|\b(?:passcode|OTP|PIN)\b|\b(?:your\s+code|code\s+(?:is|below))\b|\bcode\s*:|\b(?:use|enter|input)\b[^\n.!?]{0,35}\bcode\b/gi
const CANDIDATES = /(?<![A-Za-z0-9_#.:/\-])(?:\d{2,4}(?:[ \t\-‐‑–]\d{2,4}){1,3}|\d(?:[ \t]\d){3,7}|[A-Za-z0-9]{4,8})(?![A-Za-z0-9_.:/\-])/g
const VERIFY = /验证|驗證|校验|动态码|确认码|激活|\b(?:verify|verification|validate|authentication|sign[- ]?in|login|passcode|OTP|one[- ]time)\b/i
const NON_CODE = /(?:order|invoice|reference|ticket|phone|tel|postcode|zip|amount|total|订单|訂單|电话|金額|金额|编号)\s*(?:number|no\.?|id|号码)?\s*[:#：]?\s*$/i

function clean(text) {
  return String(text || '')
    .replace(/https?:\/\/[^\s<>"'\[\]]+/gi, ' ')
    .replace(/\bwww\.[^\s<>]+/gi, ' ')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/ /g, ' ')
}

function candidates(text, subject, verificationContext) {
  const keywords = Array.from(text.matchAll(KEYWORDS))
  const found = []
  for (const match of text.matchAll(CANDIDATES)) {
    const value = match[0].replace(/[ \t\-‐‑–]/g, '').toUpperCase()
    if (value.length < 4 || value.length > 8 || !/\d/.test(value)) continue
    if (/^\d{4}-\d{2}-\d{2}$/.test(match[0])) continue
    const before = text.slice(Math.max(0, match.index - 120), match.index)
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 80)
    if (NON_CODE.test(before) || /[$€£¥]\s*$/.test(before) || /^\s*(?:USD|EUR|元|美元|年)\b/i.test(after)) continue
    const lineStart = text.lastIndexOf('\n', match.index - 1) + 1
    const lineEnd = text.indexOf('\n', match.index + match[0].length)
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd).trim()
    const standalone = line === match[0]
    let distance = Infinity
    for (const keyword of keywords) {
      const end = keyword.index + keyword[0].length
      if (end <= match.index) distance = Math.min(distance, match.index - end)
      else if (keyword.index >= match.index + match[0].length) distance = Math.min(distance, keyword.index - match.index - match[0].length + 25)
    }
    const near = distance <= 120
    if (!near && !(standalone && verificationContext && /^\d+$/.test(value))) continue
    // 无直接提示时不猜四位年份；字母数字码必须在关键词附近。
    if (!near && /^(19|20)\d{2}$/.test(value)) continue
    if (/[A-Z]/.test(value) && !near) continue
    const score = (near ? 100 - distance / 4 : 20) + (standalone ? 25 : 0) + (subject ? 10 : 0)
    found.push({ value, score })
  }
  return found
}

export function extractOtp({ subject = '', text = '', html = '' } = {}) {
  const sources = [clean(subject), clean(text), clean(html ? htmlToText(html, { includeLinks: false }) : '')]
  const verificationContext = sources.some(s => VERIFY.test(s) || Array.from(s.matchAll(KEYWORDS)).length > 0)
  const found = sources.flatMap((s, i) => candidates(s, i === 0, verificationContext))
  found.sort((a, b) => b.score - a.score)
  return found[0]?.value || null
}
