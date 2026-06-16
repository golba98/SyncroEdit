export class Theme {
  constructor() {
    this.currentTheme = localStorage.getItem('synchroEditTheme') || 'dark';
    this.currentAccentColor = localStorage.getItem('synchroEditAccentColor') || '#3b82f6';
    this.init();
  }

  init() {
    this.applyTheme(this.currentTheme);
    this.applyAccentColor(this.currentAccentColor);
  }

  applyTheme(theme) {
    this.showThemeToast(theme === 'light' ? 'Applying Light Mode...' : 'Applying Dark Mode...');
    this.currentTheme = theme;
    localStorage.setItem('synchroEditTheme', theme);
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
      // Ensure background-specific overrides are cleared
      document.body.classList.remove('bg-code-mode');
    }
    this.updateThemeButtons();
  }

  showThemeToast(text) {
    const toast = document.getElementById('themeToast');
    const toastText = document.getElementById('themeToastText');
    if (!toast || !toastText) return;

    toastText.textContent = text;
    toast.style.display = 'block';
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.bottom = '40px';
    }, 10);

    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.bottom = '30px';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 300);
    }, 1500);
  }

  updateThemeButtons() {
    const darkBtn = document.getElementById('darkThemeBtn');
    const lightBtn = document.getElementById('lightThemeBtn');
    if (!darkBtn || !lightBtn) return;

    darkBtn.style.background = '';
    darkBtn.style.color = '';
    lightBtn.style.background = '';
    lightBtn.style.color = '';

    if (this.currentTheme === 'dark') {
      darkBtn.classList.add('active');
      lightBtn.classList.remove('active');
    } else {
      lightBtn.classList.add('active');
      darkBtn.classList.remove('active');
    }
  }

  applyAccentColor(color) {
    // Fallback if legacy rainbow value exists in local storage
    if (color === 'rainbow') color = '#39ff14';

    this.showThemeToast('Applying Accent Color...');
    this.currentAccentColor = color;
    localStorage.setItem('synchroEditAccentColor', color);

    let rgbString, lightColor, lighterColor, hexColor;

    document.body.classList.remove('theme-rainbow');
    const rgb = this.hexToRgb(color);
    if (!rgb) return;
    rgbString = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    hexColor = color;
    lightColor = this.lightenColor(color, 20);
    lighterColor = this.lightenColor(color, 40);

    document.documentElement.style.setProperty('--accent-color', hexColor);
    document.documentElement.style.setProperty('--accent-color-rgb', rgbString);
    document.documentElement.style.setProperty('--accent-color-light', lightColor);
    document.documentElement.style.setProperty('--accent-color-lighter', lighterColor);

    let styleEl = document.getElementById('accentColorStyle');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'accentColorStyle';
      document.head.appendChild(styleEl);
    }

    // Dynamic CSS generation
    styleEl.innerHTML = `
            body { background: #101418 !important; transition: background 0.2s ease-in-out !important; }
            body.light-theme { background: #f3f4f6 !important; }
            body.glow-enabled { background: #101418 !important; }
            body.light-theme.glow-enabled { background: #f3f4f6 !important; }
            
            /* Selection Highlight */
            ::selection { background-color: rgba(${rgbString}, 0.25) !important; color: inherit !important; }
            ::-moz-selection { background-color: rgba(${rgbString}, 0.25) !important; color: inherit !important; }
            body.light-theme ::selection { background-color: rgba(${rgbString}, 0.2) !important; }
            body.light-theme ::-moz-selection { background-color: rgba(${rgbString}, 0.2) !important; }

            /* Header & Logo */
            .header { border-bottom: 1px solid #2a323d !important; background: #151a20 !important; box-shadow: none !important; }
            body.light-theme .header { border-bottom: 1px solid #ced4da !important; background: #ffffff !important; backdrop-filter: none !important; box-shadow: 0 1px 3px rgba(0,0,0,0.05) !important; }
            
            .logo { color: #f3f4f6 !important; text-shadow: none !important; }
            body.light-theme .logo { color: #101418 !important; text-shadow: none !important; font-weight: 700 !important; }

            .doc-title { color: #f3f4f6 !important; text-shadow: none !important; }
            body.light-theme .doc-title { color: #101418 !important; text-shadow: none !important; font-weight: 600 !important; }
            .doc-title:focus { background: rgba(${rgbString}, 0.08) !important; box-shadow: 0 0 0 1px rgba(${rgbString}, 0.3) !important; }
            
            /* Ribbon & Tabs */
            .ribbon-tabs { border-bottom: 1px solid #2a323d !important; background: #151a20 !important; }
            body.light-theme .ribbon-tabs { border-bottom: 1px solid #ced4da !important; background: #f8f9fa !important; }

            .ribbon-tab.active { color: ${hexColor} !important; border-bottom: 2px solid ${hexColor} !important; background: transparent !important; }
            body.light-theme .ribbon-tab.active { background: #ffffff !important; color: ${hexColor} !important; border-bottom-color: ${hexColor} !important; box-shadow: none !important; }

            .ribbon-tab:hover { color: ${hexColor} !important; background: rgba(${rgbString}, 0.05) !important; }
            .ribbon-content { border-bottom: 1px solid #2a323d !important; background: #151a20 !important; box-shadow: none !important; }
            body.light-theme .ribbon-content { border-bottom: 1px solid #ced4da !important; background: #ffffff !important; box-shadow: none !important; }

            .ribbon-section { border-right-color: #2a323d !important; }
            body.light-theme .ribbon-section { border-right-color: #dee2e6 !important; }

            .ribbon-section-title { color: #7d8794 !important; border-bottom-color: #2a323d !important; }
            body.light-theme .ribbon-section-title { color: #6c757d !important; border-bottom-color: #e9ecef !important; }
            
            /* Toolbar Buttons */
            .toolbar-btn:hover { color: ${hexColor} !important; background: rgba(${rgbString}, 0.08) !important; box-shadow: none !important; }
            body.light-theme .toolbar-btn:hover { background: #f1f3f5 !important; border-color: #ced4da !important; color: #1a1a1a !important; }
            
            .toolbar-btn.active { background: rgba(${rgbString}, 0.14) !important; border-color: rgba(${rgbString}, 0.42) !important; color: ${hexColor} !important; box-shadow: none !important; }
            
            /* Editor Container & Background */
            body.light-theme .main-workspace { background: #f3f4f6 !important; }
            .pages-container { background: #0f1317 !important; }
            body.light-theme .pages-container { background: #f3f4f6 !important; }

            body.light-theme .page-scaler { 
                background: #ffffff !important;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04) !important;
            }

            /* Page Glow Overrides */
            .editor-container { background: transparent !important; border: none !important; outline: none !important; box-shadow: none !important; }
            body.light-theme .editor-container { 
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }

            .editor-container:hover { outline: none !important; box-shadow: none !important; }
            
            .editor-container.border-enabled .page-scaler { outline: 1px solid ${hexColor} !important; }
            .editor-container.border-enabled:hover .page-scaler { outline-color: ${lightColor} !important; }
            
            .editor-container.glow-effect .page-scaler { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.26) !important; }
            body.light-theme .editor-container.glow-effect .page-scaler { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06) !important; }

            .editor-container.glow-effect .page-scaler::after { display: none !important; }
            body.light-theme .editor-container.glow-effect .page-scaler::after { display: none !important; }
            
            /* Page Navigator & Status Bar */
            .page-navigator { border-bottom-color: #2a323d !important; background: #151a20 !important; }
            body.light-theme .page-navigator { border-bottom-color: #ced4da !important; background: #f8f9fa !important; }

            .page-tab.active { background: ${hexColor} !important; border-color: ${hexColor} !important; box-shadow: none !important; color: white !important; }
            
            .status-bar { border-top: 1px solid #202832 !important; background: #151a20 !important; }
            body.light-theme .status-bar { border-top: 1px solid #ced4da !important; background: #ffffff !important; box-shadow: none !important; }
            
            /* Dropdowns & Inputs */
            select, .ql-picker, .ql-align { border: 1px solid #2a323d !important; color: #f3f4f6 !important; background: #1a2028 !important; }
            body.light-theme select, body.light-theme .ql-picker, body.light-theme .ql-align { border: 1px solid #ced4da !important; color: #1f2937 !important; background: #fff !important; }

            /* Library / File Management Overrides */
            body.light-theme #docLibrary { background: #f8f9fa !important; }
            body.light-theme .doc-item { background: #ffffff !important; border: 1px solid #e9ecef !important; box-shadow: 0 2px 4px rgba(0,0,0,0.02) !important; }
            body.light-theme .doc-item:hover { border-color: ${hexColor} !important; box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important; transform: translateY(-1px) !important; }
            body.light-theme #docSearch { background: #f1f3f5 !important; border: 1px solid #ced4da !important; }
            body.light-theme #docSearch:focus { background: #fff !important; border-color: ${hexColor} !important; box-shadow: 0 0 0 2px rgba(${rgbString}, 0.1) !important; }
            
            body.light-theme .doc-title-text { color: #1a1a1a !important; font-weight: 600 !important; }
            body.light-theme .doc-meta-text { color: #6c757d !important; }
            body.light-theme .doc-icon-container i { color: #dee2e6 !important; }
            body.light-theme .doc-item:hover .doc-icon-container i { color: ${hexColor} !important; }

            body.light-theme #createNewDoc { background: #ffffff !important; border: 1px solid #dee2e6 !important; }
            body.light-theme #createNewDoc:hover { border-color: ${hexColor} !important; box-shadow: 0 4px 12px rgba(0,0,0,0.05) !important; }
            body.light-theme #createNewDoc > div { background: #f8f9fa !important; color: ${hexColor} !important; }

            /* Modals */
            #profileModal > div, #historyModal > div, #shareModal > div { 
                background: #1a2028 !important;
                border-color: #2a323d !important; 
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28) !important; 
            }
            body.light-theme #profileModal > div, body.light-theme #historyModal > div, body.light-theme #shareModal > div {
                background: #ffffff !important;
                border: 1px solid #ced4da !important;
                box-shadow: 0 12px 32px rgba(0,0,0,0.1) !important;
            }

            .profile-tab { border-bottom: 2px solid transparent !important; }
            .profile-tab.active { 
                background: transparent !important; 
                border-bottom: 2px solid ${hexColor} !important; 
                color: ${hexColor} !important;
                box-shadow: none !important;
            }
            
            /* Scrollbars */
            ::-webkit-scrollbar-thumb { background: rgba(${rgbString}, 0.3) !important; border: 1px solid rgba(${rgbString}, 0.1) !important; }
            body.light-theme ::-webkit-scrollbar-thumb { background: #ced4da !important; border: 4px solid #f8f9fa !important; }
            ::-webkit-scrollbar-thumb:hover { background: ${hexColor} !important; }

            /* Theme Toast Light Mode */
            body.light-theme #themeToast { background: rgba(255, 255, 255, 0.95) !important; border-color: #ced4da !important; box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important; }
            body.light-theme #themeToastText { color: #1a1a1a !important; }
            
            /* Color Picker Buttons */
            .accent-color-btn[data-color="${color}"] { border: 2px solid #ffffff !important; transform: scale(1.05); box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important; }
            body.light-theme .accent-color-btn[data-color="${color}"] { border: 2px solid #1a1a1a !important; box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important; }
        `;

    this.updateThemeButtons();
    window.dispatchEvent(new CustomEvent('theme-update'));
  }

  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  }

  lightenColor(hex, percent) {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return hex;
    const r = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * (percent / 100)));
    const g = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * (percent / 100)));
    const b = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * (percent / 100)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
}
