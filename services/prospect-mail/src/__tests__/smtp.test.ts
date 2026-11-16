import { SMTPServer } from 'smtp-server'
import nodemailer from 'nodemailer'
import { Sender } from '../sender'

test('sends one message through a local fake SMTP server', async () => {
  let received = ''
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData (stream, _session, done) {
      stream.on('data', (chunk: Buffer) => {
        received += chunk.toString()
      })
      stream.on('end', () => {
        done()
      })
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test port')
  const transport = nodemailer.createTransport({
    host: '127.0.0.1',
    port: address.port,
    secure: false,
    ignoreTLS: true
  })
  const customer: any = {
    _id: 'customer',
    _class: 'prospect',
    space: 'space',
    email: 'customer@example.test',
    status: 'new',
    emailCount: 0
  }
  let record: any
  const ops = {
    match: jest.fn(),
    notMatch: jest.fn(),
    addCollection: jest.fn(async (...args: any[]) => {
      record = { ...args[5], _id: args[6] }
    }),
    update: jest.fn(async (target: any, value: any) => {
      Object.assign(target, value)
    }),
    commit: jest.fn().mockResolvedValue({ result: true })
  }
  let calls = 0
  const client = {
    findOne: jest.fn(async () => {
      calls++
      if (calls === 1) return undefined
      if (calls === 2 || calls === 3 || calls === 5) return customer
      return record
    }),
    apply: jest.fn().mockReturnValue(ops)
  }
  try {
    await new Sender(client as any, transport, 'sender@example.test').send(
      'actor' as any,
      'customer',
      '12345678-1234-1234-1234-123456789abc',
      'Hello',
      'Test message'
    )
    expect(received).toContain('Test message')
    expect(record.delivery).toBe('sent')
    expect(customer.status).toBe('sent')
  } finally {
    transport.close()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  }
})
