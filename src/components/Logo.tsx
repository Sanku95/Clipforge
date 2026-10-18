export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ClipForge">
      <rect width="64" height="64" rx="15" fill="#16161c" />
      <rect x="1" y="1" width="62" height="62" rx="14" fill="none" stroke="#2a2a34" strokeWidth="2" />
      <path d="M24 17 L47 32 L24 47 Z" fill="#ff6a2b" />
      <path d="M14 32 H21" stroke="#ff6a2b" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}
