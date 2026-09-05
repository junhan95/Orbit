/**
 * Orbit 마크 — 행성 하나와 궤도 세 개, 각 궤도 끝의 위성. public/favicon.svg 와 같은 도형입니다.
 * 전부 currentColor 라 놓이는 곳의 글자색을 따릅니다.
 */
export function OrbitMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 64 64" width={size}>
      <circle cx="32" cy="32" fill="currentColor" r="8.5" />
      <path d="M30.54 45.92A14 14 0 1 1 41.37 42.4" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      <path d="M26.49 51.23A20 20 0 1 1 51.41 36.84" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      <path d="M18.5 55.38A27 27 0 0 1 42.98 7.33" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
      <circle cx="41.37" cy="42.4" fill="currentColor" r="3.1" />
      <circle cx="51.41" cy="36.84" fill="currentColor" r="3.1" />
      <circle cx="42.98" cy="7.33" fill="currentColor" r="3.1" />
    </svg>
  );
}
