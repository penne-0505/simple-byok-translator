# simple-byok-translator

> BYOK（Bring Your Own Key, OpenRouter 準拠）の翻訳アプリ。鍵はユーザーが持ち込み、サーバは保持しない。

## 概要

ユーザー自身の OpenRouter 鍵で翻訳するシンプルなアプリです。既定でモデル・翻訳 instruction・対モデル翻訳補助ハーネスを同梱しつつ、リクエスト単位で上書きできます。

フロントエンドは将来 React に大幅置換する前提で、現在は依存ゼロの単一 HTML（捨てられる前提の最小実装）です。その分、バックエンドは疎結合・抽象的に作り込んであり、フロントとは REST 境界で分離しています。

## 設計の要点

- **BYOK・鍵非保持**: 鍵は `Authorization: Bearer`（または `X-API-Key`）でリクエスト単位に受け、プロセスに保持しません。ログ・レスポンス・追跡対象ファイルのいずれにも出しません。
- **provider 抽象**: LLM 呼び出しは `ChatProvider` Protocol の背後にあり、OpenRouter 実装はオブジェクト一つで差し替え可能です。
- **対モデル翻訳ハーネス**: `HarnessProfile`（system テンプレート・サンプリング・出力抽出規則）をモデル特性ごとに切り替えます。
- **既定とユーザー上書き**: 解決は一箇所に集約し、優先順位は「同梱既定 < model→profile マッピング < リクエスト明示指定」。翻訳の既定は `backend/config/defaults.yaml` にデータとして置き、コード変更なしに調整できます。
- **ローカル dev 鍵は OS keyring**: 任意の開発用フォールバック鍵は libsecret / Secret Service（暗号化 at rest）から解決します。平文 `.env` は既定ではありません。
- **単一バイナリ**: API・既定設定・UI を PyInstaller で 1 ファイルに同梱できます（バイナリは鍵を焼き込みません）。

## アーキテクチャ

```text
routes (HTTP)          backend/app/main.py        ← HTTP を知る唯一の層 + UI 自己ホスト
  └ TranslationEngine  backend/app/translation/   ← 解決→構築→呼び出し→抽出
      ├ ConfigStore    backend/app/config_store   ← 既定 + リクエスト上書きの合流
      ├ harness        backend/app/harness/       ← 純粋関数：プロンプト構築・出力抽出
      └ ChatProvider   backend/app/providers/     ← LLM 境界（OpenRouter 実装）
```

## クイックスタート

```bash
cd backend
uv venv && uv pip install -e ".[dev]"
uv run python -m app --port 8000
```

ブラウザで <http://localhost:8000/> を開くと UI（API と同一オリジン）が出ます。鍵は UI に入力するか、ローカル開発用に OS keyring へ格納できます。詳細・curl 例・単一バイナリのビルドは [backend/README.md](backend/README.md) を参照してください。

## リポジトリ構成

```text
backend/        FastAPI バックエンド（provider / harness / config / engine の四層）
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

- バックエンド: 実装・実 OpenRouter E2E 済み。テスト・doc validator は green。
- フロントエンド: 最小 HTML（動作確認用）。React 版は今後の別タスク。

## ライセンス

[MIT License](LICENSE.txt) の下でライセンスされています。

---

## Summary (English)

**simple-byok-translator** is a minimal bring-your-own-key translation app
(OpenRouter-compatible). Users supply their own key per request; the server
never stores it. Default model, instruction, and a per-model translation
harness ship bundled and are overridable per request.

The frontend is a throwaway single HTML file (a React replacement is planned),
so the durable work lives in a cleanly separated backend: an abstract
`ChatProvider` boundary, a pure-function harness, layered config resolution, and
an orchestration engine. The optional local dev key is stored in the OS keyring
(encrypted at rest), and the whole app can be packaged into a single binary that
bakes in no key.

See [backend/README.md](backend/README.md) for setup, API, security posture, and
single-binary build instructions.
