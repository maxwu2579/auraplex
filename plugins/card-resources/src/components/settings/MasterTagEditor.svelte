<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { MasterTag, MasterTagEditorSection } from '@hcengineering/card'
  import { getClient } from '@hcengineering/presentation'
  import {
    Button,
    ButtonIcon,
    Component,
    IconAdd,
    IconDescription,
    NavItem,
    Scroller,
    SelectPopup,
    Separator,
    defineSeparators,
    eventToHTMLElement,
    secondNavSeparators,
    showPopup
  } from '@hcengineering/ui'
  import card from '../../plugin'

  export let masterTag: MasterTag
  export let visibleSecondNav: boolean = true
  export let readonly: boolean = true

  const client = getClient()

  $: isMasterTag = masterTag._class === card.class.MasterTag
  $: allSections = client
    .getModel()
    .findAllSync(card.class.MasterTagEditorSection, !isMasterTag ? { masterOnly: { $ne: true } } : {})

  // Auraplex: optional blocks are added or hidden per type; hiding keeps the data.
  const optionalSectionIds = new Set(['tags', 'childs', 'relations', 'roles', 'views'])
  interface AuraplexEditorSections {
    auraplexEditorSections?: string[]
  }
  $: shownOptional = (masterTag as MasterTag & AuraplexEditorSections).auraplexEditorSections ?? []
  $: sections = allSections.filter((it) => !optionalSectionIds.has(it.id) || shownOptional.includes(it.id))
  $: hiddenSections = allSections.filter((it) => optionalSectionIds.has(it.id) && !shownOptional.includes(it.id))

  async function setShownOptional (ids: string[]): Promise<void> {
    await client.update(masterTag, { auraplexEditorSections: ids } as any)
  }

  function addSection (ev: MouseEvent): void {
    showPopup(
      SelectPopup,
      { value: hiddenSections.map((it) => ({ id: it.id, label: it.label })) },
      eventToHTMLElement(ev),
      (id: string | undefined) => {
        if (id !== undefined) void setShownOptional([...shownOptional, id])
      }
    )
  }

  function hideSection (section: MasterTagEditorSection): void {
    void setShownOptional(shownOptional.filter((it) => it !== section.id))
  }

  const sectionRefs: Record<string, HTMLElement | undefined> = {}

  defineSeparators('spaceTypeEditor', secondNavSeparators)
</script>

<div class="hulyComponent-content__container columns">
  {#if visibleSecondNav}
    <div class="hulyComponent-content__column">
      <div class="hulyComponent-content__navHeader">
        <div class="hulyComponent-content__navHeader-menu">
          <ButtonIcon kind="tertiary" icon={IconDescription} size="small" inheritColor />
        </div>
      </div>
      {#each sections as navItem (navItem.id)}
        <NavItem
          type="type-anchor-link"
          label={navItem.label}
          on:click={() => {
            sectionRefs[navItem.id]?.scrollIntoView()
          }}
        />
      {/each}
    </div>
    <Separator name="spaceTypeEditor" index={0} color="transparent" />
  {/if}
  <div class="hulyComponent-content__column content">
    <Scroller align="center" padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
      <div class="hulyComponent-content gap">
        {#each sections as section, i}
          <div bind:this={sectionRefs[section.id]} class:hulyTableAttr-container={i}>
            {#if optionalSectionIds.has(section.id)}
              <div class="auraplex-hideSection">
                <Button
                  kind="ghost"
                  size="small"
                  label={card.string.HideEditorSection}
                  on:click={() => {
                    hideSection(section)
                  }}
                />
              </div>
            {/if}
            <Component
              is={section.component}
              disabled={readonly}
              props={{
                masterTag
              }}
            />
          </div>
        {/each}
        {#if hiddenSections.length > 0}
          <div class="auraplex-addSection">
            <Button kind="regular" icon={IconAdd} label={card.string.AddEditorSection} on:click={addSection} />
          </div>
        {/if}
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  /* Auraplex: small "Hide" button above each optional block, "Add section" below the list */
  .auraplex-hideSection {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 0.25rem;
  }
  .auraplex-addSection {
    display: flex;
    justify-content: center;
    padding: 0.5rem 0;
  }
</style>
