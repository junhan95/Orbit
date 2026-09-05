/**
 * 화면 문구 번역.
 *
 * 사전의 키는 "한국어 원문"입니다. 즉 코드에 쓰인 한국어가 그대로 키가 되고,
 * 한국어 모드에서는 사전을 거치지 않고 원문을 그대로 돌려줍니다.
 * 새 문구를 추가할 때는 t('...') 로 감싸기만 하면 한국어는 바로 동작하고,
 * lib/i18n-en.ts 에 영어 번역만 채워 넣으면 됩니다.
 */
import { EN } from './i18n-en';

export const LANGUAGES = ['ko', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<Lang, string> = { ko: '한글', en: 'English' };

export function isLang(value: unknown): value is Lang {
  return value === 'ko' || value === 'en';
}

/**
 * 현재 언어. 서버 렌더와 첫 클라이언트 렌더는 항상 'ko' 로 시작하고,
 * 마운트 후 저장값으로 바꿉니다(hydration 불일치 방지).
 */
let current: Lang = 'ko';

export function getLang(): Lang {
  return current;
}

export function setLang(next: Lang) {
  current = next;
}

/** 화면에 그대로 보여줄 문구 하나를 번역합니다. */
export function t(text: string): string {
  if (current === 'ko') return text;
  return EN[text] ?? text;
}

/**
 * 숫자·이름이 섞인 문장. 자리표시자는 {0}, {1} … 입니다.
 *   tf('{0}건 실행 중', 3) → '3건 실행 중' / '3 running'
 */
export function tf(template: string, ...values: (string | number)[]): string {
  return t(template).replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

/** 날짜·숫자 표기에 쓸 로케일. */
export function locale(): string {
  return current === 'en' ? 'en-US' : 'ko-KR';
}
