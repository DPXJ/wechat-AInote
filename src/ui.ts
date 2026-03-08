export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>微信归档助手</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f1ea;
        --panel: #fffaf1;
        --ink: #17211a;
        --muted: #59645c;
        --line: #ddd2bd;
        --accent: #14532d;
        --accent-soft: #dff3e6;
        --warning: #8a4b12;
        --warning-soft: #ffedd5;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: var(--ink); background: radial-gradient(circle at top left, #fff7e8 0%, transparent 35%), linear-gradient(180deg, #f4f1ea 0%, #ece7db 100%); }
      .page { max-width: 1160px; margin: 0 auto; padding: 24px; }
      .hero, .panel { background: rgba(255, 250, 241, 0.88); border: 1px solid var(--line); border-radius: 24px; backdrop-filter: blur(10px); box-shadow: 0 18px 50px rgba(52, 46, 34, 0.08); }
      .hero { padding: 28px; display: grid; gap: 20px; }
      .hero h1 { margin: 0; font-size: 36px; line-height: 1.05; }
      .hero p { margin: 0; color: var(--muted); font-size: 16px; }
      .actions, .grid { display: grid; gap: 16px; }
      .actions { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .grid { margin-top: 20px; grid-template-columns: 2fr 1fr; }
      .panel { padding: 20px; }
      button, input { font: inherit; }
      button { border: 0; border-radius: 14px; padding: 12px 16px; cursor: pointer; background: var(--accent); color: white; font-weight: 600; }
      button.secondary { background: #f6efe0; color: var(--ink); border: 1px solid var(--line); }
      .toolbar, .search-box { display: flex; gap: 10px; flex-wrap: wrap; }
      input[type="search"] { width: 100%; padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: white; }
      .list { display: grid; gap: 12px; margin-top: 16px; }
      .card { padding: 16px; border-radius: 18px; background: white; border: 1px solid var(--line); }
      .meta { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .badge { display: inline-flex; padding: 4px 10px; border-radius: 999px; background: #f0eadb; color: var(--muted); font-size: 12px; }
      .warning { background: var(--warning-soft); color: var(--warning); }
      .answer { padding: 14px; border-radius: 16px; background: var(--accent-soft); color: var(--ink); border: 1px solid #b8ddc5; margin-top: 16px; white-space: pre-wrap; }
      .small { color: var(--muted); font-size: 13px; }
      @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } .hero h1 { font-size: 28px; } }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div>
          <div class="small">微信客服归档助手</div>
          <h1>转发即归档，归档后可搜、可追、可改</h1>
        </div>
        <p>一期默认走微信客服消息同步。文本、链接、图片、视频、语音、文件会自动归档；超限内容会在归档结果里提示你走补传入口。</p>
        <div class="actions">
          <div class="panel">
            <div class="small">同步消息</div>
            <div class="toolbar" style="margin-top: 12px">
              <button id="sync-button">立即同步</button>
              <span id="sync-status" class="small">等待操作</span>
            </div>
          </div>
          <div class="panel">
            <div class="small">搜索资料</div>
            <div class="search-box" style="margin-top: 12px">
              <input id="search-input" type="search" placeholder="搜索：公司的宣传手册" />
              <button id="search-button">搜索</button>
            </div>
            <div class="small" style="margin-top: 12px">如果微信提示文件过大，请改走 <a href="/upload">补传入口</a>。</div>
          </div>
        </div>
      </section>
      <section class="grid">
        <div class="panel">
          <div class="small">搜索结果</div>
          <div id="answer-box" class="answer" hidden></div>
          <div id="results" class="list"></div>
        </div>
        <div class="panel">
          <div class="small">待办列表</div>
          <div id="todo-list" class="list"></div>
        </div>
      </section>
    </main>
    <script>
      async function loadRecent() {
        const response = await fetch("/api/archive");
        const payload = await response.json();
        renderResults(payload.items || []);
      }
      async function loadTodos() {
        const response = await fetch("/api/todos");
        const payload = await response.json();
        const root = document.getElementById("todo-list");
        root.innerHTML = "";
        for (const item of payload.items || []) {
          const card = document.createElement("article");
          card.className = "card";
          card.innerHTML = \`<strong>\${item.title}</strong><div class="small">置信度：\${Math.round(item.confidence * 100)}% · \${item.needsReview ? "待复核" : "自动确认"}</div>\${item.evidence ? \`<p>\${item.evidence}</p>\` : ""}<div class="toolbar"><button class="secondary" data-todo-id="\${item.id}" data-status="done">标记完成</button><button class="secondary" data-todo-id="\${item.id}" data-status="dismissed">忽略</button></div>\`;
          root.appendChild(card);
        }
        root.querySelectorAll("button[data-todo-id]").forEach((button) => {
          button.addEventListener("click", async (event) => {
            const target = event.currentTarget;
            await fetch(\`/api/todos/\${target.dataset.todoId}\`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: target.dataset.status }) });
            await loadTodos();
          });
        });
      }
      function renderResults(items) {
        const root = document.getElementById("results");
        root.innerHTML = "";
        for (const item of items) {
          const card = document.createElement("article");
          card.className = "card";
          card.innerHTML = \`<strong>\${item.title}</strong><div class="small">\${new Date(item.createdAt).toLocaleString()} · \${item.sourceType}</div>\${item.summary ? \`<p>\${item.summary}</p>\` : ""}<div class="meta">\${(item.tags || []).map((tag) => \`<span class="badge">#\${tag}</span>\`).join("")}\${item.warningMessage ? \`<span class="badge warning">\${item.warningMessage}</span>\` : ""}</div>\`;
          root.appendChild(card);
        }
      }
      document.getElementById("sync-button").addEventListener("click", async () => {
        const status = document.getElementById("sync-status");
        status.textContent = "同步中...";
        const response = await fetch("/api/sync", { method: "POST" });
        const payload = await response.json();
        status.textContent = payload.error ? payload.error : \`已同步 \${payload.syncedMessages ?? 0} 条消息\`;
        await loadRecent();
        await loadTodos();
      });
      document.getElementById("search-button").addEventListener("click", async () => {
        const input = document.getElementById("search-input");
        if (!input.value.trim()) return;
        const response = await fetch("/api/search?q=" + encodeURIComponent(input.value.trim()));
        const payload = await response.json();
        const answerBox = document.getElementById("answer-box");
        answerBox.hidden = false;
        answerBox.textContent = payload.answer || "没有找到结果";
        renderResults(payload.results || []);
      });
      loadRecent();
      loadTodos();
    </script>
  </body>
</html>`;
}

export function renderUploadHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>补传文件</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f5f1e8; color: #17211a; }
      .page { min-height: 100vh; display: grid; place-items: center; padding: 20px; }
      .card { width: min(560px, 100%); background: #fffaf1; border: 1px solid #ddd2bd; border-radius: 24px; padding: 24px; box-shadow: 0 18px 50px rgba(52, 46, 34, 0.08); }
      h1 { margin: 0 0 8px; font-size: 28px; }
      p { color: #59645c; }
      input, textarea, button { width: 100%; font: inherit; }
      input, textarea { margin-top: 12px; padding: 12px 14px; border: 1px solid #ddd2bd; border-radius: 14px; background: white; }
      textarea { min-height: 100px; resize: vertical; }
      button { margin-top: 12px; border: 0; border-radius: 14px; padding: 12px 16px; cursor: pointer; background: #14532d; color: white; font-weight: 600; }
      #result { margin-top: 16px; white-space: pre-wrap; color: #14532d; }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="card">
        <h1>补传文件</h1>
        <p>当微信客服链路拿不到超大文件时，在这里直接上传，系统会继续完成归档、摘要、标签和待办抽取。</p>
        <form id="upload-form">
          <input type="file" name="file" required />
          <textarea name="note" placeholder="可选备注：这是什么文件，来自哪段聊天，为什么重要"></textarea>
          <button type="submit">上传并归档</button>
        </form>
        <div id="result"></div>
      </section>
    </main>
    <script>
      document.getElementById("upload-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const result = document.getElementById("result");
        result.textContent = "上传中...";
        const body = new FormData(form);
        const response = await fetch("/api/uploads", { method: "POST", body });
        const payload = await response.json();
        result.textContent = payload.error ? payload.error : "已归档，可返回首页搜索查看。";
        if (!payload.error) {
          form.reset();
        }
      });
    </script>
  </body>
</html>`;
}
