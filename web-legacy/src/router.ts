/**
 * Simple client-side router for SPA navigation.
 */

import { homeHTML, initHome } from './pages/home/index';
import { editorHTML, initEditor } from './pages/editor/index';
import { lessonSheetHTML, initLessonSheet, initLessonSheetDemo } from './pages/lesson/index';
import { settingsHTML, initSettings } from './pages/settings';
import { onAuth, getCurrentUser } from './auth';
import { loginHTML, initLogin } from './pages/login';

type RouteHandler = () => void | Promise<void>;

const routes: Map<string, RouteHandler> = new Map();
const publicPaths = new Set(['/login']);
let authReady = false;
let authResolve: (() => void) | null = null;
const authPromise = new Promise<void>((resolve) => {
  authResolve = resolve;
});

function navigate(path: string) {
  history.pushState(null, '', path);
  handleRoute();
}

function matchRoute(path: string): { handler: RouteHandler; params: Record<string, string> } | null {
  // Exact match first
  const exact = routes.get(path);
  if (exact) return { handler: exact, params: {} };

  // Pattern matching for :id params
  for (const [pattern, handler] of routes) {
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) continue;

    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < patternParts.length; i++) {
      const pp = patternParts[i]!;
      const pathPart = pathParts[i]!;
      if (pp.startsWith(':')) {
        params[pp.slice(1)] = pathPart;
      } else if (pp !== pathPart) {
        match = false;
        break;
      }
    }
    if (match) return { handler, params };
  }

  return null;
}

// Store current route params for pages to read
let currentParams: Record<string, string> = {};
export function getRouteParams(): Record<string, string> {
  return currentParams;
}

async function handleRoute() {
  const path = location.pathname;

  // Public paths skip auth entirely
  const isPublic = publicPaths.has(path) || path.startsWith('/s/') || path === '/demo';

  // Wait for auth to initialize (skip for public paths)
  if (!isPublic && !authReady) await authPromise;

  if (!isPublic) {
    if (!getCurrentUser()) {
      history.replaceState(null, '', '/login');
      const app = document.getElementById('app')!;
      app.innerHTML = loginHTML();
      initLogin();
      return;
    }
  }

  // If logged in and visiting /login, redirect to home
  if (path === '/login' && getCurrentUser()) {
    history.replaceState(null, '', '/');
    handleRoute();
    return;
  }

  const matched = matchRoute(path);
  if (matched) {
    currentParams = matched.params;
    matched.handler();
  } else {
    // Fallback to home
    history.replaceState(null, '', '/');
    handleRoute();
  }
}

export function initRouter() {
  routes.set('/', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = homeHTML();
    initHome();
  });

  routes.set('/login', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = loginHTML();
    initLogin();
  });

  routes.set('/new', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = editorHTML();
    initEditor();
  });

  routes.set('/new/:mode', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = editorHTML();
    initEditor();
  });

  routes.set('/post/:id', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = editorHTML();
    initEditor();
  });

  routes.set('/settings', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = settingsHTML();
    initSettings();
  });

  routes.set('/s/:id', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = lessonSheetHTML();
    initLessonSheet();
  });

  routes.set('/demo', () => {
    const app = document.getElementById('app')!;
    app.innerHTML = lessonSheetHTML();
    initLessonSheetDemo();
  });

  // Listen for popstate (back/forward navigation)
  window.addEventListener('popstate', handleRoute);

  // Intercept link clicks for SPA navigation
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && anchor.href && anchor.origin === location.origin) {
      e.preventDefault();
      navigate(anchor.pathname);
    }
  });

  // Wait for auth state, then handle initial route
  onAuth(() => {
    if (!authReady) {
      authReady = true;
      authResolve?.();
    }
    handleRoute();
  });
}

export { navigate };
