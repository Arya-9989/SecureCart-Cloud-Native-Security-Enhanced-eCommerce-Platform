import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronDown, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, Navigate, useSearchParams } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { Logo, LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, errorMessage } from "@/lib/api";
import { protection } from "@/lib/protection";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { safeNext } from "@/lib/redirect";
import { z } from "@/lib/zod";

// Demo shortcuts for the seeded store. Disable with VITE_DEMO_MODE=false for real deployments.
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== "false";
const DEMO_ACCOUNTS = [
  { label: "Customer", email: "maya@example.com", password: "SecureCart!Demo1" },
  { label: "Admin", email: "admin@securecart.dev", password: "SecureCart!Admin1" },
];

export function AuthShell({
  title,
  subtitle,
  children,
  after,
}: {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
  after?: ReactNode;
}) {
  useDocumentTitle(title.replace(/\.$/, ""));
  const signIn = protection("sign-in");
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <header className="glass sticky top-0 z-10 border-b border-line/60">
        <div className="mx-auto flex h-12 max-w-[1024px] items-center justify-between px-4">
          <Logo compact />
          <Link
            to="/"
            className="inline-flex h-11 items-center text-[12px] text-fg/80 hover:text-fg"
          >
            Back to the store
          </Link>
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 pt-14 pb-20 sm:pt-20">
        <div className="w-full max-w-[440px]">
          <LogoMark className="mx-auto size-12" />
          <h1 className="mt-6 text-center text-[32px] leading-tight font-semibold tracking-[-0.025em] sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-3 text-center text-[17px] text-muted">{subtitle}</p>
          <div className="mt-10">{children}</div>
          {after}
          <details className="group mt-10 rounded-[18px] bg-surface-2 p-5 open:pb-6">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 text-[15px] font-medium text-fg [&::-webkit-details-marker]:hidden">
              <ShieldCheck className="size-5 text-brand" strokeWidth={1.75} aria-hidden />
              <span className="flex-1">Protected sign-in</span>
              <ChevronDown
                className="size-4 text-muted transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <ul className="mt-4 space-y-2.5">
              {signIn.details.map((detail) => (
                <li key={detail} className="flex gap-2.5 text-[14px] leading-snug text-muted">
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <span>{detail}</span>
                </li>
              ))}
            </ul>
            <Link to="/protection#sign-in" className="link mt-3 inline-block py-1 text-[14px]">
              How your order is protected
            </Link>
          </details>
        </div>
      </main>
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
      title="Sign in to SecureCart."
      subtitle={
        <>
          New to SecureCart?{" "}
          <Link
            to={`/register${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="link inline-block py-0.5"
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
            className="flex items-start gap-2 rounded-[14px] bg-danger-soft px-4 py-3 text-[15px] font-medium text-danger"
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
        <p className="text-center">
          <Link
            to="/forgot-password"
            className="link inline-flex min-h-11 items-center text-[15px]"
          >
            Forgot your password?
          </Link>
        </p>
      </form>
      {DEMO_MODE && (
        <div className="mt-8 rounded-[18px] border border-line p-5">
          <p className="text-[13px] font-medium text-muted">Demo accounts, created by seed_demo</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <Button
                key={account.email}
                variant="outline"
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
  const toast = useToast();
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
      toast.success("Check your inbox.", `We sent a link to ${email} to confirm your address.`);
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
      title="Create your account."
      subtitle={
        <>
          Already have one?{" "}
          <Link
            // Keep where the shopper was heading, as the sign-in page's link to here does.
            to={`/login${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="link inline-block py-0.5"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {formError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[14px] bg-danger-soft px-4 py-3 text-[15px] font-medium text-danger"
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
