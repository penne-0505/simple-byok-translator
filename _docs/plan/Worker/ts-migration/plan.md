---
title: TypeScript Cloudflare Worker migration plan
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/ts-migration/decision.md"
  - "_docs/qa/Worker/ts-migration/test-plan.md"
related_issues: []
related_prs: []
---

<!-- Canonical path: _docs/plan/Worker/ts-migration/plan.md -->

## Overview

Python の四層バックエンドを、契約・ハーネスそのままに Hono ベースの TypeScript Cloudflare Worker（`worker/`）へ移植する。

## Scope

- `types` / `errors` / `config`(+defaults) / `schemas`(zod) / `provider`(OpenRouter) / `harness` / `engine` / `credentials` の移植。
- Hono ルート（`/healthz` `/v1/config` `/v1/translate` `/v1/translate/stream`）、エラーマッピング、CORS、Static Assets による UI 自己ホスト。
- vitest による単体・統合テスト（fake provider）と opt-in 実 E2E。
- `wrangler.jsonc`、`package.json`、`tsconfig.json`。

## Non-Goals

- 二モード（サーバ鍵＋Cloudflare Access）= Worker-Feat-7。
- Python `backend/` の撤去（規約により残置）。
- 実 Cloudflare へのデプロイ自動化。

## Requirements

- **Functional**: Python 版と同等の契約で 4 エンドポイントが動作。BYOK 鍵をヘッダで受け、既定/上書き・reasoning・streaming を移植。
- **Non-Functional**: provider はオブジェクト差し替えで交換可能。鍵は保持・出力しない。型安全（`tsc --noEmit` クリーン）。

## Tasks

- [x] types / errors / config / schemas / provider / harness / engine / credentials 移植
- [x] Hono ルート・エラー・CORS・静的配信（エントリは default のみ export）
- [x] vitest（fake provider）単体・統合テスト
- [x] 実 OpenRouter E2E（node, opt-in）
- [x] workerd（`wrangler dev`）構造スモーク

## QA Plan

- QA document: `_docs/qa/Worker/ts-migration/test-plan.md`
- Risk level: High
- Test strategy:
  - Unit: config 解決、harness、reasoning。
  - Integration: engine ＋ fake provider、Hono `app.request` ＋ fake provider。
  - E2E: 実 OpenRouter（node, `TRANSLATOR_E2E=1`）。
  - Manual QA: `wrangler dev` で healthz / config / UI(assets) / 401。
  - Static check: `tsc --noEmit`。
- AC / INV の確認手段は test-plan の Test Matrix を参照。
- Risk High: rollback は未デプロイのため該当薄、`wrangler dev` の Authorization 制約を High-risk チェックで明記。

## Deployment / Rollout

- `npx wrangler deploy`。鍵は持たない既定（BYOK）。
- ロールバックは前デプロイへ revert。状態なし。
