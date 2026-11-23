<script setup lang="ts">
import { computed } from 'vue'
import { confirmQueue } from '../../composables/useConfirm'
import UiButton from './UiButton.vue'
import UiDialog from './UiDialog.vue'

const current = computed(() => confirmQueue[0])

function settle(ok: boolean) {
  const req = confirmQueue.shift()
  req?.resolve(ok)
}
</script>

<template>
  <UiDialog
    v-if="current"
    :key="confirmQueue.length + current.title"
    :open="true"
    :title="current.title"
    @update:open="(v: boolean) => !v && settle(false)"
  >
    <p v-if="current.body">{{ current.body }}</p>
    <template #footer>
      <UiButton variant="secondary" @click="settle(false)">{{ current.cancelLabel ?? 'Cancel' }}</UiButton>
      <UiButton :variant="current.danger ? 'danger' : 'primary'" @click="settle(true)">
        {{ current.confirmLabel ?? 'Confirm' }}
      </UiButton>
    </template>
  </UiDialog>
</template>
