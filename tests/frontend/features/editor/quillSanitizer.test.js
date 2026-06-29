/**
 * @jest-environment jsdom
 */

import { sanitizeQuillHtml, sanitizeQuillUrl } from '/js/security/quillSanitizer.js';

describe('Quill HTML sanitization', () => {
  it('removes image event handlers', () => {
    const html = sanitizeQuillHtml('<p><img src=x onerror=alert(1)></p>');

    expect(html).toContain('<img');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('removes svg payloads', () => {
    const html = sanitizeQuillHtml('<svg onload=alert(1)><circle></circle></svg><p>safe</p>');

    expect(html).toContain('<p>safe</p>');
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('onload');
  });

  it('removes javascript links', () => {
    const html = sanitizeQuillHtml('<a href="javascript:alert(1)">x</a>');

    expect(html).toBe('<a>x</a>');
  });

  it('removes malformed attribute-breaking payloads', () => {
    const html = sanitizeQuillHtml('<p><img src="x&quot; onerror=&quot;alert(1)" alt="x"></p>');

    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('removes unused embed surfaces', () => {
    const html = sanitizeQuillHtml(`
      <iframe src="https://example.com"></iframe>
      <video src="https://example.com/video.mp4"></video>
      <span class="ql-formula" data-value="<img src=x onerror=alert(1)>">formula</span>
    `);

    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<video');
    expect(html).not.toContain('data-value');
    expect(html).not.toContain('onerror');
    expect(html).toContain('<span class="ql-formula">formula</span>');
  });

  it('allows only approved link URL forms', () => {
    expect(sanitizeQuillUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeQuillUrl('http://example.com')).toBe('http://example.com');
    expect(sanitizeQuillUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    expect(sanitizeQuillUrl('/documents/1')).toBe('/documents/1');
    expect(sanitizeQuillUrl('javascript:alert(1)')).toBe('');
    expect(sanitizeQuillUrl('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(sanitizeQuillUrl('//example.com')).toBe('');
  });
});
