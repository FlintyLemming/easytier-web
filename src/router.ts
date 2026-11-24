import { createRouter, createWebHashHistory, type LocationQueryRaw, type RouteLocationNormalized } from 'vue-router'
import { ApiError, onUnauthorized } from './api/http'
import { useSession } from './stores/session'
import { useInventory } from './stores/inventory'
import { useRuntime } from './stores/runtime'
import { useToast } from './composables/useToast'
import { t } from './i18n'
import AppShell from './components/shell/AppShell.vue'
import LoginPage from './pages/LoginPage.vue'
import RegisterPage from './pages/RegisterPage.vue'
import DevicesPage from './pages/DevicesPage.vue'
import DeviceDetailPage from './pages/DeviceDetailPage.vue'
import DeviceInstancesPage from './pages/DeviceInstancesPage.vue'

/** Fully percent-encode query values (`next=%2Fdevices%2F…`) so the login URL is unambiguous. */
function stringifyQuery(query: LocationQueryRaw | undefined): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) {
      if (item === undefined) continue
      parts.push(item === null ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`)
    }
  }
  return parts.join('&')
}

export const router = createRouter({
  history: createWebHashHistory(),
  stringifyQuery,
  routes: [
    { path: '/login', name: 'login', component: LoginPage, meta: { public: true } },
    { path: '/register', name: 'register', component: RegisterPage, meta: { public: true } },
    {
      path: '/',
      component: AppShell,
      children: [
        { path: '', name: 'overview', component: () => import('./pages/OverviewPage.vue'), meta: { inventoryPollMs: 10_000 } },
        { path: 'devices', name: 'devices', component: DevicesPage },
        { path: 'devices/:machineId', name: 'device', component: DeviceDetailPage },
        { path: 'devices/:machineId/networks/:networkId', name: 'device-network', component: DeviceDetailPage },
        { path: 'devices/:machineId/instances', name: 'device-instances', component: DeviceInstancesPage },
      ],
    },
  ],
})

/** True while the guard itself is loading the session; it handles its own 401. */
let guardLoading = false
/** True while a redirect to login started by the 401 handler is in flight. */
let redirecting = false

router.beforeEach(async (to: RouteLocationNormalized) => {
  if (to.meta.public) return true
  const session = useSession()
  if (session.info) return true
  guardLoading = true
  try {
    await session.load()
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      return { name: 'login', query: { next: to.fullPath } }
    }
    useToast().error(t('shell.sessionError', { message: e instanceof Error ? e.message : String(e) }))
  } finally {
    guardLoading = false
  }
  return true
})

onUnauthorized(() => {
  if (guardLoading || redirecting) return
  const cur = router.currentRoute.value
  if (cur.meta.public) return // e.g. the 401 from probing the session on the login page
  redirecting = true
  useSession().reset()
  useInventory().reset()
  useRuntime().reset()
  void router
    .replace({ name: 'login', query: { next: cur.fullPath } })
    .finally(() => {
      redirecting = false
    })
})
