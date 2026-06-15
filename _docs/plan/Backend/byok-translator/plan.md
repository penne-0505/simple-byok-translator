---
title: BYOK OpenRouter translation backend plan
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Backend/byok-translator/decision.md"
  - "_docs/qa/Backend/byok-translator/test-plan.md"
related_issues: []
related_prs: []
---

<!-- Canonical path: _docs/plan/Backend/byok-translator/plan.md -->

## Overview

BYOK（OpenRouter 準拠）翻訳バックエンドを、provider / harness / config / engine の四層に分離して実装する。フロントは将来 React に置換するため、現状は単一 HTML の最小実装に留める。

## Scope

- `ChatProvider` 抽象と OpenRouter 実装（complete / stream / aclose）。
- `HarnessProfile` / `TranslationSpec` と純粋関数によるプロンプト構築・出力抽出。
- `ConfigStore`: `defaults.yaml` ロードと、既定＋リクエスト上書きの解決。
- `TranslationEngine`: 解決→構築→provider 呼び出し→抽出のオーケストレーション。
- FastAPI ルート（`/healthz`, `/v1/config`, `/v1/translate`, `/v1/translate/stream`）と BYOK 認証依存・エラーマッピング。
- 最小フロント（`frontend/index.html`）。

## Non-Goals

- 永続化（履歴・ユーザー管理・鍵保存）。
- 複数 provider の同時運用や自動フェイルオーバー。
- 本格的なフロント（React 版は別タスク）。
- 課金・レート制御・認可（BYOK 鍵の透過のみ）。

## Requirements

- **Functional**: BYOK 鍵で翻訳できる。既定モデル/instruction/ハーネスが同梱され、リクエスト単位で model/profile/instruction/tone/glossary/sampling を上書きできる。`/v1/config` が既定を返す。
- **Non-Functional**: provider はオブジェクト差し替えで交換可能。鍵は保持・出力しない。翻訳既定はコード変更なしに `defaults.yaml` で再調整できる。

## Tasks

- [x] provider 抽象 + OpenRouter 実装
- [x] harness（models / builder）
- [x] config_store + defaults.yaml
- [x] engine
- [x] FastAPI ルート + 認証依存 + エラーハンドラ
- [x] 最小フロント
- [x] テスト（config / harness / engine / api）

## QA Plan

- QA document: `_docs/qa/Backend/byok-translator/test-plan.md`
- Risk level: High
- Test strategy:
  - Unit: config 解決、harness 描画/抽出。
  - Integration: engine ＋ fake provider、FastAPI TestClient ＋ fake provider。
  - E2E: 実 OpenRouter 鍵での手動 1 ケース（任意・ネットワーク必要）。
  - Manual QA: uvicorn 起動・`/healthz`・`/v1/config`・鍵なし 401。
  - Validator / static check: `scripts/check-docs.sh`。
- AC / INV の確認手段紐付けは test-plan の Test Matrix を参照。
- Risk High のため、rollback（= デプロイ単位の revert）と secret 安全性（鍵非出力）を High-risk checklist で確認する。

## Deployment / Rollout

- `uv run uvicorn app.main:app`。環境変数は `TRANSLATOR_*`（`.env.example` 参照）。
- ロールバックはデプロイ単位の revert。状態を持たないためデータ移行・後方互換の懸念はない。
- 監視は provider エラー率（502/429/401）を想定。
