-- Phase 3.3a: 为 favorites 表添加上下文字段
-- 在 Supabase SQL Editor 中执行此脚本

ALTER TABLE favorites
ADD COLUMN IF NOT EXISTS context_tags TEXT DEFAULT '',
ADD COLUMN IF NOT EXISTS context_note TEXT DEFAULT '';

COMMENT ON COLUMN favorites.context_tags IS '场景标签：技术选型/趋势判断/风险评估/预算申请（逗号分隔）';
COMMENT ON COLUMN favorites.context_note IS '收藏备注：自由文本，记录收藏原因/使用场景（仅自己可见）';

CREATE INDEX IF NOT EXISTS idx_favorites_context_tags ON favorites(context_tags);

-- 回滚脚本（如需删除字段）：
-- ALTER TABLE favorites DROP COLUMN IF EXISTS context_tags;
-- ALTER TABLE favorites DROP COLUMN IF EXISTS context_note;
