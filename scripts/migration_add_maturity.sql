-- Phase 3.1: 添加成熟度字段到 favorites 表
-- 在 Supabase SQL Editor 中执行此脚本

ALTER TABLE favorites
ADD COLUMN IF NOT EXISTS maturity TEXT DEFAULT 'B';

-- 添加注释
COMMENT ON COLUMN favorites.maturity IS '成熟度：S=已规模化应用, A=有POC/试点, B=有demo/开源可用';

-- 创建索引（可选，用于按成熟度筛选）
CREATE INDEX IF NOT EXISTS idx_favorites_maturity ON favorites(maturity);
