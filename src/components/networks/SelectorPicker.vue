<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LABEL_CLASS } from '../config-editor/styles'
import UiInput from '../ui/UiInput.vue'
import type { SelectorOption } from './aclLabels'

/** A searchable checkbox list of ACL selectors; 「全部成员」 (`all`) excludes the others. */
const props = defineProps<{ label: string; options: SelectorOption[]; error?: string }>()
const keys = defineModel<string[]>({ required: true })
const { t } = useI18n()
const query = ref('')

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return q ? props.options.filter((o) => o.key === 'all' || o.label.toLowerCase().includes(q)) : props.options
})
const allOn = computed(() => keys.value.includes('all'))

function toggle(key: string, on: boolean) {
  keys.value = on ? [...keys.value, key] : keys.value.filter((k) => k !== key)
}
</script>

<template>
  <div role="group" :aria-label="label" class="flex flex-col gap-1.5">
    <span :class="LABEL_CLASS" aria-hidden="true">{{ label }}</span>
    <UiInput v-if="options.length > 8" v-model="query" :placeholder="t('acl.search')" />
    <ul class="flex max-h-56 flex-col overflow-y-auto rounded-control border" :class="error ? 'border-error' : 'border-hairline'">
      <li v-for="o in shown" :key="o.key" class="border-t border-hairline-soft first:border-t-0">
        <label class="flex items-center gap-3 px-3 py-2" :class="allOn && o.key !== 'all' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-canvas-soft'">
          <input
            type="checkbox"
            class="h-4 w-4 shrink-0 accent-ink"
            :checked="keys.includes(o.key)"
            :disabled="allOn && o.key !== 'all'"
            @change="toggle(o.key, ($event.target as HTMLInputElement).checked)"
          />
          <span class="min-w-0 truncate text-[14px] text-ink">{{ o.label }}</span>
        </label>
      </li>
    </ul>
    <p v-if="error" class="text-[12px] text-error">{{ error }}</p>
  </div>
</template>
