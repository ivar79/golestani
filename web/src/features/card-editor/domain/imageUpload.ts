/**
 * Shared contract for uploading a card image asset — used by BOTH the Toolbox
 * "افزودن تصویر" picker, the Inspector's "تعویض فایل تصویر" and the artboard's
 * drag-and-drop drop zone.
 *
 * The backend (`BusinessCardRequest`) validates `front_image` with
 * `['nullable', 'image', 'max:5120']`: any raster image, at most 5 MB. The
 * editor only ever renders the asset through an `<img>`, so the client mirrors
 * those limits and — critically — reports a refusal in PERSIAN *before* a
 * request is made. A 7 MB phone photo used to be sent anyway, come back as a
 * server-side (English) validation error, and read as "the upload simply does
 * not work".
 */

/** Mirrors the backend's 5120 KB cap on `front_image`. */
export const CARD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** `accept` attribute for the card image file inputs. */
export const CARD_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Spellings that mean "a plain JPEG". `image/jpg` is non-standard but is what
 * several cameras, Android builds and desktop tools report for a perfectly
 * ordinary .jpg — refusing it turned a good photo into a silent no-op.
 */
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/**
 * `null` when the file may be uploaded, otherwise the Persian message to show.
 * Never throws: every branch answers with something the UI can display.
 */
export function validateCardImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has((file.type || "").toLowerCase())) {
    return "فقط تصویر JPEG، PNG یا WebP قابل آپلود است.";
  }
  if (file.size === 0) {
    return "فایل تصویر خالی است — فایل دیگری انتخاب کنید.";
  }
  if (file.size > CARD_IMAGE_MAX_BYTES) {
    const mb = Math.round(CARD_IMAGE_MAX_BYTES / (1024 * 1024));
    return `حجم تصویر بیشتر از ${mb} مگابایت است — تصویر کوچک‌تری انتخاب کنید.`;
  }
  return null;
}
