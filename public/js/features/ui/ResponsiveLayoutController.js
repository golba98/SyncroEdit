const VIEWPORT_BREAKPOINTS = {
  mobile: 600,
  tablet: 900,
  compact: 1200,
};

const SECTION_PRIORITIES = {
  Font: 1,
  Paragraph: 2,
  Editing: 3,
  Media: 1,
  Links: 2,
  Blocks: 3,
  Pages: 1,
  Highlights: 1,
  'Page Setup': 1,
  Spacing: 2,
  Indent: 2,
  'Border Setting': 3,
  'Border Style': 3,
  Width: 3,
  Color: 3,
  'Apply Border': 3,
  Theme: 2,
  Zoom: 1,
  Readability: 3,
  Focus: 3,
  Activity: 1,
  Share: 1,
  File: 2,
};

const TAB_PRIORITIES = {
  home: 1,
  insert: 1,
  view: 1,
  layout: 2,
  design: 2,
  history: 3,
  share: 3,
};

function layoutMode(width) {
  if (width < VIEWPORT_BREAKPOINTS.mobile) return 'mobile';
  if (width < VIEWPORT_BREAKPOINTS.tablet) return 'tablet';
  if (width < VIEWPORT_BREAKPOINTS.compact) return 'compact';
  return 'desktop';
}

// Height of the layout viewport hidden below the visual viewport, i.e. the on-screen keyboard.
function keyboardInset(layoutHeight, viewport) {
  if (!viewport) return 0;
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

function elementWidth(element) {
  if (!element) return 0;
  const rect = element.getBoundingClientRect();
  const styles = getComputedStyle(element);
  return rect.width + parseFloat(styles.marginLeft || 0) + parseFloat(styles.marginRight || 0);
}

export class ResponsiveLayoutController {
  constructor(app) {
    this.app = app;
    this.resizeObserver = null;
    this.mutationObserver = null;
    this.frame = null;
    this.boundSchedule = () => this.schedule();
  }

  init() {
    this.prepareRibbonOverflow();
    this.prepareTabOverflow();
    this.setupEvents();
    this.sync();
  }

  setupEvents() {
    window.addEventListener('resize', this.boundSchedule, { passive: true });
    window.visualViewport?.addEventListener('resize', this.boundSchedule, {
      passive: true,
    });
    window.visualViewport?.addEventListener('scroll', this.boundSchedule, {
      passive: true,
    });

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(this.boundSchedule);
      ['.header', '.ribbon-tabs', '.ribbon-content.active', '.main-workspace', '#pagesContainer']
        .map((selector) => document.querySelector(selector))
        .filter(Boolean)
        .forEach((element) => this.resizeObserver.observe(element));
    }

    this.mutationObserver = new MutationObserver(this.boundSchedule);
    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-view-state'],
      subtree: true,
    });

    document.addEventListener('click', (event) => {
      const overflowButton = event.target.closest('[data-responsive-overflow-button]');
      if (overflowButton) {
        event.stopPropagation();
        const host = overflowButton.closest('.responsive-overflow');
        const open = !host.classList.contains('is-open');
        this.closeOverflowMenus();
        host.classList.toggle('is-open', open);
        overflowButton.setAttribute('aria-expanded', String(open));
        return;
      }

      const proxy = event.target.closest('[data-proxy-click]');
      if (proxy) {
        document.getElementById(proxy.dataset.proxyClick)?.click();
        this.closeOverflowMenus();
        return;
      }

      if (!event.target.closest('.responsive-overflow')) this.closeOverflowMenus();
    });

    document.getElementById('workspacePanelBackdrop')?.addEventListener('click', () => {
      document.querySelector('#outlineSidebar[style*="flex"] #closeOutline')?.click();
      document.querySelector('#minimapSidebar[style*="flex"] #closeMinimap')?.click();
    });
  }

  schedule() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.sync();
    });
  }

  sync() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const body = document.body;
    body.dataset.layoutMode = layoutMode(width);
    document.documentElement.style.setProperty('--visual-viewport-height', `${height}px`);
    document.documentElement.style.setProperty(
      '--visual-viewport-offset-top',
      `${viewport?.offsetTop || 0}px`
    );
    document.documentElement.style.setProperty(
      '--keyboard-inset',
      `${keyboardInset(window.innerHeight, viewport)}px`
    );

    const pages = document.getElementById('pagesContainer');
    if (pages && this.app.editor) {
      const styles = getComputedStyle(pages);
      const available =
        pages.clientWidth -
        parseFloat(styles.paddingLeft || 0) -
        parseFloat(styles.paddingRight || 0);
      const presentation = available < VIEWPORT_BREAKPOINTS.mobile ? 'continuous' : 'paginated';
      body.dataset.documentPresentation = presentation;
      this.app.editor.setResponsivePresentation?.(presentation, Math.max(0, available));
    }

    this.layoutTabs();
    this.layoutActiveRibbon();
    this.app.uiManager?.updateMobileUIState?.();
  }

  prepareRibbonOverflow() {
    document.querySelectorAll('.ribbon-content').forEach((ribbon) => {
      Array.from(ribbon.children)
        .filter((child) => child.classList.contains('ribbon-section'))
        .forEach((section, index) => {
          const title = section.querySelector('.ribbon-section-title')?.textContent.trim() || '';
          section.dataset.responsiveSection = 'true';
          section.dataset.responsiveOrder = String(index);
          section.dataset.responsivePriority = String(SECTION_PRIORITIES[title] || 2);
        });

      if (ribbon.querySelector(':scope > .responsive-overflow')) return;
      const overflow = document.createElement('div');
      overflow.className = 'responsive-overflow ribbon-overflow';
      overflow.innerHTML = `
        <button class="toolbar-btn responsive-overflow__button" type="button"
          data-responsive-overflow-button aria-expanded="false" aria-label="More ${ribbon.id.replace('-ribbon', '')} tools" title="More tools">
          <i class="fas fa-ellipsis-h" aria-hidden="true"></i>
        </button>
        <div class="responsive-overflow__panel" role="group"></div>`;
      ribbon.appendChild(overflow);
    });
  }

  layoutActiveRibbon() {
    const ribbon = document.querySelector('.ribbon-content.active');
    if (!ribbon || !ribbon.clientWidth) return;
    const overflow = ribbon.querySelector(':scope > .responsive-overflow');
    const panel = overflow?.querySelector('.responsive-overflow__panel');
    if (!overflow || !panel) return;

    Array.from(panel.children)
      .sort((a, b) => Number(a.dataset.responsiveOrder) - Number(b.dataset.responsiveOrder))
      .forEach((section) => ribbon.insertBefore(section, overflow));
    overflow.hidden = true;

    const sections = Array.from(ribbon.querySelectorAll(':scope > [data-responsive-section]'));
    const styles = getComputedStyle(ribbon);
    const available =
      ribbon.getBoundingClientRect().width -
      parseFloat(styles.paddingLeft || 0) -
      parseFloat(styles.paddingRight || 0);
    const gap = parseFloat(styles.columnGap) || 0;
    // The overflow host has an auto left margin, so measure its button plus its fixed right margin.
    const overflowWidth =
      (overflow.firstElementChild?.getBoundingClientRect().width || 40) +
      (parseFloat(getComputedStyle(overflow).marginRight) || 0) +
      gap;
    const visible = new Set(sections);
    // Sections, the gaps between them, and the overflow button once anything has moved into it.
    const needed = () =>
      [...visible].reduce((sum, section) => sum + elementWidth(section), 0) +
      gap * Math.max(0, visible.size - 1) +
      (visible.size < sections.length ? overflowWidth : 0);
    const candidates = [...sections].sort((a, b) => {
      const priority = Number(b.dataset.responsivePriority) - Number(a.dataset.responsivePriority);
      return priority || Number(b.dataset.responsiveOrder) - Number(a.dataset.responsiveOrder);
    });

    while (needed() > available && candidates.length > 1) {
      const section = candidates.shift();
      visible.delete(section);
      panel.prepend(section);
    }

    overflow.hidden = panel.children.length === 0;
  }

  prepareTabOverflow() {
    const tabs = document.querySelector('.ribbon-tabs');
    if (!tabs || tabs.querySelector(':scope > .tab-overflow')) return;
    Array.from(tabs.querySelectorAll(':scope > .ribbon-tab')).forEach((tab, index) => {
      tab.dataset.responsiveOrder = String(index);
      tab.dataset.responsivePriority = String(TAB_PRIORITIES[tab.dataset.tab] || 2);
    });
    const overflow = document.createElement('div');
    overflow.className = 'responsive-overflow tab-overflow';
    overflow.innerHTML = `
      <button class="ribbon-tab responsive-overflow__button" type="button"
        data-responsive-overflow-button aria-expanded="false">More <i class="fas fa-chevron-down" aria-hidden="true"></i></button>
      <div class="responsive-overflow__panel" role="group" aria-label="More editor tabs"></div>`;
    tabs.appendChild(overflow);
  }

  layoutTabs() {
    const tabs = document.querySelector('.ribbon-tabs');
    const overflow = tabs?.querySelector(':scope > .tab-overflow');
    const panel = overflow?.querySelector('.responsive-overflow__panel');
    if (!tabs || !overflow || !panel || !tabs.clientWidth) return;

    Array.from(panel.children)
      .sort((a, b) => Number(a.dataset.responsiveOrder) - Number(b.dataset.responsiveOrder))
      .forEach((tab) => tabs.insertBefore(tab, overflow));
    overflow.hidden = true;

    const tabButtons = Array.from(tabs.querySelectorAll(':scope > .ribbon-tab'));
    const available = tabs.clientWidth - 32;
    let used = tabButtons.reduce((sum, tab) => sum + elementWidth(tab), 0);
    const candidates = [...tabButtons]
      .filter((tab) => !tab.classList.contains('active'))
      .sort((a, b) => {
        const priority =
          Number(b.dataset.responsivePriority) - Number(a.dataset.responsivePriority);
        return priority || Number(b.dataset.responsiveOrder) - Number(a.dataset.responsiveOrder);
      });

    while (used + 74 > available && candidates.length) {
      const tab = candidates.shift();
      used -= elementWidth(tab);
      panel.prepend(tab);
    }
    overflow.hidden = panel.children.length === 0;
  }

  closeOverflowMenus() {
    document.querySelectorAll('.responsive-overflow.is-open').forEach((host) => {
      host.classList.remove('is-open');
      host
        .querySelector('[data-responsive-overflow-button]')
        ?.setAttribute('aria-expanded', 'false');
    });
  }

  destroy() {
    window.removeEventListener('resize', this.boundSchedule);
    window.visualViewport?.removeEventListener('resize', this.boundSchedule);
    window.visualViewport?.removeEventListener('scroll', this.boundSchedule);
    this.resizeObserver?.disconnect();
    this.mutationObserver?.disconnect();
    if (this.frame) cancelAnimationFrame(this.frame);
  }
}

export { keyboardInset, layoutMode, VIEWPORT_BREAKPOINTS };
