---
title: Two-mode credentials decision (BYOK + gated server key)
status: active
draft_status: n/a
created_at: 2026-06-15
updated_at: 2026-06-15
references:
  - "_docs/plan/Worker/two-mode-auth/plan.md"
  - "_docs/qa/Worker/two-mode-auth/test-plan.md"
  - "_docs/intent/Worker/ts-migration/decision.md"
related_issues: []
related_prs: []
---

# Two-mode credentials decision (BYOK + gated server key)

## Context

スマホ・出先ラップトップから、鍵を持ち歩かずに使いたい。OSS 公開も前提。よって既定は「鍵を持たない安全側（BYOK）」のまま、個人運用向けに「サーバが鍵を持つように見せる」モードを opt-in で足す。状態は持たないので鍵は Worker Secret で足り、D1/KV 不要。

## Decision

- 鍵解決は `getCredentials(headers, env)` シーム一箇所に集約し、二モードにする。
  1. **BYOK（既定・安全）**: `Authorization: Bearer` / `X-API-Key` が常に優先。空 Bearer は弾いて素通り。
  2. **サーバ鍵（opt-in）**: `env.OPENROUTER_KEY`（Worker Secret）が設定されている場合のみ、鍵なしリクエストがそれを使える。ただし**ゲート通過時に限る**。
- ゲートは「`X-Gate-Token` が `env.GATE_TOKEN` と定数時間一致」または「Cloudflare Access の identity ヘッダ（`Cf-Access-Authenticated-User-Email`）が存在」。
- 鍵はあるがゲート未設定/不一致なら **403**（オープンリレー化を防ぐ）。鍵もゲートも無ければ **401**。
- OSS 既定は `OPENROUTER_KEY` 未設定＝純 BYOK。漏れる鍵が無い。

## Alternatives

- **Cloudflare Access のみ（合言葉なし）**: ブラウザログインで快適だが、Zero Trust 設定が必須でクローン採用者の敷居が上がる。Access は「足せる上位層」として受理しつつ、自己完結する合言葉も用意。
- **サーバ鍵を無条件フォールバック**: ゲート無しだとオープンリレーになり、鍵の支出を他人に使われる。不採用。
- **鍵をクライアント localStorage 同期（PM）**: ビルドゼロだが端末ごとに鍵実体が載る。サーバ鍵＋ゲートの方が「鍵を持ち歩かない」要求に合う。

## Rationale

要求は「どの端末からも、鍵を持ち歩かず、非エンタープライズの安全水準で」。ゲート付きサーバ鍵は、端末が持つのはゲート token（または Access セッション）だけで、OpenRouter 鍵はサーバの暗号化 Secret に留まる。既定を BYOK に保つことで OSS 採用者は安全側で立ち上がる。

## Consequences / Impact

- `OPENROUTER_KEY` を設定するなら、必ず `GATE_TOKEN` か Cloudflare Access を併設する必要がある（さもなくば 403 で使えない＝安全側に倒れる）。
- ゲート token は OpenRouter 鍵より低感度（漏れても支出上限で頭打ち・ローテート容易）だが secret 扱い。
- 公開 URL でも BYOK 経路は他人が自分の鍵で使うだけでコスト無し、サーバ鍵経路はゲートで保護。

## Quality Implications

- 外部認証・secret を扱うため Risk High。QA / verification を残す。
- 鍵・ゲート token はログ・レスポンスに出さない。ゲート比較は定数時間。

## Intent-derived Invariants

- INV-001: `OPENROUTER_KEY` 未設定なら、鍵なしリクエストは 401（純 BYOK、サーバ鍵なし）。
- INV-002: ヘッダ鍵（BYOK）はサーバ鍵より常に優先される。
- INV-003: サーバ鍵は、ゲート（gate token 一致 or Access identity）通過時のみ使われる。
- INV-004: 鍵はあるがゲート不通過なら 403、鍵もゲートも無ければ 401。
- INV-005: 鍵・ゲート token はログ・レスポンスに出力されない。
