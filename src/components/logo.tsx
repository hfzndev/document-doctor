export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2752e6" />
      <path d="M10 7h8l5 5v13a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" fill="#fff" />
      <path d="M18 7v5h5" fill="#dbe6fe" />
      <path d="M15.5 15v7M12 18.5h7" stroke="#2752e6" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
