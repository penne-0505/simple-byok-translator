---
title: "QA Test Plan: Two-mode credentials"
status: active
draft_status: n/a
qa_status: planned
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/two-mode-auth/decision.md"
  - "_docs/plan/Worker/two-mode-auth/plan.md"
related_issues: []
related_prs: []
---

# QA Test Plan: `Two-mode credentials`

## Source of Intent

- TODO: Worker-Feat-7
- Plan: `_docs/plan/Worker/two-mode-auth/plan.md`
- Intent: `_docs/intent/Worker/two-mode-auth/decision.md`

## Quality Goal

サーバ鍵モードを足しても、ゲート無しでは決して使われず（オープンリレー化しない）、BYOK 既定の安全性を保つこと。鍵・ゲートを漏らさない。

## Acceptance Criteria

- AC-001: ヘッダ鍵があれば BYOK、無ければ `env.OPENROUTER_KEY`（設定時）を使う二モードが切り替わる。
- AC-002: サーバ鍵はゲート（gate token or Access）無しでは使われない。
- AC-003: OSS 既定（`OPENROUTER_KEY` 未設定）は純 BYOK で 401 を返す。

## Intent-derived Invariants

- INV-001: `OPENROUTER_KEY` 未設定なら鍵なしは 401。
- INV-002: BYOK はサーバ鍵より優先。
- INV-003: サーバ鍵はゲート通過時のみ使用。
- INV-004: 鍵ありゲート不通過は 403、両方無しは 401。
- INV-005: 鍵・ゲート token は非ログ・非レスポンス。

## Risk Assessment

- Risk level: High
- Risk rationale: サーバが鍵を持つ。外部認証・secret。
- Regression risk: 中（BYOK 経路を壊さないこと）。
- Data safety risk: 低（状態なし）。
- Security / privacy risk: オープンリレー化・鍵/ゲート漏洩。ゲート必須・定数時間比較・非ログで対処。
- UX risk: 低。
- Agent misbehavior risk: 該当なし。

## Test Strategy

- Unit: `test/credentials.test.ts`。
- Integration: `test/api.test.ts`（env 注入）。
- E2E: 本番 Worker。

## Test Matrix

| ID | Source | Requirement / Invariant | Test Type | Command / File | Expected Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | TODO | 二モード切替 | Unit + E2E | `test/credentials.test.ts`, prod | BYOK/server-key 切替 | verified |
| AC-002 | TODO | ゲート必須 | Unit + E2E | `test/credentials.test.ts`, prod | 無ゲートで 403 | verified |
| AC-003 | TODO | 既定は純 BYOK | Unit | `test/credentials.test.ts` | 未設定で 401 | verified |
| INV-001 | intent | 未設定→401 | Unit | `test/credentials.test.ts` | 401 | verified |
| INV-002 | intent | BYOK 優先 | Unit | `test/credentials.test.ts` | header 鍵採用 | verified |
| INV-003 | intent | ゲート通過のみ | Unit + E2E | `test/credentials.test.ts`, prod | 正ゲートで採用 | verified |
| INV-004 | intent | 403 / 401 区別 | Unit + E2E | `test/api.test.ts`, prod | 403/401 | verified |
| INV-005 | intent | 非ログ | Review | `src/credentials.ts` | 出力なし・定数時間比較 | verified |

## Manual QA Checklist

- [ ] 本番で BYOK ヘッダ翻訳が通る。
- [ ] 本番で server-key + 正ゲートが通る。
- [ ] 無ゲート / 誤ゲートが 403。
- [ ] 鍵もゲートも無しが 401。

## Regression Checklist

- [ ] `npx vitest run` 全通過（BYOK 経路維持）。

## High-risk Checklist

Use this section only for Risk High / Critical.

- [x] Rollback or recovery path is documented.（Secret 削除で純 BYOK へ）
- [x] Data safety has been checked.（状態なし）
- [x] Security / privacy implications have been checked.（ゲート必須・定数時間・非ログ）
- [x] Failure mode is understood.（無ゲート→403、未設定→401）

## Out of Scope

- Cloudflare Access の自動構築、JWT 署名検証。

## Open Questions

- Access を採用する場合の JWT 署名検証を将来足すか（現状は identity ヘッダ存在で可）。
