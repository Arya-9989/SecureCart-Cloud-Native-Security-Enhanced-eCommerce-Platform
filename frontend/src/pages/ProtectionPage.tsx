import { clsx } from "clsx";
import { ArrowDown, Check, CircleSlash, Code2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { buttonClasses } from "@/components/ui/buttonClasses";
import { Reveal } from "@/components/ui/Reveal";
import { PROTECTIONS, protection, type Protection } from "@/lib/protection";
import { STORE_RULES } from "@/lib/storeRules";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

const REPO =
  "https://github.com/Arya-9989/SecureCart-Cloud-Native-Security-Enhanced-eCommerce-Platform";

/** GitHub URL for a source path: files open as blobs, folders as trees. */
const sourceUrl = (path: string) => `${REPO}/${/\.\w+$/.test(path) ? "blob" : "tree"}/main/${path}`;

/** Sticky local nav (Apple product-page pattern) with the active section underlined. */
function LocalNav() {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const p of PROTECTIONS) {
      const el = document.getElementById(p.id);
      if (el) observer.observe(el);
    }
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <nav
      aria-label="Protection sections"
      className="glass sticky top-12 z-30 border-b border-line/60"
    >
      <div className="container-page flex h-[52px] items-center gap-6">
        <a href="#top" className="shrink-0 text-[19px] font-semibold tracking-[-0.02em] text-fg">
          Protection
        </a>
        <ul className="no-scrollbar ml-auto hidden items-center gap-6 overflow-x-auto md:flex">
          {PROTECTIONS.map((p) => (
            <li key={p.id}>
              <a
                href={`#${p.id}`}
                aria-current={active === p.id ? "location" : undefined}
                className={clsx(
                  "hit relative inline-block py-1 text-[12px] whitespace-nowrap transition-colors",
                  active === p.id
                    ? "text-fg after:absolute after:inset-x-0 after:-bottom-[15px] after:h-px after:bg-fg"
                    : "text-fg/80 hover:text-fg",
                )}
              >
                {p.stage}
              </a>
            </li>
          ))}
        </ul>
        <Link to="/shop" className={buttonClasses("primary", "sm", "ml-auto md:ml-0")}>
          Shop
        </Link>
      </div>
    </nav>
  );
}

function Evidence({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <figure
      className={clsx(
        "rounded-[28px] p-6 sm:p-8",
        dark ? "bg-[#1d1d1f] text-[#f5f5f7]" : "bg-surface text-fg shadow-card",
      )}
    >
      {children}
    </figure>
  );
}

function Chip({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[13px]",
        dark ? "bg-[#2c2c2e] text-[#f5f5f7]" : "bg-surface-2 text-fg",
      )}
    >
      <Check className={clsx("size-3.5", dark ? "text-[#4c9bff]" : "text-brand")} aria-hidden />
      {children}
    </span>
  );
}

function SessionEvidence() {
  return (
    <Evidence>
      <figcaption className="text-[13px] font-medium text-muted">
        What the browser holds after you sign in
      </figcaption>
      <p className="mt-5 text-[15px] font-semibold">Refresh token: a cookie</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>HttpOnly</Chip>
        <Chip>Secure</Chip>
        <Chip>SameSite=Strict</Chip>
        <Chip>Path=/api/auth/</Chip>
        <Chip>{STORE_RULES.refreshTokenDays} days, rotated on use</Chip>
      </div>
      <p className="mt-6 text-[15px] font-semibold">Access token: memory only</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip>{STORE_RULES.accessTokenMinutes} minutes</Chip>
        <Chip>never in localStorage</Chip>
      </div>
      <p className="mt-6 border-t border-line pt-4 text-[13px] text-muted">
        The cookie-only endpoints (refresh and sign-out) also require an{" "}
        <code className="font-mono">X-CSRF-Protection</code> header that cross-site forms can't
        send.
      </p>
    </Evidence>
  );
}

function BagEvidence() {
  return (
    <Evidence>
      <figcaption className="text-[13px] font-medium text-muted">
        The most you can add to one line
      </figcaption>
      <p className="mt-5 font-mono text-[clamp(1.25rem,1rem+1.2vw,1.75rem)] font-medium tracking-tight">
        min(stock on hand, {STORE_RULES.maxPerLine})
      </p>
      <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
        {[
          ["24 in stock", `up to ${STORE_RULES.maxPerLine}`],
          ["3 in stock", "up to 3"],
          ["0 in stock", "sold out"],
        ].map(([stock, limit]) => (
          <div key={stock} className="rounded-2xl bg-surface-2 px-2 py-4">
            <dt className="text-[13px] text-muted">{stock}</dt>
            <dd className="mt-1 text-[17px] font-semibold">{limit}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 border-t border-line pt-4 text-[13px] text-muted">
        If stock drops after you add something, the bag flags the line and checkout waits until you
        adjust it.
      </p>
    </Evidence>
  );
}

const CHECKOUT_STEPS: { title: string; text: string; branch?: string }[] = [
  {
    title: "Lock",
    text: "The products in your bag are locked in the database, always in the same order, so concurrent checkouts queue instead of colliding.",
  },
  {
    title: "Verify and reserve",
    text: "Every line is checked against the locked stock and reserved in one transaction. If any line is short, nothing is reserved and you see which item.",
  },
  {
    title: "Charge once",
    text: "Only after the reservation commits is the payment token charged, with an idempotency key, so a retried request returns the same order.",
  },
  {
    title: "Confirm or release",
    text: "An approved payment marks the order paid and clears those lines from your bag.",
    branch: "A declined payment marks it failed and puts the stock straight back.",
  },
];

function CheckoutEvidence() {
  return (
    <Evidence dark>
      <figcaption className="text-[13px] font-medium text-[#a1a1a6]">
        What happens when you press Place order
      </figcaption>
      <ol className="mt-6 space-y-0">
        {CHECKOUT_STEPS.map((step, index) => (
          <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
            {index < CHECKOUT_STEPS.length - 1 && (
              <span className="absolute top-8 bottom-0 left-[15px] w-px bg-[#424245]" aria-hidden />
            )}
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#2c2c2e] text-[13px] font-semibold tabular-nums">
              {index + 1}
            </span>
            <div className="pt-1">
              <p className="text-[17px] font-semibold">{step.title}</p>
              <p className="mt-1 text-[15px] leading-relaxed text-[#a1a1a6]">{step.text}</p>
              {step.branch && (
                <p className="mt-2 flex gap-2 text-[15px] leading-relaxed text-[#a1a1a6]">
                  <CircleSlash className="mt-1 size-3.5 shrink-0 text-[#ff6961]" aria-hidden />
                  {step.branch}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Evidence>
  );
}

function StateMachineEvidence() {
  const node = "rounded-full bg-surface-2 px-3.5 py-2 text-[14px] font-medium whitespace-nowrap";
  const arrow = <ArrowDown className="mx-auto size-4 text-muted" aria-hidden />;
  return (
    <Evidence>
      <figcaption className="text-[13px] font-medium text-muted">
        The only moves an order can make
      </figcaption>
      <div className="mt-6 grid grid-cols-[1fr_auto] items-start gap-x-6 gap-y-2 text-center">
        <div className="space-y-2">
          <p className={node}>Pending payment</p>
          {arrow}
          <p className={node}>Paid</p>
          {arrow}
          <p className={node}>Shipped</p>
          {arrow}
          <p className={node}>Delivered</p>
        </div>
        <div className="space-y-3 pt-0.5 text-left">
          <p className="text-[13px] text-muted">From pending payment</p>
          <p className={clsx(node, "inline-block")}>Payment failed</p>
          <p className="pt-2 text-[13px] text-muted">From pending or paid</p>
          <p className={clsx(node, "inline-block")}>Cancelled</p>
          <p className="text-[13px] text-muted">restock, and refund if paid</p>
        </div>
      </div>
      <p className="mt-6 border-t border-line pt-4 text-[13px] text-muted">
        Customers can only cancel. Staff can ship, deliver or cancel. Only checkout itself can mark
        an order paid or failed.
      </p>
    </Evidence>
  );
}

function Chapter({
  item,
  children,
  tone,
}: {
  item: Protection;
  children: ReactNode;
  tone: "white" | "gray" | "black";
}) {
  const dark = tone === "black";
  const Icon = item.icon;
  return (
    <section
      id={item.id}
      aria-labelledby={`${item.id}-heading`}
      className={clsx(
        "scroll-mt-[100px] py-20 sm:py-28",
        tone === "gray" && "bg-surface-2",
        dark && "bg-black text-[#f5f5f7] dark:bg-[#0b0b0c]",
      )}
    >
      <div className="container-page grid items-start gap-10 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
        <Reveal>
          <p
            className={clsx(
              "type-eyebrow flex items-center gap-2",
              dark ? "text-[#a1a1a6]" : "text-muted",
            )}
          >
            <Icon
              className={clsx("size-5", dark ? "text-[#4c9bff]" : "text-brand")}
              strokeWidth={1.75}
              aria-hidden
            />
            {item.stage}
          </p>
          <h2 id={`${item.id}-heading`} className="type-section mt-3">
            {item.title}
          </h2>
          <p className={clsx("type-body-lg mt-4", dark ? "text-[#a1a1a6]" : "text-muted")}>
            {item.summary}
          </p>
          <ul className="mt-8 space-y-3">
            {item.details.map((detail) => (
              <li key={detail} className="flex gap-3 text-[17px] leading-snug">
                <Check
                  className={clsx("mt-1 size-4 shrink-0", dark ? "text-[#4c9bff]" : "text-brand")}
                  strokeWidth={2.25}
                  aria-hidden
                />
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          <a
            href={sourceUrl(item.source)}
            rel="noreferrer"
            className={clsx(
              "mt-6 inline-flex min-h-11 items-center gap-2 rounded-sm font-mono text-[13px] hover:underline",
              dark ? "text-[#4c9bff]" : "text-brand",
            )}
          >
            <Code2 className="size-4" aria-hidden />
            {item.source}
          </a>
        </Reveal>
        <Reveal delay={0.08} className="lg:sticky lg:top-[124px]">
          {children}
        </Reveal>
      </div>
    </section>
  );
}

export function ProtectionPage() {
  useDocumentTitle("How your order is protected");
  return (
    <div id="top">
      <LocalNav />
      <header className="container-text pt-16 pb-20 text-center sm:pt-24 sm:pb-28">
        <p className="type-eyebrow text-muted">How your order is protected</p>
        <h1 className="type-hero mt-3">
          Trust you can
          <br />
          read in the code.
        </h1>
        <p className="type-lead mx-auto mt-5 max-w-[680px] text-muted">
          Four moments matter when you shop: signing in, filling your bag, paying, and everything
          after. Here is exactly what protects each one, and where it lives.
        </p>
        <p className="mx-auto mt-6 max-w-[560px] text-[14px] text-muted">
          This is a demonstration store: payments go to a mock provider, so no real card is ever
          charged.
        </p>
      </header>
      <Chapter item={protection("sign-in")} tone="gray">
        <SessionEvidence />
      </Chapter>
      <Chapter item={protection("bag")} tone="white">
        <BagEvidence />
      </Chapter>
      <Chapter item={protection("checkout")} tone="black">
        <CheckoutEvidence />
      </Chapter>
      <Chapter item={protection("after")} tone="gray">
        <StateMachineEvidence />
      </Chapter>
      <section className="container-text py-20 text-center sm:py-28" aria-labelledby="cta-heading">
        <h2 id="cta-heading" className="type-section">
          Ready when you are.
        </h2>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link to="/shop" className={buttonClasses("primary", "md")}>
            Shop now
          </Link>
          <a href="/api/docs/" className={buttonClasses("secondary", "md")}>
            Read the API docs
          </a>
        </div>
      </section>
    </div>
  );
}
