-- Phase 3.3c: 为 favorites 表添加完整 AI 分析字段
-- 在 Supabase SQL Editor 中执行此脚本

ALTER TABLE favorites
ADD COLUMN IF NOT EXISTS what TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS industry_use TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS capability TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS assessment TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS risk TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS importance INTEGER DEFAULT 3;

COMMENT ON COLUMN favorites.what IS '这是什么？1-2句大白话解释';
COMMENT ON COLUMN favorites.industry_use IS '对行业有什么用？1-2句';
COMMENT ON COLUMN favorites.capability IS '能干什么？解决什么问题';
COMMENT ON COLUMN favorites.assessment IS '评估和判断：成熟度、热度、是否值得关注';
COMMENT ON COLUMN favorites.risk IS '风险是什么？适合应用在哪里';
COMMENT ON COLUMN favorites.importance IS '重要度：1-5分（5=强烈建议关注）';

CREATE INDEX IF NOT EXISTS idx_favorites_importance ON favorites(importance);

-- 回滚脚本（如需删除字段）：
-- ALTER TABLE favorites DROP COLUMN IF EXISTS what;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS industry_use;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS capability;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS assessment;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS risk;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS importance;
