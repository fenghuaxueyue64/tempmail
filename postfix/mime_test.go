package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime/quotedprintable"
	"net/http"
	"net/http/httptest"
	"net/mail"
	"net/textproto"
	"strings"
	"testing"

	"golang.org/x/text/encoding/simplifiedchinese"
)

func quoted(s string) string {
	var out bytes.Buffer
	w := quotedprintable.NewWriter(&out)
	_, _ = w.Write([]byte(s))
	_ = w.Close()
	return out.String()
}

func TestExtractBodies(t *testing.T) {
	chinese := "输入此临时验证码以继续：\n\n154027\n"
	gb, err := simplifiedchinese.GB18030.NewEncoder().String(chinese)
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, raw, text, html string
	}{
		{"plain default", "\r\nHello\r\n985-667", "Hello\r\n985-667", ""},
		{"base64 plain", "Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64.StdEncoding.EncodeToString([]byte(chinese)), chinese, ""},
		{"root quoted printable", "Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Code: 154=\r\n027</p>", "", "<p>Code: 154027</p>"},
		{"gb18030", "Content-Type: text/plain; charset=gb18030\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64.StdEncoding.EncodeToString([]byte(gb)), chinese, ""},
		{"latin1", "Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=E9", "café", ""},
		{"alternative", "Content-Type: multipart/alternative; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain\r\n\r\nCode: 154027\r\n--a\r\nContent-Type: text/html\r\nContent-Transfer-Encoding: base64\r\n\r\n" + base64.StdEncoding.EncodeToString([]byte("<p>154027</p>")) + "\r\n--a--\r\n", "Code: 154027", "<p>154027</p>"},
		{"QP decoded once", "Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" + quoted("literal =41 and 中文") + "\r\n--a--\r\n", "literal =41 and 中文", ""},
		{"mixed parts and attachment", "Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=code.txt\r\n\r\nWrong 999999\r\n--a\r\nContent-Type: text/plain\r\n\r\nFirst\r\n--a\r\n\r\nLast 985-667\r\n--a--\r\n", "First\n\nLast 985-667", ""},
		{"filename without disposition", "Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain; name=readme.txt\r\n\r\nWrong\r\n--a\r\nContent-Type: text/plain\r\n\r\nRight\r\n--a--\r\n", "Right", ""},
		{"alternative last supported", "Content-Type: multipart/alternative; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain\r\n\r\nold\r\n--a\r\nContent-Type: text/plain\r\n\r\nnew\r\n--a--\r\n", "new", ""},
		{"mixed html and text", "Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: text/html\r\n\r\n<p>First</p>\r\n--a\r\nContent-Type: text/plain\r\n\r\nLast <end>\r\n--a--\r\n", "First\n\nLast <end>", "<p>First</p>\n\n<pre>Last &lt;end&gt;</pre>"},
		{"related explicit root", "Content-Type: multipart/related; boundary=a; start=\"<root>\"\r\n\r\n--a\r\nContent-Type: text/plain\r\nContent-ID: <resource>\r\n\r\nNot the body\r\n--a\r\nContent-Type: text/html\r\nContent-ID: <root>\r\n\r\n<p>154027</p>\r\n--a--\r\n", "", "<p>154027</p>"},
		{"nested", "Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: multipart/related; boundary=b\r\n\r\n--b\r\nContent-Type: multipart/alternative; boundary=c\r\n\r\n--c\r\nContent-Type: text/plain\r\n\r\n985-667\r\n--c\r\nContent-Type: text/html\r\n\r\n<b>985-667</b>\r\n--c--\r\n--b\r\nContent-Type: image/png\r\n\r\nimage\r\n--b--\r\n--a--\r\n", "985-667", "<b>985-667</b>"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, err := mail.ReadMessage(strings.NewReader(tt.raw))
			if err != nil {
				t.Fatal(err)
			}
			text, html, err := extractBodies(msg)
			if err != nil || text != tt.text || html != tt.html {
				t.Fatalf("got text=%q html=%q err=%v; want text=%q html=%q", text, html, err, tt.text, tt.html)
			}
		})
	}
}

func TestMIMEFailureDoesNotReturnPartialBody(t *testing.T) {
	for _, raw := range []string{
		"Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\nSGVsbG8=@@@",
		"Content-Type: text/plain; charset=unknown-charset\r\n\r\nHello",
		"Content-Type: multipart/mixed\r\n\r\nHello",
		"Content-Type: multipart/mixed; boundary=a\r\n\r\n--a\r\nContent-Type: text/plain\r\n\r\nPartial body",
	} {
		msg, err := mail.ReadMessage(strings.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		text, html, err := extractBodies(msg)
		if err == nil || text != "" || html != "" {
			t.Fatalf("malformed message returned text=%q html=%q err=%v", text, html, err)
		}
	}
}

func TestMIMELimits(t *testing.T) {
	header := textproto.MIMEHeader{"Content-Type": {"text/plain"}}
	for _, p := range []bodyParser{
		{remaining: 3},
		{parts: maxMIMEParts, remaining: maxMessageBytes},
	} {
		if _, err := p.parse(header, strings.NewReader("hello"), 0); err == nil {
			t.Fatal("expected limit error")
		}
	}
	p := bodyParser{remaining: maxMessageBytes}
	if _, err := p.parse(header, strings.NewReader("hello"), maxMIMEDepth+1); err == nil {
		t.Fatal("expected nesting error")
	}
}

func TestLongBodyIsNotClipped(t *testing.T) {
	body := strings.Repeat("正文\n", 50000) + "LAST-LINE"
	msg, err := mail.ReadMessage(strings.NewReader("Content-Type: text/plain; charset=utf-8\r\n\r\n" + body))
	if err != nil {
		t.Fatal(err)
	}
	text, _, err := extractBodies(msg)
	if err != nil || text != body {
		t.Fatalf("body clipped: len=%d want=%d err=%v", len(text), len(body), err)
	}
}

func TestDeliverDecodesAndRetainsRaw(t *testing.T) {
	var payload deliverPayload
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Error(err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()
	var reply bytes.Buffer
	s := session{srv: &server{apiURL: ts.URL, httpClient: ts.Client()}, w: bufio.NewWriter(&reply), recipients: []string{"test@example.com"}}
	raw := "From: =?UTF-8?B?5rWL6K+V?= <sender@example.com>\r\nSubject: =?UTF-8?B?6aqM6K+B56CB?=\r\nContent-Transfer-Encoding: base64\r\n\r\nMTU0MDI3"
	s.deliverAll(context.Background(), []byte(raw))
	if payload.Subject != "验证码" || payload.Sender != "测试 <sender@example.com>" || payload.BodyText != "154027" || payload.Raw != raw {
		t.Fatalf("unexpected decoded payload: %+v", payload)
	}
	if !strings.HasPrefix(reply.String(), "250 ") {
		t.Fatalf("unexpected response: %s", reply.String())
	}
}

func TestInvalidMailTemporaryFailureForAllRecipients(t *testing.T) {
	var reply bytes.Buffer
	s := session{w: bufio.NewWriter(&reply), recipients: []string{"a@example.com", "b@example.com"}}
	// 不设置 API server；解析失败不能继续投递不完整邮件。
	s.deliverAll(context.Background(), []byte("Content-Transfer-Encoding: base64\r\n\r\n!!!"))
	if strings.Count(reply.String(), "451 ") != 2 {
		t.Fatalf("expected two temporary failures, got %q", reply.String())
	}
}
