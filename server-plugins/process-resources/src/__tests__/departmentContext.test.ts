//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { AccountUuid } from '@hcengineering/core'
import { pickDepartmentApprovers, pickResponsibleApprovers } from '../departmentContext'

const a = (s: string): AccountUuid => s as AccountUuid

const sales = {
  administrators: [a('admin1')],
  supervisors: [a('sup1'), a('sup2')],
  employees: [a('emp1')],
  readers: [a('read1')]
}

describe('pickDepartmentApprovers', () => {
  it('admin step: everyone but an admin goes to the first department admin', () => {
    expect(pickDepartmentApprovers(a('emp1'), [sales], 'admin')).toEqual(['admin1'])
    expect(pickDepartmentApprovers(a('read1'), [sales], 'admin')).toEqual(['admin1'])
    expect(pickDepartmentApprovers(a('sup2'), [sales], 'admin')).toEqual(['admin1'])
  })

  it('admin step: an admin gets it back to pass it or hand it on', () => {
    expect(pickDepartmentApprovers(a('admin1'), [{ ...sales, administrators: [a('admin1'), a('admin2')] }], 'admin')).toEqual(['admin1'])
  })

  it('supervisor step: first supervisor that is not the applicant, for admins too', () => {
    expect(pickDepartmentApprovers(a('emp1'), [sales], 'supervisor')).toEqual(['sup1'])
    expect(pickDepartmentApprovers(a('admin1'), [sales], 'supervisor')).toEqual(['sup1'])
    expect(pickDepartmentApprovers(a('sup1'), [sales], 'supervisor')).toEqual(['sup2'])
    expect(pickDepartmentApprovers(a('emp1'), [{ ...sales, supervisors: [] }], 'supervisor')).toEqual(['emp1'])
  })

  it('one per department, skips archived ones, outsiders get it back', () => {
    const prod = { administrators: [a('admin2')], supervisors: [a('sup3')], employees: [a('emp1')] }
    expect(pickDepartmentApprovers(a('emp1'), [sales, prod, { ...prod, archived: true }], 'admin')).toEqual(['admin1', 'admin2'])
    expect(pickDepartmentApprovers(a('nobody'), [sales, prod], 'admin')).toEqual(['nobody'])
  })
})

describe('pickResponsibleApprovers', () => {
  const hr = { administrators: [a('hrAdmin')], supervisors: [a('hrSup')], employees: [a('hrEmp')], applicationTypes: ['leave'] }

  it('a form with a responsible department goes to its admin, whoever applies', () => {
    expect(pickResponsibleApprovers(a('emp1'), [sales, hr], ['leave'], 'admin')).toEqual(['hrAdmin'])
    expect(pickResponsibleApprovers(a('admin1'), [sales, hr], ['leave'], 'admin')).toEqual(['hrAdmin'])
    expect(pickResponsibleApprovers(a('hrEmp'), [sales, hr], ['leave'], 'admin')).toEqual(['hrAdmin'])
  })

  it('matches parent types, and the responsible admin gets his own request back', () => {
    expect(pickResponsibleApprovers(a('emp1'), [hr], ['sickLeave', 'leave'], 'admin')).toEqual(['hrAdmin'])
    expect(pickResponsibleApprovers(a('hrAdmin'), [hr], ['leave'], 'admin')).toEqual(['hrAdmin'])
  })

  it('second step uses the responsible department supervisor', () => {
    expect(pickResponsibleApprovers(a('emp1'), [sales, hr], ['leave'], 'supervisor')).toEqual(['hrSup'])
  })

  it('no responsible department (or only archived): falls back', () => {
    expect(pickResponsibleApprovers(a('emp1'), [sales, hr], ['expense'], 'admin')).toBeUndefined()
    expect(pickResponsibleApprovers(a('emp1'), [{ ...hr, archived: true }], ['leave'], 'admin')).toBeUndefined()
  })
})
