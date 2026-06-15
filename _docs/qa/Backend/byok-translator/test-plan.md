---
title: "QA Test Plan: BYOK OpenRouter translation backend"
status: active
draft_status: n/a
qa_status: planned
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Backend/byok-translator/decision.md"
  - "_docs/plan/Backend/byok-translator/plan.md"
related_issues: []
related_prs: []
---

# QA Test Plan: `BYOK OpenRouter translation backend`

## Source of Intent

- TODO: Backend-Feat-5
- Plan: `_docs/plan/Backend/byok-translator/plan.md`
- Intent: `_docs/intent/Backend/byok-translator/decision.md`

## Quality Goal

ユーザーの BYOK 鍵で安全に翻訳でき、既定と上書きの解決が決定的で、LLM 呼び出しが抽象の背後に隔離されていること。とりわけ鍵が一切漏れないこと。

## Acceptance Criteria

- AC-001: `POST /v1/translate` が BYOK 鍵（Authorization ヘッダ）で翻訳結果を返す。
- AC-002: 既定モデル・instruction・ハーネスが同梱され、リクエスト単位の上書きが効く。
- AC-003: LLM 呼び出しが `ChatProvider` 抽象の背後にあり OpenRouter 実装が差し替え可能。
- AC-004: 鍵がログ・レスポンス・保存先に出力されない。
- AC-005: `GET /v1/config` が secret を含まず既定値を返す。

## Intent-derived Invariants

- INV-001: BYOK 鍵はログ・レスポンス・永続化に出力されない。
- INV-002: 上位層は具象 provider を参照しない（抽象越し）。
- INV-003: 未指定は既定に解決、明示指定はマッピングより優先。
- INV-004: provider の 401/403/429 が対応 HTTP ステータスで伝わる。
- INV-005: `/v1/config` は secret を含まない。

## Risk Assessment

- Risk level: High
- Risk rationale: 外部 API・secret（ユーザー鍵）を扱う。
- Regression risk: 低（新規・状態なし）。
- Data safety risk: 低（永続化なし）。
- Security / privacy risk: 鍵漏洩が最大リスク。非保持・非ログ・redacted repr で対処。
- UX risk: 低（throwaway フロント）。
- Agent misbehavior risk: 該当なし（agent workflow/validator/skill 変更ではない）。

## Test Strategy

- Unit: config 解決、harness 描画/抽出。
- Integration: engine ＋ fake provider、FastAPI TestClient ＋ fake provider。
- E2E: 実鍵での手動 1 ケース（任意）。
- Manual QA: uvicorn 起動と基本エンドポイント。
- Validator / static check: `scripts/check-docs.sh`。
- Diff review: 鍵の取り扱い箇所（main.get_credentials, providers.openrouter）。

## Test Matrix

| ID | Source | Requirement / Invariant | Test Type | Command / File | Expected Evidence | Status |
| --- | --- | --- | --- | --- | --- | --- |
| AC-001 | TODO | BYOK 鍵で翻訳が返る | Integration | `tests/test_api.py::test_translate_happy_path` | 200 + translation + 鍵が provider に到達 | verified |
| AC-002 | TODO | 既定と上書き | Unit | `tests/test_config_store.py` (defaults/override 群) | 既定解決と上書きが期待通り | verified |
| AC-003 | TODO | provider 差し替え | Integration | `tests/test_engine.py`, `tests/test_api.py` (FakeProvider) | fake で全層動作 | verified |
| AC-004 | TODO | 鍵非出力 | Diff review + Unit | `Credentials.__repr__`, `tests/test_engine.py` | repr redacted、ログ出力なし | verified |
| AC-005 | TODO | config 公開 | Integration | `tests/test_api.py::test_config_is_public_and_secret_free` | secret なし | verified |
| INV-001 | intent | 鍵漏洩なし | Diff review | `app/providers/base.py`, `app/main.py` | 鍵は header 構築時のみ使用 | verified |
| INV-002 | intent | 抽象越し呼び出し | Unit | `app/translation/engine.py` | engine は `ChatProvider` のみ依存 | verified |
| INV-003 | intent | 解決優先順位 | Unit | `tests/test_config_store.py::test_explicit_profile_beats_model_mapping` 他 | 優先順位通り | verified |
| INV-004 | intent | upstream ステータス伝播 | Integration | `tests/test_api.py::test_provider_rate_limit_maps_to_429` | 429 + code | verified |
| INV-005 | intent | config に secret なし | Integration | `tests/test_api.py::test_config_is_public_and_secret_free` | secret なし | verified |
| INV-006 | intent | stream に区切り漏れなし | Unit + E2E | `tests/test_engine.py::test_stream_defaults_to_delimiter_free_profile` | raw 既定でクリーン | verified |
| INV-007 | intent | バイナリに鍵非同梱 | Manual | `/tmp` から起動し鍵なし 401 | dev 鍵非同梱 | verified |
| INV-008 | intent | dev 鍵は keyring 暗号化保管・平文非残置 | Manual + E2E | keyring 経由翻訳、`.env` shred、ログ grep | 平文鍵なし | verified |

## Manual QA Checklist

- [ ] `uv run uvicorn app.main:app` が起動する。
- [ ] `GET /healthz` が 200。
- [ ] `GET /v1/config` が既定を返し secret を含まない。
- [ ] 鍵なし `POST /v1/translate` が 401。

## Regression Checklist

- [ ] `uv run pytest` が全通過。

## High-risk Checklist

- [x] Rollback or recovery path is documented.（デプロイ単位 revert、状態なし）
- [x] Data safety has been checked.（永続化なし）
- [x] Security / privacy implications have been checked.（鍵非保持・非ログ・redacted repr・dev_api_key は開発限定）
- [x] Failure mode is understood.（provider 異常は 401/403/429/502 にマップ）

## Out of Scope

- 実 OpenRouter への自動 E2E（ネットワーク・課金が必要）。

## Open Questions

- 既定モデル slug の陳腐化監視を運用にどう載せるか（現状は `defaults.yaml` 手動更新）。
