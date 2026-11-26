// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import type { MasterTag, Tag } from '@hcengineering/card'
import core, {
  DateRangeMode,
  generateId,
  type ApplyOperations,
  type TypeDate,
  type EnumOf,
  type Ref
} from '@hcengineering/core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import type { HrCalendarFields } from '@hcengineering/process'

export async function addHrCalendarFields (
  ops: ApplyOperations,
  tag: Ref<MasterTag | Tag>,
  chinese: boolean
): Promise<HrCalendarFields> {
  const labels = chinese ? ['开始日期', '结束日期', '假期类型'] : ['Start date', 'End date', 'Leave type']
  const enumValues = chinese
    ? ['年假', '病假', '事假', '调休', '其他']
    : ['Annual leave', 'Sick leave', 'Personal leave', 'Time off in lieu', 'Other']
  const of = await ops.createDoc(core.class.Enum, core.space.Model, { name: labels[2], enumValues })
  const date: TypeDate = {
    _class: core.class.TypeDate,
    label: core.string.Date,
    icon: core.icon.TypeDate,
    mode: DateRangeMode.DATE,
    withShift: false,
    calendarDate: true
  }
  const kind: EnumOf = { _class: core.class.EnumOf, label: core.string.Enum, icon: core.icon.TypeEnumOf, of }
  const names = { start: 'custom' + generateId(), end: 'custom' + generateId(), kind: 'custom' + generateId() }
  for (const [index, name] of Object.values(names).entries()) {
    await ops.createDoc(core.class.Attribute, core.space.Model, {
      attributeOf: tag,
      name,
      label: getEmbeddedLabel(labels[index]),
      isCustom: true,
      type: index === 2 ? kind : date,
      readonly: false,
      automationOnly: false,
      required: true
    })
  }
  return names
}
