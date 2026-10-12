/**
 * Clipboard operations for Markdown preview surfaces (#799).
 *
 * Provides extraction, sanitization, and clipboard serialization for:
 *   - Rich text (HTML + Plain text)
 *   - Plain text
 *   - Link URLs
 *   - SVG XML source
 *   - High-resolution transparent PNG copy for SVG graphics (Mermaid / inline SVG)
 */

/**
 * Strips Pergamum-internal data attributes and preview-specific decorations
 * from a cloned preview fragment so that pasted content into external apps
 * (Word, Google Docs, etc.) remains clean.
 */
export function cleanPreviewHtmlForClipboard(container: HTMLElement): void {
  // 1. Unwrap glossary surface decoration spans (keep their inner text/children intact)
  const glossarySpans = Array.from(
    container.querySelectorAll("span.glossarySurfaceDecoration")
  );
  for (const span of glossarySpans) {
    span.replaceWith(...Array.from(span.childNodes));
  }

  // 2. Remove internal data-* attributes across all elements in the fragment
  const allElements = Array.from(container.querySelectorAll("*"));
  for (const el of allElements) {
    const attributeNames = el.getAttributeNames();
    for (const name of attributeNames) {
      if (name.startsWith("data-source-line") || name.startsWith("data-glossary-")) {
        el.removeAttribute(name);
      }
    }
  }
}

/**
 * Extracts sanitized HTML and plain text representations from a DOM Range.
 */
export function extractRichTextFromRange(range: Range): {
  html: string;
  text: string;
} {
  const fragment = range.cloneContents();
  const wrapper = document.createElement("div");
  wrapper.appendChild(fragment);

  cleanPreviewHtmlForClipboard(wrapper);

  return {
    html: wrapper.innerHTML,
    text: range.toString()
  };
}

/**
 * Serializes an SVGSVGElement to standalone SVG XML markup with required XML namespaces.
 */
export function serializeSvgElement(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }

  let xml = new XMLSerializer().serializeToString(clone);

  // If xlink:href is present in the serialized SVG, ensure xlink namespace is declared
  if (xml.includes("xlink:href") && !xml.includes("xmlns:xlink=")) {
    xml = xml.replace("<svg", '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  return xml;
}

/**
 * Writes rich text (both text/html and text/plain) to the clipboard.
 * Falls back to plain text if the W3C Clipboard write() API fails.
 */
export async function writeRichTextToClipboard(
  html: string,
  text: string
): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      const htmlBlob = new Blob([html], { type: "text/html" });
      const textBlob = new Blob([text], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": htmlBlob,
          "text/plain": textBlob
        })
      ]);
      return true;
    }
  } catch (error) {
    console.warn("Failed to write rich text to clipboard, falling back to plain text:", error);
  }

  return writePlainTextToClipboard(text);
}

/**
 * Writes plain text to the clipboard.
 */
export async function writePlainTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.error("Failed to write plain text to clipboard:", error);
  }
  return false;
}

/**
 * Writes SVG XML source code to the clipboard.
 */
export async function writeSvgSourceToClipboard(
  svg: SVGSVGElement
): Promise<boolean> {
  const xml = serializeSvgElement(svg);
  return writePlainTextToClipboard(xml);
}

/**
 * Serializes a MathML <math> element to standalone XML markup with proper namespace.
 */
export function serializeMathElement(math: Element): string {
  const clone = math.cloneNode(true) as Element;
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/1998/Math/MathML");
  }
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Writes MathML XML source code to the clipboard.
 */
export async function writeMathMLSourceToClipboard(
  math: Element
): Promise<boolean> {
  const xml = serializeMathElement(math);
  return writePlainTextToClipboard(xml);
}

/**
 * Default resolution scaling factor for PNG rasterization (2x for crisp display on high-DPI screens & print).
 */
export const DEFAULT_SVG_PNG_SCALE = 2;

/**
 * Rasterizes an SVG string to a transparent PNG Blob via an offscreen HTMLCanvasElement
 * with a configurable resolution scale factor.
 */
export async function rasterizeSvgToPngBlob(
  svgXml: string,
  width: number,
  height: number,
  scale = DEFAULT_SVG_PNG_SCALE,
  timeoutMs = 1000
): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (url?: string) => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore URL revoke failures
        }
      }
    };

    try {
      const svgBlob = new Blob([svgXml], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();

      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup(url);
          resolve(null);
        }
      }, timeoutMs);

      img.onload = () => {
        if (settled) {
          return;
        }
        settled = true;
        try {
          const canvas = document.createElement("canvas");
          const targetScale = Math.max(1, scale);
          canvas.width = Math.max(1, Math.round(width * targetScale));
          canvas.height = Math.max(1, Math.round(height * targetScale));

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            cleanup(url);
            resolve(null);
            return;
          }

          // Transparent background: canvas is transparent by default (no fillRect)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          if (typeof canvas.toBlob === "function") {
            canvas.toBlob((blob) => {
              cleanup(url);
              resolve(blob);
            }, "image/png");
          } else {
            cleanup(url);
            resolve(null);
          }
        } catch {
          cleanup(url);
          resolve(null);
        }
      };

      img.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup(url);
        resolve(null);
      };

      img.src = url;
    } catch {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    }
  });
}

/**
 * Copies an SVG element to the clipboard as a high-resolution transparent PNG image.
 */
export async function writeSvgPngToClipboard(
  svg: SVGSVGElement,
  scale = DEFAULT_SVG_PNG_SCALE
): Promise<boolean> {
  try {
    const svgXml = serializeSvgElement(svg);

    const rect = svg.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : (svg.viewBox?.baseVal?.width || 800);
    const height = rect.height > 0 ? rect.height : (svg.viewBox?.baseVal?.height || 600);

    const pngBlob = await rasterizeSvgToPngBlob(svgXml, width, height, scale);
    if (!pngBlob) {
      console.warn("Failed to rasterize SVG to PNG blob");
      return false;
    }

    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": pngBlob
        })
      ]);
      return true;
    }
  } catch (error) {
    console.error("Failed to write SVG PNG to clipboard:", error);
  }

  return false;
}
