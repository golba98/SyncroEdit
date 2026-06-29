import DOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'u',
  'ul',
];

const ALLOWED_ATTR = ['alt', 'class', 'height', 'href', 'rel', 'src', 'target', 'width'];
const URL_ATTRS = new Set(['href', 'src']);
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const IMAGE_DATA_URL_RE = /^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z0-9+/=\s]+$/i;
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

let hooksConfigured = false;

function configureHooks() {
  if (hooksConfigured) return;
  hooksConfigured = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!node || typeof node.getAttribute !== 'function') return;

    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        node.removeAttribute(attr.name);
      }
    }

    for (const attrName of URL_ATTRS) {
      if (!node.hasAttribute(attrName)) continue;
      const allowImageData = node.nodeName === 'IMG' && attrName === 'src';
      const cleanUrl = sanitizeQuillUrl(node.getAttribute(attrName), { allowImageData });
      if (cleanUrl) {
        node.setAttribute(attrName, cleanUrl);
      } else {
        node.removeAttribute(attrName);
      }
    }

    if (node.nodeName === 'A') {
      const target = node.getAttribute('target');
      if (target && target !== '_blank') {
        node.removeAttribute('target');
      }
      if (node.getAttribute('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  });
}

export function sanitizeQuillUrl(value, { allowImageData = false } = {}) {
  if (typeof value !== 'string') return '';

  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, '');
  if (!clean) return '';

  if (allowImageData && IMAGE_DATA_URL_RE.test(clean)) {
    return clean;
  }

  if (/[\s"'<>`]/.test(clean)) return '';
  if (clean.startsWith('//')) return '';

  const schemeMatch = clean.match(URL_SCHEME_RE);
  if (schemeMatch) {
    const protocol = schemeMatch[0].toLowerCase();
    return LINK_PROTOCOLS.has(protocol) ? clean : '';
  }

  return clean;
}

export function sanitizeQuillHtml(html) {
  configureHooks();

  return DOMPurify.sanitize(String(html || ''), {
    ALLOW_DATA_ATTR: false,
    ALLOWED_ATTR,
    ALLOWED_TAGS,
    FORBID_ATTR: ['style'],
    FORBID_TAGS: ['embed', 'form', 'iframe', 'math', 'object', 'script', 'style', 'svg', 'video'],
    KEEP_CONTENT: true,
  });
}

export function convertSanitizedHtmlToDelta(quill, html, text = '') {
  if (!quill || !quill.clipboard || typeof quill.clipboard.convert !== 'function') {
    return null;
  }

  // Quill HTML can contain active content until it is sanitized.
  const sanitizedHtml = sanitizeQuillHtml(html);
  return quill.clipboard.convert({ html: sanitizedHtml, text });
}
