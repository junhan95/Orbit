/**
 * Orbit 마크 — 행성 + 기울어진 궤도 + 위성. public/favicon.svg 와 같은 도형입니다.
 * 행성·궤도는 currentColor 라 놓이는 곳의 글자색을 따르고, 위성만 색을 따로 받습니다
 * (노란 배경 위에서는 흰색을 넘겨야 보입니다).
 */
export function OrbitMark({ size = 24, satellite = 'var(--c-brand, #ffd02f)', className }: {
  size?: number; satellite?: string; className?: string;
}) {
  return (
    <svg aria-hidden="true" className={className} fill="none" height={size} viewBox="0 0 64 64" width={size}>
      <g transform="translate(32 32) rotate(-25)">
        <path d="M-27 0A27 11 0 0 1 27 0" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <circle fill="currentColor" r="13" />
        <path d="M27 0A27 11 0 0 1-27 0" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
        <circle cx="23.4" cy="-5.5" fill={satellite} r="6" />
      </g>
    </svg>
  );
}
