import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Download, KeyRound, LogOut, MailCheck, Trash2, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { VerifyEmailNotice } from "@/components/store/VerifyEmailNotice";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, apiDownload, errorMessage, saveBlob } from "@/lib/api";
import { authApi } from "@/lib/endpoints";
import { NoIndex } from "@/lib/NoIndex";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { z } from "@/lib/zod";

function Section({
  icon: Icon,
  id,
  title,
  description,
  children,
}: {
  icon: typeof UserRound;
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-6 border-t border-line py-10 first:border-t-0 first:pt-0 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12"
    >
      <div>
        <h2
          id={id}
          className="flex items-center gap-2.5 text-[21px] font-semibold tracking-[-0.02em]"
        >
          <Icon className="size-5 text-muted" strokeWidth={1.75} aria-hidden />
          {title}
        </h2>
        <p className="mt-2 text-[15px] leading-snug text-pretty text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

const profileSchema = z.object({ full_name: z.string().trim().min(2, "Enter your name").max(150) });
type ProfileForm = z.infer<typeof profileSchema>;

function ProfileSection() {
  const { user, reloadUser } = useAuth();
  const toast = useToast();
  const { register, handleSubmit, formState, reset } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: { full_name: user?.full_name ?? "" },
  });
  const save = useMutation({
    mutationFn: ({ full_name }: ProfileForm) => authApi.updateProfile(full_name),
    onSuccess: async (updated) => {
      reset({ full_name: updated.full_name });
      await reloadUser();
      toast.success("Name updated");
    },
    onError: (error) => {
      toast.error("Couldn't update your name", errorMessage(error));
    },
  });
  return (
    <Section
      icon={UserRound}
      id="profile-heading"
      title="Profile"
      description="The name on your orders and invoices."
    >
      <form
        noValidate
        onSubmit={(e) => void handleSubmit((values) => save.mutate(values))(e)}
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
      >
        <TextField
          label="Full name"
          autoComplete="name"
          wrapperClassName="flex-1"
          error={formState.errors.full_name?.message}
          {...register("full_name")}
        />
        <Button type="submit" loading={save.isPending} disabled={!formState.isDirty}>
          Save
        </Button>
      </form>
    </Section>
  );
}

function EmailSection() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Section
      icon={MailCheck}
      id="email-heading"
      title="Email"
      description="Where we send confirmation and password-reset links."
    >
      <p className="flex flex-wrap items-center gap-3 text-[17px]">
        <span className="font-medium break-all">{user.email}</span>
        {user.email_verified ? (
          <Badge tone="success" dot>
            Confirmed
          </Badge>
        ) : (
          <Badge tone="warning" dot>
            Not confirmed
          </Badge>
        )}
      </p>
      {!user.email_verified && (
        <div className="mt-5">
          <VerifyEmailNotice email={user.email} />
        </div>
      )}
    </Section>
  );
}

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(10, "Use at least 10 characters").max(128),
    confirm: z.string(),
  })
  .refine((d) => d.next === d.confirm, { message: "Passwords don't match", path: ["confirm"] });
type PasswordForm = z.infer<typeof passwordSchema>;

function PasswordSection() {
  const { adopt } = useAuth();
  const toast = useToast();
  const { register, handleSubmit, formState, setError, reset } = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });
  const change = useMutation({
    mutationFn: ({ current, next }: PasswordForm) => authApi.changePassword(current, next),
    onSuccess: (session) => {
      adopt(session);
      reset();
      toast.success("Password changed", "Every other device has been signed out.");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fields) {
        const current = error.fieldError("current_password");
        const next = error.fieldError("new_password");
        if (current) setError("current", { message: current });
        if (next) setError("next", { message: next });
        if (current ?? next) return;
      }
      toast.error("Couldn't change your password", errorMessage(error));
    },
  });
  return (
    <Section
      icon={KeyRound}
      id="password-heading"
      title="Password"
      description="Changing it signs you out on every other device straight away."
    >
      <form
        noValidate
        onSubmit={(e) => void handleSubmit((values) => change.mutate(values))(e)}
        className="grid max-w-[480px] gap-4"
      >
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={formState.errors.current?.message}
          {...register("current")}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Common or all-numeric passwords are rejected."
          error={formState.errors.next?.message}
          {...register("next")}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={formState.errors.confirm?.message}
          {...register("confirm")}
        />
        <div>
          <Button type="submit" loading={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const { forget } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const revoke = useMutation({
    mutationFn: authApi.revokeSessions,
    onSuccess: () => {
      forget();
      toast.success("Signed out everywhere", "Sign in again on the devices you use.");
      void navigate("/login", { replace: true });
    },
    onError: (error) => {
      setConfirming(false);
      toast.error("Couldn't sign out everywhere", errorMessage(error));
    },
  });
  return (
    <Section
      icon={LogOut}
      id="sessions-heading"
      title="Devices"
      description="Lost a phone, or signed in somewhere you shouldn't have? End every session at once, this one included."
    >
      <Button
        variant="outline"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Sign out everywhere
      </Button>
      <Dialog
        open={confirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Sign out on every device?"
        description="Every session ends immediately, including this one. Your bag and orders are kept."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep me signed in
            </Button>
            <Button
              loading={revoke.isPending}
              onClick={() => {
                revoke.mutate();
              }}
            >
              Sign out everywhere
            </Button>
          </>
        }
      >
        <p className="text-[15px] text-muted">You can sign straight back in with your password.</p>
      </Dialog>
    </Section>
  );
}

function DataSection() {
  const toast = useToast();
  const download = useMutation({
    mutationFn: () => apiDownload("/auth/me/export/"),
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
    },
    onError: (error) => {
      toast.error("Couldn't prepare your data", errorMessage(error));
    },
  });
  return (
    <Section
      icon={Download}
      id="data-heading"
      title="Your data"
      description="A copy of everything this store holds about you: profile, orders, bag and sign-in activity, as JSON."
    >
      <Button
        variant="outline"
        icon={<Download className="size-4" aria-hidden />}
        loading={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        Download your data
      </Button>
    </Section>
  );
}

const deleteSchema = z.object({ password: z.string().min(1, "Enter your password") });
type DeleteForm = z.infer<typeof deleteSchema>;

function DeleteSection() {
  const { forget } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError, reset } = useForm<DeleteForm>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: "" },
  });
  const remove = useMutation({
    mutationFn: ({ password }: DeleteForm) => authApi.deleteAccount(password),
    onSuccess: () => {
      forget();
      toast.success("Your account was deleted", "Thanks for shopping with us.");
      void navigate("/", { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldError("password")) {
        setError("password", { message: error.fieldError("password") });
      } else {
        setRefusal(errorMessage(error));
      }
    },
  });
  const close = () => {
    setOpen(false);
    setRefusal(null);
    reset();
  };
  return (
    <Section
      icon={Trash2}
      id="delete-heading"
      title="Delete account"
      description="Removes your name, email and password, signs you out everywhere and empties your bag. Past orders are kept, anonymised, because invoices must be retained."
    >
      <Button
        variant="danger"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete account
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title="Delete your account?"
        description="This can't be undone. You'll need a new account to shop here again."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="delete-account-form"
              variant="danger"
              loading={remove.isPending}
            >
              Delete account
            </Button>
          </>
        }
      >
        <form
          id="delete-account-form"
          noValidate
          onSubmit={(e) => {
            setRefusal(null);
            void handleSubmit((values) => remove.mutate(values))(e);
          }}
          className="space-y-4"
        >
          {refusal && (
            <p
              role="alert"
              className="rounded-[14px] bg-danger-soft px-4 py-3 text-[15px] font-medium text-danger"
            >
              {refusal}
            </p>
          )}
          <TextField
            label="Confirm with your password"
            type="password"
            autoComplete="current-password"
            error={formState.errors.password?.message}
            {...register("password")}
          />
        </form>
      </Dialog>
    </Section>
  );
}

export function AccountSettingsPage() {
  const { user } = useAuth();
  useDocumentTitle("Account");
  return (
    <div className="container-text pt-12 pb-24 sm:pt-16">
      <NoIndex />
      <header>
        <h1 className="type-headline">Account.</h1>
        <p className="mt-3 text-[17px] text-muted">
          Signed in as <span className="font-medium text-fg">{user?.email}</span>
        </p>
      </header>
      <div className="mt-12">
        <ProfileSection />
        <EmailSection />
        <PasswordSection />
        <SessionsSection />
        <DataSection />
        <DeleteSection />
      </div>
    </div>
  );
}
