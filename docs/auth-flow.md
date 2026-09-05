# orbitcrew 접속 흐름 — 로그인·세션·Claude 연결

작성일 2026-09-05 · 구현 범위: 로그인·로그아웃 + BYOK 온보딩

---

## 0. 한 장 요약

```
랜딩(/landing) ──CTA──▶ 로그인(/login) ──Google / GitHub──▶ 제공자 인증 ──▶ 콜백
                                                                              │
              ┌───────────────────────────────────────────────────────────────┘
              ▼
   첫 로그인이면 users 행 생성(= 회원가입) + 프로필에 이름·이메일 선입력
              │
              ▼
   세션 발급(쿠키 orbit_session, 30일) ──▶ 앱(/)  ──▶ [다음 단계] Anthropic API 키 온보딩
              │
   로그아웃 ──┴──▶ 세션 삭제 + 쿠키 제거 ──▶ 랜딩(/landing)
```

**"Claude 로 로그인" 은 없습니다.** 아래 §1 이 그 이유이고, Claude 는 로그인 뒤 사용자 본인의
API 키로 연결합니다(§6).

---

## 1. 왜 Claude 계정 로그인이 아닌가 (정책 근거)

Anthropic 공식 문서 [Legal and compliance › Authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance) (2026-09 확인):

> **Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. **Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users.** Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

orbitcrew 는 제3자 앱이므로 세 가지가 모두 막힙니다.

| 하고 싶었던 것 | 가능 여부 | 대신 |
|---|---|---|
| "Claude 로그인" 버튼 | ✗ 금지 | Google / GitHub OAuth 로 신원 확인 |
| 사용자의 Claude 구독으로 에이전트 실행 | ✗ 금지 | 사용자 본인의 **Anthropic API 키**(BYOK) — 비용은 본인 청구 |
| 사용자의 Claude.ai 사용량 읽기 | ✗ API 없음 | 앱이 실측하는 사용자별 토큰·비용 (`usage_events`, `lib/pricing.ts`) |

허용되는 범위는 문서가 명시합니다: 사용자가 자기 API 키를 넣고 그 사용량이 키 주인에게 청구되는 구조.
이것이 §6 의 BYOK 온보딩입니다.

---

## 2. 화면 흐름

| 단계 | 경로 | 누가 | 무엇 |
|---|---|---|---|
| 랜딩 | `/landing` | 공개 | "시작하기 / 앱 열기 / orbitcrew 열기" CTA 3개 → 모두 `/login` |
| 로그인 | `/login` | 공개 | 설정된 제공자 버튼만 표시. 이미 로그인돼 있으면 middleware 가 `/` 로 보냄 |
| 제공자 인증 | Google / GitHub | 외부 | 계정 선택·동의 |
| 콜백 | `/api/auth/callback/{provider}` | 서버 | code→토큰→프로필, 사용자 upsert, 세션 발급, `/` 로 302 |
| 첫 로그인 | `/?welcome=1` | 앱 | Anthropic API 키 연결 모달 (§6) |
| 앱 | `/` | 로그인 필요 | 세션 없으면 `/login?next=…` |
| 로그아웃 | 계정 화면 → `POST /api/auth/logout` | 앱 | 세션 삭제 → `/landing` |

회원가입 화면은 따로 없습니다. OAuth 첫 로그인이 곧 가입이고, 로그인 화면에 그 사실을 적어 둡니다.
가입 직후에는 프로필(`user_profiles`)에 제공자가 준 이름·이메일을 미리 채워 계정 화면이 비어 보이지 않게 합니다.

---

## 3. 두 가지 모드

| `AUTH_MODE` | 동작 | 용도 |
|---|---|---|
| (없음) / `local` | 예전과 동일 — 로그인 없이 `LOCAL_USER_ID` 단일 사용자 | 로컬 개발, 개인 사용 |
| `oauth` | 로그인 필수. middleware 가 모든 앱 경로·API 를 막음 | 배포 |

기존 로컬 데이터(`user_id = local-user`)는 OAuth 사용자와 분리됩니다. 옮기려면
`UPDATE … SET user_id = '<새 id>' WHERE user_id = 'local-user'` 를 전 테이블에 한 번 돌리면 됩니다(스키마 변경 없음).

---

## 4. 서버 구성

```
proxy.ts                      게이트. 세션 검증 → x-orbit-* 헤더로 사용자 전달. 정적 자산은 matcher 로 제외
app/auth.ts       getCurrentUser() 이제 async. 헤더 우선, 없으면 쿠키+DB. 로컬 모드는 예전 그대로
lib/auth.ts                        OAuth(라이브러리 없음)·세션·쿠키·state 서명
app/api/auth/providers             GET  설정된 제공자 + 모드
app/api/auth/login/[provider]      GET  state 생성·서명 → 제공자로 302
app/api/auth/callback/[provider]   GET  state 대조 → 토큰 교환 → 프로필 → upsert → 세션 → /
app/api/auth/logout                POST 세션 삭제 → /landing (303)
app/login                          로그인 화면
```

### 세션
- 쿠키 `orbit_session`: 256비트 난수, `HttpOnly; SameSite=Lax; Path=/`, https 면 `Secure`, 30일.
- DB `sessions.id` 에는 토큰의 SHA-256 만 저장 — DB 가 새어도 쿠키를 만들 수 없음.
- 로그아웃 = 행 삭제. 즉시 무효.
- 만료 연장은 하지 않음(30일 뒤 다시 로그인). 필요하면 `findSessionUser` 에서 갱신하면 됨.

### CSRF (OAuth state)
- `state = provider.nonce.HMAC(AUTH_SECRET, provider.nonce)` — 쿠키(10분)와 콜백 쿼리 양쪽에 있어야 하고 서명이 맞아야 함.
- 로그아웃은 `SameSite=Lax` 쿠키 + POST 라 외부 사이트에서 트리거 불가.

### `getCurrentUser()` 가 async 가 된 이유
`next/headers` 의 `cookies()`/`headers()` 가 async 라서. 호출부 50곳을 `await getCurrentUser()` 로 바꿨고
(`app/api/**/route.ts` — 전부 async 핸들러), tsc 로 빠진 곳이 없음을 확인했습니다.

---

## 5. 스키마 (마이그레이션 `0019_auth`)

```sql
users    (id PK, provider, provider_id, email, name, avatar_url, created_at, last_login_at)
         UNIQUE (provider, provider_id)
sessions (id PK = sha256(token), user_id → users ON DELETE CASCADE, created_at, expires_at, user_agent)
```

`users.id` 가 곧 모든 테이블의 `user_id` 입니다. `u_<12바이트 난수>` 형식이고 발급 후 바뀌지 않습니다.

---

## 6. Anthropic API 키 온보딩 (BYOK) — 구현됨

정책이 허용하는 유일한 방식이자, 이 앱의 "Claude 연동" 입니다.

| 조각 | 구현 |
|---|---|
| 저장 | `user_keys(user_id PK, ciphertext, iv, key_hint, created_at, updated_at)` (0020). AES-GCM 256, 마스터 키 = SHA-256(`KEY_ENCRYPTION_SECRET`). 순수 함수는 `lib/user-keys-crypto.ts`(단위 테스트 5개), env·DB 를 아는 쪽은 `lib/user-keys.ts` |
| API | `GET/PUT/DELETE /api/keys`. PUT 은 `sk-ant-` 형식 확인 → Anthropic `GET /v1/models` 로 실검증 → 저장. 키 자체는 어떤 응답에도 담기지 않고 `hint`(`sk-ant-…xxxx`)만 |
| 사용 | 실행·대화(일반/스트림)·계획·검토 다섯 입구가 `resolveApiKey(db, userId)` 로 키를 고릅니다. **OAuth 모드 = 사용자 키만**(운영자 키로 대신 보내지 않음), 로컬 모드 = `.env` 키 → 저장된 키 순 |
| 키 없음 | `409 { code: 'no_api_key' }`. 앱 셸이 `window.fetch` 를 한 겹 감싸 이 코드를 보면 연결 모달을 띄웁니다 (`components/api-key-dialog.tsx`) |
| 온보딩 | 첫 로그인(`?welcome=1`)과 OAuth 모드에서 키가 없을 때 자동으로 모달. 계정 화면의 "Claude API 키" 카드와 사용자 메뉴에서 연결·바꾸기·삭제 |
| 사용량 | 이미 있는 `usage_events` 가 `user_id` 로 나뉘어 있으므로 사용량 화면이 그대로 "내 Claude 사용량". 청구는 본인 Console |

운영자 키(`ANTHROPIC_API_KEY`)를 공용으로 두는 옵션은 채택하지 않았습니다(사용자별 BYOK 결정).
개발 중 로컬 모드에서는 기존처럼 `.env` 의 키를 씁니다.

## 7. 환경변수

```
AUTH_MODE=oauth                 # 없으면 local
AUTH_SECRET=<32자 이상 난수>     # openssl rand -base64 32
APP_URL=https://orbit.example   # 없으면 요청 origin (dev: http://localhost:3000)
GOOGLE_CLIENT_ID=…  GOOGLE_CLIENT_SECRET=…
GITHUB_CLIENT_ID=…  GITHUB_CLIENT_SECRET=…
KEY_ENCRYPTION_SECRET=<32자 이상 난수>   # 사용자 API 키 암호화 (OAuth 모드 필수)
```

제공자 콘솔의 리디렉션 URI:
- Google: `{APP_URL}/api/auth/callback/google`
- GitHub: `{APP_URL}/api/auth/callback/github`

둘 중 하나만 설정해도 됩니다 — 설정된 것만 버튼으로 나옵니다.

---

## 8. 확인 목록

- [x] `npm run db:migrate:check` — 0019 포함 빈 DB 전체 적용
- [x] `tsc --noEmit` — async 전환 후 타입 오류 없음
- [x] 로컬 모드 회귀 — `AUTH_MODE` 없이 예전과 동일하게 동작
- [x] OAuth 모드 실검증 — Google 클라이언트(테스트 상태) 발급, GitHub Pages 랜딩 → localhost 로그인 → 앱 → 로그아웃 한 바퀴 (2026-09-05). users/sessions/user_profiles 행 생성 확인
- [ ] GitHub 제공자 실검증
- [ ] 구글 앱 게시(프로덕션) — 테스트 상태에서는 등록한 테스트 사용자만 로그인 가능
- [ ] 앱 배포(Cloudflare Workers) 후 리디렉션 URI·LANDING_APP_URL 을 실제 주소로
- [x] BYOK 온보딩 (§6) — 키 연결 모달·계정 카드·409 게이트·암호화 저장
