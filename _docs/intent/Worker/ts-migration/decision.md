---
title: TypeScript Cloudflare Worker migration decision
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/plan/Worker/ts-migration/plan.md"
  - "_docs/qa/Worker/ts-migration/test-plan.md"
  - "_docs/intent/Backend/byok-translator/decision.md"
related_issues: []
related_prs: []
---

# TypeScript Cloudflare Worker migration decision

## Context

スマホ・出先ラップトップから使いたいという要求から、Cloudflare へのデプロイを決定。あわせて将来フロントが React（TS）になるため、バックエンドも TS に寄せて言語を一本化する。状態は持たない（BYOK パススルー）ので D1/KV は不要、鍵は Worker Secret で足りる。アーキの抽象（`backend/byok-translator` の四層）はそのまま TS へ写せる。

## Decision

- ランタイムは **Cloudflare Workers**、ルータは **Hono**、検証は **Zod**、テストは **vitest**。
- Python の四層（provider / harness / config / engine）と契約を 1:1 で TS へ移植。ワイヤは Python と同一の snake_case（既存フロント・契約互換）、内部型は camelCase で境界変換。
- 翻訳既定（`defaults.yaml`）は型付き TS モジュール `src/config.ts` へ。Workers はデプロイ時バンドルのため「再ビルド無し編集」の利点は元々無く、型安全を優先。
- UI は Workers Static Assets（`assets` バインディング）で同一オリジン自己ホスト。将来 React の build 出力に差し替え。
- 鍵の出所は `getCredentials` シームに集約（現状ヘッダ BYOK のみ）。サーバ鍵＋Cloudflare Access の二モードは **Worker-Feat-7** に分離。
- Python `backend/` は移植元のプロトタイプ。移植・本番デプロイ完了後、並行実装を抱えないため 2026-06-16 に撤去（後方互換より新仕様の長期性を優先）。Backend の intent/QA は履歴として `_docs/.../Backend/` に残す。

## Alternatives

- **Python Workers（Pyodide）で FastAPI を載せる**: 2026 に公式サポートされ実現可能だが、React と言語を揃える長期メリットと、Pyodide（pydantic-core wasm 等）の不確実性を比べ、移植を採用。
- **Cloudflare Containers で Docker をそのまま**: 無改造で動くが $5/月＋CPU 課金で重く、エッジネイティブでない。保険として記録。
- **ワイヤを camelCase に刷新**: 既存フロントと Python 版の契約を壊すため不採用。snake_case 維持。

## Rationale

要件の重心は「どの端末からも使える」＋「React と一本化」。Workers は状態を持たない小さな API に最適で、抽象を効かせてあるため移植は機械的。snake_case 契約維持で既存フロントがそのまま動く。

## Consequences / Impact

- `wrangler dev` のローカルプロキシは受信 `Authorization` ヘッダ値を削るため（[workers-sdk#3513](https://github.com/cloudflare/workers-sdk/issues/3513) 系の既知差異）、BYOK-via-Authorization の経路はローカル `wrangler dev` では end-to-end 検証できない。本番エッジは影響なく、ユニットテストと node 実 E2E で正しさを担保する。
- Python と TS の二実装が一時併存する（規約により Python 残置）。契約は同一に保つ。
- デプロイは `wrangler deploy`。鍵は持たない既定で、サーバ鍵モードは Worker-Feat-7 の opt-in。

## Quality Implications

- 外部 API を扱うため Risk High。QA test-plan と verification を残す。
- BYOK 鍵はヘッダで受け、保持・ログ出力しない。
- 既定/上書き解決・reasoning・streaming 既定プロファイルを移植し、テストで担保する。

## Intent-derived Invariants

- INV-001: ワイヤ契約（エンドポイント・JSON フィールド）が Python 版と一致する。
- INV-002: LLM 呼び出しは `ChatProvider` 抽象の背後にあり、fake provider でテストできる。
- INV-003: 未指定は既定に解決、明示指定はマッピングより優先（reasoning・profile 含む）。
- INV-004: BYOK 鍵はヘッダで受け、ログ・レスポンスに出力しない。
- INV-005: streaming はプロファイル未指定時に区切りなしプロファイルへ解決する。
