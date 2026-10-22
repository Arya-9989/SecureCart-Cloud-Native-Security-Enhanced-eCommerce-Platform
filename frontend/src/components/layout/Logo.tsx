import { Link } from "react-router";

export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#logo-g)" />
      <path d="M32 12 47 18v12c0 10-6.5 18-15 22-8.5-4-15-12-15-22V18z" fill="#fff" />
      <path
        d="M24.5 31.5 30 37l10-11"
        fill="none"
        stroke="#4338ca"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ to = "/", suffix }: { to?: string; suffix?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 rounded-lg" aria-label="SecureCart home">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight text-fg">
        Secure<span className="text-brand">Cart</span>
      </span>
      {suffix && (
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted">
          {suffix}
        </span>
      )}
    </Link>
  );
}
