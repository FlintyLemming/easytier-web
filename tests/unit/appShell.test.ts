import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent } from 'vue'
import AppShell from '../../src/components/shell/AppShell.vue'
import { useInventory } from '../../src/stores/inventory'

const Blank = defineComponent({ template: '<div />' })
const stub = { TopNav: true, RefreshNotice: true, WebhookBanner: true }

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})
afterEach(() => vi.useRealTimers())

describe('AppShell inventory polling', () => {
  it('follows route.meta.inventoryPollMs and restarts when the route changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const inventory = useInventory()
    const refresh = vi.spyOn(inventory, 'refresh').mockResolvedValue(undefined)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/slow', component: Blank, meta: { inventoryPollMs: 10_000 } },
        { path: '/fast', component: Blank },
      ],
    })
    await router.push('/slow')
    const wrapper = mount(AppShell, { global: { plugins: [pinia, router], stubs: stub } })
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(refresh).toHaveBeenCalledTimes(4)

    refresh.mockClear()
    await router.push('/fast')
    await vi.advanceTimersByTimeAsync(0)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
})
