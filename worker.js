// SyncCamp Cloudflare Worker
// 使用 D1 数据库 + R2 存储，替代原来的 Supabase
//
// wrangler.toml 需要以下 bindings:
//   - D1 database: name = "DB", database_name = "synccamp-db"
//   - R2 bucket:   name = "FILES", bucket_name = "synccamp-files"

async function initDB(env) {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      event_date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      creator_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      available_start TEXT NOT NULL,
      available_end TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

function html(body) {
  return new Response(body, {
    headers: { ...corsHeaders(), 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ============================================================
// EVENTS
// ============================================================

async function listEvents(env) {
  const rows = await env.DB.prepare(
    'SELECT * FROM events ORDER BY created_at DESC'
  ).all();

  const result = [];
  for (const ev of rows.results) {
    const rsvps = await env.DB.prepare(
      'SELECT * FROM responses WHERE event_id = ? ORDER BY created_at'
    ).bind(ev.id).all();
    result.push({ ...ev, responses: rsvps.results });
  }
  return json(result);
}

async function createEvent(request, env) {
  const body = await request.json();
  const { title, event_date, start_time, end_time, creator_name } = body;

  if (!title || !event_date || !start_time || !end_time) {
    return error('请填写完整信息');
  }
  if (start_time >= end_time) {
    return error('结束时间必须晚于开始时间');
  }

  const result = await env.DB.prepare(
    `INSERT INTO events (title, event_date, start_time, end_time, creator_name)
     VALUES (?, ?, ?, ?, ?) RETURNING *`
  ).bind(title, event_date, start_time, end_time, creator_name || '匿名').first();

  return json({ success: true, event: { ...result, responses: [] } }, 201);
}

async function createResponse(request, env) {
  const body = await request.json();
  const { event_id, user_name, available_start, available_end } = body;

  if (!event_id || !user_name || !available_start || !available_end) {
    return error('请填写完整信息');
  }

  await env.DB.prepare(
    `INSERT INTO responses (event_id, user_name, available_start, available_end)
     VALUES (?, ?, ?, ?)`
  ).bind(event_id, user_name, available_start, available_end).run();

  return json({ success: true }, 201);
}

// ============================================================
// MESSAGES
// ============================================================

async function listMessages(request, env) {
  const url = new URL(request.url);
  const after = url.searchParams.get('after');

  let rows;
  if (after) {
    rows = await env.DB.prepare(
      'SELECT * FROM messages WHERE id > ? ORDER BY created_at ASC LIMIT 100'
    ).bind(parseInt(after)).all();
  } else {
    rows = await env.DB.prepare(
      'SELECT * FROM messages ORDER BY created_at ASC LIMIT 100'
    ).all();
  }
  return json({ messages: rows.results });
}

async function sendMessage(request, env) {
  const body = await request.json();
  const { user_name, content } = body;

  if (!user_name || !content) {
    return error('请填写完整信息');
  }

  const result = await env.DB.prepare(
    `INSERT INTO messages (user_name, content) VALUES (?, ?) RETURNING *`
  ).bind(user_name, content).first();

  return json({ success: true, message: result }, 201);
}

// ============================================================
// FILES
// ============================================================

async function listFiles(env) {
  const objects = await env.FILES.list();
  const files = objects.objects.map(obj => ({
    name: obj.key,
    size: obj.size,
    uploaded: obj.uploaded,
  }));
  files.sort((a, b) => b.name.localeCompare(a.name));
  return json({ files });
}

async function uploadFile(request, env) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file) return error('请选择文件');
  if (file.size > 50 * 1024 * 1024) return error('文件不能超过 50MB');

  const key = `${Date.now()}_${file.name}`;
  await env.FILES.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  return json({ success: true, file: { name: key, size: file.size } }, 201);
}

async function downloadFile(filename, env) {
  const safeName = filename.split('/').pop(); // 防止路径穿越
  const object = await env.FILES.get(safeName);

  if (!object) return error('文件不存在', 404);

  const headers = {
    ...corsHeaders(),
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${safeName.replace(/^\d+_/, '')}"`,
  };

  return new Response(object.body, { headers });
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(request, env, ctx) {
    // 初始化数据库（首次运行时）
    ctx.waitUntil(initDB(env));

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // ---- EVENTS ----
      if (path === '/api/events') {
        if (request.method === 'GET') return await listEvents(env);
        if (request.method === 'POST') return await createEvent(request, env);
      }

      // ---- RESPONSES ----
      if (path === '/api/responses' && request.method === 'POST') {
        return await createResponse(request, env);
      }

      // ---- MESSAGES ----
      if (path === '/api/messages') {
        if (request.method === 'GET') return await listMessages(request, env);
        if (request.method === 'POST') return await sendMessage(request, env);
      }

      // ---- FILES ----
      if (path === '/api/files' && request.method === 'GET') {
        return await listFiles(env);
      }
      if (path === '/api/files/upload' && request.method === 'POST') {
        return await uploadFile(request, env);
      }
      if (path.startsWith('/api/files/')) {
        const filename = path.slice('/api/files/'.length);
        if (request.method === 'GET') return await downloadFile(filename, env);
      }

      // ---- STATIC: serve index.html ----
      if (path === '/' || path === '/index.html') {
        // 从 KV 或环境变量获取 index.html
        // 这里用内联方式，实际部署建议配 Cloudflare Pages
        return html('请使用搭配的 index.html 前端页面');
      }

      return error('Not Found', 404);
    } catch (e) {
      console.error('Worker error:', e);
      return error('服务器内部错误: ' + e.message, 500);
    }
  },
};
