# Rulings made during execution of Plan 5 (networks page)

Collected from the execution ledger (decisions taken on the user's behalf). Each line: decision — reason — cost if wrong.

## Rulings

- Ruling: in place on branch feat/networks, no worktree — same as Plans 1–4 (Docker bind mounts, live smoke) — cost: none.
- Ruling: inline execution, no per-task subagents — harness spawns subagents only on the user's explicit request; user asked to write and finish plan 5 — cost: no per-task fresh review; final review is a self-review.
- Task 1: Ruling: capture-fixtures id-consistency test exempts the three secure-network fixtures and a new test asserts their own consistency (one shared secure id, networks-two[0] = home) — the plan's new fixtures describe a second network by design — cost: none.
- Task 3: Ruling: 安全模式 (and the other on/off fields) use the existing CheckboxField, not a switch — no switch control exists in the codebase; checkbox is the established pattern for flags — cost if wrong: styling only.
- Task 3: Ruling: networks copy lives in src/i18n/networks/{zh-CN,en}.ts spread into both locale files — keeps the main catalogs from doubling; key paths match the plan — cost: none.
- Task 4: Ruling: expiry copy is '{time}后到期' / 'expires in {time}' with time = elapsedText(now → expiry) — the existing relativeTime only formats past times — cost: wording only.
- Task 4: Ruling: tab clicks use router.push, not replace — the plan says 'router.replace' but also requires Back to return to the previous tab (decision 5 and test 2); replace leaves no history entry — cost if wrong: extra history entries per tab click.
- Task 4: Ruling: removing a member always re-reads the ACL policy to decide the warning line, instead of reusing a page cache — fresher and simpler, same outcome — cost: one extra GET per removal.
- Task 5: Ruling: the ACL 保存/放弃修改 buttons use size sm secondary/text inside the dirty bar, and rule rows use ↑/↓ text buttons with per-rule aria-labels — plan fixed the copy but not the control size — cost: styling only.
- Task 6: Ruling: CredentialsTab takes an extra `active` prop (plan Interfaces: only networkId) — polling must stop while the panel is hidden but still mounted (decision 5 keeps panels mounted) — cost: none.
- Task 6: Ruling: join dialog copies with explicit 复制 buttons that toast (aria-label 复制命令行 / 复制配置文件 / 复制凭据密钥) instead of CopyButton, which only flips its icon — plan requires a toast — cost: none.
- Final: Ruling: suspected list-page redirect hijacking navigation away from /networks?list=1 — not reproduced (test final-1 passed before any change); kept as a regression guard — cost: none.

## Final review (self-review, no subagent)

- Final: fixed going straight from one network URL to another left a blank panel — network-detail.spec final-2 RED→GREEN, suite 179/179 e2e, 409/409 unit
- Final: fixed ACL tab kept a stale policy after a member removal elsewhere on the page, so a later save failed with "unknown member" — acl.spec final-3 RED→GREEN, suite 179/179 e2e, 409/409 unit
- Final: minor (deferred): English member summary '{n} members · {m} online' has no singular form.
- Final: minor (deferred): members table shows fixed/assigned IP but not a separate runtime-IP label (spec §5.8 mentions 运行时); the shown IP already prefers the runtime one.
- Final: minor (deferred): tab panels have no aria-labelledby pointing at their tab.
- Final: minor (deferred): ACL PUT overwrites changes made concurrently in another browser (inherent to whole-policy writes, spec §6.5); no revision check exists upstream.
- Final: minor (deferred): build warns the main chunk is >500 kB (pre-existing warning; this plan added the networks page to it).

## Notes for later plans

- Plan 6 (migration): the 1 legacy instance with its own ACL must be rewritten by hand as central rules; the ACL editor now exists (network → ACL tab). Central ACL rules reference members by member_id, so write them after the members exist.
- Plan 6: removing a member prunes the ACL rules that name it (easytier-web remove_device); a per-device rollback that removes a migrated member loses rules referencing it.
