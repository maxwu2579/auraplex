import { Forwarder } from '../forwarder'
import { MailUserError } from '../errors'

function setup (prospect: any, emails: any[] = [{ value: 'owner@company.test', verifiedOn: 1 }]): any {
  const reply = { _id: 'reply', subject: 'Re: Hello', sender: 'c@x.test', sentAt: 0, body: 'Yes please' }
  const records: any[] = []
  const ops = {
    notMatch: jest.fn(),
    addCollection: jest.fn(async (...args: any[]) => {
      records.push({ ...args[5], _id: args[6] })
    }),
    commit: jest.fn().mockResolvedValue({ result: true })
  }
  const client = {
    findOne: jest.fn(async (_class: string, query: any) => {
      if (query._id === 'reply') return reply
      if (query.personUuid !== undefined) return { _id: 'person' }
      if (query._id === prospect?._id) return prospect
      return records.find((r) => r._id === query._id)
    }),
    findAll: jest.fn().mockResolvedValue(emails),
    apply: jest.fn().mockReturnValue(ops),
    update: jest.fn(async (target: any, value: any) => Object.assign(target, value))
  }
  const transport = { sendMail: jest.fn().mockResolvedValue({}) }
  return { client, transport, records, forwarder: new Forwarder(client as any, transport as any, 'me@gmail.test') }
}

test('forwards the reply to the owner and records it', async () => {
  const prospect = { _id: 'p', owner: 'acc', name: 'Ann', company: 'ACME', email: 'c@x.test', space: 's', _class: 'c' }
  const { forwarder, transport, records } = setup(prospect)
  await forwarder.forward('actor' as any, 'p', 'reply', '12345678-1234-1234-1234-123456789abc')
  expect(transport.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({ to: 'owner@company.test', subject: 'Fwd: Re: Hello' })
  )
  expect(transport.sendMail.mock.calls[0][0].text).toContain('Yes please')
  expect(records[0]).toMatchObject({ direction: 'forward', delivery: 'sent', replyTo: 'reply', actor: 'actor' })
})

test('refuses without an owner and sends nothing', async () => {
  const { forwarder, transport } = setup({ _id: 'p', email: 'c@x.test' })
  await expect(forwarder.forward('actor' as any, 'p', 'reply', 'r')).rejects.toBeInstanceOf(MailUserError)
  expect(transport.sendMail).not.toHaveBeenCalled()
})

test('refuses when the owner has no email', async () => {
  const { forwarder, transport } = setup({ _id: 'p', owner: 'acc', email: 'c@x.test' }, [])
  await expect(forwarder.forward('actor' as any, 'p', 'reply', 'r')).rejects.toThrow('负责人没有邮箱')
  expect(transport.sendMail).not.toHaveBeenCalled()
})
