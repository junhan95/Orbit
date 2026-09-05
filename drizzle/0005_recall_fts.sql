-- recall_docs 위에 external-content FTS5 인덱스와 동기화 트리거 (Hermes messages_fts 방식)
-- 로컬 D1(workerd)에서 fts5 / external content / 트리거 / bm25 rank 동작 확인 (2026-09-04)
CREATE VIRTUAL TABLE IF NOT EXISTS recall_fts USING fts5(
  content, content_bigram,
  content='recall_docs', content_rowid='id'
);--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recall_docs_ai AFTER INSERT ON recall_docs BEGIN
  INSERT INTO recall_fts(rowid, content, content_bigram) VALUES (new.id, new.content, new.content_bigram);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recall_docs_ad AFTER DELETE ON recall_docs BEGIN
  INSERT INTO recall_fts(recall_fts, rowid, content, content_bigram) VALUES ('delete', old.id, old.content, old.content_bigram);
END;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS recall_docs_au AFTER UPDATE OF content, content_bigram ON recall_docs BEGIN
  INSERT INTO recall_fts(recall_fts, rowid, content, content_bigram) VALUES ('delete', old.id, old.content, old.content_bigram);
  INSERT INTO recall_fts(rowid, content, content_bigram) VALUES (new.id, new.content, new.content_bigram);
END;
