// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanPreviewHtmlForClipboard,
  extractRichTextFromRange,
  serializeMathElement,
  serializeSvgElement,
  writeMathMLSourceToClipboard,
  writePlainTextToClipboard,
  writeRichTextToClipboard,
  writeSvgSourceToClipboard,
  writeSvgPngToClipboard,
  rasterizeSvgToPngBlob
} from "../../src/renderer/preview/previewClipboard";

describe("previewClipboard (#799)", () => {
  describe("cleanPreviewHtmlForClipboard", () => {
    it("strips data-source-line and data-glossary-* attributes", () => {
      const div = document.createElement("div");
      div.innerHTML = `
        <p data-source-line="42" class="paragraph">
          Text with <span data-glossary-entry-ids="e1" data-glossary-surface="word">word</span>
        </p>
      `;

      cleanPreviewHtmlForClipboard(div);

      const p = div.querySelector("p");
      expect(p?.getAttribute("data-source-line")).toBeNull();
      expect(p?.getAttribute("class")).toBe("paragraph");
      expect(div.querySelector("span")?.getAttribute("data-glossary-entry-ids")).toBeNull();
    });

    it("unwraps span.glossarySurfaceDecoration and preserves child text", () => {
      const div = document.createElement("div");
      div.innerHTML = `
        <p>Before <span class="glossarySurfaceDecoration" style="color: red;">Highlighted Term</span> After</p>
      `;

      cleanPreviewHtmlForClipboard(div);

      expect(div.querySelector("span.glossarySurfaceDecoration")).toBeNull();
      expect(div.querySelector("p")?.textContent).toBe("Before Highlighted Term After");
    });

    it("preserves standard HTML attributes like href, src, alt, class", () => {
      const div = document.createElement("div");
      div.innerHTML = `
        <a href="https://example.com" class="link" data-source-line="5">
          <img src="test.png" alt="Test" class="image" data-source-line="6" />
        </a>
      `;

      cleanPreviewHtmlForClipboard(div);

      const a = div.querySelector("a");
      const img = div.querySelector("img");
      expect(a?.getAttribute("href")).toBe("https://example.com");
      expect(a?.getAttribute("class")).toBe("link");
      expect(a?.getAttribute("data-source-line")).toBeNull();
      expect(img?.getAttribute("src")).toBe("test.png");
      expect(img?.getAttribute("alt")).toBe("Test");
      expect(img?.getAttribute("data-source-line")).toBeNull();
    });
  });

  describe("extractRichTextFromRange", () => {
    it("extracts sanitized HTML and plain text from Range", () => {
      const container = document.createElement("div");
      container.innerHTML = `<p data-source-line="10">Hello <strong class="bold">World</strong></p>`;
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const { html, text } = extractRichTextFromRange(range);

      expect(text).toBe("Hello World");
      expect(html).toContain('<strong class="bold">World</strong>');
      expect(html).not.toContain("data-source-line");

      document.body.removeChild(container);
    });
  });

  describe("serializeSvgElement", () => {
    it("adds xmlns attribute and serializes svg correctly", () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.setAttribute("viewBox", "0 0 100 100");
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", "50");
      svg.appendChild(rect);

      const xml = serializeSvgElement(svg);

      expect(xml).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(xml).toContain('viewBox="0 0 100 100"');
      expect(xml).toContain('<rect width="50"');
    });

    it("adds xlink namespace if href is present", () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#icon");
      svg.appendChild(use);

      const xml = serializeSvgElement(svg);

      expect(xml).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    });
  });

  describe("serializeMathElement", () => {
    it("preserves xmlns attribute if already present on math element", () => {
      const math = document.createElementNS("http://www.w3.org/1998/Math/MathML", "math");
      math.setAttribute("xmlns", "http://www.w3.org/1998/Math/MathML");
      const mi = document.createElementNS("http://www.w3.org/1998/Math/MathML", "mi");
      mi.textContent = "x";
      math.appendChild(mi);

      const xml = serializeMathElement(math);

      expect(xml).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
      expect(xml).toContain("<mi>x</mi>");
    });

    it("adds xmlns attribute if missing on math element", () => {
      const math = document.createElement("math");
      const mrow = document.createElement("mrow");
      const mn = document.createElement("mn");
      mn.textContent = "42";
      mrow.appendChild(mn);
      math.appendChild(mrow);

      const xml = serializeMathElement(math);

      expect(xml).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
      expect(xml).toContain("<mrow><mn>42</mn></mrow>");
    });
  });

  describe("writeRichTextToClipboard and writePlainTextToClipboard", () => {
    const originalClipboard = navigator.clipboard;

    beforeEach(() => {
      // Mock navigator.clipboard
      Object.defineProperty(navigator, "clipboard", {
        value: {
          write: vi.fn().mockResolvedValue(undefined),
          writeText: vi.fn().mockResolvedValue(undefined)
        },
        configurable: true,
        writable: true
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
        writable: true
      });
    });

    it("writes both html and plain text via ClipboardItem when supported", async () => {
      const success = await writeRichTextToClipboard("<b>Hello</b>", "Hello");

      expect(success).toBe(true);
      expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
    });

    it("falls back to writeText if ClipboardItem write fails", async () => {
      (navigator.clipboard.write as any).mockRejectedValueOnce(new Error("Write failed"));

      const success = await writeRichTextToClipboard("<b>Hello</b>", "Hello");

      expect(success).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hello");
    });

    it("writes plain text via writePlainTextToClipboard", async () => {
      const success = await writePlainTextToClipboard("Plain text");

      expect(success).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Plain text");
    });

    it("writes svg source via writeSvgSourceToClipboard", async () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.setAttribute("id", "diag");

      const success = await writeSvgSourceToClipboard(svg);

      expect(success).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const calledText = (navigator.clipboard.writeText as any).mock.calls[0][0];
      expect(calledText).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(calledText).toContain('id="diag"');
    });

    it("writes mathml source via writeMathMLSourceToClipboard", async () => {
      const math = document.createElementNS("http://www.w3.org/1998/Math/MathML", "math");
      const mi = document.createElementNS("http://www.w3.org/1998/Math/MathML", "mi");
      mi.textContent = "y";
      math.appendChild(mi);

      const success = await writeMathMLSourceToClipboard(math);

      expect(success).toBe(true);
      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const calledText = (navigator.clipboard.writeText as any).mock.calls[0][0];
      expect(calledText).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
      expect(calledText).toContain("<mi>y</mi>");
    });

    it("rasterizes SVG to transparent PNG blob with 2x scale and writes to clipboard", async () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
      svg.setAttribute("viewBox", "0 0 200 100");

      const originalImage = window.Image;
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;

      class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          setTimeout(() => {
            if (this.onload) this.onload();
          }, 0);
        }
      }
      (window as any).Image = MockImage;

      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
        drawImage: vi.fn()
      }) as any;
      HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((callback) => {
        callback(new Blob(["mock-png"], { type: "image/png" }));
      });

      try {
        const success = await writeSvgPngToClipboard(svg, 2);

        expect(success).toBe(true);
        expect(navigator.clipboard.write).toHaveBeenCalledTimes(1);
      } finally {
        window.Image = originalImage;
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
      }
    });
  });
});
