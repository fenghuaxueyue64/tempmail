import { httpUrl, parseMailHtml, textUrls } from './mailContent.js'

const ACTION = /(?:登录|登入|验证|驗證|确认邮箱|激活)|\b(?:sign[ -]?in|log[ -]?in|magic\s*link|verify|validate|activate|confirm\s+(?:your\s+)?(?:email|account))\b/i
const IGNORE = /\b(?:help|support|privacy|unsubscribe|preferences|terms|contact|twitter|linkedin|youtube|instagram)\b|帮助|隐私|退订|客服/i
const ACTION_PATH = /(?:^|\/)(?:magic[-_]?link|sign[-_]?in|log[-_]?in|verify(?:[-_](?:email|account))?|verification|validate|activate|confirm(?:[-_]email)?|auth\/callback)(?:\/|$)/i

export function extractMagicLink({ text = '', html = '' } = {}) {
  const links = []
  function add(value, label = '') {
    const url = httpUrl(value)
    if (!url) return
    const parsed = new URL(url)
    const path = parsed.pathname
    if (/\.(?:png|jpe?g|gif|svg|webp|ico|css|woff2?)$/i.test(path) || /\/(?:wf\/open|track|pixel)(?:\/|$)/i.test(path)) return
    if (IGNORE.test(label) || IGNORE.test(path)) return
    const direct = ACTION_PATH.test(path)
    const action = ACTION.test(label)
    // 单纯站点首页/登录导航并非一次性链接。
    const token = !!(parsed.hash || parsed.search || /\/(?:verify|validate|activate|confirm|magic[-_]?link)\/.+/i.test(path))
    if ((!direct && !action) || !token) return
    const score = (direct ? 100 : 0) + (action ? 40 : 0) + (/magic[-_]?link/i.test(path) ? 30 : 0)
    links.push({ url, score })
  }
  if (html) {
    for (const anchor of parseMailHtml(html).querySelectorAll('a[href]')) {
      add(anchor.getAttribute('href'), anchor.textContent || anchor.getAttribute('aria-label') || '')
    }
  }
  for (const { url, index } of textUrls(text)) {
    const preceding = String(text).slice(Math.max(0, index - 160), index).replace(/[\s\[(]+$/, '')
    const label = preceding.split('\n').pop() || ''
    add(url, label)
  }
  links.sort((a, b) => b.score - a.score)
  return links[0]?.url || null
}
