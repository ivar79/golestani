import api from "@/lib/api";

/**
 * Phase 4: authorized private print-file download.
 *
 * The print file lives on the backend's PRIVATE card_files disk and the
 * download endpoint requires the Sanctum token (owner/admin only), so a
 * plain <a href> navigation cannot authorize it. We fetch the file as a
 * blob with the Authorization header and hand the blob to the browser's
 * downloader, so the token never appears in any URL.
 */
export async function downloadPrintFile(businessId: number): Promise<void> {
  const response = await api.get(`/businesses/${businessId}/card/print-file`, {
    responseType: "blob",
  });

  // Derive a safe filename from Content-Disposition when present.
  const disposition: string = response.headers?.["content-disposition"] ?? "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const asciiMatch = /filename="?([^";]+)"?/i.exec(disposition);
  let filename = "print-file";
  if (utf8Match?.[1]) {
    filename = decodeURIComponent(utf8Match[1]);
  } else if (asciiMatch?.[1]) {
    filename = asciiMatch[1];
  }

  const blob: Blob = response.data;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[/\\?%*:|"<>]/g, "-");
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
