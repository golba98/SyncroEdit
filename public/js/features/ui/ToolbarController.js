import { Plugin } from '/js/app/Plugin.js';

export class ToolbarController extends Plugin {
  constructor(editor, options) {
    super(editor, options);
  }

  init() {
    this.setupToolbar();
  }

  setupToolbar() {
    const buttons = {
      'ql-bold': 'bold',
      'ql-italic': 'italic',
      'ql-underline': 'underline',
      'ql-strike': 'strike',
      'ql-list': 'list',
      'ql-blockquote': 'blockquote',
      'ql-code-block': 'code-block',
      'ql-clean': 'clean',
    };

    // Standard formatting buttons
    Object.entries(buttons).forEach(([cls, fmt]) => {
      document.querySelectorAll(`.${cls}`).forEach((btn) => {
        this.addDisposableListener(btn, 'click', (e) => {
          e.preventDefault();
          if (!this.editor.quill) return;

          if (fmt === 'list') {
            const val = btn.getAttribute('value') || 'bullet';
            const currentFormat = this.editor.quill.getFormat();
            this.editor.quill.format('list', currentFormat.list === val ? false : val);
          } else if (fmt === 'clean') {
            const range = this.editor.quill.getSelection();
            if (range) this.editor.quill.removeFormat(range.index, range.length);
          } else {
            const format = this.editor.quill.getFormat();
            this.editor.quill.format(fmt, !format[fmt]);
          }
        });
      });
    });

    // Font and Size selects
    document.querySelectorAll('.ql-font').forEach((sel) => {
      this.addDisposableListener(sel, 'change', (e) => {
        if (this.editor.quill) this.editor.quill.format('font', e.target.value);
      });
    });

    document.querySelectorAll('.ql-size').forEach((sel) => {
      this.addDisposableListener(sel, 'change', (e) => {
        if (this.editor.quill) this.editor.quill.format('size', e.target.value);
      });
    });

    // Alignment (selects and buttons)
    document.querySelectorAll('.ql-align').forEach((el) => {
      const eventType = el.tagName === 'SELECT' ? 'change' : 'click';
      this.addDisposableListener(el, eventType, (e) => {
        if (!this.editor.quill) return;
        const val = el.tagName === 'SELECT' ? e.target.value : el.getAttribute('value') || '';
        this.editor.quill.format('align', val);
      });
    });

    // Color Pickers
    this.setupColorPicker('textColorBtn', 'textColorPicker', 'textColorIndicator', 'color');
    this.setupColorPicker(
      'highlightColorBtn',
      'highlightColorPicker',
      'highlightColorIndicator',
      'background'
    );

    // Image & Video
    document.querySelectorAll('.ql-image').forEach((btn) => {
      this.addDisposableListener(btn, 'click', () => {
        const input = document.getElementById('imageInput');
        if (input) input.click();
      });
    });

    // Save Button
    const saveBtn = document.getElementById('saveBtn');
    if (saveBtn) {
      this.addDisposableListener(saveBtn, 'click', async (e) => {
        e.preventDefault();
        this.editor?._setSaveStatus?.('saving');

        try {
          // Force save to IndexedDB
          const docId = new URLSearchParams(window.location.search).get('doc');
          if (this.editor) {
            await this.editor.saveToCache(docId);
            // Also trigger a reflow to ensure visual consistency
            if (this.editor.pageManager) {
              this.editor.pageManager.performReflowCheck();
            }
          }

          this.editor?._setSaveStatus?.(navigator.onLine === false ? 'offline' : 'saved');
        } catch (err) {
          console.error('Save failed:', err);
          this.editor?._setSaveStatus?.('failed');
        }
      });
    }

    const imageInput = document.getElementById('imageInput');
    if (imageInput) {
      this.addDisposableListener(imageInput, 'change', (e) => {
        const file = e.target.files[0];

        // Fallback: If no active quill (user hasn't clicked yet), use the first page
        if (!this.editor.quill && this.editor.pageQuillInstances.size > 0) {
          this.editor.quill = this.editor.pageQuillInstances.values().next().value;
        }

        if (file && this.editor.quill) {
          const reader = new FileReader();
          reader.onload = (e) => {
            // Get selection or default to end
            const range = this.editor.quill.getSelection(true);
            const index = range ? range.index : this.editor.quill.getLength() - 1;

            this.editor.quill.insertEmbed(index, 'image', e.target.result);

            // Force a reflow check in case image overflows
            if (this.editor.pageManager) {
              setTimeout(() => this.editor.pageManager.performReflowCheck(), 100);
            }
          };
          reader.readAsDataURL(file);
        }
      });
    }
  }

  setupColorPicker(btnId, pickerId, indicatorId, format) {
    const btn = document.getElementById(btnId);
    const picker = document.getElementById(pickerId);
    const indicator = document.getElementById(indicatorId);

    if (btn && picker) {
      this.addDisposableListener(btn, 'click', () => picker.click());
      this.addDisposableListener(picker, 'input', (e) => {
        const color = e.target.value;
        if (indicator) indicator.style.background = color;
        if (this.editor.quill) this.editor.quill.format(format, color);
      });
    }
  }
}
