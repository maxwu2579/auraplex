// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getClient as getAccountClient } from '@hcengineering/account-client'
import core, {
  AccountRole,
  generateId,
  departmentAutoJoinClasses,
  type Class,
  systemAccountUuid,
  type AccountUuid,
  type Mixin,
  type Ref,
  type Space,
  type Tx,
  type TxCUD,
  type TxMixin,
  type TxUpdateDoc,
  type Doc
} from '@hcengineering/core'
import departments, { type DepartmentAccess } from '@hcengineering/departments'
import document from '@hcengineering/document'
import drive from '@hcengineering/drive'
import hr, { type Department } from '@hcengineering/hr'
import { type TriggerControl } from '@hcengineering/server-core'
import { generateToken } from '@hcengineering/server-token'
import tracker, { TimeReportDayType, type Project } from '@hcengineering/tracker'

import { syncStaffDepartments } from './staffDepartmentSync'

type SpaceField = 'projectSpace' | 'documentSpace' | 'driveSpace'

/** Everyone with a department role, plus the super admins who must see every department. */
export function departmentSpaceMembers (access: DepartmentAccess, owners: readonly AccountUuid[]): AccountUuid[] {
  return Array.from(
    new Set([...access.administrators, ...access.supervisors, ...access.employees, ...access.readers, ...owners])
  ).sort()
}

/** Short unique task prefix: DEP1, DEP2, ... (tracker identifiers are at most 5 characters). */
export function nextIdentifier (used: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const id = `DEP${n}`
    if (!used.has(id)) return id
  }
}

const sameMembers = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((it, i) => it === [...b].sort()[i])

export function planAutoMembership (
  current: readonly AccountUuid[], added: readonly AccountUuid[], desired: ReadonlySet<AccountUuid>,
  required: ReadonlySet<AccountUuid> = new Set()
): { members: AccountUuid[], departmentAdded: AccountUuid[] } {
  const existing = new Set(current)
  const automatic = new Set(added)
  const members = current.filter((person) => !automatic.has(person) || desired.has(person) || required.has(person))
  for (const person of desired) if (!existing.has(person)) members.push(person)
  return {
    members,
    departmentAdded: [...desired].filter((person) => !required.has(person) && (automatic.has(person) || !existing.has(person)))
  }
}

async function reconcileAutoMembership (control: TriggerControl, result: Tx[], owners: AccountUuid[]): Promise<void> {
  const departmentsList = await control.findAll(control.ctx, hr.class.Department, {})
  const desired = new Map<Ref<Space>, Set<AccountUuid>>()
  const managed = new Map<Ref<Space>, Set<AccountUuid>>()
  for (const department of departmentsList) {
    const access = control.hierarchy.asIf(department, departments.mixin.DepartmentAccess)
    if (access === undefined) continue
    for (const id of [access.projectSpace, access.documentSpace, access.driveSpace]) {
      if (id !== undefined) managed.set(id, new Set(departmentSpaceMembers(access, owners)))
    }
    if (access.archived) continue
    const people = departmentSpaceMembers(access, [])
    for (const ids of Object.values(access.autoJoin ?? {})) {
      for (const id of ids) {
        const members = desired.get(id) ?? new Set<AccountUuid>()
        for (const person of people) members.add(person)
        desired.set(id, members)
      }
    }
  }
  for (const cls of Object.values(departmentAutoJoinClasses)) {
    const spaces = await control.findAll(control.ctx, cls as Ref<Class<Space>>, {}, { showArchived: true })
    for (const space of spaces) {
      const next = desired.get(space._id)
      const state = control.hierarchy.asIf(space, departments.mixin.DepartmentAutoMembers)
      if (next === undefined && state === undefined) continue
      const required = new Set([...(managed.get(space._id) ?? []), ...(space.owners ?? [])])
      const base = managed.get(space._id)
      const current = base === undefined
        ? space.members
        : [...new Set([...base,
            ...(state?.departmentAdded ?? []).filter((person) => space.members.includes(person))])]
      const plan = planAutoMembership(current, state?.departmentAdded ?? [], next ?? new Set(), required)
      if (!sameMembers(space.members, plan.members)) {
        result.push(control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, { members: plan.members }))
      }
      if (!sameMembers(state?.departmentAdded ?? [], plan.departmentAdded)) {
        result.push(control.txFactory.createTxMixin(space._id, space._class, space.space,
          departments.mixin.DepartmentAutoMembers, { departmentAdded: plan.departmentAdded }))
      }
    }
  }
}

async function workspaceOwners (control: TriggerControl): Promise<AccountUuid[]> {
  const token = generateToken(systemAccountUuid, control.workspace.uuid, { service: 'transactor' })
  const members = await getAccountClient(process.env.ACCOUNTS_URL, token).getWorkspaceMembers()
  return members.filter((it) => it.role === AccountRole.Owner).map((it) => it.person)
}

/**
 * Keeps the three private spaces of a department (tasks, documents, drive) in line with the
 * department page: creates missing ones, then syncs name, members, owners and archive state.
 * Runs as the system; people cannot change these spaces directly (DepartmentGuardMiddleware).
 */
export async function OnDepartmentAccess (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  // Our own write-back of the new space ids carries nothing to sync; skipping it also
  // avoids creating the spaces twice if storage is not yet updated when it re-triggers.
  const relevant = txes.filter((tx) => {
    if (tx._class !== core.class.TxMixin) return true
    const keys = Object.keys((tx as TxMixin<Doc, Doc>).attributes)
    return !keys.every((key) => key === 'projectSpace' || key === 'documentSpace' || key === 'driveSpace')
  })
  const ids = new Set(relevant.map((tx) => (tx as TxCUD<Doc>).objectId as Ref<Department>))
  const result: Tx[] = []
  let owners: AccountUuid[] | undefined
  for (const id of ids) {
    const department = (await control.findAll(control.ctx, hr.class.Department, { _id: id }, { limit: 1 }))[0]
    if (department === undefined || !control.hierarchy.hasMixin(department, departments.mixin.DepartmentAccess)) {
      continue
    }
    const access = control.hierarchy.as(department, departments.mixin.DepartmentAccess)
    owners = owners ?? (await workspaceOwners(control))
    const members = departmentSpaceMembers(access, owners)
    const common = {
      name: department.name,
      description: '',
      private: true,
      members,
      owners,
      archived: access.archived,
      autoJoin: false
    }
    const created: Partial<Record<SpaceField, Ref<Space>>> = {}

    if (access.projectSpace === undefined) {
      const projects = await control.findAll(control.ctx, tracker.class.Project, {}, { projection: { identifier: 1 } })
      const projectId = generateId<Project>()
      result.push(
        control.txFactory.createTxCreateDoc(
          tracker.class.Project,
          core.space.Space,
          {
            ...common,
            identifier: nextIdentifier(new Set(projects.map((it) => it.identifier))),
            sequence: 0,
            defaultIssueStatus: tracker.status.Backlog,
            defaultTimeReportDay: TimeReportDayType.PreviousWorkDay,
            type: tracker.ids.ClassingProjectType
          },
          projectId
        ),
        control.txFactory.createTxMixin(
          projectId,
          tracker.class.Project,
          core.space.Space,
          `${tracker.ids.ClassingProjectType}:type:mixin` as Ref<Mixin<Project>>,
          {}
        )
      )
      created.projectSpace = projectId
    }
    if (access.documentSpace === undefined) {
      const id = generateId<Space>()
      result.push(
        control.txFactory.createTxCreateDoc(
          document.class.Teamspace,
          core.space.Space,
          { ...common, type: document.spaceType.DefaultTeamspaceType },
          id as any
        )
      )
      created.documentSpace = id
    }
    if (access.driveSpace === undefined) {
      const id = generateId<Space>()
      result.push(
        control.txFactory.createTxCreateDoc(
          drive.class.Drive,
          core.space.Space,
          { ...common, type: drive.spaceType.DefaultDrive },
          id as any
        )
      )
      created.driveSpace = id
    }
    if (Object.keys(created).length > 0) {
      result.push(
        control.txFactory.createTxMixin(
          department._id,
          hr.class.Department,
          department.space,
          departments.mixin.DepartmentAccess,
          created
        )
      )
    }

    const existing = [access.projectSpace, access.documentSpace, access.driveSpace].filter(
      (it): it is Ref<Space> => it !== undefined
    )
    if (existing.length === 0) continue
    const spaces = await control.findAll(control.ctx, core.class.Space, { _id: { $in: existing } })
    for (const space of spaces) {
      const update: Record<string, unknown> = {}
      if (space.name !== common.name) update.name = common.name
      if (!space.private) update.private = true
      if (space.archived !== common.archived) update.archived = common.archived
      const added = control.hierarchy.asIf(space, departments.mixin.DepartmentAutoMembers)?.departmentAdded ?? []
      const combined = [...new Set([...members, ...added.filter((person) => space.members.includes(person))])]
      if (!sameMembers(space.members, combined)) update.members = combined
      if (!sameMembers(space.owners ?? [], owners)) update.owners = owners
      if (Object.keys(update).length > 0) {
        result.push(control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, update))
      }
    }
  }
  const staffChanges = new Set<Ref<Department>>()
  for (const tx of relevant) {
    if (tx._class === core.class.TxMixin) {
      const update = tx as TxMixin<Doc, DepartmentAccess>
      if (update.mixin !== departments.mixin.DepartmentAccess) continue
    } else if (tx._class === core.class.TxUpdateDoc && !('archived' in (tx as TxUpdateDoc<DepartmentAccess>).operations)) {
      continue
    }
    staffChanges.add((tx as TxCUD<Department>).objectId)
  }
  if (staffChanges.size > 0) result.push(...await syncStaffDepartments(control, staffChanges))
  if (ids.size > 0) await reconcileAutoMembership(control, result, owners ?? await workspaceOwners(control))
  return result
}
