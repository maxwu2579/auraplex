// Copyright © 2026 Auraplex. Licensed under EPL-2.0.
// Local fake mail server for testing only: just enough SMTP and IMAP for the prospect-mail
// service, plus a small HTTP API to look at mailboxes and simulate a customer's reply.
// Nothing leaves this machine. Any user name and password is accepted.
const net = require('net')
const http = require('http')

const boxes = new Map() // address -> [{ uid, raw }]
let nextUid = 1
const box = (address) => {
  const key = String(address).toLowerCase()
  if (!boxes.has(key)) boxes.set(key, [])
  return boxes.get(key)
}
const deliver = (to, raw) => box(to).push({ uid: nextUid++, raw: raw.replace(/\r?\n/g, '\r\n') })
const address = (text) => (/<([^>]*)>/.exec(text) ?? [])[1] ?? ''

function smtp (socket) {
  let rcpt = []
  let data = null
  let pending = ''
  let auth = null
  socket.write('220 fake-mail ESMTP\r\n')
  socket.on('data', (chunk) => {
    pending += chunk.toString('latin1')
    let index
    while ((index = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, index)
      pending = pending.slice(index + 2)
      if (data !== null) {
        if (line === '.') {
          const raw = Buffer.from(data.join('\r\n'), 'latin1').toString('utf8')
          for (const to of rcpt) deliver(to, raw)
          data = null
          rcpt = []
          socket.write('250 OK queued\r\n')
        } else data.push(line.startsWith('..') ? line.slice(1) : line)
        continue
      }
      if (auth !== null) {
        auth--
        socket.write(auth > 0 ? '334 UGFzc3dvcmQ6\r\n' : '235 Authenticated\r\n')
        if (auth === 0) auth = null
        continue
      }
      const cmd = line.toUpperCase()
      if (cmd.startsWith('EHLO')) socket.write('250-fake-mail\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
      else if (cmd.startsWith('HELO')) socket.write('250 fake-mail\r\n')
      else if (cmd === 'AUTH LOGIN') {
        auth = 2
        socket.write('334 VXNlcm5hbWU6\r\n')
      } else if (cmd === 'AUTH PLAIN') {
        auth = 1
        socket.write('334 \r\n')
      } else if (cmd.startsWith('AUTH')) socket.write('235 Authenticated\r\n')
      else if (cmd.startsWith('MAIL FROM')) socket.write('250 OK\r\n')
      else if (cmd.startsWith('RCPT TO')) {
        rcpt.push(address(line))
        socket.write('250 OK\r\n')
      } else if (cmd === 'DATA') {
        data = []
        socket.write('354 End with .\r\n')
      } else if (cmd === 'QUIT') {
        socket.end('221 Bye\r\n')
      } else socket.write('250 OK\r\n')
    }
  })
  socket.on('error', () => {})
}

function imap (socket) {
  let user = ''
  let pending = ''
  socket.write('* OK [CAPABILITY IMAP4rev1] fake-mail ready\r\n')
  const send = (text) => socket.write(text + '\r\n')
  const messages = () => box(user)
  socket.on('data', (chunk) => {
    pending += chunk.toString('latin1')
    let index
    while ((index = pending.indexOf('\r\n')) >= 0) {
      const line = pending.slice(0, index)
      pending = pending.slice(index + 2)
      const [tag, rawCommand, ...rest] = line.split(' ')
      const command = (rawCommand ?? '').toUpperCase()
      const args = rest.join(' ')
      if (command === 'CAPABILITY') {
        send('* CAPABILITY IMAP4rev1')
        send(`${tag} OK done`)
      } else if (command === 'LOGIN') {
        user = (/^"?([^"\s]+)"?/.exec(args) ?? [])[1] ?? ''
        send(`${tag} OK [CAPABILITY IMAP4rev1] logged in`)
      } else if (command === 'EXAMINE' || command === 'SELECT') {
        const list = messages()
        send('* FLAGS (\\Seen)')
        send(`* ${list.length} EXISTS`)
        send('* 0 RECENT')
        send('* OK [UIDVALIDITY 1] UIDs valid')
        send(`* OK [UIDNEXT ${nextUid}] next`)
        send(`${tag} OK [${command === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] done`)
      } else if (command === 'LIST') {
        send('* LIST (\\HasNoChildren) "/" INBOX')
        send(`${tag} OK done`)
      } else if (command === 'UID' && rest[0]?.toUpperCase() === 'SEARCH') {
        const range = /UID (\d+):(\*|\d+)/i.exec(args)
        const list = messages()
        const max = list.length === 0 ? 0 : list[list.length - 1].uid
        const from = range === null ? 1 : Number(range[1])
        const to = range === null || range[2] === '*' ? max : Number(range[2])
        let found = list.filter((m) => m.uid >= Math.min(from, max) && m.uid <= to).map((m) => m.uid)
        if (found.length === 0 && range !== null && range[2] === '*' && max > 0) found = [max]
        send(`* SEARCH${found.map((u) => ' ' + u).join('')}`)
        send(`${tag} OK done`)
      } else if (command === 'UID' && rest[0]?.toUpperCase() === 'FETCH') {
        const uid = Number(rest[1])
        const items = rest.slice(2).join(' ').toUpperCase()
        const list = messages()
        const seq = list.findIndex((m) => m.uid === uid)
        if (seq >= 0) {
          const message = list[seq]
          const parts = [`UID ${uid}`]
          if (items.includes('FLAGS')) parts.push('FLAGS ()')
          if (items.includes('RFC822.SIZE')) parts.push(`RFC822.SIZE ${Buffer.byteLength(message.raw)}`)
          let literal
          if (items.includes('BODY.PEEK[HEADER]')) {
            const end = message.raw.indexOf('\r\n\r\n')
            literal = ['BODY[HEADER]', end < 0 ? message.raw : message.raw.slice(0, end + 4)]
          } else if (items.includes('BODY.PEEK[]') || items.includes('BODY[]')) {
            literal = ['BODY[]', message.raw]
          }
          if (literal === undefined) send(`* ${seq + 1} FETCH (${parts.join(' ')})`)
          else {
            const bytes = Buffer.from(literal[1])
            socket.write(`* ${seq + 1} FETCH (${parts.join(' ')} ${literal[0]} {${bytes.length}}\r\n`)
            socket.write(bytes)
            socket.write(')\r\n')
          }
        }
        send(`${tag} OK done`)
      } else if (command === 'LOGOUT') {
        send('* BYE')
        send(`${tag} OK done`)
        socket.end()
      } else if (command === 'ID') {
        send('* ID NIL')
        send(`${tag} OK done`)
      } else if (tag !== '') {
        send(`${tag} OK done`)
      }
    }
  })
  socket.on('error', () => {})
}

// GET /mailbox/<address>  -> messages delivered to that address
// POST /reply {from, to, inReplyTo, subject, text, padKb?} -> put a customer reply into <to>'s inbox
function api (req, res) {
  const json = (code, value) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(value, null, 1))
  }
  if (req.method === 'GET' && req.url.startsWith('/mailbox/')) {
    json(200, box(decodeURIComponent(req.url.slice(9))))
    return
  }
  if (req.method === 'POST' && req.url === '/reply') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const r = JSON.parse(body)
      const id = `<reply-${nextUid}@customer.test>`
      const pad = r.padKb > 0 ? '\r\n' + 'x'.repeat(76).concat('\r\n').repeat(Math.ceil((r.padKb * 1024) / 78)) : ''
      deliver(
        r.to,
        [
          `From: ${r.from}`,
          `To: ${r.to}`,
          `Subject: =?UTF-8?B?${Buffer.from(r.subject).toString('base64')}?=`,
          `Message-ID: ${id}`,
          `Date: ${new Date().toUTCString()}`,
          ...(r.inReplyTo ? [`In-Reply-To: ${r.inReplyTo}`, `References: ${r.inReplyTo}`] : []),
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset=utf-8',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from(r.text).toString('base64') + pad
        ].join('\r\n')
      )
      json(200, { ok: true, messageId: id })
    })
    return
  }
  json(404, {})
}

net.createServer(smtp).listen(2525, '0.0.0.0')
net.createServer(imap).listen(1143, '0.0.0.0')
http.createServer(api).listen(8112, '0.0.0.0')
console.log('fake mail: smtp 2525, imap 1143, api 8112')
