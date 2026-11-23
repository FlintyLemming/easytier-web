<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CentralNetworkSummary } from '../../api/types'
import type { DeviceView } from '../../domain/devices'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'

const props = defineProps<{ device: DeviceView; networks: CentralNetworkSummary[]; busy?: boolean }>()
const emit = defineEmits<{ join: [networkId: string] }>()
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

/** Networks this device is not in yet. */
const choices = computed(() => props.networks.filter((n) => !props.device.networks.some((d) => d.id === n.network_id)))
const selected = ref<string | null>(null)

watch(open, (v) => {
  if (v) selected.value = choices.value[0]?.network_id ?? null
})

function submit() {
  if (selected.value) emit('join', selected.value)
}
</script>

<template>
  <UiDialog v-model:open="open" :title="t('detail.join.title')">
    <p v-if="choices.length === 0">{{ t('detail.join.none') }}</p>
    <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
      <p>{{ t('detail.join.body', { name: device.name }) }}</p>
      <fieldset class="flex max-h-72 flex-col gap-2 overflow-y-auto">
        <legend class="sr-only">{{ t('detail.join.title') }}</legend>
        <label
          v-for="n in choices"
          :key="n.network_id"
          class="flex cursor-pointer items-center gap-3 rounded-control border px-3 py-2.5"
          :class="selected === n.network_id ? 'border-ink' : 'border-hairline'"
        >
          <input v-model="selected" type="radio" name="join-network" :value="n.network_id" class="h-4 w-4 accent-ink" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-ink">{{ n.display_name }}</span>
            <span class="block font-mono text-[12px] text-muted">{{ n.virtual_cidr || '—' }}</span>
          </span>
          <span class="shrink-0 text-[12px] text-muted">{{ t('detail.join.members', { n: n.member_count }) }}</span>
        </label>
      </fieldset>
    </form>
    <template #footer>
      <UiButton variant="secondary" @click="open = false">{{ t('common.cancel') }}</UiButton>
      <UiButton
        v-if="choices.length > 0"
        variant="secondary"
        :loading="busy"
        :disabled="!selected"
        @click="submit"
      >
        {{ t('detail.join.confirm') }}
      </UiButton>
    </template>
  </UiDialog>
</template>
