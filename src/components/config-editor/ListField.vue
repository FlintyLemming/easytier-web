<script setup lang="ts">
import { nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import AddButton from './AddButton.vue'
import { FIELD_CLASS, LABEL_CLASS, REMOVE_CLASS } from './styles'

/** An editable list of strings; `validate` returns the message to show under an item. */
defineProps<{ label: string; placeholder?: string; mono?: boolean; validate?: (value: string) => string | undefined }>()
const items = defineModel<string[]>({ required: true })
const { t } = useI18n()
const labelId = useId()
const list = ref<HTMLUListElement | null>(null)

function update(i: number, value: string) {
  items.value = items.value.map((x, j) => (j === i ? value : x))
}

function remove(i: number) {
  items.value = items.value.filter((_, j) => j !== i)
}

async function add() {
  items.value = [...items.value, '']
  await nextTick()
  list.value?.querySelector<HTMLInputElement>('li:last-child input')?.focus()
}
</script>

<template>
  <div role="group" :aria-labelledby="labelId" class="flex flex-col gap-1.5">
    <span :id="labelId" :class="LABEL_CLASS">{{ label }}</span>
    <ul v-if="items.length" ref="list" class="flex flex-col gap-2">
      <li v-for="(item, i) in items" :key="i" class="flex flex-col gap-1">
        <div class="flex gap-1">
          <input
            type="text"
            :value="item"
            :placeholder="placeholder"
            :aria-label="t('config.item', { label, n: i + 1 })"
            :aria-invalid="validate?.(item) ? 'true' : undefined"
            :class="[FIELD_CLASS, mono ? 'font-mono' : '', validate?.(item) ? 'border-error' : 'border-hairline-strong']"
            @input="update(i, ($event.target as HTMLInputElement).value)"
          />
          <button type="button" :aria-label="t('config.remove')" :class="REMOVE_CLASS" @click="remove(i)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <p v-if="validate?.(item)" class="text-[12px] text-error">{{ validate(item) }}</p>
      </li>
    </ul>
    <AddButton @click="add">{{ t('config.add') }}</AddButton>
  </div>
</template>
