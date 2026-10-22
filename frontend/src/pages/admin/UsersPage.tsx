import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router";

import { useAuth } from "@/auth/useAuth";
import {
  DataTable,
  SearchInput,
  SkeletonRows,
  TableMessage,
  Td,
  Th,
} from "@/components/admin/Table";
import { AdminPageHeader } from "@/components/layout/AdminLayout";
import { Badge } from "@/components/ui/Badge";
import { ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/misc";
import { useToast } from "@/components/ui/Toast";
import { errorMessage } from "@/lib/api";
import { adminApi } from "@/lib/endpoints";
import { formatDate, initials } from "@/lib/format";
import type { AdminUser, Role } from "@/lib/types";

const PAGE_SIZE = 12;

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const search = params.get("search") ?? "";
  const role = params.get("role") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const queryClient = useQueryClient();
  const toast = useToast();

  const query = { search, role, page, page_size: PAGE_SIZE };
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "users", query],
    queryFn: () => adminApi.users(query),
    placeholderData: keepPreviousData,
  });

  const update = useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: number;
      changes: Partial<Pick<AdminUser, "role" | "is_active">>;
    }) => adminApi.updateUser(id, changes),
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("User updated", `${user.email}: existing sessions were revoked.`);
    },
    onError: (err) => {
      toast.error("Couldn't update user", errorMessage(err));
    },
  });

  const setParam = useCallback(
    (key: string, value: string) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== "page") next.delete("page");
        return next;
      });
    },
    [setParams],
  );
  const onSearch = useCallback(
    (value: string) => {
      setParam("search", value);
    },
    [setParam],
  );

  return (
    <>
      <AdminPageHeader
        title="Users & roles"
        description="Promote administrators and suspend accounts. Changes revoke the user's sessions."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={onSearch} placeholder="Search name or email" />
        <label htmlFor="role-filter" className="sr-only">
          Filter by role
        </label>
        <select
          id="role-filter"
          className="field w-full sm:w-44"
          value={role}
          onChange={(e) => {
            setParam("role", e.target.value);
          }}
        >
          <option value="">All roles</option>
          <option value="admin">Admins</option>
          <option value="customer">Customers</option>
        </select>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <DataTable label="Users">
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th className="text-right">Orders</Th>
                <Th>Joined</Th>
                <Th>Last login</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {isLoading ? (
                <SkeletonRows cols={6} />
              ) : data?.results.length === 0 ? (
                <TableMessage colSpan={6}>No users found.</TableMessage>
              ) : (
                data?.results.map((user) => {
                  const isMe = user.id === me?.id;
                  return (
                    <tr key={user.id} className="transition hover:bg-surface-2/50">
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">
                            {initials(user.full_name)}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-fg">
                              {user.full_name}{" "}
                              {isMe && <span className="text-xs text-subtle">(you)</span>}
                            </p>
                            <p className="truncate text-xs text-muted">{user.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <label className="sr-only" htmlFor={`role-${user.id}`}>
                          Role for {user.email}
                        </label>
                        <select
                          id={`role-${user.id}`}
                          className="field w-32 py-1.5"
                          value={user.role}
                          disabled={isMe || update.isPending}
                          title={isMe ? "You can't change your own role" : undefined}
                          onChange={(e) => {
                            update.mutate({
                              id: user.id,
                              changes: { role: e.target.value as Role },
                            });
                          }}
                        >
                          <option value="customer">Customer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          disabled={isMe || update.isPending}
                          onClick={() => {
                            update.mutate({ id: user.id, changes: { is_active: !user.is_active } });
                          }}
                          className="rounded-full disabled:cursor-not-allowed"
                          aria-label={`${user.is_active ? "Suspend" : "Reactivate"} ${user.email}`}
                        >
                          {user.is_active ? (
                            <Badge tone="success" dot>
                              Active
                            </Badge>
                          ) : (
                            <Badge tone="danger" dot>
                              Suspended
                            </Badge>
                          )}
                        </button>
                      </Td>
                      <Td className="text-right text-fg tabular-nums">{user.order_count}</Td>
                      <Td className="text-muted">{formatDate(user.date_joined)}</Td>
                      <Td className="text-muted">
                        {user.last_login ? formatDate(user.last_login) : "Never"}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </DataTable>
          {data && (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              count={data.count}
              onPage={(next) => {
                setParam("page", String(next));
              }}
            />
          )}
        </>
      )}
    </>
  );
}
