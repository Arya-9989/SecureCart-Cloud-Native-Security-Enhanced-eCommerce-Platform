import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { DataTable, SkeletonRows, TableMessage, Td, Th } from "@/components/admin/Table";
import { AdminPageHeader } from "@/components/layout/AdminLayout";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/misc";
import { adminApi } from "@/lib/endpoints";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;
const FILTERS = [
  { value: "", label: "All events" },
  { value: "admin.", label: "Admin actions" },
  { value: "auth.", label: "Authentication" },
  { value: "auth.login_failed", label: "Failed logins" },
];

function toneFor(action: string): Tone {
  if (action.includes("failed") || action.includes("reuse") || action.endsWith("deleted")) {
    return "danger";
  }
  if (action.startsWith("admin.")) return "brand";
  return "neutral";
}

function formatChanges(changes: Record<string, unknown>): string {
  return Object.entries(changes)
    .map(([key, value]) =>
      Array.isArray(value) && value.length === 2
        ? `${key}: ${JSON.stringify(value[0])} → ${JSON.stringify(value[1])}`
        : `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" · ");
}

export function AdminAuditLogPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const query = { action, page, page_size: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "audit", query],
    queryFn: () => adminApi.auditLogs(query),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <AdminPageHeader
        title="Audit log"
        description="Append-only record of administrative and authentication events."
      />
      <div className="mb-4">
        <label htmlFor="audit-filter" className="sr-only">
          Filter events
        </label>
        <select
          id="audit-filter"
          className="field w-full sm:w-56"
          value={action}
          onChange={(e) => {
            setParams(e.target.value ? { action: e.target.value } : {});
          }}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable label="Audit log">
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Event</Th>
                <Th>Target</Th>
                <Th>Changes</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <SkeletonRows cols={6} />
              ) : data?.results.length === 0 ? (
                <TableMessage colSpan={6}>No events recorded yet.</TableMessage>
              ) : (
                data?.results.map((entry) => (
                  <tr key={entry.id} className="align-top">
                    <Td className="whitespace-nowrap text-muted">
                      {formatDateTime(entry.created_at)}
                    </Td>
                    <Td className="text-fg">
                      {entry.actor_email || <span className="text-subtle">anonymous</span>}
                    </Td>
                    <Td>
                      <Badge tone={toneFor(entry.action)} className="font-mono">
                        {entry.action}
                      </Badge>
                    </Td>
                    <Td className="max-w-48 truncate text-fg">
                      {entry.target_repr || <span className="text-subtle">–</span>}
                    </Td>
                    <Td className="max-w-80 font-mono text-xs break-words text-muted">
                      {formatChanges(entry.changes) || "–"}
                    </Td>
                    <Td className="font-mono text-xs text-muted">{entry.ip_address ?? "–"}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              count={data.count}
              onPage={(next) => {
                setParams({ ...(action ? { action } : {}), page: String(next) });
              }}
            />
          )}
        </>
      )}
    </>
  );
}
