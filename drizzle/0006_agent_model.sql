-- agents.model: 에이전트별 Claude 모델. NULL 이면 .env 의 ANTHROPIC_MODEL 을 씁니다.
-- drizzle-kit 이 만든 원본 마이그레이션은 색상 기본값 드리프트 때문에 agents/projects/tasks 를
-- 통째로 재생성했습니다. 실제 변경은 컬럼 하나뿐이라 ADD COLUMN 으로 대체했습니다.
ALTER TABLE `agents` ADD `model` text;