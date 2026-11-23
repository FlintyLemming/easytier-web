<script setup lang="ts">
import { computed } from 'vue'
import { confirmQueue, settleConfirm } from '../../composables/useConfirm'
import UiButton from './UiButton.vue'
import UiDialog from './UiDialog.vue'

// Only the queue head is rendered; handlers capture that request's own id so a
// late event can never settle a different request.
const head = computed(() => confirmQueue.slice(0, 1))
</script>

<template>
  <UiDialog
    v-for="req in head"
    :key="req.id"
    :open="true"
    :title="req.title"
    @update:open="(v: boolean) => !v && settleConfirm(req.id, false)"
  >
    <p v-if="req.body">{{ req.body }}</p>
    <template #footer>
      <UiButton variant="secondary" @click="settleConfirm(req.id, false)">{{ req.cancelLabel ?? 'Cancel' }}</UiButton>
      <UiButton :variant="req.danger ? 'danger' : 'primary'" @click="settleConfirm(req.id, true)">
        {{ req.confirmLabel ?? 'Confirm' }}
      </UiButton>
    </template>
  </UiDialog>
</template>
