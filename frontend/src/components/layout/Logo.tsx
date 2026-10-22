import { clsx } from "clsx";
import { Link } from "react-router";

/** A shield carrying a shopping bag: protection around the purchase. Flat, one colour. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={clsx("text-brand", className)} aria-hidden>
      <path
        d="M12 1.75 20 4.9v6.1c0 5.2-3.35 9.3-8 11.25C7.35 20.3 4 16.2 4 11V4.9z"
        fill="currentColor"
      />
      <path
        d="M9.6 10.4V9.3a2.4 2.4 0 0 1 4.8 0v1.1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect x="8.1" y="10.2" width="7.8" height="6.4" rx="1.4" fill="#fff" />
    </svg>
  );
}

export function Logo({
  to = "/",
  suffix,
  compact = false,
}: {
  to?: string;
  suffix?: string;
  compact?: boolean;
}) {
  return (
    <Link to={to} className="hit flex shrink-0 items-center gap-2 rounded-md">
      <LogoMark className={compact ? "size-5.5" : "size-6"} />
      <span
        className={clsx(
          "font-semibold tracking-[-0.02em] text-fg",
          compact ? "text-[15px]" : "text-[17px]",
        )}
      >
        SecureCart
      </span>
      {suffix && (
        <>
          {" "}
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">
            {suffix}
          </span>
        </>
      )}
    </Link>
  );
}
