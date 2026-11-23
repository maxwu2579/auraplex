//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { AccountUuid } from '@hcengineering/core'
import { pickDepartmentApprovers } from '../departmentContext'

const a = (s: string): AccountUuid => s as AccountUuid

const sales = {
  administrators: [a('admin1')],
  supervisors: [a('sup1'), a('sup2')],
  employees: [a('emp1')],
  readers: [a('read1')]
}

describe('pickDepartmentApprovers', () => {
  it('employee and reader go to the first supervisor', () => {
    expect(pickDepartmentApprovers(a('emp1'), [sales])).toEqual(['sup1'])
    expect(pickDepartmentApprovers(a('read1'), [sales])).toEqual(['sup1'])
  })

  it('falls back to the first admin when there is no supervisor', () => {
    expect(pickDepartmentApprovers(a('emp1'), [{ ...sales, supervisors: [] }])).toEqual(['admin1'])
  })

  it('supervisor goes to the admin, admin needs nobody', () => {
    expect(pickDepartmentApprovers(a('sup2'), [sales])).toEqual(['admin1'])
    expect(pickDepartmentApprovers(a('admin1'), [sales])).toEqual([])
  })

  it('skips archived and unrelated departments, one approver per department', () => {
    const prod = { administrators: [a('admin2')], supervisors: [a('sup3')], employees: [a('emp1')] }
    expect(pickDepartmentApprovers(a('emp1'), [sales, prod, { ...prod, archived: true }])).toEqual(['sup1', 'sup3'])
    expect(pickDepartmentApprovers(a('nobody'), [sales, prod])).toEqual([])
  })
})
