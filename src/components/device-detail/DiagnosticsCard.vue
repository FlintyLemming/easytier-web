<script setup lang="ts">
import { ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getLoggerLevel, nodeAclStats, nodeInfo, setLoggerLevel } from '../../api/client'
import type { NodeAclRuleStat } from '../../api/types'
import { useToast } from '../../composables/useToast'
import { formatBytes } from '../../domain/format'
import CopyButton from '../ui/CopyButton.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import LinkButton from './LinkButton.vue'
import { errorMessage } from './writes'

const props = defineProps<{ deviceId: string; networkId: string; online: boolean }>()
const { t } = useI18n()
const toast = useToast()
const bodyId = useId()
const levelId = useId()

const LEVELS = ['DISABLED', 'ERROR', 'WARNING', 'INFO', 'DEBUG', 'TRACE']

type Slot<T> = { state: 'idle' | 'loading' | 'ready' | 'error'; value: T | null; error: string }
const slot = <T,>(): Slot<T> => ({ state: 'idle', value: null, error: '' })

const open = ref(false)
const level = ref<Slot<number>>(slot())
const acl = ref<Slot<NodeAclRuleStat[]>>(slot())
const toml = ref<Slot<string>>(slot())
const savingLevel = ref(false)
let seq = 0

async function fill<T>(target: { value: Slot<T> }, run: () => Promise<T>, mySeq: number) {
  target.value = { state: 'loading', value: target.value.value, error: '' }
  try {
    const v = await run()
    if (mySeq === seq) target.value = { state: 'ready', value: v, error: '' }
  } catch (e) {
    if (mySeq === seq) target.value = { state: 'error', value: null, error: errorMessage(e) }
  }
}

const busy = () => [level, acl, toml].some((x) => x.value.state === 'loading')

function load() {
  if (!open.value || !props.online || busy()) return
  const s = ++seq
  void fill(level, () => getLoggerLevel(props.deviceId), s)
  void fill(acl, () => nodeAclStats(props.deviceId, props.networkId), s)
  void fill(toml, async () => (await nodeInfo(props.deviceId, props.networkId)).config, s)
}

function toggle() {
  open.value = !open.value
  if (open.value) load()
}

watch(() => props.online, (v) => { if (v) load() })

async function changeLevel(e: Event) {
  const next = Number((e.target as HTMLSelectElement).value)
  const prev = level.value.value
  level.value = { ...level.value, value: next }
  savingLevel.value = true
  try {
    await setLoggerLevel(props.deviceId, next)
    toast.success(t('detail.diagnostics.logLevelSaved'))
  } catch (err) {
    level.value = { ...level.value, value: prev }
    toast.error(t('detail.diagnostics.logLevelFailed', { message: errorMessage(err) }))
  } finally {
    savingLevel.value = false
  }
}

const count = (v: number | string | undefined) => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n.toLocaleString() : '—'
}
const bytes = (v: number | string | undefined) => formatBytes(Number(v ?? 0))
</script>

<template>
  <section data-testid="diagnostics-card" class="rounded-card border border-hairline bg-surface-card">
    <h2 class="text-[11px]">
      <button
        type="button"
        :aria-expanded="open ? 'true' : 'false'"
        :aria-controls="bodyId"
        class="flex w-full cursor-pointer items-center justify-between gap-3 rounded-card px-5 py-3 text-left hover:bg-canvas-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink"
        @click="toggle"
      >
        <span class="caption-uppercase text-muted">{{ t('detail.diagnostics.title') }}</span>
        <svg
          class="text-muted transition-transform"
          :class="open ? 'rotate-180' : ''"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </h2>

    <div v-if="open" :id="bodyId" class="flex flex-col gap-6 border-t border-hairline-soft p-5">
      <p v-if="!online" class="text-[14px] text-muted">{{ t('detail.diagnostics.offline') }}</p>
      <template v-else>
        <!-- log level -->
        <div class="flex items-end justify-between gap-3">
          <div class="flex flex-col gap-1.5">
            <label :for="levelId" class="caption-uppercase text-muted">{{ t('detail.diagnostics.logLevel') }}</label>
            <SkeletonRows v-if="level.state === 'loading' && level.value === null" :rows="1" class="w-48" />
            <p v-else-if="level.state === 'error'" class="text-[13px] text-error">
              {{ t('detail.diagnostics.loadFailed', { message: level.error }) }}
            </p>
            <select
              v-else
              :id="levelId"
              :value="String(level.value ?? 0)"
              :disabled="savingLevel"
              class="h-[30px] w-48 cursor-pointer rounded-control border border-hairline-strong bg-surface-card px-2 font-mono text-[13px] text-ink focus:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50"
              @change="changeLevel"
            >
              <option v-for="(name, i) in LEVELS" :key="name" :value="String(i)">{{ name }}</option>
            </select>
          </div>
          <LinkButton class="mb-1.5" @click="load">{{ t('detail.diagnostics.refresh') }}</LinkButton>
        </div>

        <!-- ACL rule hits -->
        <div class="flex flex-col gap-1.5">
          <h3 class="caption-uppercase text-muted">{{ t('detail.diagnostics.acl') }}</h3>
          <SkeletonRows v-if="acl.state === 'loading' && acl.value === null" :rows="2" />
          <p v-else-if="acl.state === 'error'" class="text-[13px] text-error">
            {{ t('detail.diagnostics.loadFailed', { message: acl.error }) }}
          </p>
          <p v-else-if="!acl.value || acl.value.length === 0" class="text-[13px] text-muted">{{ t('detail.diagnostics.aclEmpty') }}</p>
          <div v-else class="overflow-x-auto">
            <table :aria-label="t('detail.diagnostics.acl')" class="w-full border-collapse text-left text-[13px]">
              <thead>
                <tr class="text-[12px] text-muted">
                  <th scope="col" class="py-1.5 pr-3 font-normal">{{ t('detail.diagnostics.aclRule') }}</th>
                  <th scope="col" class="px-3 py-1.5 text-right font-normal">{{ t('detail.diagnostics.aclPackets') }}</th>
                  <th scope="col" class="py-1.5 pl-3 text-right font-normal">{{ t('detail.diagnostics.aclBytes') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in acl.value" :key="i" class="border-t border-hairline-soft">
                  <td class="py-1.5 pr-3 font-mono text-[12px] break-all text-ink">{{ r.rule?.name || '—' }}</td>
                  <td class="px-3 py-1.5 text-right font-mono text-[12px] whitespace-nowrap text-body">{{ count(r.stat?.packet_count) }}</td>
                  <td class="py-1.5 pl-3 text-right font-mono text-[12px] whitespace-nowrap text-body">{{ bytes(r.stat?.byte_count) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- running TOML -->
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2">
            <h3 class="caption-uppercase text-muted">{{ t('detail.diagnostics.toml') }}</h3>
            <CopyButton v-if="toml.state === 'ready' && toml.value" :text="toml.value" :label="t('detail.diagnostics.copyToml')" />
          </div>
          <SkeletonRows v-if="toml.state === 'loading' && toml.value === null" :rows="4" />
          <p v-else-if="toml.state === 'error'" class="text-[13px] text-error">
            {{ t('detail.diagnostics.loadFailed', { message: toml.error }) }}
          </p>
          <pre
            v-else
            data-testid="running-toml"
            class="max-h-80 overflow-auto rounded-control border border-hairline-soft bg-canvas-soft p-3 font-mono text-[12px] leading-5 text-ink"
          >{{ toml.value }}</pre>
        </div>
      </template>
    </div>
  </section>
</template>
