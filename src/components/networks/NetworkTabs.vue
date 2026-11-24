<script setup lang="ts" generic="K extends string">
import { nextTick, ref } from 'vue'

/** A row of tabs (`role="tablist"`); Left / Right move between them. */
const props = defineProps<{ tabs: { key: K; label: string }[]; label: string; panelId: (key: K) => string }>()
const active = defineModel<K>({ required: true })
const buttons = ref<HTMLButtonElement[]>([])

async function onKey(e: KeyboardEvent) {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const i = props.tabs.findIndex((x) => x.key === active.value)
  const next = props.tabs[(i + step + props.tabs.length) % props.tabs.length]!
  active.value = next.key
  await nextTick()
  buttons.value[props.tabs.indexOf(next)]?.focus()
}
</script>

<template>
  <div role="tablist" :aria-label="label" class="flex gap-6 border-b border-hairline" @keydown="onKey">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      ref="buttons"
      type="button"
      role="tab"
      :aria-selected="active === tab.key ? 'true' : 'false'"
      :aria-controls="panelId(tab.key)"
      :tabindex="active === tab.key ? 0 : -1"
      class="-mb-px cursor-pointer border-b-2 pb-2.5 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      :class="active === tab.key ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'"
      @click="active = tab.key"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
