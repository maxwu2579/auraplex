// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Prospect, ProspectFieldDef } from './index'
import { introCandidates } from './automation'
import { matchHeaders, planImport, type ImportColumn } from './importRows'

const builtin = (key: string, label: string): ImportColumn => ({ key, label, field: { key, builtin: true, label: '', type: 'text', hidden: false, order: 0 } })
const fair: ProspectFieldDef = { key: 'c_fair', builtin: false, label: '展会', type: 'select', options: ['广交会', '新加坡展'], hidden: false, order: 20 }
const columns: ImportColumn[] = [
  builtin('name', '姓名'), builtin('company', '公司'), builtin('mobile', '手机'), builtin('phone', '电话'), builtin('email', '邮箱'),
  { key: 'c_fair', label: '展会', field: fair }
]
const old = { _id: 'old', name: '旧人', company: '旧公司', mobile: '+65 9111 2222', phone: '', email: 'old@fake.test', normalizedEmail: 'old@fake.test' } as unknown as Prospect

test('headers match display names, keys and the owner column', () => {
  expect(matchHeaders(['姓名', 'Email', '公司 *', '负责人邮箱', '备注不存在'], columns)).toEqual(['name', 'email', 'company', 'owner', undefined])
})

test('rows are added, skipped or sent to review', () => {
  const plan = planImport([
    ['姓名', '公司', '手机', '邮箱', '展会', '负责人', '奇怪的列'],
    ['新人', '新公司', '', 'new@fake.test', '广交会', 'Boss@Fake.test', ''],
    ['', '', '', 'x@fake.test', '', '', ''],
    ['重复', '某公司', '', 'OLD@fake.test', '', '', ''],
    ['文件里重复', '某公司', '', 'new@fake.test', '', '', ''],
    ['同手机', '别的公司', '91112222', '', '不在选项里', '', ''],
    ['坏邮箱', '公司', '', 'not-an-email', '', '', ''],
    ['', '', '', '', '', '', '']
  ], columns, [old])
  expect(plan.unknownHeaders).toEqual(['奇怪的列'])
  expect(plan.add.map((it) => it.values.name)).toEqual(['新人', '同手机'])
  expect(plan.add[0]).toMatchObject({ row: 2, ownerEmail: 'boss@fake.test', custom: { c_fair: '广交会' }, review: [] })
  expect(plan.add[1]).toMatchObject({ custom: {}, review: ['dup:old'] })
  expect(plan.skipped).toEqual([
    { row: 3, reason: 'empty' }, { row: 4, reason: 'existing-email' }, { row: 5, reason: 'file-email' }, { row: 7, reason: 'bad-email' }
  ])
})

test('imported old customers get no introduction mail', () => {
  const card = { _id: 'a', email: 'a@fake.test', status: 'new', emailCount: 0, createdOn: 10 } as unknown as Prospect
  expect(introCandidates([card], 0, new Set(), new Set())).toHaveLength(1)
  expect(introCandidates([{ ...card, imported: true }], 0, new Set(), new Set())).toHaveLength(0)
})
