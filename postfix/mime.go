package main

import (
	"encoding/base64"
	"fmt"
	"html"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"strings"

	xhtml "golang.org/x/net/html"
	"golang.org/x/net/html/charset"
)

const (
	maxMIMEDepth = 32
	maxMIMEParts = 1000
)

type mailBodies struct {
	text string
	html string
}

type bodyParser struct {
	parts     int
	remaining int64
}

func decodeHeader(value string) string {
	decoder := mime.WordDecoder{CharsetReader: charset.NewReaderLabel}
	decoded, err := decoder.DecodeHeader(value)
	if err != nil {
		return value
	}
	return decoded
}

func extractBodies(msg *mail.Message) (string, string, error) {
	parser := bodyParser{remaining: maxMessageBytes}
	bodies, err := parser.parse(textproto.MIMEHeader(msg.Header), msg.Body, 0)
	if err != nil {
		return "", "", err
	}
	return bodies.text, bodies.html, nil
}

func (p *bodyParser) parse(header textproto.MIMEHeader, r io.Reader, depth int) (mailBodies, error) {
	p.parts++
	if depth > maxMIMEDepth || p.parts > maxMIMEParts {
		return mailBodies{}, fmt.Errorf("MIME nesting or part limit exceeded")
	}
	contentType := header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/plain"
	}
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return mailBodies{}, fmt.Errorf("invalid MIME content type: %w", err)
	}
	disposition, dispParams, err := mime.ParseMediaType(header.Get("Content-Disposition"))
	if header.Get("Content-Disposition") != "" && err != nil {
		return mailBodies{}, fmt.Errorf("invalid MIME disposition: %w", err)
	}
	// 附件即使是 text/plain 或 text/html，也不能混入邮件正文。
	if strings.EqualFold(disposition, "attachment") || dispParams["filename"] != "" || params["name"] != "" {
		return mailBodies{}, nil
	}
	mediaType = strings.ToLower(mediaType)
	if !strings.HasPrefix(mediaType, "multipart/") && mediaType != "text/plain" && mediaType != "text/html" {
		return mailBodies{}, nil
	}

	switch strings.ToLower(strings.TrimSpace(header.Get("Content-Transfer-Encoding"))) {
	case "base64":
		r = base64.NewDecoder(base64.StdEncoding, r)
	case "quoted-printable":
		r = quotedprintable.NewReader(r)
	case "", "7bit", "8bit", "binary":
	default:
		return mailBodies{}, fmt.Errorf("unsupported content transfer encoding")
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		if params["boundary"] == "" {
			return mailBodies{}, fmt.Errorf("multipart boundary missing")
		}
		return p.multipart(r, mediaType, params, depth)
	}

	label := strings.TrimSpace(params["charset"])
	if label != "" && !strings.EqualFold(label, "utf-8") && !strings.EqualFold(label, "us-ascii") {
		r, err = charset.NewReaderLabel(label, r)
		if err != nil {
			return mailBodies{}, fmt.Errorf("unsupported text charset: %w", err)
		}
	}
	body, err := io.ReadAll(io.LimitReader(r, p.remaining+1))
	if err != nil {
		return mailBodies{}, fmt.Errorf("decode MIME body: %w", err)
	}
	p.remaining -= int64(len(body))
	if p.remaining < 0 {
		return mailBodies{}, fmt.Errorf("decoded message exceeds body limit")
	}
	if mediaType == "text/html" {
		return mailBodies{html: string(body)}, nil
	}
	return mailBodies{text: string(body)}, nil
}

func (p *bodyParser) multipart(r io.Reader, mediaType string, params map[string]string, depth int) (mailBodies, error) {
	mr := multipart.NewReader(r, params["boundary"])
	var result mailBodies
	var mixed []mailBodies
	start := strings.Trim(params["start"], "<>")
	rootFound := false
	for index := 0; ; index++ {
		// NextPart 自动解码 QP，使用 NextRawPart 避免二次解码。
		part, err := mr.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return mailBodies{}, fmt.Errorf("read MIME part: %w", err)
		}
		body, err := p.parse(part.Header, part, depth+1)
		if err != nil {
			return mailBodies{}, err
		}
		switch mediaType {
		case "multipart/alternative":
			// 同一内容的不同表示取最后一个可用版本，不重复拼接。
			if strings.TrimSpace(body.text) != "" {
				result.text = body.text
			}
			if strings.TrimSpace(body.html) != "" {
				result.html = body.html
			}
		case "multipart/related":
			// related 的非根部件是内联资源，不能当作额外正文。
			if (start == "" && index == 0) || (start != "" && strings.Trim(part.Header.Get("Content-ID"), "<>") == start) {
				result = body
				rootFound = true
			}
		default:
			mixed = append(mixed, body)
		}
	}
	if len(mixed) > 0 {
		hasHTML := false
		for _, body := range mixed {
			hasHTML = hasHTML || body.html != ""
		}
		for _, body := range mixed {
			if body.text == "" && body.html != "" {
				body.text = htmlBodyText(body.html)
			}
			if hasHTML && body.html == "" && body.text != "" {
				body.html = "<pre>" + html.EscapeString(body.text) + "</pre>"
			}
			result.text = joinBody(result.text, body.text)
			result.html = joinBody(result.html, body.html)
		}
	}
	if mediaType == "multipart/related" && !rootFound {
		return mailBodies{}, fmt.Errorf("multipart related root missing")
	}
	return result, nil
}

func htmlBodyText(body string) string {
	doc, err := xhtml.Parse(strings.NewReader(body))
	if err != nil {
		return ""
	}
	var out strings.Builder
	var walk func(*xhtml.Node)
	walk = func(n *xhtml.Node) {
		if n.Type == xhtml.ElementNode {
			switch n.Data {
			case "head", "script", "style", "template":
				return
			}
		}
		if n.Type == xhtml.TextNode {
			out.WriteString(n.Data)
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
		if n.Type == xhtml.ElementNode {
			switch n.Data {
			case "p", "div", "br", "tr", "li", "h1", "h2", "h3", "pre":
				out.WriteByte('\n')
			case "td", "th":
				out.WriteByte(' ')
			}
		}
	}
	walk(doc)
	return strings.TrimSpace(out.String())
}

func joinBody(first, next string) string {
	if first == "" {
		return next
	}
	if next == "" {
		return first
	}
	return first + "\n\n" + next
}
