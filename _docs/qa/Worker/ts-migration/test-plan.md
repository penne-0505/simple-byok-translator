---
title: "QA Test Plan: TypeScript Cloudflare Worker migration"
status: active
draft_status: n/a
qa_status: planned
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/ts-migration/decision.md"
  - "_docs/plan/Worker/ts-migration/plan.md"
related_issues: []
related_prs: []
---

# QA Test Plan: `TypeScript Cloudflare Worker migration`

## Source of Intent

- TODO: Worker-Feat-6
- Plan: `_docs/plan/Worker/ts-migration/plan.md`
- Intent: `_docs/intent/Worker/ts-migration/decision.md`

## Quality Goal

Python 版と同一の契約・ハーネスを保ったまま TS Worker が動作し、BYOK 鍵を漏らさず、既定/上書き解決が決定的であること。

## Acceptance Criteria

- AC-001: 4 エンドポイントが Python 版と同等の契約で応答する。
- AC-002: provider が `ChatProvider` 抽象の背後にあり fake でテストできる。
- AC-003: 既定モデル・instruction・プロファイル・reasoning・既定/上書き解決が移植されテストで担保。
- AC-004: BYOK 鍵はヘッダで受け、保持・ログ出力しない。
- AC-005: 実 OpenRouter への E2E で翻訳が通る。

## Intent-derived Invariants

- INV-001: ワイヤ契約が Python 版と一致。
- INV-002: 上位層は具象 provider を参照しない。
- INV-003: 未指定は既定に解決、明示指定が優先。
- INV-004: BYOK 鍵をログ・レスポンスに出さない。
- INV-005: streaming はプロファイル未指定時に区切りなしへ解決。

## Risk Assessment

- Risk level: High
- Risk rationale: 外部 API（OpenRouter）を扱う。
- Regression risk: 中（Python 版からの契約ずれ）。Test Matrix で契約一致を確認。
- Data safety risk: 低（状態なし）。
- Security / privacy risk: 鍵漏洩。ヘッダ受け・非ログ・非保持で対処。
- UX risk: 低（throwaway フロント）。
- Agent misbehavior risk: 該当なし。

## Test Strategy

- Unit: config 解決・harness・reasoning（vitest）。
- Integration: engine ＋ fake、Hono `app.request` ＋ fake。
- E2E: 実 OpenRouter（node, opt-in）。
- Manual QA: `wrangler dev` 構造スモーク。
- Static check: `tsc --noEmit`。

## Test Matrix

| ID | Source | Requirement / Invariant | Test Type | Command / File | Expected Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | TODO | 契約一致 | Integration | `test/api.test.ts` | 4 routes が期待 JSON | verified |
| AC-002 | TODO | provider 差し替え | Integration | `test/engine.test.ts`, `test/api.test.ts` | fake で全層動作 | verified |
| AC-003 | TODO | 既定/上書き・reasoning | Unit | `test/config.test.ts`, `test/harness.test.ts` | 解決が期待通り | verified |
| AC-004 | TODO | 鍵非出力 | Unit + review | `test/api.test.ts`, `src/credentials.ts` | 鍵到達のみ・非ログ | verified |
| AC-005 | TODO | 実翻訳 | E2E | `test/e2e.test.ts` | gemini-3.1-flash-lite で成功 | verified |
| INV-001 | intent | 契約一致 | Integration | `test/api.test.ts` | snake_case 一致 | verified |
| INV-002 | intent | 抽象越し | Unit | `src/engine.ts` | `ChatProvider` のみ依存 | verified |
| INV-003 | intent | 解決優先順位 | Unit | `test/config.test.ts` | 優先順位通り | verified |
| INV-004 | intent | 鍵非出力 | Review + Unit | `src/credentials.ts`, `src/provider.ts` | 非ログ | verified |
| INV-005 | intent | stream 既定 raw | Unit | `test/engine.test.ts` | 区切りなし | verified |

## Manual QA Checklist

- [ ] `wrangler dev` が起動する。
- [ ] `GET /healthz` 200。
- [ ] `GET /v1/config` が既定を返す。
- [ ] `GET /` が同梱 UI を返す（assets バインディング）。
- [ ] 鍵なし `POST /v1/translate` が 401。

## Regression Checklist

- [ ] `npx vitest run` 全通過。
- [ ] `npx tsc --noEmit` クリーン。

## High-risk Checklist

Use this section only for Risk High / Critical.

- [x] Rollback or recovery path is documented.（未デプロイ。デプロイ後は前 deploy へ revert）
- [x] Data safety has been checked.（状態なし）
- [x] Security / privacy implications have been checked.（鍵はヘッダ受け・非保持・非ログ）
- [x] Failure mode is understood.（provider 異常は 401/403/429/502 にマップ）

## Out of Scope

- 二モード（サーバ鍵＋Access）= Worker-Feat-7。
- 実 Cloudflare デプロイ。

## Open Questions

- `wrangler dev` の Authorization 値削り（既知差異）に対し、ローカル実認証検証を `wrangler dev --remote` で行うか、node E2E に委ねるか。現状は後者。
