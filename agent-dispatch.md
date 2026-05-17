# Agent Dispatch

## 1. Target Agent
Agent 7 - QA Verification Agent

## 2. Task
Perform the final QA verification pass after the latest build fixes.

This is a QA-only task. Do not implement features, do not merge, and do not broaden scope.

## 3. Exact Prompt To Send
```text
Agent 7, perform the final QA verification pass for the current pre-merge branch.

Context:
- The branch contains completed work across workspace isolation, event engine ownership, batch/campaign tag matching, traffic source run state machine, task automation atomicity, and admin settings foundation.
- Recent build blockers were fixed only in:
  - artifacts/mockup-sandbox/vite.config.ts
  - package.json
  - artifacts/offerops/vite.config.ts
- The latest verified commands passed:
  - git diff --check
  - pnpm run typecheck
  - pnpm run build
  - pnpm --filter @workspace/scripts run check:workspace-isolation
- DATABASE_URL-backed workspace isolation testing is now explicit via:
  - pnpm run test:workspace-isolation

Primary QA goals:
1. Verify no latest build fix weakened dev/preview env validation.
2. Verify root build/typecheck no longer require PORT, BASE_PATH, or DATABASE_URL.
3. Verify static workspace isolation checking still runs during typecheck.
4. Review the integration risk across the completed domains before merge.
5. Decide whether this branch is ready for human-supervised manual merge.

Start review with high-overlap files:
- artifacts/api-server/src/engine/executor.ts
- artifacts/api-server/src/engine/types.ts
- artifacts/api-server/src/engine/rules/index.ts
- artifacts/api-server/src/engine/rules.test.ts
- artifacts/api-server/src/routes/todo-tasks.ts
- artifacts/api-server/src/routes/settings.ts
- package.json
- artifacts/mockup-sandbox/vite.config.ts
- artifacts/offerops/vite.config.ts

Then review:
- Workspace isolation route coverage and scoped invariant tests.
- Event engine as source of truth for workflow mutations.
- Tag-driven batch/campaign matching.
- Traffic source iOS/Android platform substates.
- Atomic task completion behavior.
- Admin settings foundation and generated API consistency.
- Migration ordering for 0009, 0010, and 0011.

Forbidden:
- No auto-merge.
- No destructive commands.
- No Voluum API integration.
- No production access.
- No broad refactors.
- Do not touch CampaignOps logic unless a QA blocker requires a tiny fix and supervisor approval is given.
- Do not remove or weaken workspace isolation checks.
- Do not silently skip important tests.

Special note:
- There is an untracked file named "-" that appears to be accidental pnpm metadata. Confirm it is excluded from merge unless the human supervisor explicitly approves otherwise.

Final decision required:
- ready for manual merge
- not ready, blockers listed
- ready after specific small fixes
```

## 4. Required Commands
Run from repo root. Use the Cursor node toolchain path if `pnpm` is not on PATH.

```sh
git diff --check
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/scripts run check:workspace-isolation
```

If a local Postgres database is available:

```sh
pnpm run test:workspace-isolation
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run test:engine
pnpm --filter @workspace/api-server run test:routes
```

If API contracts changed:

```sh
pnpm --filter @workspace/api-spec run codegen
git diff -- lib/api-zod/src/generated/api.ts lib/api-client-react/src/generated/api.ts lib/api-client-react/src/generated/api.schemas.ts
```

## 5. Expected Report Format
Agent 7 must report:

- Changed files, if any.
- Commands run and exact pass/fail results.
- QA summary.
- Risks found.
- Possible overlaps or conflicts.
- Blockers before merge.
- Whether the untracked `-` file should be excluded.
- Recommended next step.
- Merge recommendation: ready / not ready / ready after small fixes.

## 6. Risk Notes
- Manual merge only. Human supervisor is final decision maker.
- No Voluum API integration yet.
- Event engine must remain the source of truth.
- Workspace isolation must remain mandatory.
- Tag-driven batch/campaign matching must remain deterministic.
- Task completion must remain atomic.
- Traffic source run state must preserve independent iOS/Android substates.
- The build fixes should only relax env requirements for production build config loading, not for dev/preview runtime.
