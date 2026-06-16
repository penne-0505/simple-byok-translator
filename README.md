# simple-byok-translator

> BYOK（Bring Your Own Key, OpenRouter 準拠）の翻訳アプリ。TypeScript Cloudflare Worker。

## 概要

OpenRouter で翻訳するシンプルなアプリです。既定でモデル・翻訳 instruction・対モデル翻訳補助ハーネスを同梱しつつ、リクエスト単位で上書きできます。鍵はリクエストで持ち込む BYOK と、ログインしてサーバ保持の鍵を使う方式の二つに対応します。

フロントエンドは将来 React に大幅置換する前提で、現在は依存ゼロの単一 HTML（捨てられる前提の最小実装）です。その分、バックエンド（Worker）は疎結合・抽象的に作り込んであり、フロントとは REST 境界で分離しています。

稼働中: <https://simple-byok-translator.penneotibo.workers.dev>

## 設計の要点

- **二モードの鍵解決**: `getCredentials` 一箇所に集約。BYOK ヘッダ（`Authorization: Bearer` / `X-API-Key`）が常に優先。鍵なしリクエストは、ログインセッションがあればサーバ保持の `OPENROUTER_KEY` を使う。鍵は保持・ログ出力しない。
- **単一 admin ログイン（DB なし）**: PBKDF2 ＋ HMAC 署名 Cookie。資格情報は Worker Secret（＋ UI ローテーション用に KV）。未設定なら純 BYOK で安全に立ち上がる。
- **provider 抽象**: LLM 呼び出しは `ChatProvider` の背後にあり、OpenRouter 実装はオブジェクト一つで差し替え可能。
- **対モデル翻訳ハーネス**: `HarnessProfile`（system テンプレート・サンプリング・reasoning・出力抽出規則）をモデル特性ごとに切り替える。
- **既定とユーザー上書き**: 解決は一箇所に集約し、優先順位は「同梱既定 < model→profile マッピング < リクエスト明示指定」。翻訳の既定は `worker/src/config.ts` に型付きデータとして置く。

## アーキテクチャ

```text
routes (Hono)          worker/src/app.ts        ← HTTP を知る唯一の層 + UI 自己ホスト
  └ TranslationEngine  worker/src/engine.ts     ← 解決→構築→呼び出し→抽出
      ├ ConfigStore    worker/src/config.ts     ← 既定 + リクエスト上書きの合流
      ├ harness        worker/src/harness.ts    ← 純粋関数：プロンプト構築・出力抽出
      └ ChatProvider   worker/src/provider.ts   ← LLM 境界（OpenRouter 実装）
  getCredentials       worker/src/credentials.ts ← 鍵の継ぎ目（BYOK / サーバ鍵）
  auth                 worker/src/auth.ts        ← PBKDF2・署名セッション
```

## クイックスタート

```bash
cd worker
npm install
npm test              # vitest（fake provider、ネットワーク無し）
npx wrangler dev      # ローカル workerd
npx wrangler deploy   # Cloudflare へ
```

UI は Worker が同一オリジンで自己ホストします。セットアップ・API・ログイン/鍵の設定・デプロイ手順は [worker/README.md](worker/README.md) を参照してください。

## リポジトリ構成

```text
worker/         TypeScript Cloudflare Worker（Hono、本体・デプロイ対象）
frontend/       最小フロント（単一 HTML、将来 React へ置換）
_docs/          ドキュメント駆動開発の成果物（intent / plan / qa など）
TODO.md         タスクの source of truth
AGENTS.md       coding agent 向けの運用規約
```

## 開発ワークフロー

このリポジトリはドキュメント駆動開発で運用します。[TODO.md](TODO.md) をタスクの source of truth とし、`Size >= M` または `Risk >= Medium` の変更では `_docs/` 配下に intent / QA test-plan / verification を残します。詳細は [documentation guide](_docs/documentation_guide.md)、coding agent 向けの規約は [AGENTS.md](AGENTS.md)、入口は [QUICKSTART.md](QUICKSTART.md) を参照してください。

ローカルのドキュメント検証はまとめて実行できます。

```bash
./scripts/check-docs.sh
```

## ステータス

- TS Worker (`worker/`): **Cloudflare デプロイ済み**。vitest 65 件・実 OpenRouter E2E（node）・本番エッジで BYOK / ログイン / サーバ鍵を検証済み。
- 認証: 単一 admin の**ログイン**（DB なし、PBKDF2 ＋ 署名 Cookie）。UI からパスワード・ユーザー名をローテート可能（KV）。詳細は [worker/README.md](worker/README.md)。
- フロントエンド: 最小 HTML（動作確認用、同一オリジン配信、ログイン / BYOK 対応）。React 版は今後の別タスク。

## ライセンス

[MIT License](LICENSE.txt) の下でライセンスされています。

---

## Summary (English)

**simple-byok-translator** is a minimal translation app (OpenRouter-compatible),
deployed as a TypeScript Cloudflare Worker. It resolves credentials two ways:
bring-your-own-key per request (header), or a login session that unlocks a
server-held key. The server never logs or persists a key.

A single-admin login (no database — PBKDF2 hash + HMAC-signed cookie, with KV for
UI-driven rotation) gates the server-key path; with nothing configured it is pure
BYOK. Default model, instruction, and a per-model translation harness ship bundled
and are overridable per request, behind a clean `ChatProvider` boundary.

The frontend is a throwaway single HTML file (a React replacement is planned). See
[worker/README.md](worker/README.md) for setup, API, auth, and deploy.
