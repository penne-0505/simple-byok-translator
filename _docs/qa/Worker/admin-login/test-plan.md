---
title: "QA Test Plan: Single-admin login"
status: active
draft_status: n/a
qa_status: planned
risk: High
created_at: 2026-06-16
updated_at: 2026-06-16
references:
  - "_docs/intent/Worker/admin-login/decision.md"
  - "_docs/plan/Worker/admin-login/plan.md"
related_issues: []
related_prs: []
---

# QA Test Plan: `Single-admin login`

## Source of Intent

- TODO: Worker-Feat-8
- Plan: `_docs/plan/Worker/admin-login/plan.md`
- Intent: `_docs/intent/Worker/admin-login/decision.md`

## Quality Goal

私的インスタンスをログインで保護しつつ、未設定なら純 BYOK で安全に立ち上がる。資格情報・セッション・鍵を漏らさない。

## Acceptance Criteria

- AC-001: 正しい admin 資格でセッションが発行され、サーバ鍵で翻訳できる。
- AC-002: 無セッションのサーバ鍵利用は 403、誤資格は 401、未設定環境の login は 501。
- AC-003: BYOK ヘッダは併存し、ログイン無しでも自分の鍵で翻訳できる。
- AC-004: ログイン中＋現在パスワード再確認で、UI からパスワード・ユーザー名を変更でき、以後新資格でログインできる（旧は不可）。KV 未バインドなら 501。

## Intent-derived Invariants

- INV-001: ログイン未設定なら鍵なしは 401。
- INV-002: BYOK はサーバ鍵より優先。
- INV-003: サーバ鍵は有効セッション時のみ使用。
- INV-004: 誤資格は 401、未設定 login は 501。
- INV-005: ハッシュ・セッション・鍵は非ログ・非レスポンス。
- INV-006: パスワード変更はセッション＋現在パスワード必須、KV 未バインドなら 501、新資格でログイン可・旧不可。

## Risk Assessment

- Risk level: High
- Risk rationale: 認証・secret・サーバ鍵。
- Regression risk: 中（BYOK 経路維持・gate 撤去）。
- Data safety risk: 低（DB なし、状態は署名 Cookie のみ）。
- Security / privacy risk: 資格情報漏洩・オープンリレー化。PBKDF2・定数時間・セッション必須で対処。
- UX risk: 低。
- Agent misbehavior risk: 該当なし。

## Test Strategy

- Unit: `test/auth.test.ts`, `test/credentials.test.ts`。
- Integration: `test/api.test.ts`。
- E2E: 本番 Worker。

## Test Matrix

| ID | Source | Requirement / Invariant | Test Type | Command / File | Expected Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | TODO | login→session→server key | Integration + E2E | `test/api.test.ts`, prod | 翻訳成功 | verified |
| AC-002 | TODO | 403/401/501 | Integration + E2E | `test/api.test.ts`, prod | ステータス一致 | verified |
| AC-003 | TODO | BYOK 併存 | Unit + E2E | `test/credentials.test.ts`, prod | header 鍵で翻訳 | verified |
| INV-001 | intent | 未設定→401 | Unit | `test/credentials.test.ts` | 401 | verified |
| INV-002 | intent | BYOK 優先 | Unit | `test/credentials.test.ts` | header 採用 | verified |
| INV-003 | intent | セッション時のみ | Integration + E2E | `test/api.test.ts`, prod | 無セッション 403 | verified |
| INV-004 | intent | 401 / 501 | Integration | `test/api.test.ts` | 誤資格 401・未設定 501 | verified |
| INV-005 | intent | 非ログ | Review | `src/auth.ts`, `src/credentials.ts` | 出力なし・定数時間 | verified |
| AC-004 | TODO | UI ローテーション | Integration + E2E | `test/api.test.ts`, prod | 変更後 新可・旧不可、KV 無し 501 | verified |
| INV-006 | intent | 変更の再認証/501 | Integration + E2E | `test/api.test.ts`, prod | session+現pw 必須、501 | verified |

## Manual QA Checklist

- [ ] 本番で admin ログイン → セッション → サーバ鍵翻訳。
- [ ] 誤パスワード 401、ログアウト後 403。
- [ ] BYOK ヘッダ翻訳が併存。
- [ ] `/auth/me` が状態を反映。

## Regression Checklist

- [ ] `npx vitest run` 全通過。
- [ ] `npx tsc --noEmit` クリーン。

## High-risk Checklist

Use this section only for Risk High / Critical.

- [x] Rollback or recovery path is documented.（ログイン Secret 削除で純 BYOK、`SESSION_SECRET` ローテで全失効）
- [x] Data safety has been checked.（DB なし）
- [x] Security / privacy implications have been checked.（PBKDF2・定数時間・HttpOnly/Secure Cookie・非ログ）
- [x] Failure mode is understood.（無セッション 403、誤資格 401、未設定 501）

## Out of Scope

- 複数ユーザー（D1）、セッション即時失効（KV）、Access JWT 検証。

## Open Questions

- ログインのブルートフォース対策（レート制限）は state を要するため未実装。必要なら KV で追加。
