<!--
// Copyright © 2022 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import core, { Class, Doc, Obj, Ref, isOwnerOrMaintainer } from '@hcengineering/core'
  import { IntlString, translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import {
    AnySvelteComponent,
    Scroller,
    ButtonIcon,
    IconDescription,
    Label,
    getLocation,
    navigate,
    Header,
    Breadcrumb,
    defineSeparators,
    twoPanelsSeparators,
    Separator,
    NavGroup,
    SearchInput,
    languageStore
  } from '@hcengineering/ui'
  import setting from '../plugin'
  import { filterDescendants } from '../utils'
  import ClassAttributes from './ClassAttributes.svelte'
  import ClassHierarchy from './ClassHierarchy.svelte'
  import { clearSettingsStore } from '../store'

  export let ofClass: Ref<Class<Obj>> | undefined = undefined
  export let attributeMapper:
  | {
    component: AnySvelteComponent
    label: IntlString
    props: Record<string, any>
  }
  | undefined = undefined
  export let withoutHeader = false
  export let useOfClassAttributes = true

  const canEdit = isOwnerOrMaintainer()

  const loc = getLocation()
  const client = getClient()
  const hierarchy = client.getHierarchy()

  let _class: Ref<Class<Doc>> | undefined = ofClass ?? (loc.query?._class as Ref<Class<Doc>> | undefined)

  $: if (_class !== undefined && ofClass === undefined) {
    const loc = getLocation()
    loc.query = undefined
    navigate(loc, true)
  }

  const clQuery = createQuery()

  let classes: Ref<Class<Doc>>[] = []
  let rawClasses: Class<Doc>[] = []

  clQuery.query(core.class.Class, {}, (res) => {
    rawClasses = res
  })

  $: classes = filterDescendants(hierarchy, ofClass, rawClasses)
  $: if (ofClass !== undefined) {
    // We need to include all possible mixins as well
    for (const ancestor of hierarchy.getAncestors(ofClass)) {
      if (ancestor === ofClass) {
        continue
      }
      const mixins = hierarchy.getDescendants(ancestor).filter((it) => hierarchy.isMixin(it))
      for (const m of mixins) {
        const mm = hierarchy.getClass(m)
        if (
          !classes.includes(m) &&
          mm.extends === ancestor &&
          mm.label !== undefined &&
          client.getHierarchy().hasMixin(mm, setting.mixin.Editable)
        ) {
          // Check if parent of
          classes.push(m)
        }
      }
    }
  }

  $: if (ofClass !== undefined && _class !== undefined && !client.getHierarchy().isDerived(_class, ofClass)) {
    _class = ofClass
  }
  // Auraplex: search localized class names and surface frequently used categories.
  const commonIds = [
    'contact:class:Person',
    'contact:class:Organization',
    'tracker:class:Issue',
    'departments:class:Order',
    'materials:class:Material'
  ] as Array<Ref<Class<Doc>>>
  let search: string | undefined
  $: commonClasses = ofClass === undefined
    ? commonIds.filter(id => rawClasses.some(candidate => candidate._id === id && candidate.hidden !== true && candidate.label !== undefined))
    : []
  $: commonMatches = commonClasses.filter((id) => matches === undefined || matches.has(id))
  $: term = search?.trim().toLocaleLowerCase() ?? ''
  // Auraplex: keep the previous result on screen until the new search finishes, so the list doesn't flash empty.
  let matches: Set<Ref<Class<Doc>>> | undefined
  let searchRun = 0
  $: void updateMatches(rawClasses, term, $languageStore)

  async function updateMatches (candidates: Class<Doc>[], term: string, language: string): Promise<void> {
    const run = ++searchRun
    const result = term === '' ? undefined : await matchClasses(candidates, term, language)
    if (run === searchRun) matches = result
  }

  async function matchClasses (
    candidates: Class<Doc>[],
    term: string,
    language: string
  ): Promise<Set<Ref<Class<Doc>>>> {
    const languages = [...new Set([language, 'en', 'zh'])]
    const matches = await Promise.all(candidates.map(async (candidate) => {
      if (candidate.hidden === true || candidate.label === undefined) return undefined
      const names = await Promise.allSettled(languages.map(language => translate(candidate.label, {}, language)))
      return names.some(name => name.status === 'fulfilled' && name.value.toLocaleLowerCase().includes(term))
        ? candidate._id
        : undefined
    }))
    return new Set(matches.filter((id): id is Ref<Class<Doc>> => id !== undefined))
  }

  function selectClass (id: Ref<Class<Doc>>): void {
    _class = id
    clearSettingsStore()
  }

  defineSeparators('workspaceSettings', twoPanelsSeparators)
</script>

<div class="hulyComponent">
  {#if !withoutHeader}
    <Header adaptive={'disabled'}>
      <Breadcrumb icon={setting.icon.Clazz} label={setting.string.ClassSetting} size={'large'} isCurrent />
    </Header>
  {/if}
  <div class="hulyComponent-content__container columns">
    <div class="hulyComponent-content__column">
      <div class="hulyComponent-content__navHeader divide">
        <div class="hulyComponent-content__navHeader-menu">
          <ButtonIcon kind={'tertiary'} icon={IconDescription} size={'small'} inheritColor />
        </div>
        <div class="hulyComponent-content__navHeader-hint paragraph-regular-14">
          <Label label={ofClass === undefined ? setting.string.ClassDirectoryHint : setting.string.ClassSettingHint} />
        </div>
      </div>
      {#if ofClass === undefined}
        <div class="p-3">
          <SearchInput bind:value={search} placeholder={setting.string.ClassDirectorySearch} />
        </div>
      {/if}
      <Scroller>
        {#if commonMatches.length > 0}
          <NavGroup label={setting.string.ClassDirectoryCommon} categoryName="common-classes" noDivider isFold>
            <ClassHierarchy classes={commonMatches} {_class} flat on:select={(event) => { selectClass(event.detail) }} />
          </NavGroup>
        {/if}
        <!-- Auraplex: common types also stay in the full tree, so their sub-types keep their parent -->
        <NavGroup label={setting.string.Classes} highlighted={_class !== undefined} categoryName="classes" noDivider isFold>
          <ClassHierarchy
            {classes}
            {_class}
            {ofClass}
            {matches}
            on:select={(event) => { selectClass(event.detail) }}
          />
        </NavGroup>
      </Scroller>
    </div>
    <Separator name={'workspaceSettings'} index={0} color={'var(--theme-divider-color)'} />
    <div class="hulyComponent-content__column content">
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        <div class="hulyComponent-content">
          {#if _class !== undefined}
            <ClassAttributes {_class} {ofClass} {attributeMapper} disabled={!canEdit} />
          {/if}
        </div>
      </Scroller>
    </div>
  </div>
</div>
