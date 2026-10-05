// 在未挂载的 template 中读取邮件，不执行脚本或加载图片。
export function parseMailHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = String(html || '')
  const root = template.content
  root.querySelectorAll('script,style,title,head,iframe,object,embed,svg,math,template,noscript,[hidden],[aria-hidden="true"]').forEach(n => n.remove())
  root.querySelectorAll('[style]').forEach(n => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all/i.test(n.getAttribute('style'))) n.remove()
  })
  return root
}

export function httpUrl(value) {
  const raw = String(value || '').trim()
  if (!/^https?:\/\//i.test(raw) || /[\s\u0000-\u001f\u007f]/.test(raw)) return null
  try {
    const parsed = new URL(raw)
    if (!parsed.hostname || parsed.username || parsed.password) return null
    return raw
  } catch { return null }
}

const BLOCK = /^(ADDRESS|ARTICLE|BLOCKQUOTE|DIV|DL|DT|DD|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|OL|P|PRE|SECTION|TABLE|TR|UL)$/

export function htmlToText(html, { includeLinks = true } = {}) {
  if (!html) return ''
  const root = parseMailHtml(html)
  function walk(node) {
    if (node.nodeType === 3) return node.textContent
    if (node.nodeType !== 1 && node.nodeType !== 11) return ''
    const tag = node.tagName
    if (tag === 'BR') return '\n'
    let text = Array.from(node.childNodes, walk).join('')
    if (tag === 'A' && includeLinks) {
      const url = httpUrl(node.getAttribute('href'))
      if (url && text.trim() !== url) text += ` [${url}]`
    }
    if (tag === 'TD' || tag === 'TH') return `${text}\t`
    return BLOCK.test(tag || '') ? `\n${text}\n` : text
  }
  return walk(root).replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function textUrls(text) {
  return Array.from(String(text || '').matchAll(/https?:\/\/[^\s<>"'`\[\]]+/gi), m => ({
    // 括号/句号是文本的标点，不能删除 fragment 中的冒号、等号或百分号。
    url: m[0].replace(/[.,;!?，。；！）)]+$/, ''),
    index: m.index,
  }))
}
