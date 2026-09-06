'use client';

/**
 * 이 기기의 환경 설정(테마·언어·알림 등).
 *
 * localStorage 'orbit-preferences' 한 곳에만 저장하고, 화면 어디서든
 * usePrefs() 로 같은 값을 읽습니다. 테마는 <html> 의 class 로,
 * 언어는 lib/i18n 의 현재 언어로 즉시 반영합니다.
 */
import { useSyncExternalStore } from 'react';
import { type Lang, isLang, setLang } from './i18n';

export const THEME_CHOICES = ['system', 'dark', 'light'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** 세로 메뉴바 상태 — 확장(라벨까지) / 축소(아이콘 위주) */
export const NAV_MODES = ['expanded', 'collapsed'] as const;
export type NavMode = (typeof NAV_MODES)[number];

export type Prefs = {
  notifications: boolean;
  toastNotifications: boolean;
  autoAssign: boolean;
  showTutorial: boolean;
  theme: ThemeChoice;
  lang: Lang;
  nav: NavMode;
};

export const PREFS_KEY = 'orbit-preferences';

export const DEFAULT_PREFS: Prefs = {
  notifications: true,
  toastNotifications: true,
  autoAssign: true,
  showTutorial: true,
  theme: 'dark',
  lang: 'ko',
  nav: 'expanded',
};

let prefs: Prefs = DEFAULT_PREFS;
/** 저장값을 아직 안 읽었으면 true. 읽기 전에 저장하면 기본값으로 덮어써지므로 반드시 먼저 읽습니다. */
let hydrated = false;
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'dark' || value === 'light';
}

function isNav(value: unknown): value is NavMode {
  return value === 'expanded' || value === 'collapsed';
}

/** localStorage 에 저장된 값을 읽어 기본값과 합칩니다. 값이 깨져 있으면 기본값으로 돌아갑니다. */
export function readPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>;
    return {
      notifications: typeof saved.notifications === 'boolean' ? saved.notifications : DEFAULT_PREFS.notifications,
      toastNotifications: typeof saved.toastNotifications === 'boolean' ? saved.toastNotifications : DEFAULT_PREFS.toastNotifications,
      autoAssign: typeof saved.autoAssign === 'boolean' ? saved.autoAssign : DEFAULT_PREFS.autoAssign,
      showTutorial: typeof saved.showTutorial === 'boolean' ? saved.showTutorial : DEFAULT_PREFS.showTutorial,
      theme: isTheme(saved.theme) ? saved.theme : DEFAULT_PREFS.theme,
      lang: isLang(saved.lang) ? saved.lang : DEFAULT_PREFS.lang,
      nav: isNav(saved.nav) ? saved.nav : DEFAULT_PREFS.nav,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** 'system' 이면 OS 설정을 따라 실제 테마를 정합니다. */
export function resolveTheme(choice: ThemeChoice): 'dark' | 'light' {
  if (choice !== 'system') return choice;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** <html> 에 테마·언어를 반영합니다. CSS 는 이 클래스만 봅니다. */
function applyToDocument(next: Prefs) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolveTheme(next.theme) === 'dark');
  root.dataset.theme = next.theme;
  root.lang = next.lang === 'en' ? 'en' : 'ko';
}

function emit() {
  for (const listener of listeners) listener();
}

export function getPrefs(): Prefs {
  return prefs;
}

/** 마운트 후 한 번 호출 — 저장값을 읽어 화면 전체에 반영합니다. */
export function hydratePrefs(): Prefs {
  const next = readPrefs();
  prefs = next;
  hydrated = true;
  setLang(next.lang);
  applyToDocument(next);
  emit();
  return next;
}

/** 설정 저장. 바뀐 항목만 넘기면 됩니다. */
export function updatePrefs(patch: Partial<Prefs>): Prefs {
  // 저장값을 아직 안 읽었다면 지금 읽어서 합칩니다 (마운트 순서와 무관하게 안전하도록).
  const base = hydrated ? prefs : readPrefs();
  const next = { ...base, ...patch };
  prefs = next;
  hydrated = true;
  setLang(next.lang);
  applyToDocument(next);
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch { /* 저장 공간이 막혀 있어도 화면 동작은 막지 않습니다. */ }
  emit();
  return next;
}

/** 테마가 '시스템'일 때 OS 설정 변화를 따라갑니다. 해제 함수를 돌려줍니다. */
export function watchSystemTheme(): () => void {
  if (typeof window === 'undefined') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (prefs.theme === 'system') applyToDocument(prefs); };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, () => DEFAULT_PREFS);
}
