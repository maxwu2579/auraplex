<script lang="ts">
  import type { Ref } from '@hcengineering/core'
  import materials, { formatQuantity, type Material } from '@hcengineering/materials'
  import { createQuery } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'

  export let _id: Ref<Material>
  const query = createQuery()
  let material: Material | undefined
  $: query.query(materials.class.Material, { _id }, (items) => {
    material = items[0]
  })
</script>

{#if material}
  <section class="material-panel">
    <h2>{material.code} · {material.name}</h2>
    <p><Label label={materials.string.Stock} />: {formatQuantity(material.stock)} {material.unit}</p>
    <p><Label label={materials.string.MinimumStock} />: {material.minimumStock ?? '—'}</p>
    <p><Label label={materials.string.Location} />: {material.rack || '—'} / {material.level || '—'}</p>
    <p><Label label={materials.string.Model} />: {material.model || '—'}</p>
    <p><Label label={materials.string.Category} />: {material.category || '—'}</p>
    <p><Label label={materials.string.Notes} />: {material.notes || '—'}</p>
  </section>
{/if}

<style lang="scss">
  .material-panel {
    padding: 24px;
  }
</style>
