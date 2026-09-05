# 연속 eval

AI-Native SDLC 플레이북의 "continuous evals" — 실제 있었던 실행을 케이스로 굳혀 두고, 프롬프트·기억 규칙·스킬·검토 정책·모델이 바뀔 때 돌려 회귀를 잡습니다.

```
npm run dev                 # 다른 터미널에서 dev 서버
npm run evals               # 전부 (약 5~8분, Claude 호출 8~10회)
npm run evals -- --only=03  # 일부
npm run evals -- --judge    # LLM 판정 검사까지 (Haiku)
npm run evals -- --keep     # eval 프로젝트를 남겨 화면에서 확인
```

- 케이스: `cases/*.json` — `why` 에 "언제 무엇이 잘못됐었는지"를 적습니다. 인시던트 하나 = 케이스 하나.
- 결과: `results/<시각>.json` (git 에는 넣지 않습니다). 통과율이 `--threshold`(기본 1.0) 미만이면 종료 코드 1.
- 러너는 `eval <시각>` 프로젝트와 `E-Bolt`/`E-Lint`/`E-Mira` 에이전트를 만들어 쓰고, 끝나면 프로젝트(카드·댓글·기억 포함)를 지웁니다. 에이전트는 남습니다.
- 검사는 결정적(상태·툴 호출·문구·검토 판정·pending 기억 수)이 기본이고, `judge` 는 `--judge` 를 줄 때만 돕니다. `soft: true` 검사는 경고로만 집계합니다.

## 케이스를 추가할 때

1. 프로덕션(또는 검증)에서 잘못된 실행이 나오면 그 카드의 본문·댓글·기대 결과를 그대로 `cases/NN-id.json` 으로 옮깁니다.
2. 검사는 "무엇이 잘못됐는지"를 가장 좁게 잡는 것 하나 + 정상 동작 확인 한두 개.
3. `npm run evals -- --only=NN` 으로 새 케이스만 돌려 통과를 확인한 뒤 커밋.
