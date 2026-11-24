<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ step: number }>()
const { t } = useI18n()
const STEPS = ['inventory', 'network', 'preview', 'execute', 'report'] as const
</script>

<template>
  <nav :aria-label="t('migrate.stepsLabel')">
    <ol class="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
      <li
        v-for="(s, i) in STEPS"
        :key="s"
        :aria-current="step === i + 1 ? 'step' : undefined"
        class="flex items-center gap-2"
        :class="step === i + 1 ? 'text-ink' : step > i + 1 ? 'text-body' : 'text-muted-soft'"
      >
        <span
          class="inline-flex h-5 w-5 items-center justify-center rounded-full border font-mono text-[11px]"
          :class="step === i + 1 ? 'border-ink bg-ink text-white' : 'border-hairline-strong'"
        >{{ i + 1 }}</span>
        {{ t(`migrate.steps.${s}`) }}
      </li>
    </ol>
  </nav>
</template>
