/** Mirrors the server's checks so obvious mistakes fail fast; the server stays the authority. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function checkImageFile(file: File): string | null {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (file.size > MAX_IMAGE_BYTES) return "Images must be 5 MB or smaller.";
  if (file.size === 0) return "The file is empty.";
  return null;
}
