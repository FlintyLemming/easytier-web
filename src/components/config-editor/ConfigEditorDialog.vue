<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
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
  /**
   * The actions cannot run for now (e.g. the device went offline): they are disabled, but unlike
   * `busy` the draft stays editable and the dialog can still be closed.
   */
  disabled?: boolean
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

/** A save is under way (the parent's write, or this dialog parsing the TOML for it). */
const locked = computed(() => props.busy || flushing.value)

// Closing mid-save would drop the draft a failed save must keep, so 取消, Escape and the overlay
// do nothing until the save settles. The parent can still close the dialog through `open`.
function requestOpen(v: boolean) {
  if (!v && locked.value) return
  open.value = v
}

async function run(key: string) {
  if (!editor.value || flushing.value || props.busy || props.disabled || !valid.value) return
  lastKey.value = key
  flushing.value = true
  try {
    const config = await editor.value.flush()
    // The parent closed the dialog while the TOML was being parsed: drop this save.
    if (config && open.value) emit('action', key, config)
  } finally {
    flushing.value = false
  }
}
</script>

<template>
  <UiDialog :open="open" :title="title" size="lg" @update:open="requestOpen">
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
      <UiButton variant="text" :disabled="locked" @click="requestOpen(false)">{{ t('common.cancel') }}</UiButton>
      <UiButton
        v-for="a in actions"
        :key="a.key"
        variant="secondary"
        :loading="(busy || flushing) && lastKey === a.key"
        :disabled="!valid || locked || disabled"
        @click="run(a.key)"
      >
        {{ a.label }}
      </UiButton>
    </template>
  </UiDialog>
</template>
