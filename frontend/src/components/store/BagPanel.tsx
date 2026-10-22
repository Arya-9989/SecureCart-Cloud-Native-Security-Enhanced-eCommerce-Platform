import { Lock, Package, ShoppingBag, UserRound } from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "@/auth/useAuth";
import { buttonClasses } from "@/components/ui/buttonClasses";
import { ProductImage, Skeleton } from "@/components/ui/misc";
import { useCart } from "@/hooks/queries";
import { formatMoney } from "@/lib/format";

const PREVIEW_LINES = 3;

/**
 * Bag preview shown from the global nav: a popover on desktop, a drawer on mobile.
 * `onNavigate` lets the container close itself when the shopper follows a link.
 */
export function BagPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { status } = useAuth();
  const { data: cart, isLoading } = useCart();

  if (status !== "authenticated") {
    return (
      <div>
        <p className="type-tile text-[28px]">Your bag is empty.</p>
        <p className="mt-2 text-[15px] text-muted">
          <Link to="/login?next=%2Fcart" className="link" onClick={onNavigate}>
            Sign in
          </Link>{" "}
          to see what you saved. Your bag lives on your account, not in this browser.
        </p>
        <ProfileLinks onNavigate={onNavigate} signedIn={false} />
      </div>
    );
  }

  if (isLoading || !cart) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-16 rounded-xl" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div>
        <p className="type-tile text-[28px]">Your bag is empty.</p>
        <p className="mt-2 text-[15px] text-muted">
          <Link to="/shop" className="link" onClick={onNavigate}>
            Browse the store
          </Link>{" "}
          to find something you love.
        </p>
        <ProfileLinks onNavigate={onNavigate} signedIn />
      </div>
    );
  }

  const shown = cart.items.slice(0, PREVIEW_LINES);
  const more = cart.items.length - shown.length;
  return (
    <div>
      <p className="text-[24px] font-semibold tracking-[-0.02em]">Bag</p>
      <ul className="mt-3 divide-y divide-line" aria-label="Bag items">
        {shown.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-3">
            <div className="studio size-16 shrink-0 overflow-hidden rounded-xl">
              <ProductImage src={item.product.image_url} alt="" className="size-full" sizes="sm" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{item.product.name}</p>
              <p className="text-[13px] text-muted">Qty {item.quantity}</p>
            </div>
            <p className="text-[15px] font-medium tabular-nums">
              {formatMoney(item.line_total, cart.currency)}
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="pt-1 text-[13px] text-muted">
          {more} more item{more === 1 ? "" : "s"} in your bag
        </p>
      )}
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-[15px] text-muted">Subtotal</span>
        <span className="text-[17px] font-semibold tabular-nums">
          {formatMoney(cart.subtotal, cart.currency)}
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        <Link
          to="/checkout"
          className={buttonClasses("primary", "md", "w-full")}
          onClick={onNavigate}
        >
          Check out
        </Link>
        <Link to="/cart" className={buttonClasses("outline", "md", "w-full")} onClick={onNavigate}>
          Review bag
        </Link>
      </div>
      <p className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-muted">
        <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Stock is checked live and reserved only when you place the order.
      </p>
      <ProfileLinks onNavigate={onNavigate} signedIn />
    </div>
  );
}

function ProfileLinks({ onNavigate, signedIn }: { onNavigate?: () => void; signedIn: boolean }) {
  const item =
    "flex items-center gap-3 rounded-lg py-2 text-[14px] text-fg/85 transition-colors hover:text-brand";
  return (
    <nav aria-label="My profile" className="mt-6 border-t border-line pt-4">
      <p className="text-[12px] font-medium text-muted">My profile</p>
      <ul className="mt-1">
        <li>
          <Link to="/cart" className={item} onClick={onNavigate}>
            <ShoppingBag className="size-4 text-muted" aria-hidden /> Bag
          </Link>
        </li>
        <li>
          <Link
            to={signedIn ? "/orders" : "/login?next=%2Forders"}
            className={item}
            onClick={onNavigate}
          >
            <Package className="size-4 text-muted" aria-hidden /> Orders
          </Link>
        </li>
        {!signedIn && (
          <li>
            <Link to="/login" className={item} onClick={onNavigate}>
              <UserRound className="size-4 text-muted" aria-hidden /> Sign in
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
