import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Lock, RefreshCcw, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useSearchParams } from "react-router";
import { z } from "zod";

import { useAuth } from "@/auth/useAuth";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { ApiError, errorMessage } from "@/lib/api";
import { safeNext } from "@/lib/validation";

// Demo shortcuts for the seeded store. Disable with VITE_DEMO_MODE=false for real deployments.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";
const DEMO_ACCOUNTS = [
  { label: "Customer", email: "maya@example.com", password: "SecureCart!Demo1" },
  { label: "Admin", email: "admin@securecart.dev", password: "SecureCart!Admin1" },
];

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-4 py-8 sm:px-10 lg:px-16">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-3xl font-bold tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-[#1e1b4b] lg:block">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(40rem 30rem at 80% 10%, rgba(129,140,248,.45), transparent 60%), radial-gradient(30rem 24rem at 10% 90%, rgba(45,212,191,.28), transparent 60%)",
          }}
          aria-hidden
        />
        <div className="relative flex h-full flex-col justify-end p-16 text-white">
          <p className="text-sm font-semibold tracking-wider text-indigo-200 uppercase">
            Security by design
          </p>
          <h2 className="mt-3 max-w-md text-3xl leading-tight font-bold">
            Your session is protected at every step.
          </h2>
          <ul className="mt-8 max-w-md space-y-5">
            {[
              {
                icon: KeyRound,
                text: "Passwords hashed with Argon2, never stored or logged in plain text.",
              },
              {
                icon: Lock,
                text: "Short-lived access tokens kept in memory, not in browser storage.",
              },
              {
                icon: RefreshCcw,
                text: "Refresh tokens rotate on every use; a replayed token revokes the session.",
              },
              {
                icon: ShieldCheck,
                text: "Every admin action is permission-checked server-side and audited.",
              },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4.5" aria-hidden />
                </span>
                <span className="pt-1.5 text-sm leading-relaxed text-indigo-100">{text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const loginSchema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { status, user, login } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setValue, formState } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  // Once signed in, this redirect fires; admins without an explicit target land on /admin.
  if (status === "authenticated") {
    return <Navigate to={next === "/" && user?.role === "admin" ? "/admin" : next} replace />;
  }

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await login(email, password);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  return (
    <AuthShell
      title="Welcome back"
      subtitle={
        <>
          New to SecureCart?{" "}
          <Link
            to={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-semibold text-brand hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
          >
            {formError}
          </p>
        )}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={formState.errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          error={formState.errors.password?.message}
          {...register("password")}
        />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      {DEMO_MODE && (
        <div className="mt-8 rounded-2xl border border-dashed border-line-strong p-4">
          <p className="text-xs font-semibold tracking-wider text-subtle uppercase">
            Demo accounts (created by seed_demo)
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="secondary"
                size="sm"
                onClick={() => {
                  setValue("email", account.email, { shouldValidate: true });
                  setValue("password", account.password, { shouldValidate: true });
                }}
              >
                Use {account.label.toLowerCase()}
              </Button>
            ))}
          </div>
        </div>
      )}
    </AuthShell>
  );
}

const registerSchema = z
  .object({
    full_name: z.string().trim().min(2, "Enter your name").max(150),
    email: z.email("Enter a valid email address"),
    password: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });
type RegisterForm = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { status, register: createAccount } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: "", email: "", password: "", confirm: "" },
  });

  if (status === "authenticated") return <Navigate to={next} replace />;

  const onSubmit = handleSubmit(async ({ full_name, email, password }) => {
    setFormError(null);
    try {
      await createAccount({ full_name, email, password });
    } catch (error) {
      if (error instanceof ApiError && error.fields) {
        let mapped = false;
        for (const field of ["full_name", "email", "password"] as const) {
          const message = error.fieldError(field);
          if (message) {
            setError(field, { message });
            mapped = true;
          }
        }
        const general = error.fieldError("non_field_errors");
        if (general ?? !mapped) setFormError(general ?? error.message);
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  return (
    <AuthShell
      title="Create your account"
      subtitle={
        <>
          Already have one?{" "}
          <Link to="/login" className="font-semibold text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger"
          >
            {formError}
          </p>
        )}
        <TextField
          label="Full name"
          autoComplete="name"
          error={formState.errors.full_name?.message}
          {...register("full_name")}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={formState.errors.email?.message}
          {...register("email")}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Common or all-numeric passwords are rejected."
          error={formState.errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirm?.message}
          {...register("confirm")}
        />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
