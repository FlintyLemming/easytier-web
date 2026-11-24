<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { addMembers } from '../../api/client'
import { useToast } from '../../composables/useToast'
import type { DeviceView } from '../../domain/devices'
import { MEMBER_TTLS } from '../../domain/networks'
import { useInventory } from '../../stores/inventory'
import CheckboxField from '../config-editor/CheckboxField.vue'
import { FIELD_CLASS, LABEL_CLASS } from '../config-editor/styles'
import { errorMessage, refreshInventoryFresh } from '../device-detail/writes'
import StatusDot from '../ui/StatusDot.vue'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiInput from '../ui/UiInput.vue'

const props = defineProps<{ networkId: string; secure: boolean }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const toast = useToast()
const inventory = useInventory()
const ttlId = useId()

const memberIds = computed(() => new Set((inventory.membersByNetwork[props.networkId] ?? []).map((m) => m.device_id)))
/** Devices with a machine id that are not in this network yet. */
const candidates = computed<DeviceView[]>(() =>
  inventory.devices
    .filter((d) => !d.pending && !memberIds.value.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
)
const query = ref('')
const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return candidates.value
  return candidates.value.filter((d) => d.name.toLowerCase().includes(q) || d.hostname.toLowerCase().includes(q))
})

const selected = ref(new Set<string>())
const temporary = ref(false)
const ttlHours = ref(168)
const busy = ref(false)

watch(open, (v) => {
  if (!v) return
  selected.value = new Set()
  query.value = ''
  temporary.value = false
  ttlHours.value = 168
})

function toggle(id: string, on: boolean) {
  const next = new Set(selected.value)
  if (on) next.add(id)
  else next.delete(id)
  selected.value = next
}

function setOpen(v: boolean) {
  if (!busy.value) open.value = v
}

async function submit() {
  const ids = candidates.value.filter((d) => selected.value.has(d.id)).map((d) => d.id)
  if (ids.length === 0 || busy.value) return
  busy.value = true
  try {
    const temp = props.secure && temporary.value
    await addMembers(props.networkId, ids, temp ? { temporary: true, ttlSeconds: ttlHours.value * 3600 } : undefined)
    toast.success(t('network.addMembers.added', { n: ids.length }, ids.length))
    busy.value = false
    open.value = false
    await refreshInventoryFresh()
  } catch (e) {
    toast.error(t('network.addMembers.failed', { message: errorMessage(e) }))
  } finally {
    busy.value = false
  }
}

const count = computed(() => candidates.value.filter((d) => selected.value.has(d.id)).length)
</script>

<template>
  <UiDialog :open="open" size="wide" :title="t('network.addMembers.title')" @update:open="setOpen">
    <div class="flex flex-col gap-4">
      <p v-if="candidates.length === 0" class="text-[14px] text-muted">{{ t('network.addMembers.none') }}</p>
      <template v-else>
        <UiInput v-if="candidates.length > 8" v-model="query" :placeholder="t('network.addMembers.search')" :disabled="busy" />
        <ul class="flex max-h-80 flex-col overflow-y-auto rounded-control border border-hairline">
          <li v-for="d in shown" :key="d.id" class="border-t border-hairline-soft first:border-t-0">
            <label class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-canvas-soft">
              <input
                type="checkbox"
                class="h-4 w-4 shrink-0 accent-ink"
                :checked="selected.has(d.id)"
                :disabled="busy"
                @change="toggle(d.id, ($event.target as HTMLInputElement).checked)"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[14px] text-ink">{{ d.name }}</span>
                <span class="block truncate text-[12px] text-muted">{{ d.os || '—' }}</span>
              </span>
              <span class="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
                <StatusDot :online="d.online" />{{ d.online ? t('common.online') : t('common.offline') }}
              </span>
            </label>
          </li>
        </ul>
      </template>

      <div v-if="secure" class="flex flex-col gap-2">
        <CheckboxField v-model="temporary" :label="t('network.addMembers.temporary')" :help="t('network.addMembers.temporaryHint')" />
        <div v-if="temporary" class="flex flex-col gap-1.5 pl-6">
          <label :for="ttlId" :class="LABEL_CLASS">{{ t('network.addMembers.ttl') }}</label>
          <select :id="ttlId" v-model.number="ttlHours" :class="[FIELD_CLASS, 'border-hairline-strong max-w-48']" :disabled="busy">
            <option v-for="o in MEMBER_TTLS" :key="o.key" :value="o.hours">{{ t(`network.ttl.${o.key}`) }}</option>
          </select>
        </div>
      </div>
    </div>
    <template #footer>
      <UiButton :disabled="busy" @click="setOpen(false)">{{ t('common.cancel') }}</UiButton>
      <UiButton :loading="busy" :disabled="count === 0" @click="submit">{{ t('network.addMembers.submit', { n: count }, count) }}</UiButton>
    </template>
  </UiDialog>
</template>
