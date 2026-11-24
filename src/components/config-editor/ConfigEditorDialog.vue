<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { NetworkConfig } from '../../lib/networkConfig'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import ConfigEditor from './ConfigEditor.vue'
import { cloneConfig } from './rules'

const props = defineProps<{
  title: string
  mode: 'member' | 'instance'
  initial: NetworkConfig
  /** The device's `easytier_version`. */
  coreVersion: string
  busy: boolean
  /** Shown above the form. */
  note?: string
  actions: { key: string; label: string }[]
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ action: [key: string, config: NetworkConfig] }>()
const { t } = useI18n()

// A snapshot per opening: a parent re-rendering `initial` must not wipe the edits under way.
const start = shallowRef(cloneConfig(props.initial))
const session = ref(0)
const editor = ref<InstanceType<typeof ConfigEditor> | null>(null)
const valid = ref(true)
const flushing = ref(false)
const lastKey = ref<string | null>(null)

watch(open, (v) => {
  if (!v) return
  start.value = cloneConfig(props.initial)
  session.value++
})

async function run(key: string) {
  if (!editor.value || flushing.value || props.busy || !valid.value) return
  lastKey.value = key
  flushing.value = true
  try {
    const config = await editor.value.flush()
    // Closed while the TOML was being parsed: the user walked away from this save.
    if (config && open.value) emit('action', key, config)
  } finally {
    flushing.value = false
  }
}
</script>

<template>
  <UiDialog v-model:open="open" :title="title" size="lg">
    <p v-if="note" class="mb-5 text-[13px] text-muted">{{ note }}</p>
    <ConfigEditor
      :key="session"
      ref="editor"
      :model-value="start"
      :mode="mode"
      :core-version="coreVersion"
      @update:valid="valid = $event"
    />
    <template #footer>
      <UiButton variant="text" @click="open = false">{{ t('common.cancel') }}</UiButton>
      <UiButton
        v-for="a in actions"
        :key="a.key"
        variant="secondary"
        :loading="(busy || flushing) && lastKey === a.key"
        :disabled="!valid || busy || flushing"
        @click="run(a.key)"
      >
        {{ a.label }}
      </UiButton>
    </template>
  </UiDialog>
</template>
