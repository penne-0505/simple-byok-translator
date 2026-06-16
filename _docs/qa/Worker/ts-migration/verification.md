---
title: "QA Verification: TypeScript Cloudflare Worker migration"
status: active
draft_status: n/a
qa_status: verified
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/ts-migration/decision.md"
  - "_docs/plan/Worker/ts-migration/plan.md"
  - "_docs/qa/Worker/ts-migration/test-plan.md"
related_issues: []
related_prs: []
---

# QA Verification: `TypeScript Cloudflare Worker migration`

## Summary

Python の四層を Hono ベースの TS Worker（`worker/`）へ契約一致で移植。vitest で 40 件の単体・統合テスト、node で実 OpenRouter E2E 3 件、`wrangler dev`（workerd）で構造スモークを実施。移植中に実ランタイム固有の問題を 2 件検出・修正した（下記）。`wrangler dev` の Authorization 値削り（既知差異）により BYOK-via-Authorization のローカル end-to-end のみ未検証で、node E2E と本番エッジ挙動で正しさを担保する。

## Verification Verdict

Verdict: PASS

## Commands Run

```bash
cd worker
npm install
npx tsc --noEmit
npx vitest run
TRANSLATOR_E2E=1 OPENROUTER_KEY=... npx vitest run test/e2e.test.ts
WRANGLER_SEND_METRICS=false npx wrangler dev   # structural smoke
```

Result:

```text
tsc: clean
vitest: 40 passed | 3 skipped
e2e (node, real OpenRouter): 3 passed
  - default model gemini-3.1-flash-lite translate
  - reasoning_effort honored
  - streaming clean deltas (no delimiter leak)
wrangler dev (workerd):
  GET /healthz 200, GET /v1/config 200 (default_model gemini-3.1-flash-lite),
  GET / 200 text/html (bundled UI via assets), no-key POST -> 401
```

## Automated Test Results

| Command / Test | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | 型クリーン |
| `npx vitest run` | PASS | 40 passed |
| `test/config.test.ts` | PASS | 解決・優先順位・reasoning |
| `test/harness.test.ts` | PASS | 描画・抽出・brace-safe・reasoning |
| `test/engine.test.ts` | PASS | fake 越し・stream 既定 raw・error 伝播 |
| `test/api.test.ts` | PASS | 4 routes・BYOK・error マップ・SSE・usage |
| `test/e2e.test.ts` (node) | PASS | 実 OpenRouter 3 系統 |
| `wrangler dev` smoke | PASS | healthz/config/UI/401（構造） |

## Manual QA Results

| Checklist Item | Result | Notes |
| --- | --- | --- |
| `wrangler dev` 起動 | PASS | workerd local |
| `GET /healthz` | PASS | 200 |
| `GET /v1/config` | PASS | 既定返却 |
| `GET /` 同梱 UI | PASS | assets バインディングで配信 |
| 鍵なし 401 | PASS | missing_credentials |

## Acceptance Criteria Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| AC-001 | PASS | `test/api.test.ts`、wrangler smoke |
| AC-002 | PASS | engine/api を fake provider で検証 |
| AC-003 | PASS | `test/config.test.ts`, `test/harness.test.ts` |
| AC-004 | PASS | `test/api.test.ts`（鍵到達のみ）、非ログ |
| AC-005 | PASS | `test/e2e.test.ts`（node 実 OpenRouter） |

## Invariant Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| INV-001 | PASS | snake_case 契約一致（api テスト） |
| INV-002 | PASS | engine は `ChatProvider` のみ依存 |
| INV-003 | PASS | config テストの優先順位群 |
| INV-004 | PASS | credentials/provider レビュー・api テスト |
| INV-005 | PASS | engine stream 既定 raw テスト |

## Issues Found During Migration (fixed)

- BUG-1: エントリ `src/index.ts` が `default` 以外（`VERSION` 定数）を export し、workerd が起動拒否。ルーティングを `src/app.ts` に分離し、エントリは `default` のみに。
- BUG-2: `compatibility_date` が古い wrangler の対応範囲外で警告。有効日付へ修正し wrangler を v4 へ更新。

## Deferred / Not Covered

| ID | Reason | Follow-up |
| --- | --- | --- |
| AUTHZ-LOCAL | `wrangler dev` のローカルプロキシが受信 Authorization 値を削る既知差異（workers-sdk#3513 系） | 解決済み: 本番デプロイ後、本番エッジで BYOK ヘッダ翻訳が成功（雪国冒頭）。ローカル限定の制約と確定 |
| DEPLOY | — | 完了: `wrangler deploy` 済み（<https://simple-byok-translator.penneotibo.workers.dev>）。healthz/config/UI/BYOK/401 を本番検証 |

## Residual Risks

- なし

## Follow-up TODOs

- Worker-Feat-7（サーバ鍵＋Cloudflare Access の二モード）。
- 実 Cloudflare デプロイと本番での BYOK ヘッダ疎通確認。
