<script setup lang="ts">
import { onMounted } from 'vue'
import { useInventory } from '../../stores/inventory'
import { useSession } from '../../stores/session'
import { usePolling } from '../../composables/usePolling'
import TopNav from './TopNav.vue'
import WebhookBanner from './WebhookBanner.vue'

const session = useSession()
const inventory = useInventory()

// Global inventory poller: every authenticated page (and the bell) reads from it.
const poller = usePolling(() => inventory.refresh(), 5000)
onMounted(() => poller.start())
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <TopNav />
    <WebhookBanner v-if="session.info?.webhook_auth === true" />
    <main class="mx-auto w-full max-w-[1200px] px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
