<script setup lang="ts">
import { computed, onMounted, ref, toRaw } from 'vue'
import { useI18n } from 'vue-i18n'
import { getAclPolicy, putAclPolicy } from '../../api/client'
import type { AclPolicy, AclRule } from '../../api/types'
import { useConfirm } from '../../composables/useConfirm'
import { useToast } from '../../composables/useToast'
import { allowsNothing, destinationKeys, moveRule, policyEquals, sourceKeys } from '../../domain/acl'
import { useInventory } from '../../stores/inventory'
import { errorMessage } from '../device-detail/writes'
import EmptyState from '../ui/EmptyState.vue'
import SkeletonRows from '../ui/SkeletonRows.vue'
import UiButton from '../ui/UiButton.vue'
import AclRuleDialog from './AclRuleDialog.vue'
import AclRuleRow from './AclRuleRow.vue'
import { useAclLabels, type SelectorOption } from './aclLabels'

/**
 * The network's ACL policy. Every change edits a local draft; 保存 writes the whole policy back,
 * built from what was read so untouched rules go back exactly as they came (spec §6.5).
 */
const props = defineProps<{ networkId: string }>()
const { t } = useI18n()
const toast = useToast()
const { confirm } = useConfirm()
const inventory = useInventory()

const members = computed(() => inventory.membersByNetwork[props.networkId] ?? [])
const { selectorText, selectorSummary, protocolSummary, memberOption } = useAclLabels(members)

const saved = ref<AclPolicy | null>(null)
const draft = ref<AclPolicy | null>(null)
const loadError = ref<string | null>(null)
const saving = ref(false)
const dirty = computed(() => !!saved.value && !!draft.value && !policyEquals(draft.value, saved.value))
defineExpose({ dirty })

async function load() {
  loadError.value = null
  try {
    const p = await getAclPolicy(props.networkId)
    saved.value = p
    draft.value = structuredClone(p)
  } catch (e) {
    loadError.value = errorMessage(e)
  }
}
onMounted(load)

function setDefault(action: 'allow' | 'deny') {
  if (draft.value) draft.value.default_action = action
}
function setRules(rules: AclRule[]) {
  if (draft.value) draft.value.rules = rules
}
function toggle(i: number) {
  const rules = [...draft.value!.rules]
  rules[i] = { ...rules[i]!, enabled: !rules[i]!.enabled }
  setRules(rules)
}
function removeRule(i: number) {
  setRules(draft.value!.rules.filter((_, j) => j !== i))
}

// --- the rule dialog ---
const editorOpen = ref(false)
const editingIndex = ref<number | null>(null)
const editingRule = computed(() => (editingIndex.value === null ? null : (draft.value?.rules[editingIndex.value] ?? null)))
function openEditor(i: number | null) {
  editingIndex.value = i
  editorOpen.value = true
}
function onDone(rule: AclRule) {
  const rules = [...draft.value!.rules]
  if (editingIndex.value === null) rules.push(rule)
  else rules[editingIndex.value] = rule
  setRules(rules)
}

/** Groups can only come from credential grants, so offer the ones the rules already use. */
const groupKeys = computed(() => {
  const keys = new Set<string>()
  for (const p of [saved.value, draft.value]) for (const r of p?.rules ?? []) for (const k of sourceKeys(r.sources)) if (k.startsWith('group:')) keys.add(k)
  return [...keys]
})
const sourceOptions = computed<SelectorOption[]>(() => [
  { key: 'all', label: t('acl.allMembers') },
  ...members.value.map(memberOption),
  ...groupKeys.value.map((k) => ({ key: k, label: selectorText(k) })),
])
const destinationOptions = computed<SelectorOption[]>(() => {
  const opts: SelectorOption[] = [{ key: 'all', label: t('acl.allMembers') }, ...members.value.map(memberOption)]
  const seen = new Set(opts.map((o) => o.key))
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key)
      opts.push({ key, label: selectorText(key) })
    }
  }
  for (const m of members.value) for (const c of m.proxy_cidrs ?? []) add(`subnet:${m.member_id}:${c}`)
  for (const r of draft.value?.rules ?? []) for (const k of destinationKeys(r.destinations)) if (k.startsWith('subnet:')) add(k)
  return opts
})

async function save() {
  if (!draft.value || saving.value) return
  if (allowsNothing(draft.value)) {
    const ok = await confirm({ title: t('acl.denyAllTitle'), body: t('acl.denyAllBody'), confirmLabel: t('acl.denyAllConfirm'), danger: true })
    if (!ok) return
  }
  saving.value = true
  try {
    const stored = await putAclPolicy(props.networkId, draft.value)
    saved.value = stored
    draft.value = structuredClone(stored)
    toast.success(t('acl.saved'))
  } catch (e) {
    toast.error(t('acl.saveFailed', { message: errorMessage(e) }))
  } finally {
    saving.value = false
  }
}

function discard() {
  // `saved` holds a reactive proxy, which structuredClone cannot copy.
  if (saved.value) draft.value = structuredClone(toRaw(saved.value))
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <EmptyState v-if="loadError !== null" :title="t('acl.loadFailed')" :body="loadError">
      <template #action><UiButton @click="load">{{ t('acl.retry') }}</UiButton></template>
    </EmptyState>
    <SkeletonRows v-else-if="!draft" :rows="4" />
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" :aria-label="t('acl.defaultLabel')" class="inline-flex gap-0.5 rounded-control border border-hairline-strong p-0.5">
          <button
            v-for="a in (['allow', 'deny'] as const)"
            :key="a"
            type="button"
            role="radio"
            :aria-checked="draft.default_action === a ? 'true' : 'false'"
            :disabled="saving"
            class="h-8 cursor-pointer rounded-[6px] px-3 text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed"
            :class="draft.default_action === a ? 'bg-surface-strong text-ink' : 'text-muted hover:text-ink'"
            @click="setDefault(a)"
          >
            {{ a === 'allow' ? t('acl.defaultAllow') : t('acl.defaultDeny') }}
          </button>
        </div>
        <div v-if="dirty" class="flex flex-wrap items-center gap-2">
          <span class="text-[13px] text-muted">{{ t('acl.dirty') }}</span>
          <UiButton size="sm" variant="text" :disabled="saving" @click="discard">{{ t('acl.discard') }}</UiButton>
          <UiButton size="sm" :loading="saving" @click="save">{{ t('acl.save') }}</UiButton>
        </div>
      </div>
      <p v-if="draft.default_action === 'deny'" class="text-[13px] text-error">{{ t('acl.denyHint') }}</p>
      <p class="text-[12px] text-muted">{{ t('acl.orderHint') }}</p>

      <div class="rounded-card border border-hairline bg-surface-card">
        <EmptyState v-if="draft.rules.length === 0" :title="t('acl.empty')" :body="t('acl.emptyBody')" />
        <ul v-else>
          <AclRuleRow
            v-for="(r, i) in draft.rules"
            :key="r.id"
            :rule="r"
            :first="i === 0"
            :last="i === draft.rules.length - 1"
            :busy="saving"
            :selector-summary="selectorSummary"
            :protocol-summary="protocolSummary"
            @toggle="toggle(i)"
            @up="setRules(moveRule(draft.rules, i, -1))"
            @down="setRules(moveRule(draft.rules, i, 1))"
            @edit="openEditor(i)"
            @remove="removeRule(i)"
          />
        </ul>
      </div>
      <UiButton class="self-start" :disabled="saving" @click="openEditor(null)">{{ t('acl.addRule') }}</UiButton>

      <AclRuleDialog
        v-model:open="editorOpen"
        :rule="editingRule"
        :source-options="sourceOptions"
        :destination-options="destinationOptions"
        :selector-text="selectorText"
        @done="onDone"
      />
    </template>
  </div>
</template>
