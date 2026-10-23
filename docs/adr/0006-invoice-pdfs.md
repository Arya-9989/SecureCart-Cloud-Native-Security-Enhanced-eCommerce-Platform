# 0006. Server-side invoice PDFs

- Status: accepted
- Date: 2026-10-23

## Context

Customers and admins need an invoice for every paid order. An invoice is a financial
document, so it has three hard requirements. Its figures must equal what was charged. It
must not change when the catalog changes. And only the order's owner and staff may read it.
The tax rate applied at checkout was not stored, only the tax amount.

## Options considered

- **Client-side PDF (jsPDF in the browser).** It cannot be trusted for figures, adds a large
  bundle, and would need a CSP change for its workers.
- **HTML to PDF (WeasyPrint or headless Chrome).** The typography is good, but it needs
  system libraries (Pango, Cairo) or a browser in the API image, which means a larger
  attack surface and more CVEs for Trivy to gate.
- **ReportLab, a pure-Python PDF generator (chosen).** No system dependencies, it uses the
  standard PDF fonts (nothing embedded or fetched), and the output is small. Babel formats
  money with the same CLDR rules as the storefront's `Intl.NumberFormat("en-US")`.

## Decision

- `GET /api/orders/{id}/invoice/` is for the owner. The order is looked up through the
  requesting user, so another customer gets `404`, exactly like the order itself.
  `GET /api/admin/orders/{id}/invoice/` is for admins, and the RBAC matrix covers it
  automatically.
- Both answer `application/pdf` with `Content-Disposition: attachment;
  filename="invoice-<number>.pdf"`, `nosniff` and `Cache-Control: no-store`. An order
  that was never paid answers `409`.
- **Every figure comes from the order snapshot:** line names, SKUs, unit prices and line
  totals, plus subtotal, shipping, tax, total and currency. Nothing is recomputed. The new
  `Order.tax_rate` column records the rate at checkout. It is null for older orders, which
  print "Tax" with no percentage.
- **Money formatting:**
  - `$1,234.50`, `€1,234.50`, `£1,234.50`;
  - `¥1,235` (JPY has no minor unit);
  - currencies whose symbol the standard fonts cannot draw are printed with the ISO code
    (`INR 1,234.50`), never as a missing glyph.
- Customer-controlled text (names, addresses) is escaped before it reaches ReportLab's
  paragraph markup.
- A cancelled order that had been paid says that the payment was refunded.
- The seller details come from `STORE_NAME`, `STORE_ADDRESS` and `INVOICE_FOOTER`. The
  default footer says the store is a demonstration.
- The order page (customer) and the order drawer (admin) have a "Download invoice" button.
  It fetches the PDF with the in-memory access token, because a plain link cannot carry
  bearer auth, and saves it under the server's filename.

## Consequences

- Tests parse the generated PDF's text with pypdf and assert each line, subtotal,
  shipping, tax and total, including a rounding case: 67.42 × 8% = 5.3936, printed as
  $5.39. They also cover currencies, escaping, snapshots versus later catalog edits, and
  the authorization matrix.
- The standard fonts keep the PDFs small and dependency-free. Full Unicode for a currency
  like INR would need an embedded TTF. The ISO-code fallback is the documented trade-off.
- An invoice is regenerated on each request, not stored. Its content cannot drift, because
  the order snapshot is immutable for invoiced fields.
