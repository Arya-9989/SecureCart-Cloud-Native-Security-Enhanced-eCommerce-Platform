/**
 * Asks search engines not to index this page: the bag, checkout, orders and admin screens
 * are private, and not-found states are not content. React hoists the tag into <head>.
 *
 * robots.txt deliberately does NOT disallow these paths: a crawler that is blocked from
 * fetching a page never sees its noindex, and can still index the bare URL from links.
 */
export function NoIndex() {
  return <meta name="robots" content="noindex" />;
}
