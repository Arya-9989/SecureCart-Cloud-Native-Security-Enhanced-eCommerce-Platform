import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { errorMessage } from "@/lib/api";
import { authApi } from "@/lib/endpoints";
import { STORE_RULES } from "@/lib/storeRules";

/**
 * Shown on the bag and at checkout until the shopper confirms their address. Orders need a
 * confirmed inbox (the server refuses checkout with 403 `email_unverified`), so this says
 * so before they fill in the form, and offers a fresh link in place.
 */
export function VerifyEmailNotice({ email }: { email: string }) {
  const resend = useMutation({ mutationFn: authApi.resendVerification });
  return (
    <section
      aria-labelledby="verify-email-heading"
      className="flex gap-4 rounded-[18px] bg-info-soft p-5 sm:p-6"
    >
      <MailCheck className="mt-0.5 size-6 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 id="verify-email-heading" className="text-[17px] font-semibold text-fg">
          Confirm your email to check out.
        </h2>
        <p className="mt-1 text-[15px] leading-snug text-fg/80">
          We sent a link to <span className="font-medium break-all text-fg">{email}</span>. It works
          once and expires in {STORE_RULES.verifyLinkHours} hours.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2" aria-live="polite">
          {resend.isSuccess ? (
            <p className="text-[15px] font-medium text-success">
              A new link is on its way. Earlier links no longer work.
            </p>
          ) : (
            <Button
              variant="outline"
              size="sm"
              loading={resend.isPending}
              onClick={() => {
                resend.mutate();
              }}
            >
              Send a new link
            </Button>
          )}
          {resend.isError && (
            <p role="alert" className="text-[15px] font-medium text-danger">
              {errorMessage(resend.error)}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
