// 只把静态 HTML 放入 sandbox；CSP 放在任何邮件内容之前。
export function buildMailDocument(html, remote = false) {
  const template = document.createElement('template')
  template.innerHTML = String(html || '')
  const root = template.content
  root.querySelectorAll('script,base,meta,iframe,object,embed,link[rel="import"]').forEach(n => n.remove())
  root.querySelectorAll('form').forEach(n => n.replaceWith(...n.childNodes))
  root.querySelectorAll('*').forEach(node => {
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name) || attr.name === 'srcdoc') node.removeAttribute(attr.name)
    }
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      if (!/^(?:https?:\/\/|mailto:|#)/i.test(href)) node.removeAttribute('href')
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  })
  const resources = remote
    ? "img-src data: cid: https: http:; style-src 'unsafe-inline' https: http:; font-src https: http: data:;"
    : "img-src data: cid:; style-src 'unsafe-inline'; font-src data:;"
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${resources} base-uri 'none'; form-action 'none';"><meta name="referrer" content="no-referrer"><style>html{margin:0;padding:0;background:#fff}body{margin:0;padding:16px;box-sizing:border-box;display:flow-root;min-height:0!important;height:auto!important;font:14px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1C1917;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style></head><body>${template.innerHTML}</body></html>`
}
