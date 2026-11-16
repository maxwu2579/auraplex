import { pollInbox } from '../poller'

test('polling parses replies and saves progress only after processing', async () => {
  const source = Buffer.from(
    'From: customer@example.test\r\nMessage-ID: <reply@example.test>\r\nIn-Reply-To: <sent@example.test>\r\nSubject: Re: Hello\r\n\r\nReply body'
  )
  const client = {
    connect: jest.fn(),
    mailboxOpen: jest.fn().mockResolvedValue({ uidValidity: 42n }),
    search: jest.fn().mockResolvedValue([1, 2]),
    fetchOne: jest.fn(async (id: string, query: { size?: boolean }) =>
      query.size === true ? { uid: Number(id), size: source.length } : { uid: Number(id), source }
    ),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn()
  }
  const storage = {
    read: jest.fn().mockResolvedValue({ uidValidity: '42', uid: 1 }),
    write: jest.fn(),
    accept: jest.fn()
  }
  await pollInbox(client as any, storage)
  expect(storage.accept).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 2, from: 'customer@example.test', references: ['<sent@example.test>', ''] })
  )
  expect(storage.write).toHaveBeenCalledWith({ uidValidity: '42', uid: 2 })
  expect(client.logout).toHaveBeenCalledTimes(1)
})

test('does not advance the cursor on processing failure', async () => {
  const source = Buffer.from('From: customer@example.test\r\n\r\nReply')
  const client = {
    connect: jest.fn(),
    mailboxOpen: jest.fn().mockResolvedValue({ uidValidity: 1n }),
    search: jest.fn().mockResolvedValue([1]),
    fetchOne: jest.fn(async (_id: string, query: { size?: boolean }) =>
      query.size === true ? { size: source.length } : { source }
    ),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn()
  }
  const storage = {
    read: jest.fn().mockResolvedValue({ uidValidity: '1', uid: 0 }),
    write: jest.fn(),
    accept: jest.fn().mockRejectedValue(new Error('failed'))
  }
  await expect(pollInbox(client as any, storage)).rejects.toThrow('failed')
  expect(storage.write).not.toHaveBeenCalled()
  expect(client.logout).toHaveBeenCalledTimes(1)
})

test('first run starts after the existing mail instead of importing it', async () => {
  const client = {
    connect: jest.fn(),
    mailboxOpen: jest.fn().mockResolvedValue({ uidValidity: 7n, uidNext: 500 }),
    search: jest.fn(),
    fetchOne: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn()
  }
  const storage = { read: jest.fn().mockResolvedValue(undefined), write: jest.fn(), accept: jest.fn() }
  await pollInbox(client as any, storage)
  expect(storage.write).toHaveBeenCalledWith({ uidValidity: '7', uid: 499 })
  expect(client.search).not.toHaveBeenCalled()
  expect(storage.accept).not.toHaveBeenCalled()
})

test('a large message is matched from its headers and does not block later mail', async () => {
  const headers = Buffer.from(
    ['From: customer@example.test', 'In-Reply-To: <sent@example.test>', 'Subject: Re: Big', '', ''].join('\r\n')
  )
  const client = {
    connect: jest.fn(),
    mailboxOpen: jest.fn().mockResolvedValue({ uidValidity: 3n }),
    search: jest.fn().mockResolvedValue([5]),
    fetchOne: jest.fn(async (_id: string, query: { size?: boolean, headers?: boolean, source?: boolean }) =>
      query.size === true ? { size: 5 * 1024 * 1024 } : query.headers === true ? { headers } : { source: undefined }
    ),
    logout: jest.fn().mockResolvedValue(undefined),
    close: jest.fn()
  }
  const storage = {
    read: jest.fn().mockResolvedValue({ uidValidity: '3', uid: 4 }),
    write: jest.fn(),
    accept: jest.fn()
  }
  await pollInbox(client as any, storage)
  expect(client.fetchOne).not.toHaveBeenCalledWith('5', expect.objectContaining({ source: true }), expect.anything())
  expect(storage.accept).toHaveBeenCalledWith(
    expect.objectContaining({ uid: 5, references: ['<sent@example.test>', ''] })
  )
  expect(storage.write).toHaveBeenCalledWith({ uidValidity: '3', uid: 5 })
})
