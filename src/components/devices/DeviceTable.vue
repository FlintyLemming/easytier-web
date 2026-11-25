<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { SortDir, SortKey } from '../../domain/deviceFilter'
import type { DeviceView } from '../../domain/devices'
import DeviceRow from './DeviceRow.vue'

defineProps<{
  devices: DeviceView[]
  now: Date
  primaryName: string | null
  joiningIds: Set<string>
  sortKey: SortKey | null
  sortDir: SortDir
  central?: boolean
}>()
defineEmits<{ sort: [key: SortKey]; join: [d: DeviceView]; rename: [d: DeviceView]; delete: [d: DeviceView] }>()
const { t } = useI18n()

const cols: { key: SortKey | null; label: string; width: string }[] = [
  { key: 'name', label: 'devices.cols.device', width: '27%' },
  { key: 'ip', label: 'devices.cols.ip', width: '20%' },
  { key: null, label: 'devices.cols.location', width: '19%' },
  { key: 'version', label: 'devices.cols.version', width: '16%' },
  { key: 'lastSeen', label: 'devices.cols.lastSeen', width: '14%' },
]
</script>

<template>
  <div class="overflow-hidden rounded-card border border-hairline bg-surface-card">
    <table class="w-full table-fixed border-collapse text-left">
      <colgroup>
        <col v-for="c in cols" :key="c.label" :style="{ width: c.width }" />
        <col style="width: 56px" />
      </colgroup>
      <thead>
        <tr>
          <th
            v-for="c in cols"
            :key="c.label"
            scope="col"
            class="caption-uppercase px-4 py-3 text-muted"
            :aria-sort="c.key && sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined"
          >
            <button
              v-if="c.key"
              type="button"
              data-testid="sort-header"
              class="group/sort inline-flex cursor-pointer items-center gap-1 uppercase hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              :class="sortKey === c.key ? 'text-ink' : ''"
              @click="$emit('sort', c.key)"
            >
              {{ t(c.label) }}
              <!-- Active column: its direction. Others: a faint up-down mark so every sortable header reads as clickable. -->
              <svg v-if="sortKey === c.key" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path v-if="sortDir === 'asc'" d="M12 19V5M6 11l6-6 6 6" />
                <path v-else d="M12 5v14M6 13l6 6 6-6" />
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="opacity-40 group-hover/sort:opacity-100" aria-hidden="true">
                <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
              </svg>
            </button>
            <template v-else>{{ t(c.label) }}</template>
          </th>
          <th scope="col" />
        </tr>
      </thead>
      <tbody>
        <DeviceRow
          v-for="d in devices"
          :key="d.id"
          :device="d"
          :now="now"
          :primary-name="primaryName"
          :joining="joiningIds.has(d.id)"
          :central="central ?? true"
          @join="$emit('join', d)"
          @rename="$emit('rename', d)"
          @delete="$emit('delete', d)"
        />
      </tbody>
    </table>
  </div>
</template>
