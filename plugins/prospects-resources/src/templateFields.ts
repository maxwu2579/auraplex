// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import core from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import { createQuery } from '@hcengineering/presentation'
import prospects, { isBuiltinProspectField, type BuiltinProspectField, type ProspectFieldDef, type ProspectTemplate } from '@hcengineering/prospects'

const builtinLabels: Record<BuiltinProspectField, IntlString> = {
  name: prospects.string.PageName,
  company: prospects.string.PageCompany,
  title: prospects.string.PageJobTitle,
  mobile: prospects.string.PageMobile,
  phone: prospects.string.PagePhone,
  email: prospects.string.PageEmail,
  website: prospects.string.PageWebsite,
  address: prospects.string.PageAddress,
  country: prospects.string.PageCountry,
  industry: prospects.string.PageIndustry,
  source: prospects.string.PageSource,
  notes: prospects.string.PageNotes
}

export function prospectFieldLabel (field: ProspectFieldDef, local: (label: IntlString) => string): string {
  if (field.label !== '') return field.label
  return isBuiltinProspectField(field.key) ? local(builtinLabels[field.key]) : field.key
}

export function watchProspectTemplate (update: (template: ProspectTemplate | undefined) => void): void {
  createQuery().query(prospects.class.ProspectTemplate, { _id: prospects.template.Default, space: core.space.Workspace },
    (docs) => { update(docs[0]) })
}
