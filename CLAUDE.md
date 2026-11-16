# Savdo Copilot — shared rules for every agent

This file is loaded by the orchestrator and by every specialist in
`.claude/agents/`. It holds what all of them must agree on — the shape of the
project, who owns which files, and how work is handed across a border. Anything
specific to one area lives in that area's agent file, not here.

## Project shape

Serverless React 19 + TypeScript SPA in `frontend/` (Vite, Tailwind 4, Radix,
TanStack Query 5, Zustand 5, zod, Vitest). The browser calls
`api-seller.uzum.uz` directly with the seller's own token and keeps everything in
IndexedDB (`savdo`, v3). An in-browser Copilot talks to the seller's chosen LLM
provider with the seller's own key. There is no application server:
**`backend/` is an untouched ASP.NET template — never modify it.**

The repo has three packages besides `backend/`. `core/` is the source-only
Copilot engine (no dependencies and no `node_modules` of its own) shared by two
hosts: `frontend/`, the site, and `extension/`, an MV3 browser extension for
seller.uzum.uz (Chrome, Edge, Firefox). Each host compiles `core/` against its
own `node_modules`. **`core/` never imports from a host; hosts import core via
`@core/`** (`@/` exists only in `frontend/`, `@ext/` only in `extension/`; lint
rejects either inside `core/src`). The layer direction below applies inside
`frontend/`; `core/` sits below every one of its layers and may be imported from
any of them.

Layer direction, strictly downward — an upper layer may import a lower one,
never the reverse:

```
pages -> features -> services/queries -> services/insights -> services/derive
      -> services/data -> services/sync + services/storage -> services/uzum -> services/api
```

The LLM transport (`core/src/ai`) is used only by the engine and
`services/insights`. `lib/`, `types/` and `constants/` are shared leaves any
layer may import. Contract modules are the one accepted exception to the
direction: `insights/cards.ts` (the insight-card envelope, which the rules in
`derive/insights.ts` also author) and the source shapes in `queries/sources.ts`
may be imported from below. The block language is `@core/agent/blocks`,
importable from anywhere as core. A new
upward import of anything else is a defect.

## Ownership — one owner per path

| Path (under `frontend/` unless it starts with `core/` or `extension/`) | Owner |
|---|---|
| `src/services/api/` (except `queryKeys.ts`), `src/services/uzum/` | `uzum-api` |
| `src/services/storage/idb/` (cursor/worker plumbing, schema, repos, mappers), `src/services/storage/*.ts` (`account`, `localStorage`, `retention`) | `storage-idb` |
| `src/services/sync/`, `src/services/storage/archive/`, `src/services/data/`, `missingRanges()` in `idb/metadata.repo.ts` | `archive-sync` |
| `src/services/derive/`, the arithmetic in `idb/aggregation.ts`, `src/types/` | `derive-metrics` |
| `src/services/queries/`, `src/services/api/queryKeys.ts` | `data-queries` |
| `src/services/insights/` — `prompt`, `actions`, `cards`, `alerts`, `pins`, `ai` | `copilot-engine` |
| `src/services/insights/` — `toolkit`, `datasets`, `digest`, `siteToolkit` | `copilot-data` |
| `src/pages/`, `src/features/`, `src/components/`, `src/store/`, `src/lib/`, `src/styles/`, `src/app/`, `src/hooks/`, `src/constants/`, `src/main.tsx`, `index.html` | `ui-surface` |
| `package.json`, lockfile, `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vercel.json` | `platform-tooling` |
| `core/src/ai/` | `ai-providers` |
| `core/src/agent/` | `copilot-engine` |
| `core/src/tools/` (including `contract.ts`) | `copilot-data` |
| `core/src/settings/`, `core/src/storage/` | `storage-idb` |
| `core/src/errors/`, `core/src/net/` | `uzum-api` |
| `core/src/ui/`, `core/src/state/`, `core/src/i18n/`, `core/src/lib/`, `core/src/hooks/`, `core/src/styles/`, `core/src/constants/` | `ui-surface` |
| `core/src/types/` | `derive-metrics` |
| `extension/src/uzum/` | `uzum-api` |
| `extension/src/tools/` | `copilot-data` |
| `extension/src/host/` | `copilot-engine` |
| `extension/src/storage/` | `storage-idb` |
| `extension/src/content/`, `extension/src/panel/` | `ui-surface` |
| `core/package.json`, `core/tsconfig.json`, `core/tooling/`, `extension/` config files (`package.json`, lockfile, `vite*.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `eslint.config.js`), `extension/manifests/`, `extension/scripts/`, `extension/_locales/`, root `.gitignore` | `platform-tooling` |
| growth of the test suite, fixtures | `test-harness` |
| review against project invariants (read-only) | `invariant-reviewer` |
| `docs/FUNCTIONAL-SPECIFICATION.md`, `docs/TECHNICAL-SPECIFICATION.md`, `docs/API-REQUEST-RESPONSE.md`, `ENDPOINTS.md`, `STORAGE.md` | `spec-scribe` |

`frontend/_design/` is reference material (design canvas, recorded API samples in
`uploads/uzum-samples.json`); read it, never edit it.

## Rules at a border

1. **Edit only the paths you own.** Read anything. When the right fix is in
   someone else's path, stop and put it in your report: the file, what must
   change, and why — precisely enough that the owner can do it without
   re-deriving your reasoning. Never "just fix it" across the border.
2. **Contracts first.** When your change alters something another layer
   consumes (a type, a hook's return shape, a block kind, a tool's output), say
   so explicitly in the report under *Contract changes*.
3. **Tests move with the code.** If your intended change breaks an existing
   test, update that test in the same change and say why. New coverage beyond
   that is `test-harness` work.
4. **Shared leaves.** Adding a key to `core/src/i18n/dictionary.ts` (all three of
   `[en, ru, uz]`) or a host-agnostic type to `core/src/types/` is allowed for any agent that needs it;
   changing an existing entry belongs to the owner.
5. **Documentation follows the code when it has to.** When a change makes a
   section of the specs untrue, name the section in your report; the
   orchestrator hands the update to `spec-scribe` as part of the same task.
   Documentation is not rewritten for taste or ahead of the code.

## Invariants nobody may break

- Coverage is recorded **after** the rows it covers are written.
- API `dateFrom`/`dateTo` are seconds, stored timestamps are milliseconds;
  conversion only through `toApiSeconds()`.
- Every request goes through `api/rateLimit.ts`, sequentially.
- `store_id` comes from the shop that was asked, never from the payload; record
  ids are deterministic.
- `derive/` is pure: no network, storage, DOM or clock reads.
- Every figure on a screen names its source; unknown is never shown as zero.
- The Copilot's figures are computed by the model from data a lookup returned,
  carried in validated blocks as plain values with a `format`. Unknown block
  kinds, unknown action ids and action params the registry refuses are rejected
  before they render. No forecasts.
- Every user-visible string is a dictionary key with all three languages.

## House style

- TypeScript `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`; alias
  `@/` → `frontend/src/`, `@core/` → `core/src/` (both hosts), `@ext/` → `extension/src/`. Lint: no `any`, `import type` for type-only imports, no unused
  vars (`^_` exempt), no `console.log`.
- Code comments in **English**, explaining *why*, in the voice of the existing
  module headers. Markdown documentation in **Uzbek**.
- Reports to the orchestrator and answers to the user are in **Uzbek**; code,
  paths and identifiers stay as they are.

## Verification

From `frontend/` (also typechecks, lints and tests `core/`):

```bash
npm run typecheck && npm run lint && npm test
```

From `extension/` (its own install; `core/` is linted and tested by `frontend/`):

```bash
npm run typecheck && npm run lint && npm test
```

A change under `core/` runs both. UI and tooling changes also run `npm run build`
in the host they touch. Report failures honestly with
their output; never adjust a test's expectation to hide a defect.
