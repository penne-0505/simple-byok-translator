---
title: "QA Verification: BYOK OpenRouter translation backend"
status: active
draft_status: n/a
qa_status: verified
risk: High
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/intent/Backend/byok-translator/decision.md"
  - "_docs/plan/Backend/byok-translator/plan.md"
  - "_docs/qa/Backend/byok-translator/test-plan.md"
related_issues: []
related_prs: []
---

# QA Verification: `BYOK OpenRouter translation backend`

## Summary

provider / harness / config / engine / routes の四層実装を、fake provider を用いた単体・統合テスト 34 件と、実 uvicorn 起動のスモークで検証した。鍵漏洩・解決優先順位・upstream ステータス伝播・config 公開の各不変条件を確認。

2026-06-15 追記: ユーザー提供鍵で**実 OpenRouter E2E を実施**（既定 gemini / anthropic / streaming）。E2E で 2 件の実問題を検出・修正した（下記）。さらに **PyInstaller 単一バイナリ**をビルドし、`backend/` 外（`/tmp`）から自己完結で起動・翻訳・鍵なし 401 を確認した。

2026-06-15 追記 2: dev 鍵のローカル保管を**平文 `.env` から OS keyring（libsecret / SecretService）へ移行**。`app/secret_source.py` が `env > keyring > none` で解決。keyring 経由の無ヘッダ翻訳を source/binary 両方で確認、平文 `.env` 鍵は `shred -u` で破棄、keyring を同梱した単一バイナリでも動作。

2026-06-15 追記 3: 既定モデルを `google/gemini-3.1-flash-lite`（実在確認済み）へ変更し、**reasoning を一級市民化**（`reasoning_effort` / `reasoning`）。実 E2E で reasoning_effort=high の翻訳成功、無効 effort は 422、`/v1/config` に `reasoning_efforts` 露出を確認。テスト 41 件全通過。

## Verification Verdict

Verdict: PASS

## Commands Run

```bash
cd backend
uv run pytest -q
uv run python -m app --port 8144                       # smoke (UI + API)
# real E2E (key via gitignored .env TRANSLATOR_DEV_API_KEY / Authorization header)
curl -X POST :8144/v1/translate -d '{"text":"...","target_language":"English"}'
# single binary
uv run pyinstaller byok-translator.spec --clean --noconfirm
(cd /tmp && byok-translator --port 8150)               # standalone, BYOK header
```

Result:

```text
34 passed, 1 warning in 0.32s
healthz -> {"status":"ok","version":"0.1.0"}
GET /  -> 200 text/html (bundled UI)
GET /v1/config -> 200, secret なし, profiles [general,claude,gemini,raw]
E2E gemini  JA->EN -> "The train came out of the long tunnel into the snow country." (usage 付き)
E2E claude  EN->JA -> glossary「猫殿」反映, claude profile 抽出
E2E stream        -> 区切り漏れなしのクリーンなデルタ
binary (/tmp, 26MB) -> 同梱UI/config で翻訳成功, 鍵なし -> 401
```

## Automated Test Results

| Command / Test | Result | Notes |
| --- | --- | --- |
| `uv run pytest` | PASS | 34 passed |
| `tests/test_config_store.py` | PASS | 解決・優先順位・instruction merge・stream profile |
| `tests/test_harness_builder.py` | PASS | 描画・抽出・brace-safe |
| `tests/test_engine.py` | PASS | fake provider 越しの動作・error 伝播・stream 既定 raw |
| `tests/test_api.py` | PASS | routes・BYOK 認証・error マップ・SSE・usage 直列化回帰 |
| 実 OpenRouter E2E | PASS | gemini/claude/stream の 3 系統で実翻訳成功 |
| 単一バイナリ standalone | PASS | `/tmp` から同梱資産で起動・翻訳・鍵なし 401 |
| `./scripts/check-docs.sh` | PASS | front-matter / TODO / links / qa validators |

## Manual QA Results

| Checklist Item | Result | Notes |
| --- | --- | --- |
| uvicorn 起動 | PASS | port 8137 で起動確認 |
| `GET /healthz` | PASS | 200 |
| `GET /v1/config` secret-free | PASS | 既定返却・secret なし |
| 鍵なし `POST /v1/translate` | PASS | 401 missing_credentials |

## Acceptance Criteria Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| AC-001 | PASS | `test_translate_happy_path`（200 + translation + 鍵到達） |
| AC-002 | PASS | `test_config_store.py` 既定/上書き群 |
| AC-003 | PASS | engine/api を FakeProvider で全層検証 |
| AC-004 | PASS | `Credentials.__repr__` redacted、鍵はログ/レスポンス非出力 |
| AC-005 | PASS | `test_config_is_public_and_secret_free` |

## Invariant Coverage

| ID | Result | Evidence |
| --- | --- | --- |
| INV-001 | PASS | base.Credentials redacted、main で header 構築時のみ使用 |
| INV-002 | PASS | engine は `ChatProvider` のみ依存、具象 import なし |
| INV-003 | PASS | `test_explicit_profile_beats_model_mapping` 他 |
| INV-004 | PASS | `test_provider_rate_limit_maps_to_429`（429） |
| INV-005 | PASS | `test_config_is_public_and_secret_free` |
| INV-006 | PASS | `test_stream_defaults_to_delimiter_free_profile` ＋ 実 stream E2E（区切り漏れなし） |
| INV-007 | PASS | バイナリを `/tmp` から起動、`USE_KEYRING=false`＋鍵なし -> 401（dev 鍵は非同梱） |
| INV-008 | PASS | keyring 経由で無ヘッダ翻訳成功（source/binary 両方）、`.env` 平文は shred、ログに鍵なし |

## Issues Found During E2E (fixed)

- BUG-1: `Usage` が `slots=True` dataclass のため `vars()` が `TypeError`。OpenRouter が usage を返すと 500。`dataclasses.asdict` に修正し、API 層の回帰テストを追加。FakeProvider が usage=None だったため単体では未検出だった。
- BUG-2: 既定の `anthropic/claude-3.5-sonnet` / `claude-sonnet-4` slug が OpenRouter から消失。models API で実 slug を確認し `known_models` を更新。
- QUALITY-1: ストリーミングが区切りプロファイルだとデルタに区切り文字が漏れる。`default_stream_profile`（既定 `raw`）を導入し解決を一箇所に集約。

## Deferred / Not Covered

| ID | Reason | Follow-up |
| --- | --- | --- |
| E2E-CI | 実鍵 E2E の自動化は鍵管理・課金が絡むため CI 未配線 | 必要時に secret 注入で smoke を 1 本足す |
| BIN-XPLAT | 単一バイナリは Linux でのみ検証 | macOS/Windows 配布が必要になったら各 OS でビルド |

## Residual Risks

- なし

## Follow-up TODOs

- 既定モデル slug の陳腐化監視を運用に載せる（現状は `defaults.yaml` 手動更新。2026-06-15 に実 slug へ更新済み）。
- 配布対象が増えたら、各 OS でバイナリをビルドして検証する。
- ユーザー提供鍵はチャット履歴に残ったため、運用上はローテーション推奨（残課題ではなく申し送り）。
