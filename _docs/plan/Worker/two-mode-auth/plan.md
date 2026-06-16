---
title: Two-mode credentials plan
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Worker/two-mode-auth/decision.md"
  - "_docs/qa/Worker/two-mode-auth/test-plan.md"
related_issues: []
related_prs: []
---

<!-- Canonical path: _docs/plan/Worker/two-mode-auth/plan.md -->

## Overview

`getCredentials` シームに、ゲート付きサーバ鍵フォールバックを足す。既定は純 BYOK のまま。

## Scope

- `src/credentials.ts`: `Env`（`OPENROUTER_KEY` / `GATE_TOKEN`）、二モード解決、ゲート判定（定数時間比較 ＋ Access ヘッダ）。
- `src/errors.ts`: `ForbiddenError`(403)。
- `src/app.ts`: `c.env` を `getCredentials` へ渡す、Bindings に `Env` を合成。
- フロント: gate token フィールド（鍵空ならサーバ鍵モード、`X-Gate-Token` 送信）。
- テスト（unit + integration）。

## Non-Goals

- Cloudflare Access の自動プロビジョニング（手動／ドキュメント案内）。
- JWT 署名検証（identity ヘッダ存在で可とする。エッジが Cf-* を剥がす前提）。
- ユーザー管理・複数鍵。

## Requirements

- **Functional**: BYOK 優先、サーバ鍵はゲート通過時のみ、未設定なら純 BYOK。
- **Non-Functional**: 鍵/ゲートを非ログ・非保持、ゲート比較は定数時間。

## Tasks

- [x] `ForbiddenError` 追加
- [x] 二モード `getCredentials` ＋ ゲート判定
- [x] `app.ts` で `c.env` 連携
- [x] フロントの gate token 対応
- [x] unit/integration テスト
- [x] デプロイ ＋ 本番 E2E（BYOK / server-key+gate / 403 / 401）

## QA Plan

- QA document: `_docs/qa/Worker/two-mode-auth/test-plan.md`
- Risk level: High
- Test strategy:
  - Unit: `test/credentials.test.ts`（全分岐）。
  - Integration: `test/api.test.ts`（env 注入で server-key / 403）。
  - E2E: 本番 Worker で BYOK / server-key+gate / 誤ゲート / 無ゲート。
- Risk High: 鍵を持つモードのため、ゲート無し時の 403（オープンリレー防止）を必須確認。

## Deployment / Rollout

- `wrangler deploy` ＋ `wrangler secret put OPENROUTER_KEY GATE_TOKEN`。
- 鍵未設定で純 BYOK にロールバック可能（Secret 削除）。
