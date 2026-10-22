# 0005. Product image uploads to object storage

- Status: accepted
- Date: 2026-10-23

## Context

Product images were URLs typed by an admin: either a site-relative path to a bundled SVG or
an `https://` URL. Accepting uploads adds the classic file-upload attack surface:

- stored XSS through SVG or HTML disguised as an image;
- polyglots (a valid image that is also HTML, PHP or a ZIP);
- MIME sniffing;
- decompression bombs;
- metadata leaks (EXIF GPS, camera serials);
- path traversal through filenames;
- uploads too large for the server to handle.

## Options considered

- **Store the original bytes after validating them.** Validation alone never proves the
  absence of a second interpretation: an image can be valid and something else at once.
- **Pre-signed PUT straight to the bucket.** This takes load off the API, but the server
  never sees the bytes before they are live, so it needs an asynchronous scan-and-promote
  step.
- **Serve with pre-signed GET URLs.** That exposes the object store's origin to browsers,
  needs a CSP change (`img-src`), and the URLs expire, which breaks catalog caching and the
  build-time prerender snapshot.
- **Proxy the upload through the API, re-encode, store privately, and serve through the API
  (chosen).** One origin, no CSP change, and the bytes are always ones the server produced.

## Decision

- `POST /api/admin/products/{id}/image/` is multipart and admin-only. Permissions are
  checked before the body is parsed, and the existing RBAC matrix covers the new route
  automatically. The pipeline (`apps/catalog/media.py`):
  1. **Size.** nginx allows 6 MiB on this one route (1 MiB everywhere else). The API refuses
     anything over `MAX_IMAGE_UPLOAD_BYTES` (5 MiB) with a `413`, from the declared length
     before parsing and again from the actual size.
  2. **Magic bytes.** Only JPEG, PNG and WebP. The client's filename and content type are
     ignored, which also rules out SVG.
  3. **Polyglots** are refused:
     - markup markers anywhere (`<script`, `<svg`, `<html`, `<!doctype`, `<?php`, `%PDF-`,
       `<iframe`);
     - trailing bytes after the format's end (after PNG `IEND`, past the RIFF length, after
       a JPEG's final `FFD9`). This catches appended archives.
  4. **Decode.** The pixel count is capped before decoding (`MAX_IMAGE_PIXELS`), and the
     decoder must agree with the magic bytes. Only the first frame is used.
  5. **Re-encode** to WebP: EXIF orientation applied, longest edge capped at 2000 px, and no
     EXIF, GPS, ICC, XMP or text chunks carried over.
- **Storage.**
  - Random keys `products/<id>/<uuid>.webp` in a **private** bucket, through any S3 API
    (MinIO locally, S3 in production).
  - boto3 with 3 s connect and 10 s read timeouts and standard retries.
  - The bucket is created idempotently at start-up.
  - A replaced image is deleted after commit. A failed database write deletes the new object.
- **Serving.** `GET /api/media/<key>` accepts only keys matching the generated pattern
  (no traversal), and only objects stored as `image/webp` by the pipeline. It sends
  `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition: inline` and
  `Cache-Control: public, max-age=31536000, immutable`. The URL changes with every upload,
  so the cache never goes stale.
- **Local MinIO.** MinIO stopped publishing container images in 2025. Compose and CI use
  Chainguard's MinIO build, pinned by digest, with its Sigstore signature verified via
  `cosign verify` against Chainguard's GitHub workflow identity. It is a local emulator only
  and is scanned report-only.
- **Audit.** Every upload writes an audit event with the image-URL diff, the SHA-256 and
  size of the stored bytes, and the dimensions.
- **Admin UI.** The product editor shows the current image and a "Replace image" button.
  It checks type and size in the browser to fail fast, and shows the server's reason when a
  file is refused. Uploads apply immediately, and the form keeps the returned URL.

## Consequences

- Image bytes flow through the API. At this store's scale that is fine. A high-traffic
  deployment should put a CDN or nginx `proxy_cache` in front of `/api/media/`, which is
  safe because the URLs are immutable.
- Re-encoding is lossy, by design: the stored file is always one the server wrote.
- The marker scan can, very rarely, reject a genuine photo whose compressed bytes happen to
  contain a marker. The patterns are 5 to 9 bytes, so the estimated odds are about 1 in 2,500 for a
  maximum-size upload; the admin re-exports the photo.
- The demo catalog keeps its bundled SVG artwork, so the prerender snapshot and its
  contract test are unaffected.
