<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useInventory } from '../stores/inventory'

// Placeholder until the detail page lands (plan 5 Task 4).
const route = useRoute()
const inventory = useInventory()
const name = computed(() => inventory.networks.find((n) => n.network_id === route.params.networkId)?.display_name ?? '')
</script>

<template>
  <h1 class="text-[26px] font-normal tracking-[-0.325px] text-ink">{{ name }}</h1>
</template>
