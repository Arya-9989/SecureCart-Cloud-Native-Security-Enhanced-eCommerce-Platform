import { clsx } from "clsx";
import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function DataTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-line bg-surface">
      {/* The scroll container is bounded so the sticky header stays put on long tables. */}
      <div
        className="max-h-[min(70vh,760px)] overflow-auto"
        // Scrollable regions must be reachable by keyboard (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={`${label} table`}
      >
        <table className="w-full min-w-[720px] text-left text-[14px]" aria-label={label}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={clsx(
        "sticky top-0 z-[1] border-b border-line bg-surface-2 px-4 py-3 text-[12px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={clsx("px-4 py-3 align-middle", className)}>{children}</td>;
}

export function TableMessage({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center text-[15px] text-muted">
        {children}
      </td>
    </tr>
  );
}

export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-b border-line last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c} className="px-4 py-4">
              <div className="skeleton h-4 w-full max-w-36" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Search input that reports its value after the user pauses typing. */
export function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => {
    if (draft === value) return;
    const handle = window.setTimeout(() => {
      onChange(draft);
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
  }, [draft, value, onChange]);
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle"
        aria-hidden
      />
      <input
        type="search"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="field h-10 rounded-full pl-10 text-[15px]"
      />
    </div>
  );
}
