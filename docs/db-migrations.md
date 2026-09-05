# D1 마이그레이션 운영

## 구조

- 스키마 정의: `db/schema.ts` (Drizzle). 런타임은 raw `db.prepare` 만 쓰고, Drizzle 은 스키마 문서와 마이그레이션 생성용입니다.
- 마이그레이션: `drizzle/00NN_이름.sql` + `drizzle/meta/_journal.json`. **저널이 순서와 대상을 정합니다** — 저널에 없는 `.sql` 은 적용되지 않습니다.
- `drizzle-kit generate` 는 기존 테이블을 재생성하려 하므로 0006 이후로는 쓰지 않습니다. 변경분만 손으로 적고 저널에 entry 를 추가합니다.
  - `idx` 는 이전 +1, `when` 은 이전보다 **반드시 큰 값**(밀리초). 러너와 플랫폼 모두 `when` 으로 미적용분을 고릅니다.
  - 문장 사이에는 `--> statement-breakpoint` 를 넣습니다. 트리거의 `BEGIN … END;` 는 한 문장입니다.

## 명령

| 명령 | 하는 일 |
|---|---|
| `npm run db:migrate` | 로컬 D1(`.wrangler/state`)에 미적용분 적용 |
| `npm run db:migrate:check` | **빈 임시 DB 에 0000 부터 전부 적용**해 순서·문법 검증. 배포 전에 반드시 통과시킬 것 |
| `npm run db:migrate:status` | 적용/미적용 목록 |
| `npm run db:migrate:baseline` | 이미 손으로 적용한 DB 에 "전부 적용됨" 기록만 남김 (실행 없음) |
| `npm run db:migrate:remote` | wrangler 로 직접 원격 D1 에 적용 (아래 참고 — 지금 구성에선 쓰지 않음) |

적용 기록은 Drizzle migrator 와 같은 `__drizzle_migrations(hash, created_at)` 테이블에 남습니다.

## 원격(배포) 적용은 어떻게 되나

이 프로젝트는 **OpenAI Sites** 로 호스팅됩니다 (`.openai/hosting.json`, `@openai/sites-vite-plugin`). 원격 D1 은 플랫폼이 관리하고, `dist/server/wrangler.json` 의 `database_id` 는 자리표시자(`00000000-…`)라 `wrangler d1 … --remote` 로 직접 붙을 수 없습니다.

대신 `npm run build` 가 `drizzle/**` 를 `dist/.openai/drizzle/**` 로 복사하고, **배포 시 플랫폼이 같은 저널 순서로 원격 D1 에 적용**합니다. 그래서 배포 전 절차는:

1. `npm run db:migrate:check` — 빈 DB 에 전부 적용되는지 확인 (2026-09-05 기준 0000~0013, 14개 통과)
2. `npm run build` — `dist/.openai/drizzle` 에 14개 SQL + 저널이 들어갔는지 확인
3. Sites 배포 (기존 배포 절차대로)

만약 나중에 Cloudflare 계정의 D1 을 직접 쓰게 되면: `wrangler login` 뒤 `dist/server/wrangler.json` 대신 실제 `database_id` 가 든 설정을 `--config=` 로 넘겨 `db:migrate:remote` 를 쓰면 됩니다.

## 이력 정리 (2026-09-05)

- `0007_project_folders.sql` 은 저널에 없어 배포 시 누락될 상태였음 → `0013_project_folders` 로 편입 (`IF NOT EXISTS` 라 로컬 재적용에도 안전).
- `0011_skills.sql` 은 다른 세션의 `0011_agent_project` 와 번호가 겹쳐 저널에서 빠짐 → `0012_skills` 로 이동.
- 로컬 DB 는 손으로 적용해 둔 상태라 `db:migrate:baseline` 으로 기준선을 기록함.
