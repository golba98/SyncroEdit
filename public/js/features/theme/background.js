export class DynamicBackground {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.particles = [];
    this.mouse = { x: null, y: null, radius: 150 };
    this.resizeTimeout = null;
    this.animationFrameId = null;
    this.lastTypeTime = 0;

    // Theme Configuration
    this.currentTheme = 'dots';

    this.themes = {
      dots: {
        particleCount: 70,
        connectionDistance: 100,
        mouseDistance: 180,
        baseSpeed: 0.1,
        sizeRange: [2, 4],
        type: 'dots',
      },
      math: {
        particleCount: 40,
        mouseDistance: 250,
        baseSpeed: 0.1,
        sizeRange: [16, 28],
        type: 'math',
        symbols: ['∑', 'π', '∞', '∆', 'Ω', '√', '∫', '≈', '≠', '±', 'θ', 'λ', 'φ', '∂'],
      },
      code: {
        particleCount: 60,
        baseSpeed: 1.5,
        sizeRange: [14, 18],
        type: 'code',
        symbols: ['{ }', '</>', '[]', '=>', '++', '&&', '||', '!=', '==', '??', '::', 'asm', 'std'],
      },
      nature: {
        particleCount: 30,
        baseSpeed: 0.5,
        sizeRange: [20, 35],
        type: 'nature',
        symbols: ['🍃', '🌸', '🌼', '🍀', '🍂', '🌹', '🌺'],
      },
    };

    this.config = {
      color: 'rgba(59, 130, 246, 0.18)',
      lineColor: 'rgba(125, 135, 148, 0.12)',
    };

    this.init();
  }

  setTheme(themeName) {
    // No-op as background theme is now constant ('dots')
  }

  init() {
    // Setup Canvas
    this.canvas.id = 'dynamic-background';
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.zIndex = '0'; // Behind text but above container base
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.display = 'none';
    this.canvas.style.visibility = 'hidden';

    // cleanup existing
    const existing = document.getElementById('dynamic-background');
    if (existing) existing.remove();

    // Find workspace or fallback to body
    const target = document.querySelector('.main-workspace') || document.body;
    target.style.position = 'relative';
    // target.prepend(this.canvas); // Disabled dynamic background entirely per user request

    // Listeners
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.x;
      this.mouse.y = e.y;
    });
    window.addEventListener('mousedown', (e) => this.handleClick(e));
    window.addEventListener('mouseout', () => {
      this.mouse.x = undefined;
      this.mouse.y = undefined;
    });

    // Pulse on typing
    document.addEventListener('keydown', () => {
      this.lastTypeTime = Date.now();
    });

    this.resize();
    this.createParticles(); // Initial particles
    this.animate();

    window.addEventListener('theme-update', () => this.updateThemeColors());

    // Observer for light/dark mode
    const observer = new MutationObserver(() => this.updateThemeColors());
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    this.updateThemeColors();
  }

  handleClick(e) {
    if (this.currentTheme === 'dots') {
      this.particles.forEach((p) => {
        const dx = p.x - e.clientX;
        const dy = p.y - e.clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 300) {
          // Apply impulse as a one-time addition
          const force = (1 - dist / 300) * 0.8; // Reduced force, scales with distance
          p.directionX += (dx / dist) * force;
          p.directionY += (dy / dist) * force;
        }
      });
    }
  }

  updateThemeColors() {
    const isLight = document.body.classList.contains('light-theme');
    const isGlow = document.body.classList.contains('glow-enabled');
    const styles = getComputedStyle(document.documentElement);
    let accentRgb = styles.getPropertyValue('--accent-color-rgb').trim() || '139, 92, 246';

    if (accentRgb.includes('var(')) {
      accentRgb = '139, 92, 246';
    }

    this.isLight = isLight;
    this.accentRgb = accentRgb;

    if (isLight) {
      this.config.color = `rgba(${accentRgb}, 0.8)`;
      this.config.lineColor = `rgba(${accentRgb}, 0.4)`;
    } else {
      // Dark mode visibility tuning
      // If glow is OFF, we need higher opacity to make it pop against the flat black
      // If glow is ON, we still want it visible but maybe slightly less intense so it doesn't clash
      const dotAlpha = isGlow ? 0.7 : 0.9;
      const lineAlpha = isGlow ? 0.3 : 0.5;

      this.config.color = `rgba(${accentRgb}, ${dotAlpha})`;
      this.config.lineColor = `rgba(${accentRgb}, ${lineAlpha})`;
    }
  }

  handleResize() {
    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
    this.resizeTimeout = setTimeout(() => {
      this.resize();
      this.createParticles();
    }, 100);
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  createParticles() {
    this.particles = [];
    const theme = this.themes[this.currentTheme] ||
      this.themes.dots || {
        particleCount: 40,
        connectionDistance: 100,
        mouseDistance: 180,
        baseSpeed: 0.1,
        sizeRange: [1, 3],
        type: 'dots',
      };

    if (!this.themes[this.currentTheme]) {
      console.warn('[THEME] Missing background theme, using fallback', {
        requestedTheme: this.currentTheme,
      });
    }

    for (let i = 0; i < theme.particleCount; i++) {
      const size = Math.random() * (theme.sizeRange[1] - theme.sizeRange[0]) + theme.sizeRange[0];
      const x = Math.random() * this.canvas.width;
      const y = Math.random() * this.canvas.height;

      const baseDirX = (Math.random() * 2 - 1) * theme.baseSpeed;
      const baseDirY = (Math.random() * 2 - 1) * theme.baseSpeed;

      const p = {
        x,
        y,
        size,
        baseX: x,
        baseY: y,
        directionX: baseDirX,
        directionY: baseDirY,
        baseDirX: baseDirX, // Store original calm drift direction
        baseDirY: baseDirY, // Store original calm drift direction
        angle: Math.random() * Math.PI * 2,
        angleSpeed: (Math.random() - 0.5) * 0.01,
        phase: Math.random() * Math.PI * 2,
        orbitRadius: 20 + Math.random() * 30,
        flicker: 0,
        parallax: (size - theme.sizeRange[0]) / (theme.sizeRange[1] - theme.sizeRange[0]) + 0.5,
      };

      if (theme.symbols) {
        p.symbol = theme.symbols[Math.floor(Math.random() * theme.symbols.length)];
      }

      this.particles.push(p);
    }
  }

  animate() {
    if (!this.canvas.parentElement || this.canvas.style.display === 'none') return;
    this.animationFrameId = requestAnimationFrame(() => this.animate());
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Reset canvas state to prevent persistence from other themes
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';
    this.ctx.globalAlpha = 1.0;

    const theme = this.themes[this.currentTheme];
    const now = Date.now();
    const typePulse = Math.max(0, 1 - (now - this.lastTypeTime) / 1000);

    for (let i = 0; i < this.particles.length; i++) {
      let p = this.particles[i];

      switch (this.currentTheme) {
        case 'math':
          // Drifting orbital movement
          p.phase += 0.003;
          p.x += Math.cos(p.phase) * 0.3 + p.directionX;
          p.y += Math.sin(p.phase) * 0.3 + p.directionY;

          this.ctx.save();
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate(p.angle + typePulse * 0.5);
          this.ctx.font = `${p.size}px "Times New Roman"`;

          // Aesthetic Glow
          this.ctx.shadowBlur = this.isLight ? 2 : 15;
          this.ctx.shadowColor = `rgba(${this.accentRgb}, ${0.2 + typePulse * 0.4})`;

          // Parse base alpha from config to respect visibility settings
          const alphaMatch = this.config.color.match(/[\d.]+\)$/);
          const baseAlpha = alphaMatch ? parseFloat(alphaMatch[0]) : this.isLight ? 0.2 : 0.4;

          // Apply pulse on top of base visibility
          const currentAlpha = Math.min(1, baseAlpha + typePulse * 0.2);

          this.ctx.fillStyle = this.isLight
            ? `rgba(0, 0, 0, ${currentAlpha})`
            : `rgba(${this.accentRgb}, ${currentAlpha})`;

          this.ctx.fillText(p.symbol, 0, 0);
          this.ctx.restore();
          p.angle += p.angleSpeed;
          break;

        case 'code':
          // Digital Rain style
          p.y += p.directionY * (p.size / 12);
          if (p.y > this.canvas.height + 50) {
            p.y = -50;
            p.x = Math.random() * this.canvas.width;
          }

          if (Math.random() < 0.02) p.flicker = 20;
          let codeAlpha = p.flicker > 0 ? 0.6 : 0.25;
          if (p.flicker > 0) p.flicker--;

          this.ctx.font = `bold ${p.size}px monospace`;
          this.ctx.shadowBlur = p.flicker > 0 ? 10 : 0;
          this.ctx.shadowColor = `rgba(${this.accentRgb}, 0.5)`;
          this.ctx.fillStyle = this.isLight
            ? `rgba(0, 0, 0, ${codeAlpha})`
            : `rgba(${this.accentRgb}, ${codeAlpha})`;
          this.ctx.fillText(p.symbol, p.x, p.y);
          break;

        case 'nature':
          // Elegant leaf/flower drift
          p.phase += 0.005;
          p.y += theme.baseSpeed * p.parallax;
          p.x += Math.sin(p.phase) * 1.2;
          p.angle += p.angleSpeed * 2;

          if (p.y > this.canvas.height + 50) {
            p.y = -50;
            p.x = Math.random() * this.canvas.width;
          }

          this.ctx.save();
          this.ctx.translate(p.x, p.y);
          this.ctx.rotate(p.angle);
          this.ctx.font = `${p.size}px Arial`;
          this.ctx.globalAlpha = this.isLight ? 0.5 : 0.35;
          this.ctx.shadowBlur = 5;
          this.ctx.shadowColor = 'rgba(0,0,0,0.1)';
          this.ctx.fillText(p.symbol, 0, 0);
          this.ctx.restore();
          break;

        case 'dots':
          // original calm drift speed and direction
          const dampingFactor = 0.96; // Smooth deceleration
          const returnSpeed = 0.02; // How quickly to return to base direction

          // Apply damping to slow down the particle
          p.directionX *= dampingFactor;
          p.directionY *= dampingFactor;

          // Gradually return to base calm drift direction
          p.directionX += (p.baseDirX - p.directionX) * returnSpeed;
          p.directionY += (p.baseDirY - p.directionY) * returnSpeed;

          p.x += p.directionX;
          p.y += p.directionY;

          if (p.x > this.canvas.width || p.x < 0) p.directionX = -p.directionX;
          if (p.y > this.canvas.height || p.y < 0) p.directionY = -p.directionY;

          // Draw sophisticated dot
          this.ctx.beginPath();
          this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          const dotGrad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);

          // Final safety check: if for any reason the color string is invalid, fallback to hardcoded
          let finalColor = this.config.color;
          if (!finalColor || typeof finalColor !== 'string' || finalColor.includes('var(')) {
            finalColor = this.isLight ? 'rgba(139, 92, 246, 0.4)' : `rgba(${this.accentRgb}, 0.6)`;
          }

          dotGrad.addColorStop(0, finalColor);
          dotGrad.addColorStop(1, 'transparent');
          this.ctx.fillStyle = dotGrad;
          this.ctx.fill();

          for (let j = i + 1; j < this.particles.length; j++) {
            let p2 = this.particles[j];
            let dist = Math.sqrt((p.x - p2.x) ** 2 + (p.y - p2.y) ** 2);
            if (dist < theme.connectionDistance) {
              this.ctx.beginPath();
              const alphaMatch = this.config.lineColor.match(/[\d.]+\)$/);
              const baseAlpha = alphaMatch ? parseFloat(alphaMatch[0]) : 0.3;
              const lineAlpha = (1 - dist / theme.connectionDistance) * baseAlpha;

              this.ctx.strokeStyle = this.isLight
                ? `rgba(0, 0, 0, ${lineAlpha})`
                : `rgba(${this.accentRgb}, ${lineAlpha})`;
              this.ctx.lineWidth = 0.8;
              this.ctx.moveTo(p.x, p.y);
              this.ctx.lineTo(p2.x, p2.y);
              this.ctx.stroke();
            }
          }
          break;
      }

      if (p.x < -100) p.x = this.canvas.width + 100;
      if (p.x > this.canvas.width + 100) p.x = -100;
      if (p.y < -100) p.y = this.canvas.height + 100;
      if (p.y > this.canvas.height + 100) p.y = -100;
    }
  }
}
