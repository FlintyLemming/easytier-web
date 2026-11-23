<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { removeMember } from '../../api/client'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import type { DeviceView } from '../../domain/devices'
import { errorMessage, refreshInventoryFresh } from './writes'

const props = defineProps<{ device: DeviceView; networkId: string; networkName: string }>()
const emit = defineEmits<{ delete: [] }>()
const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const { confirm } = useConfirm()
const leaving = ref(false)

async function leave() {
  if (leaving.value) return
  const ok = await confirm({
    title: t('detail.danger.leave'),
    body: t('detail.danger.leaveBody', { name: props.device.name, network: props.networkName }),
    confirmLabel: t('detail.danger.leaveConfirm'),
    danger: true,
  })
  if (!ok) return
  leaving.value = true
  try {
    await removeMember(props.networkId, props.device.id)
    toast.success(t('detail.danger.left', { name: props.device.name, network: props.networkName }))
    await refreshInventoryFresh()
    await router.push({ name: 'device', params: { machineId: props.device.id } })
  } catch (e) {
    toast.error(t('detail.danger.leaveFailed', { message: errorMessage(e) }))
  } finally {
    leaving.value = false
  }
}

const linkClass =
  'cursor-pointer rounded-control text-[13px] underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
</script>

<template>
  <div data-testid="danger-zone" class="flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline px-1 pt-4">
    <button type="button" :class="[linkClass, 'text-body']" :disabled="leaving" :aria-busy="leaving ? 'true' : undefined" @click="leave">
      {{ t('detail.danger.leave') }}
    </button>
    <button type="button" :class="[linkClass, 'text-error']" @click="emit('delete')">{{ t('devices.delete') }}</button>
  </div>
</template>
