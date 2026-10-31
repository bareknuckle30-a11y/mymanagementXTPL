import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const KEY = 'xtpl-theme';

export function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* storage blocked: fall back to the default */ }
  return 'light';
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f2f7ff' : '#101722');
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
}

// Sun/Moon button: switches between the light (white gradient) and dark themes.
export function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || initialTheme());
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <button
      type="button"
      className={`icon-btn theme-toggle ${className}`}
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
      onClick={() => { applyTheme(next); setTheme(next); }}
    >
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}
