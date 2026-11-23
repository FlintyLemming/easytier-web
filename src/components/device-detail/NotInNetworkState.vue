<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EmptyState from '../ui/EmptyState.vue'
import UiButton from '../ui/UiButton.vue'

defineProps<{ primaryName: string | null; busy?: boolean }>()
const emit = defineEmits<{ join: []; choose: [] }>()
const { t } = useI18n()
</script>

<template>
  <section data-testid="not-in-network" class="rounded-card border border-hairline bg-surface-card">
    <EmptyState
      :title="t('detail.notInNetwork.title')"
      :body="primaryName ? t('detail.notInNetwork.body') : t('detail.notInNetwork.noNetwork')"
    >
      <template v-if="primaryName" #action>
        <div class="flex flex-col items-center gap-2">
          <!-- The page's single main action, so it carries the orange primary style. -->
          <UiButton variant="primary" :loading="busy" @click="emit('join')">
            {{ t('detail.notInNetwork.join', { network: primaryName }) }}
          </UiButton>
          <UiButton variant="text" size="sm" :disabled="busy" @click="emit('choose')">
            {{ t('detail.notInNetwork.choose') }}
          </UiButton>
        </div>
      </template>
    </EmptyState>
  </section>
</template>
