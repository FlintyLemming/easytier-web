<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AclRule } from '../../api/types'
import { destinationKeys, sourceKeys } from '../../domain/acl'
import UiBadge from '../ui/UiBadge.vue'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  rule: AclRule
  first: boolean
  last: boolean
  busy: boolean
  selectorSummary: (keys: string[]) => string
  protocolSummary: (protocols: AclRule['protocols']) => string
}>()
const emit = defineEmits<{ toggle: []; up: []; down: []; edit: []; remove: [] }>()
const { t } = useI18n()

const flow = computed(() => `${props.selectorSummary(sourceKeys(props.rule.sources))} → ${props.selectorSummary(destinationKeys(props.rule.destinations))}`)
</script>

<template>
  <li data-testid="acl-rule" class="flex flex-col gap-3 border-t border-hairline-soft px-4 py-3 first:border-t-0 sm:flex-row sm:items-center">
    <div class="flex min-w-0 flex-1 items-start gap-3">
      <button
        type="button"
        role="switch"
        :aria-checked="rule.enabled ? 'true' : 'false'"
        :aria-label="t('acl.enableRule', { name: rule.name })"
        :disabled="busy"
        class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-50"
        :class="rule.enabled ? 'bg-ink' : 'bg-hairline-strong'"
        @click="emit('toggle')"
      >
        <span class="inline-block h-4 w-4 rounded-full bg-surface-card transition-transform" :class="rule.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'" />
      </button>
      <div class="min-w-0 flex-1" :class="rule.enabled ? '' : 'opacity-60'">
        <div class="flex flex-wrap items-center gap-2">
          <span class="truncate text-[14px] font-medium text-ink">{{ rule.name }}</span>
          <UiBadge :tone="rule.action === 'allow' ? 'success' : 'danger'">{{ t(`acl.${rule.action}`) }}</UiBadge>
        </div>
        <div class="mt-0.5 break-words text-[13px] text-body">{{ flow }}</div>
        <div class="font-mono text-[12px] text-muted">{{ protocolSummary(rule.protocols) }}</div>
      </div>
    </div>
    <div class="flex shrink-0 flex-wrap items-center gap-1">
      <UiButton v-if="!first" size="sm" variant="text" :disabled="busy" :aria-label="t('acl.moveUp', { name: rule.name })" @click="emit('up')">↑</UiButton>
      <UiButton v-if="!last" size="sm" variant="text" :disabled="busy" :aria-label="t('acl.moveDown', { name: rule.name })" @click="emit('down')">↓</UiButton>
      <UiButton size="sm" variant="text" :disabled="busy" :aria-label="t('acl.editRule', { name: rule.name })" @click="emit('edit')">{{ t('acl.edit') }}</UiButton>
      <UiButton size="sm" variant="text" :disabled="busy" :aria-label="t('acl.removeRule', { name: rule.name })" @click="emit('remove')">{{ t('acl.remove') }}</UiButton>
    </div>
  </li>
</template>
