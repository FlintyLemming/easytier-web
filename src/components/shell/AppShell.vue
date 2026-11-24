<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useInventory } from '../../stores/inventory'
import { useSession } from '../../stores/session'
import { usePolling } from '../../composables/usePolling'
import TopNav from './TopNav.vue'
import RefreshNotice from './RefreshNotice.vue'
import WebhookBanner from './WebhookBanner.vue'

const session = useSession()
const inventory = useInventory()

// Global inventory poller: every authenticated page (and the bell) reads from it.
// The interval follows the route (10 s on the overview, 5 s elsewhere); changing it restarts the poller,
// which refreshes once straight away.
const route = useRoute()
const pollMs = () => route.meta.inventoryPollMs ?? 5000
const poller = usePolling(() => inventory.refresh(), pollMs)
onMounted(() => poller.start())
watch(pollMs, () => {
  poller.stop()
  poller.start()
})
</script>

<template>
  <div class="min-h-screen bg-canvas">
    <TopNav />
    <WebhookBanner v-if="session.webhookMode" />
    <RefreshNotice />
    <main class="mx-auto w-full max-w-[1200px] px-6 py-8">
      <RouterView />
    </main>
  </div>
</template>
