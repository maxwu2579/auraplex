import { Sender } from '../sender'

test('reserves against unresolved previous deliveries before invoking SMTP', async () => {
  const prospect = { _id: 'customer', _class: 'prospect', space: 'space', email: 'test@example.test', status: 'new' }
  const checks: Array<Record<string, unknown>> = []
  const ops = {
    match: jest.fn(),
    notMatch: jest.fn((_class: unknown, query: Record<string, unknown>) => {
      checks.push(query)
    }),
    addCollection: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ result: false })
  }
  const client = {
    findOne: jest.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(prospect),
    apply: jest.fn().mockReturnValue(ops)
  }
  const transport = { sendMail: jest.fn() }
  const sender = new Sender(client as any, transport as any, 'sender@example.test')
  await expect(sender.send('actor' as any, 'customer', 'request', 'subject', 'body')).rejects.toThrow()
  expect(checks).toContainEqual(
    expect.objectContaining({
      attachedTo: 'customer',
      direction: 'outgoing',
      delivery: { $in: ['sending', 'uncertain'] }
    })
  )
  expect(transport.sendMail).not.toHaveBeenCalled()
})
