---
title: BYOK OpenRouter translation backend decision
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/plan/Backend/byok-translator/plan.md"
  - "_docs/qa/Backend/byok-translator/test-plan.md"
related_issues: []
related_prs: []
---

# BYOK OpenRouter translation backend decision

## Context

シンプルな翻訳アプリを作る。鍵はユーザー持ち込み（BYOK、OpenRouter 準拠）。既定でモデル・instruction・対モデル翻訳補助ハーネスを同梱しつつ、ユーザー単位で上書きできること。フロントは将来 React に大幅置換される前提で、いまは最小でよい。その代わりバックエンドは疎結合・抽象的に保ち、LLM が継続的に保守する。

## Decision

- スタックは **FastAPI + httpx + Pydantic v2 + PyYAML**。理由は下記 Rationale 参照。フロントとは REST 境界で切り、現状は単一 HTML の throwaway とする。
- LLM 呼び出しは `ChatProvider` Protocol の背後に隠す。OpenRouter 実装は OpenAI 互換 `/chat/completions` の薄いマーシャリングに留める。差し替え単位はオブジェクト一つ。
- 翻訳の組み立ては `harness`（純粋関数）に集約する。`HarnessProfile` が「対モデル翻訳補助ハーネス」の単位で、system テンプレート・サンプリング既定・出力抽出規則を束ねる。
- 既定とユーザー上書きの合流は `ConfigStore.resolve` 一箇所に集約する。優先順位は **同梱既定 < model→profile マッピング < リクエスト明示指定**。
- 翻訳の既定（モデル・base instruction・profiles・model_profile_map）は `config/defaults.yaml` にデータとして置き、コード変更なしで再調整できるようにする。
- BYOK 鍵はリクエスト単位で受け、プロセスに保持しない。`Authorization: Bearer` または `X-API-Key`。ローカル開発用の任意の dev 鍵は、解決を `app/secret_source.py` に集約した鎖 `env > OS keyring(libsecret) > なし` で引く。既定の保管先は OS keyring（暗号化 at rest）とし、平文 `.env` は明示時のみ。`.env` は「secure な置き場」ではなく便宜である、と明記する（2026-06-15 にユーザー判断で keyring 採用、平文鍵は shred 済み）。
- ストリーミングは区切り抽出ができない（全文を要する）。プロファイル明示がない `/v1/translate/stream` は既定で区切りなしの `default_stream_profile`（既定 `raw`）を使い、デルタに区切り文字が漏れないようにする。明示指定は streaming でも尊重する。解決は `ConfigStore.resolve(stream=True)` に集約。
- reasoning は OpenRouter 統一 `reasoning` パラメータを一級市民化する。`reasoning_effort`（none〜xhigh）と全量 `reasoning` オブジェクトを受け、プロファイル既定にマージ（effort が勝つ）。解決は `ConfigStore._resolve_reasoning` に集約し、harness が `SamplingParams.extra["reasoning"]` へ載せる。`reasoning` と `reasoning_effort` の二重送信による 400 を避けるため、ボディには `reasoning` オブジェクトのみ送る。
- 配布は **PyInstaller onefile** で単一バイナリ化する。API・`defaults.yaml`・UI を同梱し、サーバが UI を同一オリジンで自己ホストする。バイナリは鍵を持たず BYOK のまま。frozen/source のリソース解決は `app/resources.py` に集約。

## Alternatives

- **TypeScript/Node 一本（Hono など）**: フロントと言語が揃う利点はあるが、ユーザーの強みは Python であり、バックエンドの長期保守を Python に寄せる方が継続性が高い。REST 境界があるためフロントの React 化と言語選択は独立。よって不採用。
- **provider 抽象を作らず OpenRouter SDK 直叩き**: 初期は速いが、「抽象的な操作が効くように」という要件と将来の provider 追加に反する。不採用。
- **harness をコードのみで表現**: プロファイル追加・調整のたびにコード変更が要る。LLM 運用・非開発者調整の両面で、YAML データ化を採用。
- **プロダクトとしてユーザー鍵をサーバ保存（DB 等、暗号化 at rest）**: BYOK の核に反し、漏洩面とライフサイクル管理の負債を増やす。サーバはステートレス（パススルー）を採用。なおこれは「ユーザー個人がローカルで自分の dev 鍵をどう置くか」とは別問題で、後者は OS keyring を採用した（平文 `.env` ではなく）。

## Rationale

要件の重心は「フロントは捨てる前提、バックエンドを抽象的に厚く」。したがって境界の質が成果を決める。`ChatProvider` / `harness` / `ConfigStore` / `engine` の四層は、それぞれ「外部 LLM」「プロンプト」「既定と上書き」「오케스트레이션」という独立した変更軸に対応し、テストでは fake provider に差し替えるだけで全層が検証できる。FastAPI は Pydantic による型付き契約と OpenAPI を無償で与え、React フロントが従う明確なスキーマになる。

## Consequences / Impact

- Python と TS の二言語構成になるが、REST 境界で分離され相互の結合はない。
- streaming では出力抽出（区切り抽出）を適用しない。区切りは全文を要するため。streaming 用途には区切りなしの `raw` プロファイルを用意する。
- `defaults.yaml` の system テンプレートは `str.format` で描画する。テンプレート文字列側に意図しない `{}` を置くと壊れるが、ユーザー入力（instruction/glossary）は値として差し込むため安全。
- 既定モデル slug は時とともに陳腐化する。`known_models` と `default_model` は `defaults.yaml` 編集で更新する運用とする（2026-06-15 に実 slug へ更新、既定は `google/gemini-3.1-flash-lite`。sonnet 系は OpenRouter から消失）。
- 単一バイナリは onefile のためプラットフォーム/アーキ別ビルドが必要で、起動時にテンポラリ展開が走る（コールドスタート ~1s）。サーバ常駐用途では無視できるが、CLI 的な短命起動には不利。サーバ配備の長期安定策としてはコンテナの方が素直で、バイナリは「1 ファイル配って実行」用途に位置づける。React 化後は build 出力を `datas` に差し替えて再ビルドする。

## Quality Implications

- 外部 API・secret を扱うため Risk High。QA test-plan と verification を必須とする。
- 鍵がログ・レスポンス・保存先に出ないことを不変条件として検証する。
- provider 異常（401/403/429）は忠実なステータスで表面化し、鍵は echo しない。

## Intent-derived Invariants

- INV-001: ユーザーの BYOK 鍵はログ・レスポンス本文・永続化のいずれにも出力されない。
- INV-002: LLM 呼び出しは `ChatProvider` 抽象の背後にあり、上位層（harness/engine/routes）は具象 provider を参照しない。
- INV-003: リクエスト未指定のフィールドは同梱既定に解決され、明示指定はマッピングより優先される。
- INV-004: provider の認証/レート制限失敗は、対応する HTTP ステータス（401/403/429）として呼び出し元に伝わる。
- INV-005: `GET /v1/config` は secret を含まず、既定モデル・プロファイル・既定値を返す。
- INV-006: プロファイル未指定のストリーミングは、出力区切り文字をデルタに含めない。
- INV-007: 単一バイナリは鍵を焼き込まず、鍵未指定リクエストは 401 となる（`dev_api_key` はバイナリに含まれない）。
- INV-008: dev 鍵の既定保管は OS keyring（暗号化 at rest）であり、解決経路・ログのいずれにも平文鍵を残さない。
