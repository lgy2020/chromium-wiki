const http = require('http');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const PORT = 8080;
const CONTENT_DIR = path.join(__dirname, 'content');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Module registry - add new modules here
const MODULES = [
  {
    id: 'actor',
    name: 'Actor 框架',
    icon: '🤖',
    description: 'Chrome Auto Browse / Gemini Agent 系统',
    color: '#4285f4'
  },
  {
    id: 'extensions',
    name: 'Extensions 扩展系统',
    icon: '🧩',
    description: 'Chrome 扩展架构、Service Worker、消息系统',
    color: '#34a853'
  },
  {
    id: 'architecture',
    name: '浏览器架构',
    icon: '🏗️',
    description: '多进程架构、渲染管线、V8 引擎',
    color: '#fbbc04'
  }
];

function getModuleById(id) {
  return MODULES.find(m => m.id === id);
}

function scanArticles(moduleId) {
  const moduleDir = path.join(CONTENT_DIR, moduleId);
  if (!fs.existsSync(moduleDir)) return [];
  return fs.readdirSync(moduleDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const content = fs.readFileSync(path.join(moduleDir, f), 'utf-8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      const descMatch = content.match(/^>\s+(.+)/m);
      return {
        slug: f.replace('.md', ''),
        title: titleMatch ? titleMatch[1] : f.replace('.md', ''),
        description: descMatch ? descMatch[1] : '',
        modified: fs.statSync(path.join(moduleDir, f)).mtime
      };
    })
    .sort((a, b) => b.modified - a.modified);
}

function renderMarkdown(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return marked(raw, { gfm: true, breaks: true });
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function buildPage(title, content, breadcrumbs = []) {
  let html = loadTemplate('base.html');
  const breadcrumbHtml = breadcrumbs.map((b, i) => {
    if (i < breadcrumbs.length - 1) {
      return `<a href="${b.href}">${b.label}</a><span class="sep">›</span>`;
    }
    return `<span class="current">${b.label}</span>`;
  }).join('');

  html = html.replace('{{title}}', title + ' — Chromium Wiki');
  html = html.replace('{{breadcrumbs}}', breadcrumbHtml);
  html = html.replace('{{content}}', content);
  html = html.replace('{{modules_json}}', JSON.stringify(MODULES));
  return html;
}

function homePage() {
  const moduleCards = MODULES.map(m => {
    const articles = scanArticles(m.id);
    const articleList = articles.map(a =>
      `<a href="/wiki/${m.id}/${a.slug}" class="article-item">
        <span class="article-title">${a.title}</span>
        <span class="article-date">${a.modified.toLocaleDateString('zh-CN')}</span>
      </a>`
    ).join('');

    return `<div class="module-card" style="--accent: ${m.color}">
      <div class="module-header">
        <span class="module-icon">${m.icon}</span>
        <h2><a href="/wiki/${m.id}">${m.name}</a></h2>
        <span class="article-count">${articles.length} 篇</span>
      </div>
      <p class="module-desc">${m.description}</p>
      <div class="article-list">${articleList || '<p class="empty">暂无文章</p>'}</div>
    </div>`;
  }).join('\n');

  const content = `
    <div class="hero">
      <div class="hero-icon">🦀</div>
      <h1>Chromium Wiki</h1>
      <p class="hero-sub">Chromium 内核开发知识库 · 深入理解浏览器架构</p>
      <div class="hero-stats">
        <span>${MODULES.length} 个模块</span>
        <span>${MODULES.reduce((n, m) => n + scanArticles(m.id).length, 0)} 篇文章</span>
      </div>
    </div>
    <div class="modules-grid">${moduleCards}</div>
  `;
  return buildPage('首页', content, [{ label: '🏠 首页', href: '/' }]);
}

function modulePage(moduleId) {
  const mod = getModuleById(moduleId);
  if (!mod) return null;
  const articles = scanArticles(moduleId);

  const articleCards = articles.map(a => `
    <a href="/wiki/${moduleId}/${a.slug}" class="wiki-article-card">
      <div class="wiki-article-title">${a.title}</div>
      <div class="wiki-article-desc">${a.description}</div>
      <div class="wiki-article-meta">最后更新: ${a.modified.toLocaleDateString('zh-CN')}</div>
    </a>
  `).join('');

  const content = `
    <div class="module-hero" style="--accent: ${mod.color}">
      <span class="module-icon-lg">${mod.icon}</span>
      <div>
        <h1>${mod.name}</h1>
        <p>${mod.description}</p>
      </div>
    </div>
    <div class="wiki-articles-grid">${articleCards || '<p class="empty">暂无文章，敬请期待</p>'}</div>
  `;

  return buildPage(mod.name, content, [
    { label: '🏠 首页', href: '/' },
    { label: mod.name, href: `/wiki/${moduleId}` }
  ]);
}

function articlePage(moduleId, slug) {
  const mod = getModuleById(moduleId);
  if (!mod) return null;
  const filePath = path.join(CONTENT_DIR, moduleId, slug + '.md');
  if (!fs.existsSync(filePath)) return null;

  const htmlContent = renderMarkdown(filePath);
  const articles = scanArticles(moduleId);
  const currentIdx = articles.findIndex(a => a.slug === slug);
  const current = articles[currentIdx];
  const prev = currentIdx < articles.length - 1 ? articles[currentIdx + 1] : null;
  const next = currentIdx > 0 ? articles[currentIdx - 1] : null;

  const sidebar = articles.map(a => `
    <a href="/wiki/${moduleId}/${a.slug}" class="sidebar-link ${a.slug === slug ? 'active' : ''}">${a.title}</a>
  `).join('');

  const nav = [];
  if (prev) nav.push(`<a href="/wiki/${moduleId}/${prev.slug}" class="nav-prev">← ${prev.title}</a>`);
  if (next) nav.push(`<a href="/wiki/${moduleId}/${next.slug}" class="nav-next">${next.title} →</a>`);

  const content = `
    <div class="article-layout">
      <aside class="article-sidebar">
        <div class="sidebar-title">${mod.icon} ${mod.name}</div>
        ${sidebar}
      </aside>
      <article class="article-body">
        <div class="article-meta">
          <span>最后更新: ${current.modified.toLocaleDateString('zh-CN')}</span>
        </div>
        <div class="markdown-body">${htmlContent}</div>
        <div class="article-nav">${nav.join('')}</div>
      </article>
    </div>
  `;

  return buildPage(current.title, content, [
    { label: '🏠 首页', href: '/' },
    { label: mod.name, href: `/wiki/${moduleId}` },
    { label: current.title, href: `/wiki/${moduleId}/${slug}` }
  ]);
}

function searchPage(query) {
  const results = [];
  MODULES.forEach(mod => {
    const articles = scanArticles(mod.id);
    articles.forEach(a => {
      const filePath = path.join(CONTENT_DIR, mod.id, a.slug + '.md');
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (a.title.toLowerCase().includes(query.toLowerCase()) ||
          raw.toLowerCase().includes(query.toLowerCase())) {
        results.push({ ...a, module: mod, moduleId: mod.id });
      }
    });
  });

  const resultHtml = results.map(r => `
    <a href="/wiki/${r.moduleId}/${r.slug}" class="search-result">
      <span class="search-module" style="color: ${r.module.color}">${r.module.icon} ${r.module.name}</span>
      <span class="search-title">${r.title}</span>
      <span class="search-desc">${r.description}</span>
    </a>
  `).join('');

  const content = `
    <div class="search-page">
      <h1>搜索: ${query}</h1>
      <p>${results.length} 个结果</p>
      <div class="search-results">${resultHtml || '<p class="empty">未找到相关内容</p>'}</div>
    </div>
  `;

  return buildPage(`搜索: ${query}`, content, [
    { label: '🏠 首页', href: '/' },
    { label: `搜索: ${query}`, href: '#' }
  ]);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Static files
  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes = { '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  // API for live search
  if (pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const results = [];
    MODULES.forEach(mod => {
      scanArticles(mod.id).forEach(a => {
        if (a.title.toLowerCase().includes(q.toLowerCase())) {
          results.push({ title: a.title, slug: a.slug, moduleId: mod.id, moduleName: mod.name, moduleIcon: mod.icon });
        }
      });
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
    return;
  }

  let page = null;

  if (pathname === '/') {
    page = homePage();
  } else if (pathname.match(/^\/wiki\/([^/]+)\/([^/]+)$/)) {
    const [, moduleId, slug] = pathname.match(/^\/wiki\/([^/]+)\/([^/]+)$/);
    page = articlePage(moduleId, slug);
  } else if (pathname.match(/^\/wiki\/([^/]+)$/)) {
    const [, moduleId] = pathname.match(/^\/wiki\/([^/]+)$/);
    page = modulePage(moduleId);
  } else if (pathname === '/search') {
    const q = url.searchParams.get('q') || '';
    page = searchPage(q);
  }

  if (page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(buildPage('404', '<div class="hero"><h1>404</h1><p>页面未找到</p><a href="/">返回首页</a></div>', []));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🦀 Chromium Wiki running at http://localhost:${PORT}`);
});
