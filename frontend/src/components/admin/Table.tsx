import { clsx } from "clsx";
import { Search } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

export function DataTable({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm" aria-label={label}>
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
        "border-b border-line bg-surface-2/60 px-4 py-3 text-xs font-semibold tracking-wide text-muted uppercase",
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
      <td colSpan={colSpan} className="px-4 py-14 text-center text-sm text-muted">
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
        className="field pl-10"
      />
    </div>
  );
}
