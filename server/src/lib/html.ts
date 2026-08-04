/**
 * HTML sanitisation for user-authored email bodies.
 *
 * The body is written in a rich-text editor, stored, re-rendered in the dashboard
 * preview and shipped to Gmail. Sanitising on write means a malicious or pasted
 * payload can never execute in the dashboard, and the outgoing mail stays clean.
 *
 * This is a deliberately conservative allow-list: anything not explicitly permitted
 * is dropped. Email clients strip scripts anyway, so nothing legitimate is lost.
 */

const ALLOWED_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'caption', 'code', 'div', 'em', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'center', 'font',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'style', 'align', 'valign',
  'colspan', 'rowspan', 'border', 'cellpadding', 'cellspacing', 'color', 'face',
  'size', 'target', 'rel', 'class', 'dir', 'bgcolor',
]);

// Whitespace plus C0/C1 control characters, which attackers insert to split `javascript:`.
const CONTROL_CHARS = new RegExp('[\\s\\u0000-\\u001F\\u007F-\\u009F]', 'g');

/** Blocks `javascript:`, `vbscript:` and `data:` URLs (except inline raster images). */
function isSafeUrl(value: string, attr: string): boolean {
  // Strip whitespace and control characters first: "java\tscript:" is a real bypass.
  const url = value.replace(CONTROL_CHARS, '').toLowerCase();
  if (url.startsWith('javascript:') || url.startsWith('vbscript:')) return false;
  if (url.startsWith('data:')) {
    // SVG can carry script, so only raster formats are allowed, and only as an image source.
    return attr === 'src' && /^data:image\/(png|jpe?g|gif|webp|bmp);base64,/.test(url);
  }
  return true;
}

function sanitizeStyle(style: string): string {
  // Drop anything that can load or execute: expression(), url(javascript:...), @import, behavior.
  return style
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false;
      const lower = decl.toLowerCase();
      if (/expression\s*\(|javascript:|vbscript:|@import|behavior\s*:|-moz-binding/.test(lower)) return false;
      if (/url\s*\(/.test(lower) && !/url\s*\(\s*["']?(https?:|data:image\/(png|jpe?g|gif|webp|bmp))/.test(lower)) {
        return false;
      }
      return true;
    })
    .join('; ');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeAttributes(raw: string): string {
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>=`]+))/g;
  const kept: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = attrRe.exec(raw)) !== null) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[5] ?? '';

    if (name.startsWith('on')) continue; // every event handler
    if (name === 'srcset' || name === 'formaction' || name === 'xlink:href') continue;
    if (!ALLOWED_ATTRS.has(name)) continue;
    if ((name === 'href' || name === 'src') && !isSafeUrl(value, name)) continue;

    if (name === 'style') {
      const safe = sanitizeStyle(value);
      if (safe) kept.push(`style="${escapeAttr(safe)}"`);
      continue;
    }

    kept.push(`${name}="${escapeAttr(value)}"`);
  }

  return kept.length ? ` ${kept.join(' ')}` : '';
}

export function sanitizeHtml(input: string): string {
  if (!input) return '';

  let html = input
    // Remove dangerous elements together with their content.
    .replace(
      /<(script|style|iframe|object|embed|applet|noscript|template|svg|math|form|link|meta|base)\b[\s\S]*?<\/\1\s*>/gi,
      '',
    )
    .replace(/<(script|style|iframe|object|embed|applet|link|meta|base)\b[^>]*\/?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/gi, '');

  html = html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (full: string, tagName: string, attrs: string) => {
      const tag = tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (full.startsWith('</')) return `</${tag}>`;

      const selfClosing = tag === 'br' || tag === 'hr' || tag === 'img';
      const cleanAttrs = sanitizeAttributes(attrs);

      // Force safe link behaviour for anything that opens a new tab.
      if (tag === 'a' && /target=/i.test(cleanAttrs) && !/rel=/i.test(cleanAttrs)) {
        return `<a${cleanAttrs} rel="noopener noreferrer">`;
      }
      return selfClosing ? `<${tag}${cleanAttrs} />` : `<${tag}${cleanAttrs}>`;
    },
  );

  // Anything left that looks like the start of a tag is a malformed leftover.
  return html.replace(/<(?![/a-zA-Z])/g, '&lt;');
}

/** Escapes text for safe interpolation into an HTML document. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Best-effort HTML to plain text, used for the `text/plain` MIME alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '* ')
    .replace(/<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, '').trim();
      return label === href.trim() || !label ? href : `${label} (${href})`;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
