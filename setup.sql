-- ==========================================
-- SyncCamp Supabase 数据库建表脚本
-- 在 Supabase SQL Editor 中粘贴执行
-- ==========================================

-- 1. Events 活动表
CREATE TABLE IF NOT EXISTS events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  creator_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Responses 参与回复表
CREATE TABLE IF NOT EXISTS responses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT REFERENCES events(id) ON DELETE CASCADE,
  user_name TEXT NOT NULL,
  available_start TIME NOT NULL,
  available_end TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Messages 聊天消息表
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 开启 Realtime（聊天实时推送）
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- 5. 开启 RLS（行级安全）
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 6. 公开读写策略（无需登录，所有人可访问）
CREATE POLICY "public_read_events" ON events FOR SELECT USING (true);
CREATE POLICY "public_insert_events" ON events FOR INSERT WITH CHECK (true);

CREATE POLICY "public_read_responses" ON responses FOR SELECT USING (true);
CREATE POLICY "public_insert_responses" ON responses FOR INSERT WITH CHECK (true);

CREATE POLICY "public_read_messages" ON messages FOR SELECT USING (true);
CREATE POLICY "public_insert_messages" ON messages FOR INSERT WITH CHECK (true);

-- 7. 创建文件存储桶
-- 注意：这个需要在 Supabase Dashboard > Storage 中手动创建
-- 桶名称: files
-- 公开访问: 开启
-- 然后在 Storage > Policies 中添加:
--   INSERT 策略: (true)  用于上传
--   SELECT 策略: (true)  用于读取
