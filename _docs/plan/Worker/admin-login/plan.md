---
title: Single-admin login plan
status: active
draft_status: n/a
created_at: 2026-06-16
updated_at: 2026-06-16
references:
  - "_docs/intent/Worker/admin-login/decision.md"
  - "_docs/qa/Worker/admin-login/test-plan.md"
related_issues: []
related_prs: []
---

<!-- Canonical path: _docs/plan/Worker/admin-login/plan.md -->

## Overview

単一 admin・DB なしのログインを足し、サーバ鍵モードのゲートを gate token からセッションに置換する。

## Scope

- `src/auth.ts`: PBKDF2 ハッシュ（hashPassword/verifyPassword）、HMAC 署名セッション（create/verifySession）。
- `src/errors.ts`: `InvalidCredentialsError`(401)、`LoginNotConfiguredError`(501)。
- `src/credentials.ts`: `Env` 更新（ログイン三点、`GATE_TOKEN` 撤去）、サーバ鍵はセッション gated、`loginConfigured`。
- `src/app.ts`: セッション Cookie ミドルウェア、`/auth/login` `/auth/logout` `/auth/me`、翻訳へ `authenticated` 連携。
- `scripts/hash-password.mjs`：セットアップ用ハッシュ生成。
- フロント：ログインフォーム・ログアウト・`credentials: include`、gate 欄撤去。
- ローテーション：`AUTH_KV` バインド、`effectiveAdmin`/`setAdminCredentials`（KV 上書き）、`POST /auth/change-password`、フロントの変更フォーム。
- テスト（auth / credentials / api / rotation）。

## Non-Goals

- 複数ユーザー・サインアップ（D1）。
- セッション即時失効（KV）。
- Cloudflare Access の JWT 検証。

## Requirements

- **Functional**: admin ログインでセッション発行、サーバ鍵で翻訳。BYOK 併存。未設定なら純 BYOK。
- **Non-Functional**: DB なし。パスワード・セッション・鍵を非ログ・非保持。定数時間比較。

## Tasks

- [x] auth プリミティブ（PBKDF2 / HMAC セッション）
- [x] errors / credentials / app の更新
- [x] hash-password スクリプト
- [x] フロントのログイン UI
- [x] テスト（auth / credentials / api）
- [x] デプロイ ＋ Secret 設定 ＋ 本番ログイン E2E
- [x] KV ローテーション（change-password）＋ 本番 E2E

## QA Plan

- QA document: `_docs/qa/Worker/admin-login/test-plan.md`
- Risk level: High
- Test strategy:
  - Unit: `test/auth.test.ts`（ハッシュ・セッション）、`test/credentials.test.ts`。
  - Integration: `test/api.test.ts`（login→cookie→translate、401/501/403、/auth/me）。
  - E2E: 本番 Worker（login / server-key / wrong pw / logout / BYOK）。
- Risk High: ログイン無し時のサーバ鍵 403、PBKDF2 の Workers 上限を確認。

## Deployment / Rollout

- `wrangler deploy` ＋ `wrangler secret put ADMIN_USER ADMIN_PASSWORD_HASH SESSION_SECRET`。`GATE_TOKEN` は削除。
- ロールバック：ログイン三点 Secret 削除で純 BYOK へ。`SESSION_SECRET` ローテで全セッション失効。
