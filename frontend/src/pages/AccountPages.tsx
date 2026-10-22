import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { TextField } from "@/components/ui/Field";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, errorMessage } from "@/lib/api";
import { authApi } from "@/lib/endpoints";
import { NoIndex } from "@/lib/NoIndex";
import { STORE_RULES } from "@/lib/storeRules";
import { z } from "@/lib/zod";

import { AuthShell } from "./AuthPages";

/*
 * Account recovery: forgot password, reset password and email confirmation.
 *
 * Links from emails carry their one-time secret in the URL fragment (#token=...), which the
 * browser never sends to any server. The page reads it once, then removes it from the
 * address bar and history, so it does not linger in screenshots, screen shares or the back
 * button.
 */

function useFragmentToken(): string {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
  useEffect(() => {
    if (location.hash) {
      void navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    }
  }, [location.hash, location.pathname, location.search, navigate]);
  return token;
}

function Outcome({
  tone,
  children,
  actions,
}: {
  tone: "success" | "danger" | "info";
  children: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === "success" ? CircleCheck : tone === "danger" ? CircleAlert : MailCheck;
  const color =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-brand";
  return (
    <div className="rounded-[22px] bg-surface-2 px-6 py-8 text-center">
      <Icon className={`mx-auto size-9 ${color}`} strokeWidth={1.5} aria-hidden />
      <div className="mt-4 text-[17px] leading-relaxed text-pretty text-fg">{children}</div>
      {actions && <div className="mt-6 flex flex-col gap-3">{actions}</div>}
    </div>
  );
}

function FormAlert({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-[14px] bg-danger-soft px-4 py-3 text-[15px] font-medium text-danger"
    >
      {message}
    </p>
  );
}

const signInLink = buttonClasses("primary", "lg", "w-full");

// ---------------------------------------------------------------------------------------

const forgotSchema = z.object({ email: z.email("Enter a valid email address") });
type ForgotForm = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<ForgotForm>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authApi.forgotPassword(email);
      setSentTo(email);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  });

  if (sentTo) {
    return (
      <AuthShell
        title="Check your email."
        subtitle="If that address has an account, a reset link is on its way."
      >
        <Outcome
          tone="info"
          actions={
            <Link to="/login" className={signInLink}>
              Back to sign in
            </Link>
          }
        >
          <p>
            We sent it to <span className="font-medium break-all">{sentTo}</span>. The link works
            once and expires in {STORE_RULES.resetLinkMinutes} minutes.
          </p>
          <p className="mt-3 text-[15px] text-muted">
            Nothing arrived? Check your spam folder, or{" "}
            <button
              type="button"
              className="link inline-flex min-h-11 items-center"
              onClick={() => {
                setSentTo(null);
              }}
            >
              try another address
            </button>
            .
          </p>
        </Outcome>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password." subtitle="We'll email you a link to choose a new one.">
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {formError && <FormAlert message={formError} />}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={formState.errors.email?.message}
          {...register("email")}
        />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Send reset link
        </Button>
        <p className="text-center">
          <Link to="/login" className="link inline-flex min-h-11 items-center text-[15px]">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------------------

const resetSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });
type ResetForm = z.infer<typeof resetSchema>;

function BrokenLink() {
  return (
    <Outcome
      tone="danger"
      actions={
        <Link to="/forgot-password" className={signInLink}>
          Get a new link
        </Link>
      }
    >
      <p>
        Reset links work once and expire after {STORE_RULES.resetLinkMinutes} minutes. Ask for a new
        one and use the most recent email.
      </p>
    </Outcome>
  );
}

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const { status, logout } = useAuth();
  const [state, setState] = useState<"form" | "done" | "invalid">(token ? "form" : "invalid");
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<ResetForm>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await authApi.resetPassword(token, password);
      // Every session on the account just ended on the server; end this tab's too.
      if (status === "authenticated") await logout();
      setState("done");
    } catch (error) {
      if (error instanceof ApiError && error.fieldError("token")) {
        setState("invalid");
      } else if (error instanceof ApiError && error.fieldError("new_password")) {
        setError("password", { message: error.fieldError("new_password") });
      } else {
        setFormError(errorMessage(error));
      }
    }
  });

  if (state === "done") {
    return (
      <AuthShell
        title="Password changed."
        subtitle="Every device that was signed in has been signed out."
      >
        <NoIndex />
        <Outcome
          tone="success"
          actions={
            <Link to="/login" className={signInLink}>
              Sign in
            </Link>
          }
        >
          <p>Sign in with your new password. We've emailed you a note that it changed.</p>
        </Outcome>
      </AuthShell>
    );
  }

  if (state === "invalid") {
    return (
      <AuthShell title="This link has expired." subtitle="Or it was already used.">
        <NoIndex />
        <BrokenLink />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password."
      subtitle="Saving it signs you out on every device, so only you get back in."
    >
      <NoIndex />
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
        {formError && <FormAlert message={formError} />}
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Common or all-numeric passwords are rejected."
          error={formState.errors.password?.message}
          {...register("password")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirm?.message}
          {...register("confirm")}
        />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
          Save new password
        </Button>
      </form>
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------------------

export function VerifyEmailPage() {
  const token = useFragmentToken();
  const { status, reloadUser } = useAuth();
  const started = useRef(false);
  const verify = useMutation({ mutationFn: authApi.verifyEmail });
  const { mutate } = verify;

  useEffect(() => {
    // The secret works once: never send it twice (React's development double effects).
    if (!token || started.current) return;
    started.current = true;
    mutate(token);
  }, [token, mutate]);

  useEffect(() => {
    if (verify.isSuccess && status === "authenticated") void reloadUser();
  }, [verify.isSuccess, status, reloadUser]);

  if (!token || verify.isError) {
    const invalid =
      !token || (verify.error instanceof ApiError && verify.error.fieldError("token"));
    return (
      <AuthShell
        title={invalid ? "This link has expired." : "We couldn't confirm your email."}
        subtitle={invalid ? "Or it was already used." : errorMessage(verify.error)}
      >
        <NoIndex />
        <Outcome
          tone="danger"
          actions={
            status === "authenticated" ? (
              <Link to="/cart" className={signInLink}>
                Go to your bag to get a new link
              </Link>
            ) : (
              <Link to="/login?next=%2Fcart" className={signInLink}>
                Sign in to get a new link
              </Link>
            )
          }
        >
          <p>
            Confirmation links work once and expire after {STORE_RULES.verifyLinkHours} hours. Only
            the most recent email's link works.
          </p>
        </Outcome>
      </AuthShell>
    );
  }

  if (!verify.isSuccess) {
    return (
      <AuthShell title="Confirming your email." subtitle="This takes a moment.">
        <NoIndex />
        <div className="flex justify-center py-8" aria-live="polite">
          <Spinner label="Confirming your email" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Email confirmed." subtitle="You're all set to check out.">
      <NoIndex />
      <Outcome
        tone="success"
        actions={
          status === "authenticated" ? (
            <Link to="/cart" className={signInLink}>
              Go to your bag
            </Link>
          ) : (
            <Link to="/login?next=%2Fcart" className={signInLink}>
              Sign in
            </Link>
          )
        }
      >
        <p>Thanks for confirming your address. You can place orders now.</p>
      </Outcome>
    </AuthShell>
  );
}
