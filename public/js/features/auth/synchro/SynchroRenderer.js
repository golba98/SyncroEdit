/**
 * SynchroRenderer - Handles visual rendering, particles, and DOM manipulation
 */
export class SynchroRenderer {
  constructor(container) {
    this.container = container;
    this.botRig = container.querySelector('.bot-rig') || container.querySelector('#botRig');
    this.activeParticles = [];
    this.particleInterval = null;
  }

  /**
   * Create and manage particle effects
   */
  createParticle(type) {
    const particle = document.createElement('div');
    particle.className = `synchro-particle particle-${type}`;

    switch (type) {
      case 'zzz':
        particle.textContent = 'Z';
        particle.style.cssText = `
          position: absolute;
          color: rgba(139, 92, 246, 0.6);
          font-weight: bold;
          font-size: ${12 + Math.random() * 8}px;
          opacity: 0;
          animation: floatZ 2.5s ease-out forwards;
          left: ${60 + Math.random() * 20}%;
          top: -10px;
          pointer-events: none;
          z-index: 200;
        `;
        break;

      case 'question':
        particle.textContent = '?';
        particle.style.cssText = `
          position: absolute;
          color: #ffd700;
          font-weight: bold;
          font-size: 20px;
          animation: questionPop 1s ease-out forwards;
          right: -20px;
          top: -30px;
          pointer-events: none;
          z-index: 200;
          text-shadow: 0 0 10px #ffd700;
        `;
        break;

      case 'sigh':
        particle.textContent = '💨';
        particle.style.cssText = `
          position: absolute;
          font-size: 16px;
          opacity: 0;
          animation: sighFloat 1.5s ease-out forwards;
          left: 50%;
          bottom: -10px;
          pointer-events: none;
          z-index: 200;
          transform: translateX(-50%);
        `;
        break;

      case 'star':
        particle.textContent = '⭐';
        particle.style.cssText = `
          position: absolute;
          font-size: ${10 + Math.random() * 10}px;
          opacity: 0;
          animation: starBurst 0.8s ease-out forwards;
          left: ${30 + Math.random() * 40}%;
          top: ${20 + Math.random() * 40}%;
          pointer-events: none;
          z-index: 200;
        `;
        break;

      case 'heart':
        particle.textContent = '💜';
        particle.style.cssText = `
          position: absolute;
          font-size: 14px;
          opacity: 0;
          animation: heartFloat 1.5s ease-out forwards;
          left: ${40 + Math.random() * 20}%;
          top: 0;
          pointer-events: none;
          z-index: 200;
        `;
        break;
    }

    this.botRig.appendChild(particle);
    this.activeParticles.push(particle);

    // Auto-remove after animation
    const duration = parseFloat(particle.style.animation?.match(/(\d+\.?\d*)s/)?.[1] || 2) * 1000;
    setTimeout(() => this.removeParticle(particle), duration);

    return particle;
  }

  /**
   * Start continuous particle emission
   */
  startParticleLoop(type, interval = 2000) {
    this.stopParticleLoop();
    this.createParticle(type);
    this.particleInterval = setInterval(() => this.createParticle(type), interval);
  }

  /**
   * Stop particle emission
   */
  stopParticleLoop() {
    if (this.particleInterval) {
      clearInterval(this.particleInterval);
      this.particleInterval = null;
    }
  }

  /**
   * Remove a specific particle
   */
  removeParticle(particle) {
    if (particle.parentNode) {
      particle.remove();
    }
    this.activeParticles = this.activeParticles.filter((p) => p !== particle);
  }

  /**
   * Clear all particles
   */
  clearAllParticles() {
    this.stopParticleLoop();
    this.activeParticles.forEach((p) => p.remove());
    this.activeParticles = [];
  }

  /**
   * Burst effect (multiple particles at once)
   */
  burst(type, count = 5) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.createParticle(type), i * 100);
    }
  }

  /**
   * Update antenna color
   */
  setAntennaColor(color) {
    const antenna = this.botRig.querySelector('.antenna-bulb');
    if (!antenna) return;

    const colors = {
      purple: { bg: '#8b5cf6', glow: '#8b5cf6' },
      blue: { bg: '#3b82f6', glow: '#3b82f6' },
      green: { bg: '#10b981', glow: '#10b981' },
      yellow: { bg: '#fbbf24', glow: '#fbbf24' },
      red: { bg: '#ef4444', glow: '#ef4444' },
      off: { bg: '#333', glow: 'transparent' },
    };

    const c = colors[color] || colors.purple;
    antenna.style.background = c.bg;
    antenna.style.boxShadow = `0 0 15px ${c.glow}`;
  }

  /**
   * Trigger knock animation
   */
  knock() {
    const hand = this.botRig.querySelector('.hand.right');
    if (!hand) return;

    hand.classList.add('knocking');
    setTimeout(() => hand.classList.remove('knocking'), 600);
  }

  /**
   * Trigger specific animation
   */
  playAnimation(name) {
    switch (name) {
      case 'knock':
        this.knock();
        break;
      case 'celebrate':
        this.burst('star', 8);
        break;
      case 'paperPlane':
        // Custom paper plane animation
        this.createParticle('star');
        break;
      case 'shake':
        // Handled by CSS
        break;
    }
  }

  /**
   * Inject required particle animation CSS if not present
   */
  injectParticleCSS() {
    if (document.getElementById('synchro-particle-styles')) return;

    const style = document.createElement('style');
    style.id = 'synchro-particle-styles';
    style.textContent = `
      @keyframes floatZ {
        0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
        20% { opacity: 0.8; }
        100% { transform: translate(20px, -60px) scale(1.2); opacity: 0; }
      }

      @keyframes questionPop {
        0% { transform: scale(0); opacity: 0; }
        50% { transform: scale(1.3); opacity: 1; }
        100% { transform: scale(1); opacity: 0; }
      }

      @keyframes sighFloat {
        0% { transform: translateX(-50%) scale(0.5); opacity: 0; }
        30% { opacity: 0.8; }
        100% { transform: translateX(-50%) translateY(-30px) scale(1.2); opacity: 0; }
      }

      @keyframes starBurst {
        0% { transform: scale(0); opacity: 0; }
        50% { transform: scale(1.5); opacity: 1; }
        100% { transform: scale(0.5) translateY(-30px); opacity: 0; }
      }

      @keyframes heartFloat {
        0% { transform: translateY(0) scale(0); opacity: 0; }
        30% { transform: scale(1); opacity: 1; }
        100% { transform: translateY(-40px); opacity: 0; }
      }

      .hand.knocking {
        animation: knockKnock 0.6s ease;
      }

      @keyframes knockKnock {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(5px); }
        50% { transform: translateX(-3px); }
        75% { transform: translateX(5px); }
      }
    `;
    document.head.appendChild(style);
  }
}

export default SynchroRenderer;
