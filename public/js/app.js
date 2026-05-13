// Chromium Wiki - Client JS
(function() {
  const searchInput = document.getElementById('search-input');
  const searchDropdown = document.getElementById('search-dropdown');
  let debounceTimer;

  // Live search
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      const q = this.value.trim();
      if (q.length < 1) {
        searchDropdown.classList.remove('active');
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch('/api/search?q=' + encodeURIComponent(q));
          const results = await res.json();
          if (results.length === 0) {
            searchDropdown.innerHTML = '<div style="padding:0.75rem;color:var(--text-muted)">无结果</div>';
          } else {
            searchDropdown.innerHTML = results.map(r =>
              `<a href="/wiki/${r.moduleId}/${r.slug}">
                <span class="dd-module">${r.moduleIcon} ${r.moduleName}</span>
                ${r.title}
              </a>`
            ).join('');
          }
          searchDropdown.classList.add('active');
        } catch(e) {}
      }, 200);
    });

    // Enter to search page
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && this.value.trim()) {
        window.location.href = '/search?q=' + encodeURIComponent(this.value.trim());
      }
    });

    // Close dropdown on click outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.search-box')) {
        searchDropdown.classList.remove('active');
      }
    });

    // Keyboard shortcut: / to focus search
    document.addEventListener('keydown', function(e) {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
    });
  }

  // Add copy buttons to code blocks
  document.querySelectorAll('pre code').forEach(block => {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = '复制';
    btn.style.cssText = 'position:absolute;top:0.5rem;right:0.5rem;padding:0.25rem 0.5rem;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:4px;color:var(--text-muted);font-size:0.7rem;cursor:pointer;';
    btn.addEventListener('click', function() {
      navigator.clipboard.writeText(block.textContent);
      btn.textContent = '已复制!';
      setTimeout(() => btn.textContent = '复制', 2000);
    });
    block.parentElement.style.position = 'relative';
    block.parentElement.appendChild(btn);
  });
})();
