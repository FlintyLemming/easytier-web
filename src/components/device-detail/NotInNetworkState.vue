<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyState from '../ui/EmptyState.vue'
import UiButton from '../ui/UiButton.vue'

defineProps<{ machineId: string; primaryName: string | null; busy?: boolean }>()
const emit = defineEmits<{ join: []; choose: [] }>()
const { t } = useI18n()
</script>

<template>
  <section data-testid="not-in-network" class="rounded-card border border-hairline bg-surface-card">
    <EmptyState
      :title="t('detail.notInNetwork.title')"
      :body="primaryName ? t('detail.notInNetwork.body') : t('detail.notInNetwork.noNetwork')"
    >
      <template #action>
        <div class="flex flex-col items-center gap-2">
          <template v-if="primaryName">
            <!-- The page's single main action, so it carries the orange primary style. -->
            <UiButton variant="primary" :loading="busy" @click="emit('join')">
              {{ t('detail.notInNetwork.join', { network: primaryName }) }}
            </UiButton>
            <UiButton variant="text" size="sm" :disabled="busy" @click="emit('choose')">
              {{ t('detail.notInNetwork.choose') }}
            </UiButton>
          </template>
          <!-- Shown with or without a network to join: manual instances need none. -->
          <RouterLink
            :to="{ name: 'device-instances', params: { machineId } }"
            class="rounded-control text-[13px] text-muted underline decoration-hairline-strong underline-offset-[3px] hover:text-ink hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {{ t('detail.notInNetwork.instances') }}
          </RouterLink>
        </div>
      </template>
    </EmptyState>
  </section>
</template>
