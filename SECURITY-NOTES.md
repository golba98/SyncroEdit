# Security Notes

## Quill CVE-2025-15056 / GHSA-v3m3-f69x-jf25

Dependabot alert #46 tracks `quill@2.0.3`, which is currently listed by GitHub Advisory as affected with no patched upstream version available.

SyncroEdit mitigates the vulnerable Quill HTML export/render path by keeping Yjs/Delta as the canonical document format, sanitizing Quill HTML before it crosses paste/import/render trust boundaries, and disabling unused video/formula/embed formats. Quill HTML must be treated as untrusted until it passes through `sanitizeQuillHtml()`.
