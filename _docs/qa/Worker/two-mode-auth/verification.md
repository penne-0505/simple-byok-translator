---
title: "QA Verification: Two-mode credentials"
status: active
draft_status: n/a
qa_status: verified
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/two-mode-auth/decision.md"
  - "_docs/plan/Worker/two-mode-auth/plan.md"
  - "_docs/qa/Worker/two-mode-auth/test-plan.md"
related_issues: []
related_prs: []
---

# QA Verification: `Two-mode credentials`

## Summary

`getCredentials` にゲート付きサーバ鍵フォールバックを実装。vitest で全分岐を担保し、本番 Worker（`simple-byok-translator.penneotibo.workers.dev`）に `OPENROUTER_KEY` / `GATE_TOKEN` を Secret 設定して BYOK / server-key+gate / 無ゲート / 誤ゲート / 未認証を実機検証した。

## Verification Verdict

Verdict: PASS

## Commands Run

```bash
cd worker && npx vitest run
npx wrangler deploy
echo -n "$KEY"  | npx wrangler secret put OPENROUTER_KEY
echo -n "$GATE" | npx wrangler secret put GATE_TOKEN
# production curls against the live URL
```

Result:

```text
vitest: 52 passed | 3 skipped
production:
  BYOK (Authorization)            -> 200, "The train came out of the long tunnel into the snow country."
  server-key + valid X-Gate-Token -> 200, translates (incl. reasoning_effort)
  keyless + no gate               -> 403 forbidden
  keyless + wrong gate            -> 403
  no key + no gate                -> 401 missing_credentials
```

## Automated Test Results

| Command / Test | Result | Notes |
| --- | --- | --- |
| `npx vitest run` | PASS | 52 passed（two-mode 12 件含む） |
| `test/credentials.test.ts` | PASS | 全分岐（BYOK 優先・ゲート・403/401） |
| `test/api.test.ts` | PASS | env 注入で server-key / 403 |

## Manual QA Results

| Checklist Item | Result | Notes |
| --- | --- | --- |
| 本番 BYOK | PASS | Authorization で翻訳 |
| 本番 server-key + 正ゲート | PASS | サーバ鍵で翻訳 |
| 無ゲート / 誤ゲート | PASS | 403 |
| 鍵もゲートも無し | PASS | 401 |

## Acceptance Criteria Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| AC-001 | PASS | unit ＋ 本番で二モード切替 |
| AC-002 | PASS | 無/誤ゲートで 403（本番） |
| AC-003 | PASS | `OPENROUTER_KEY` 未設定で 401（unit） |

## Invariant Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| INV-001 | PASS | `test/credentials.test.ts` |
| INV-002 | PASS | BYOK 優先テスト・本番 |
| INV-003 | PASS | 正ゲートで採用（本番） |
| INV-004 | PASS | 403/401 区別（本番） |
| INV-005 | PASS | `src/credentials.ts` レビュー（非ログ・定数時間比較） |

## Deferred / Not Covered

| ID | Reason | Follow-up |
| --- | --- | --- |
| ACCESS-JWT | Cloudflare Access の JWT 署名検証は未実装（identity ヘッダ存在で可） | Access 採用時に署名検証を足す |

## Residual Risks

- なし

## Follow-up TODOs

- 完了/置換: ゲート token gating は Worker-Feat-8（単一 admin ログイン）でセッションに置換され、`GATE_TOKEN` は撤去済み。BYOK＋サーバ鍵の二モード構造自体は維持。
- OpenRouter 鍵のローテーション運用（`wrangler secret put` で更新）。
