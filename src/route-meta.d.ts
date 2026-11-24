// Kept apart from env.d.ts: augmenting a module needs this file to be a module itself, which env.d.ts
// (with its `*.vue` wildcard and global Window) must not be.
import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean
    /** Inventory poll interval (ms) while this route is active; AppShell defaults to 5000. */
    inventoryPollMs?: number
  }
}
