---
title: Single-admin login decision
status: active
draft_status: n/a
created_at: 2026-06-16
updated_at: 2026-06-16
references:
  - "_docs/plan/Worker/admin-login/plan.md"
  - "_docs/qa/Worker/admin-login/test-plan.md"
  - "_docs/intent/Worker/two-mode-auth/decision.md"
related_issues: []
related_prs: []
---

# Single-admin login decision

## Context

OpenWebUI 的に「自分用でもログインがある」私的インスタンスにしたい。これはこのアプリに初めて"状態"を持ち込む。ただし範囲は単一 admin で十分（ユーザー判断）。サーバ鍵モードのゲートを、合言葉（gate token）から本物のログインに置き換える。

## Decision

- **単一 admin・DB なし**。資格情報は Worker Secret（`ADMIN_USER` / `ADMIN_PASSWORD_HASH` / `SESSION_SECRET`）。三つ揃った時のみログイン有効、さもなくば純 BYOK。
- パスワードは **PBKDF2（Web Crypto）** でハッシュ。bcrypt/argon2 は Workers ネイティブに無いため。反復回数は **100,000**（Workers の Web Crypto 上限。これを超えるとエッジで throw する実測制約）。
- セッションは **HMAC 署名したステートレス Cookie**（HttpOnly / Secure / SameSite=Lax、TTL 30 日）。ストア不要。
- 鍵解決は `getCredentials` シームを更新：BYOK ヘッダ優先 → 有効セッションなら `OPENROUTER_KEY` → さもなくば 403/401。**ログインが two-mode の gate token を置き換える**（`GATE_TOKEN` は撤去）。
- ロックダウン：`/v1/translate` は「セッション or BYOK ヘッダ」必須。`/healthz`・`/v1/config`・`/auth/me` は公開。UI shell は静的配信し、`/auth/me` で状態を見てログイン画面かアプリを出す。
- **UI からのローテーション**：Worker Secret は実行中に書き換え不可。よって書き換え可能な **KV（`AUTH_KV`）** に現行ハッシュ（と任意のユーザー名）を置き、KV があればそれを、無ければ起動時 Secret をブートストラップとして使う。`POST /auth/change-password` はセッション必須＋現在パスワード再確認の上で新ハッシュを KV に書く。KV 未バインドなら 501。これがこのアプリに足す最小の永続状態。

## Alternatives

- **Cloudflare Access に委譲**: 標準的で UX 良いが Zero Trust 依存で OSS 携行性が下がる。自前ログインは自己完結する代わりに認証の安全責任を負う。ユーザーの非エンタープライズ要求では範囲を絞った自前で妥当と判断。
- **複数ユーザー＋サインアップ（D1）**: マイグレーション・管理が増える。単一 admin で足りるため不採用（将来 D1 で増築可能）。
- **ステートフルセッション（KV）**: 即時失効ができるが state を増やす。短期限＋`SESSION_SECRET` ローテで代替し、KV は不採用。

## Rationale

要求は「私的インスタンス・ログインあり・単一 admin で可」。Secret＋署名 Cookie＋PBKDF2 なら **DB ゼロ**で成立し、Workers に素直。ログインを gate の正体にすることで two-mode の "サーバ鍵を開ける条件" が本物の認証になる。

## Consequences / Impact

- ステートレスセッションは期限前に失効できない。`SESSION_SECRET` ローテで全失効する運用。
- PBKDF2 100k は OWASP 推奨（600k）より低いが Workers 上限。非エンタープライズ水準として受容。
- Cookie は same-origin 前提。Worker が UI を同一オリジン配信するので成立。UI の「Backend URL」クロスオリジン欄は Cookie 認証と両立しない（ホスト運用では実質未使用）。
- two-mode（Worker-Feat-7）の gate token gating は本決定で置換され、`GATE_TOKEN` Secret は撤去済み。
- KV は結果整合のため、ローテーション直後は数秒間、旧パスワードがエッジ間で残り得る。単一 admin の個人運用では許容。
- `ADMIN_PASSWORD_HASH` Secret はブートストラップ（floor）として残す。KV をクリアすれば Secret 値に戻る。

## Quality Implications

- 認証・secret を扱うため Risk High。QA / verification を残す。
- パスワード比較・セッション署名は定数時間。鍵・パスワード・セッションはログに出さない。

## Intent-derived Invariants

- INV-001: ログイン三点 Secret 未設定なら、鍵なしリクエストは 401（純 BYOK、ログイン無効）。
- INV-002: BYOK ヘッダはサーバ鍵（ログイン）より常に優先。
- INV-003: サーバ鍵は有効セッション時のみ使用、無セッションは 403。
- INV-004: 誤資格情報のログインは 401、未設定環境の `/auth/login` は 501。
- INV-005: パスワードハッシュ・セッション・鍵はログ・レスポンスに出力されない。
- INV-006: パスワード変更はセッション＋現在パスワード再確認を要し、KV 未バインドなら 501。新パスワードでログイン可・旧パスワードは不可になる。
