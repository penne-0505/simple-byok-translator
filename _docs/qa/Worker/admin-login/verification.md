---
title: "QA Verification: Single-admin login"
status: active
draft_status: n/a
qa_status: verified
risk: High
created_at: 2026-06-16
updated_at: 2026-06-16
references:
  - "_docs/intent/Worker/admin-login/decision.md"
  - "_docs/plan/Worker/admin-login/plan.md"
  - "_docs/qa/Worker/admin-login/test-plan.md"
related_issues: []
related_prs: []
---

# QA Verification: `Single-admin login`

## Summary

単一 admin・DB なしのログイン（PBKDF2 ＋ HMAC 署名 Cookie）を実装し、サーバ鍵モードのゲートを gate token からセッションに置換。さらに **UI からのパスワード/ユーザー名ローテーション**を `AUTH_KV`（KV）で実装（Worker Secret は実行中に書き換え不可なため）。vitest で 65 件、本番 Worker で login→session→server-key 翻訳・誤資格・未設定・logout・BYOK 併存・**パスワードローテーション往復**を実機検証。実装中に Workers 固有の制約を 1 件検出・修正した（下記）。

## Verification Verdict

Verdict: PASS

## Commands Run

```bash
cd worker && npx tsc --noEmit && npx vitest run
npx wrangler deploy
printf '%s' "$PW" | npm run hash-password    # -> pbkdf2$100000$...
echo -n admin | npx wrangler secret put ADMIN_USER   # + ADMIN_PASSWORD_HASH / SESSION_SECRET
npx wrangler secret delete GATE_TOKEN
# production login flow via curl cookie jar
```

Result:

```text
tsc: clean
vitest: 65 passed | 3 skipped
production (simple-byok-translator.penneotibo.workers.dev):
  /auth/me (anon)            -> authenticated:false, login_configured:true, rotation_available:true
  POST /auth/login (correct) -> 200 {ok:true}, Set-Cookie session
  translate via session      -> 200 "I like cats." (server key)
  POST /auth/login (wrong)   -> 401 invalid_credentials
  logout then translate      -> 403 forbidden
  BYOK header (no session)   -> 200 "Good morning"
  change-password ORIG->TMP  -> 200; login ORIG -> 401; login TMP -> 200
  change-password TMP->ORIG  -> 200; login ORIG -> 200 (known password preserved)
```

## Automated Test Results

| Command / Test | Result | Notes |
| --- | --- | --- |
| `npx tsc --noEmit` | PASS | 型クリーン |
| `npx vitest run` | PASS | 65 passed |
| `test/auth.test.ts` | PASS | PBKDF2・セッション署名/失効 |
| `test/credentials.test.ts` | PASS | BYOK 優先・セッション gated・loginConfigured |
| `test/api.test.ts` | PASS | login→cookie→translate・401/501/403・/auth/me・change-password |

## Manual QA Results

| Checklist Item | Result | Notes |
| --- | --- | --- |
| 本番 admin ログイン → サーバ鍵翻訳 | PASS | "I like cats." |
| 誤パスワード 401 / ログアウト後 403 | PASS | — |
| BYOK ヘッダ併存 | PASS | "Good morning" |
| `/auth/me` 状態反映 | PASS | authenticated/username |

## Acceptance Criteria Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| AC-001 | PASS | 本番 login→session→server key |
| AC-002 | PASS | 403/401/501（unit ＋ 本番） |
| AC-003 | PASS | BYOK ヘッダ翻訳（本番） |
| AC-004 | PASS | 本番ローテーション往復（新可・旧不可）、KV 無し 501（api テスト） |

## Invariant Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| INV-001 | PASS | `test/credentials.test.ts` |
| INV-002 | PASS | BYOK 優先テスト・本番 |
| INV-003 | PASS | 無セッション 403（本番） |
| INV-004 | PASS | 誤資格 401・未設定 501（api テスト・本番） |
| INV-005 | PASS | `src/auth.ts`/`credentials.ts` レビュー（定数時間・非ログ） |
| INV-006 | PASS | change-password テスト（session/現pw 必須・501・新旧切替）＋ 本番 |

## Issues Found During Implementation (fixed)

- BUG-1: PBKDF2 反復回数 210,000 は Cloudflare Workers の Web Crypto 上限（100,000）を超え、本番ログインが 500（"iteration counts above 100000 are not supported"）。node では通るため本番でのみ顕在化。`src/auth.ts` と `scripts/hash-password.mjs` を 100,000 に下げ、ハッシュ再生成・再デプロイで解消。

## Deferred / Not Covered

| ID | Reason | Follow-up |
| --- | --- | --- |
| LOGIN-RATELIMIT | ブルートフォース対策のレート制限は state を要する | 必要なら KV で追加 |
| ACCESS | Cloudflare Access への委譲は不採用（自前ログイン） | 望めば将来切替 |

## Residual Risks

- なし

## Follow-up TODOs

- 管理パスワード・`SESSION_SECRET` のローテーション運用（`wrangler secret put`）。
- 必要に応じてログインのレート制限（KV）。
