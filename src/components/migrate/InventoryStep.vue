<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CentralNetworkSummary } from '../../api/types'
import type { DeviceRef, LegacyGroup } from '../../domain/migration/types'
import { useNarrow } from '../../composables/useNarrow'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  groups: LegacyGroup[]
  offline: DeviceRef[]
  failed: { device: DeviceRef; message: string }[]
  loading: boolean
  progress: { done: number; total: number }
  networks: CentralNetworkSummary[]
  hasJournal: boolean
}>()
const emit = defineEmits<{ select: [networkName: string]; retry: [deviceId: string]; reload: []; report: [] }>()
const { t } = useI18n()
const narrow = useNarrow(640)

function targetText(g: LegacyGroup): string {
  if (!g.targetNetworkId) return t('migrate.inventory.targetNew')
  const n = props.networks.find((x) => x.network_id === g.targetNetworkId)
  return t('migrate.inventory.targetExisting', { name: n?.display_name ?? g.networkName })
}
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="wizard-step-inventory">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p v-if="loading" class="text-[14px] text-muted" role="status">
        {{ t('migrate.inventory.progress', { done: progress.done, total: progress.total }) }}
      </p>
      <span v-else />
      <div class="flex gap-2">
        <UiButton v-if="hasJournal" size="sm" @click="emit('report')">{{ t('migrate.inventory.report') }}</UiButton>
        <UiButton size="sm" :disabled="loading" @click="emit('reload')">{{ t('migrate.inventory.reload') }}</UiButton>
      </div>
    </div>

    <SkeletonRows v-if="loading && groups.length === 0" :rows="3" />

    <EmptyState v-else-if="groups.length === 0" :title="t('migrate.inventory.empty')" :body="t('migrate.inventory.emptyBody')" />

    <ul v-else-if="narrow" class="flex flex-col gap-3">
      <li v-for="g in groups" :key="g.networkName" data-testid="legacy-group" class="rounded-card border border-hairline bg-surface-card p-4">
        <div class="font-mono text-[14px] text-ink">{{ g.networkName }}</div>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          <span>{{ t('migrate.inventory.cols.instances') }} <span data-testid="count-instances" class="font-mono text-ink">{{ g.instances.length }}</span></span>
          <span>{{ t('migrate.inventory.cols.running') }} <span data-testid="count-running" class="font-mono text-ink">{{ g.runningCount }}</span></span>
          <span>{{ t('migrate.inventory.cols.disabled') }} <span data-testid="count-disabled" class="font-mono text-ink">{{ g.disabledCount }}</span></span>
          <span>{{ targetText(g) }}</span>
        </div>
        <UiButton class="mt-3" size="sm" @click="emit('select', g.networkName)">{{ t('migrate.inventory.migrate') }}</UiButton>
      </li>
    </ul>

    <div v-else class="overflow-hidden rounded-card border border-hairline bg-surface-card">
      <table class="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('migrate.inventory.cols.name') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('migrate.inventory.cols.instances') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('migrate.inventory.cols.running') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('migrate.inventory.cols.disabled') }}</th>
            <th scope="col" class="caption-uppercase px-4 py-3 text-muted">{{ t('migrate.inventory.cols.target') }}</th>
            <th scope="col"><span class="sr-only">{{ t('migrate.inventory.migrate') }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in groups" :key="g.networkName" data-testid="legacy-group" class="border-t border-hairline-soft">
            <td class="px-4 py-3 font-mono text-ink">{{ g.networkName }}</td>
            <td class="px-4 py-3 font-mono" data-testid="count-instances">{{ g.instances.length }}</td>
            <td class="px-4 py-3 font-mono" data-testid="count-running">{{ g.runningCount }}</td>
            <td class="px-4 py-3 font-mono" data-testid="count-disabled">{{ g.disabledCount }}</td>
            <td class="px-4 py-3 text-body">{{ targetText(g) }}</td>
            <td class="px-4 py-3 text-right">
              <UiButton size="sm" @click="emit('select', g.networkName)">{{ t('migrate.inventory.migrate') }}</UiButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="offline.length" data-testid="offline-devices" class="rounded-card border border-hairline bg-surface-card px-5 py-4">
      <h2 class="caption-uppercase text-muted">{{ t('migrate.inventory.offline', { n: offline.length }) }}</h2>
      <p class="mt-1 text-[13px] text-muted">{{ t('migrate.inventory.offlineBody') }}</p>
      <p class="mt-2 text-[14px] text-ink">{{ offline.map((d) => d.name).join('、') }}</p>
    </section>

    <section v-if="failed.length" data-testid="failed-devices" class="rounded-card border border-hairline bg-surface-card px-5 py-4">
      <h2 class="caption-uppercase text-error">{{ t('migrate.inventory.failed', { n: failed.length }) }}</h2>
      <ul class="mt-2 flex flex-col gap-2">
        <li v-for="f in failed" :key="f.device.id" class="flex flex-wrap items-center justify-between gap-2 text-[14px]">
          <span><span class="text-ink">{{ f.device.name }}</span> <span class="text-muted">· {{ f.message }}</span></span>
          <UiButton size="sm" @click="emit('retry', f.device.id)">{{ t('migrate.inventory.retry') }}</UiButton>
        </li>
      </ul>
    </section>
  </div>
</template>
