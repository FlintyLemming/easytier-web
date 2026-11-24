<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeKey, DevicePreview } from '../../domain/migration/classify'
import { blockerText, changeText } from './changeText'

const props = defineProps<{
  preview: DevicePreview
  /** The user's choice (迁移 = true). */
  choice: boolean
  confirmed: ChangeKey[]
}>()
const emit = defineEmits<{ 'update:choice': [value: boolean]; 'update:confirmed': [value: ChangeKey[]] }>()
const { t } = useI18n()
const radioName = useId()
const showAcl = ref(false)

/** Blockers the user cannot resolve here (unlike a duplicate IP, which depends on the choices). */
const hardBlocked = computed(() => props.preview.blockers.some((b) => b.kind !== 'duplicateIp'))
const locked = computed(() => hardBlocked.value || props.preview.alreadyMember)
const shownChoice = computed(() => (locked.value ? false : props.choice))
const member = computed(() => props.preview.plan.member)
const overrideEntries = computed(() => Object.entries(props.preview.plan.override))
const changes = computed(() => props.preview.plan.changes)
const hasAcl = computed(() => changes.value.some((c) => c.key === 'acl'))

function toggle(key: ChangeKey, on: boolean) {
  const set = new Set(props.confirmed)
  if (on) set.add(key)
  else set.delete(key)
  emit('update:confirmed', [...set])
}
const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
</script>

<template>
  <article data-testid="device-preview" class="rounded-card border border-hairline bg-surface-card">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-hairline-soft px-5 py-3">
      <div class="min-w-0">
        <h3 class="truncate text-[15px] font-medium text-ink">{{ preview.device.name }}</h3>
        <p class="truncate font-mono text-[12px] text-muted">{{ preview.instance.instanceId }}</p>
      </div>
      <div
        v-if="!preview.alreadyMember"
        role="radiogroup"
        :aria-label="t('migrate.preview.choiceLabel', { name: preview.device.name })"
        class="inline-flex overflow-hidden rounded-control border border-hairline-strong text-[13px]"
      >
        <label
          class="flex cursor-pointer items-center px-3 py-1.5"
          :class="[shownChoice ? 'bg-ink text-white' : 'text-ink', locked ? 'cursor-not-allowed opacity-50' : '']"
        >
          <input
            type="radio"
            class="sr-only"
            :name="radioName"
            :checked="shownChoice"
            :disabled="locked"
            @change="emit('update:choice', true)"
          />{{ t('migrate.preview.migrate') }}
        </label>
        <label class="flex cursor-pointer items-center border-l border-hairline-strong px-3 py-1.5" :class="!shownChoice ? 'bg-ink text-white' : 'text-ink'">
          <input type="radio" class="sr-only" :name="radioName" :checked="!shownChoice" @change="emit('update:choice', false)" />{{
            t('migrate.preview.skip')
          }}
        </label>
      </div>
      <span v-else class="text-[13px] text-muted">{{ t('migrate.preview.alreadyMember') }}</span>
    </header>

    <div class="flex flex-col gap-4 px-5 py-4 text-[14px]">
      <p v-if="preview.alreadyMember" class="text-[13px] text-muted">{{ t('migrate.preview.leftover') }}</p>
      <p v-else-if="!preview.instance.running" class="text-[13px] text-muted">{{ t('migrate.preview.disabledNote') }}</p>
      <ul v-if="preview.blockers.length" class="flex flex-col gap-1">
        <li v-for="(b, i) in preview.blockers" :key="i" class="text-[13px] text-error">{{ blockerText(t, b) }}</li>
      </ul>

      <section data-testid="member-fields">
        <h4 class="caption-uppercase text-muted">{{ t('migrate.preview.memberFields') }}</h4>
        <dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
          <dt class="text-muted">{{ t('migrate.preview.fixedIp') }}</dt>
          <dd class="break-all font-mono text-ink">{{ member.virtualIpv4 ?? '—' }}</dd>
          <dt class="text-muted">{{ t('migrate.preview.hostnameOverride') }}</dt>
          <dd class="break-all font-mono text-ink">{{ member.hostnameOverride ?? '—' }}</dd>
          <dt class="text-muted">{{ t('migrate.preview.proxyCidrs') }}</dt>
          <dd class="break-all font-mono text-ink">{{ member.proxyCidrs.length ? member.proxyCidrs.join(', ') : '—' }}</dd>
        </dl>
      </section>

      <section data-testid="override-fields">
        <h4 class="caption-uppercase text-muted">{{ t('migrate.preview.overrideFields') }}</h4>
        <p v-if="overrideEntries.length === 0" class="mt-2 text-muted">{{ t('migrate.preview.noOverride') }}</p>
        <ul v-else class="mt-2 flex flex-col gap-1 font-mono text-[13px]">
          <li v-for="[k, v] in overrideEntries" :key="k" class="break-all"><span class="text-muted">{{ k }}</span> = {{ show(v) }}</li>
        </ul>
      </section>

      <section v-if="changes.length" data-testid="changes">
        <h4 class="caption-uppercase text-error">{{ t('migrate.preview.changes') }}</h4>
        <ul class="mt-2 flex flex-col gap-2">
          <li v-for="c in changes" :key="c.key" class="flex flex-col gap-1">
            <span class="break-all text-ink">{{ changeText(t, c) }}</span>
            <label class="inline-flex items-center gap-2 text-[13px] text-body">
              <input
                type="checkbox"
                class="h-4 w-4 accent-ink"
                :checked="confirmed.includes(c.key)"
                @change="toggle(c.key, ($event.target as HTMLInputElement).checked)"
              />{{ t('migrate.preview.understood') }}
            </label>
          </li>
        </ul>
        <div v-if="hasAcl" class="mt-3 flex flex-col gap-2">
          <p class="text-[13px] text-muted">{{ t('migrate.preview.aclNote') }}</p>
          <button type="button" class="self-start text-[13px] text-ink underline underline-offset-2" @click="showAcl = !showAcl">
            {{ showAcl ? t('migrate.preview.hideAcl') : t('migrate.preview.showAcl') }}
          </button>
          <pre
            v-if="showAcl"
            data-testid="legacy-acl"
            class="max-h-64 overflow-auto rounded-control bg-canvas-soft p-3 font-mono text-[12px] whitespace-pre-wrap break-all text-ink"
          >{{ JSON.stringify(preview.plan.legacyAcl, null, 2) }}</pre>
        </div>
      </section>
    </div>
  </article>
</template>
