const AUTH_STATES = new Set([
  'idle',
  'username-focus',
  'username-typing',
  'password-focus',
  'password-visible',
  'invalid-field',
  'submitting',
  'success',
  'error',
  'excited',
  'mad',
  'sad',
  'confused',
  'dizzy',
  'empathy',
  'hopeful',
  'expectant',
  'bored',
  'sleeping',
]);

const LOCKED_STATES = new Set(['submitting', 'success']);

// Transient reactions and how long each animation runs (ms). Several only animate child parts
// (hands, pupils, antenna), which never fire `animationend` on the rig, so a timer clears them.
const REACTION_DURATIONS = {
  'poke-left': 400,
  'poke-right': 400,
  'poke-head': 400,
  pleased: 450,
  cheer: 450,
  nod: 1000,
  annoyed: 480,
  sad: 700,
  confused: 650,
  dizzy: 1600,
  wave: 1400,
  'look-around': 1600,
  'antenna-wiggle': 900,
  'head-tilt': 1200,
  hop: 700,
  yawn: 1600,
  startle: 500,
};

const FIDGETS = ['look-around', 'antenna-wiggle', 'head-tilt', 'hop', 'double-blink'];

/**
 * SyncroBot Controller
 * High-performance interactive mascot controller with ultra-responsive eye & mouse tracking.
 */
export class SyncroBot {
  constructor(options = {}) {
    this.authFlow = options.authFlow || 'login';
    this.container = null;
    this.botRig = null;
    this.head = null;
    this.eyes = [];
    this.pupils = [];
    this.primaryState = 'idle';
    this.currentState = 'idle';
    this.focusTarget = 'none';
    this.formCompleteness = 'empty';
    this.revealedPasswords = new Set();
    this.isProcessing = false;
    this.targetElement = null;
    this.pointer = null;
    this.gaze = { x: 0, y: 0 };
    this.dragPointerId = null;
    this.dragBaseRect = null;
    this.dragSurface = null;
    this.dragSurfaceRect = null;
    this.dragOffset = { x: 0, y: 0 };
    this.dragPosition = { x: 0, y: 0 };
    this.dragOrigin = { left: 0, top: 0 };
    this.dragMoved = false;
    this.hitEye = null;
    this.eyeHitTimer = null;
    this.eyeHitDecayTimer = null;
    this.eyeHitIntensity = 0;
    this.rafId = null;
    this.blinkTimer = null;
    this.blinkEndTimer = null;
    this.typingTimer = null;
    this.idleTimer = null;
    this.sleepTimer = null;
    this.fidgetTimer = null;
    this.doubleBlinkTimer = null;
    this.reactionTimer = null;
    this.introTimers = [];
    this.mood = null;
    this.zzz = null;
    this.reaction = null;
    this.pokeCount = 0;
    this.pokeResetTimer = null;
    this.reducedMotion =
      typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    this.playsIntro = options.intro === true;
    this.isReturningUser =
      typeof options.isReturningUser === 'function' ? options.isReturningUser : () => false;
    this.random = typeof options.random === 'function' ? options.random : Math.random;

    this.config = {
      eyeMaxX: 11,
      eyeMaxY: 8,
      gazeEase: 0.12,
      blinkMinDelay: 4000,
      blinkMaxDelay: 7000,
      blinkDuration: 130,
      typingSettleDelay: 450,
      idleBoredDelay: 18000,
      idleSleepDelay: 40000,
      fidgetMinDelay: 8000,
      fidgetMaxDelay: 14000,
      introWakeDelay: 450,
      introWaveDelay: 800,
    };

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.onCharacterPress = this.onCharacterPress.bind(this);
    this.onCharacterKeydown = this.onCharacterKeydown.bind(this);
    this.onReactionEnd = this.onReactionEnd.bind(this);
    this.onWindowKeydown = this.onWindowKeydown.bind(this);
    this.tickGaze = this.tickGaze.bind(this);
  }

  get passwordVisible() {
    return this.revealedPasswords.size > 0;
  }

  init(containerSelector) {
    this.container = document.querySelector(containerSelector);
    this.botRig = this.container?.querySelector('.bot-rig') || null;
    this.head = this.container?.querySelector('.head') || null;
    this.eyes = Array.from(this.container?.querySelectorAll('.eye') || []);
    this.pupils = Array.from(this.container?.querySelectorAll('.pupil') || []);

    if (!this.container || !this.botRig || (this.eyes.length === 0 && this.pupils.length === 0)) {
      console.warn('SyncroBot: Bot elements not found');
      return false;
    }

    this.container.setAttribute('role', 'button');
    this.container.setAttribute('tabindex', '0');
    this.container.setAttribute('aria-label', 'Play with Syncrobot');
    this.botRig.setAttribute('aria-hidden', 'true');
    this.dragSurface = this.container.closest('.right-section') || this.container.parentElement;

    // Full screen cursor tracking for instant mouse following
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerleave', this.onPointerLeave, { passive: true });
    this.container.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    this.container.addEventListener('keydown', this.onCharacterKeydown);
    window.addEventListener('keydown', this.onWindowKeydown);
    this.botRig.addEventListener('animationend', this.onReactionEnd);

    this.zzz = document.createElement('span');
    this.zzz.className = 'syncro-zzz';
    this.zzz.setAttribute('aria-hidden', 'true');
    this.zzz.innerHTML = '<i>z</i><i>z</i><i>z</i>';
    this.botRig.appendChild(this.zzz);

    this.setAuthState('idle');
    this.rafId = requestAnimationFrame(this.tickGaze);
    this.startIdleTimer();
    this.scheduleFidget();
    if (this.playsIntro) this.playIntro();
    return true;
  }

  /** Wakes up, waves hello, and nods at a user whose username is already filled in. */
  playIntro() {
    if (!this.botRig || this.reducedMotion?.matches) return;
    const { introWakeDelay, introWaveDelay } = this.config;
    this.botRig.classList.add('syncro-intro');
    this.introTimers = [
      setTimeout(() => this.botRig?.classList.remove('syncro-intro'), introWakeDelay),
      setTimeout(() => this.react('wave'), introWaveDelay),
      setTimeout(
        () => {
          if (this.primaryState === 'idle' && this.isReturningUser()) this.react('nod');
        },
        introWaveDelay + REACTION_DURATIONS.wave + 150
      ),
    ];
  }

  cancelIntro() {
    this.introTimers.forEach((timer) => clearTimeout(timer));
    this.introTimers = [];
    this.botRig?.classList.remove('syncro-intro');
  }

  normalizeState(state) {
    const aliases = {
      tracking: 'username-focus',
      typing: 'username-typing',
      secure: 'password-focus',
      peeking: 'password-visible',
      processing: 'submitting',
      happy: 'excited',
      celebrate: 'excited',
      angry: 'mad',
      annoyed: 'mad',
      warn: 'confused',
      curious: 'confused',
      searching: 'confused',
      'hover-ready': this.focusTarget.includes('password') ? 'password-focus' : 'excited',
      'hover-blocked': 'invalid-field',
    };
    const normalized = aliases[state] || state;
    return AUTH_STATES.has(normalized) ? normalized : 'idle';
  }

  setAuthState(state, options = {}) {
    if (!this.botRig) return;
    const normalized = this.normalizeState(state);
    this.primaryState = normalized;
    this.currentState = normalized;
    this.targetElement = options.target || null;
    this.clearReaction();
    if (normalized !== 'idle') this.cancelIntro();

    this.botRig.dataset.syncroState = normalized;
    for (const className of Array.from(this.botRig.classList)) {
      if (className.startsWith('syncro-state--') || className.startsWith('syncro-reaction--')) {
        this.botRig.classList.remove(className);
      }
    }
    this.botRig.classList.add(`syncro-state--${normalized}`);

    if (LOCKED_STATES.has(normalized)) {
      this.clearBlinkTimer();
      this.clearIdleTimer();
      this.clearMood();
      this.botRig.classList.remove('blinking');
    } else {
      this.scheduleBlink();
      this.resetIdleTimer();
    }
  }

  applyState(state, options = {}) {
    this.setAuthState(state, options);
  }

  onPointerMove(event) {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.resetIdleTimer();
    if (this.isActivePointer(event)) this.updateDrag(event);
  }

  onPointerLeave() {
    this.pointer = null;
  }

  isActivePointer(event) {
    return this.dragPointerId !== null && this.dragPointerId === (event.pointerId ?? 'mouse');
  }

  onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;

    const baseRect = this.botRig?.getBoundingClientRect();
    const surfaceRect = this.dragSurface?.getBoundingClientRect?.();
    if (!baseRect || !surfaceRect) return;

    this.dragPointerId = event.pointerId ?? 'mouse';
    this.dragBaseRect = baseRect;
    this.dragSurfaceRect = surfaceRect;
    this.dragOrigin = {
      left: baseRect.left - this.dragPosition.x,
      top: baseRect.top - this.dragPosition.y,
    };
    this.dragOffset = {
      x: event.clientX - baseRect.left,
      y: event.clientY - baseRect.top,
    };
    this.dragMoved = false;
    this.hitEye = event.target?.closest?.('.eye') || null;
    if (this.hitEye && !this.container.contains(this.hitEye)) this.hitEye = null;
    if (this.hitEye) {
      clearTimeout(this.eyeHitTimer);
      this.eyeHitIntensity = Math.min(5, this.eyeHitIntensity + 1);
      const opacity = 0.18 + this.eyeHitIntensity * 0.1;
      this.hitEye.style.setProperty('--eye-hit-opacity', opacity.toFixed(2));
      this.hitEye.classList.add('syncro-eye--hit');
      clearTimeout(this.eyeHitDecayTimer);
      this.eyeHitDecayTimer = setTimeout(() => {
        this.eyeHitIntensity = 0;
      }, 2200);
    }

    this.container.classList.add('is-pressed');
    if (event.pointerId !== undefined) this.container.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  }

  updateDrag(event) {
    if (!this.dragBaseRect || !this.dragSurfaceRect) return;

    const distance = Math.hypot(
      event.clientX - (this.dragBaseRect.left + this.dragOffset.x),
      event.clientY - (this.dragBaseRect.top + this.dragOffset.y)
    );
    if (!this.dragMoved && distance < 4) return;
    this.dragMoved = true;
    this.container.classList.add('is-dragging');

    const surfaceRight = Number.isFinite(this.dragSurfaceRect.right)
      ? this.dragSurfaceRect.right
      : this.dragSurfaceRect.left + this.dragSurfaceRect.width;
    const surfaceBottom = Number.isFinite(this.dragSurfaceRect.bottom)
      ? this.dragSurfaceRect.bottom
      : this.dragSurfaceRect.top + this.dragSurfaceRect.height;
    const minLeft = this.dragSurfaceRect.left;
    const maxLeft = surfaceRight - this.dragBaseRect.width;
    const minTop = this.dragSurfaceRect.top;
    const maxTop = surfaceBottom - this.dragBaseRect.height;
    const nextLeft = Math.min(
      Math.max(event.clientX - this.dragOffset.x, minLeft),
      Math.max(minLeft, maxLeft)
    );
    const nextTop = Math.min(
      Math.max(event.clientY - this.dragOffset.y, minTop),
      Math.max(minTop, maxTop)
    );
    const nextX = nextLeft - this.dragOrigin.left;
    const nextY = nextTop - this.dragOrigin.top;

    this.dragPosition = { x: nextX, y: nextY };
    this.botRig.style.setProperty('--drag-x', `${nextX}px`);
    this.botRig.style.setProperty('--drag-y', `${nextY}px`);
  }

  onPointerUp(event) {
    if (!this.isActivePointer(event)) return;
    const wasDragged = this.dragMoved;
    const hitEye = this.hitEye;
    this.endPointerInteraction(event);
    this.releaseEyeHit(hitEye);
    if (!wasDragged) this.onCharacterPress(event);
  }

  onPointerCancel(event) {
    if (!this.isActivePointer(event)) return;
    const hitEye = this.hitEye;
    this.endPointerInteraction(event);
    this.releaseEyeHit(hitEye);
  }

  endPointerInteraction(event) {
    if (event?.pointerId !== undefined) this.container.releasePointerCapture?.(event.pointerId);
    this.container.classList.remove('is-pressed', 'is-dragging');
    this.dragPointerId = null;
    this.dragBaseRect = null;
    this.dragSurfaceRect = null;
    this.dragOffset = { x: 0, y: 0 };
    this.dragMoved = false;
    this.hitEye = null;
  }

  releaseEyeHit(eye) {
    if (!eye) return;
    clearTimeout(this.eyeHitTimer);
    this.eyeHitTimer = setTimeout(() => {
      eye.classList.remove('syncro-eye--hit');
      eye.style.removeProperty('--eye-hit-opacity');
    }, 650);
  }

  onCharacterPress(event) {
    if (event.button !== undefined && event.button !== 0) return;
    this.resetIdleTimer();

    this.pokeCount++;
    clearTimeout(this.pokeResetTimer);
    this.pokeResetTimer = setTimeout(() => {
      this.pokeCount = 0;
    }, 2200);

    if (this.pokeCount >= 5) {
      this.pokeCount = 0;
      this.react('dizzy');
      return;
    }

    if (this.pokeCount >= 3) {
      this.react('sad');
      return;
    }

    const rect = this.container.getBoundingClientRect();
    const isTop = event.clientY < rect.top + rect.height * 0.35;
    if (isTop) {
      this.react('confused');
      return;
    }
    this.react('annoyed');
  }

  onCharacterKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.react('pleased');
  }

  react(kind) {
    if (!this.botRig || LOCKED_STATES.has(this.primaryState)) return;
    const reaction = REACTION_DURATIONS[kind] ? kind : 'pleased';
    this.clearReaction();
    this.reaction = reaction;
    this.botRig.classList.add(`syncro-reaction--${reaction}`);
    if (this.reducedMotion?.matches) {
      queueMicrotask(() => this.clearReaction());
      return;
    }
    this.reactionTimer = setTimeout(() => this.clearReaction(), REACTION_DURATIONS[reaction] + 80);
  }

  reactExcited() {
    this.react('cheer');
  }

  reactMad() {
    this.react('annoyed');
  }

  reactSad() {
    this.setAuthState('sad');
  }

  reactConfused() {
    this.setAuthState('confused');
  }

  reactNod() {
    this.react('nod');
  }

  onReactionEnd(event) {
    if (!this.reaction || event.target !== this.botRig) return;
    this.clearReaction();
  }

  clearReaction() {
    clearTimeout(this.reactionTimer);
    this.reactionTimer = null;
    if (!this.botRig) return;
    for (const className of Array.from(this.botRig.classList)) {
      if (className.startsWith('syncro-reaction--')) this.botRig.classList.remove(className);
    }
    this.reaction = null;
  }

  resolveGazeTarget() {
    const fixed = {
      'password-focus': { x: 0, y: 0.15 },
      // Turned away from the form (left of the bot) so a revealed password stays private.
      'password-visible': { x: 0.7, y: -0.35 },
      submitting: { x: 0, y: -0.3 },
      success: { x: 0, y: -0.35 },
      error: { x: -0.4, y: 0.4 },
      sad: { x: 0, y: 0.5 },
      mad: { x: 0, y: 0 },
      confused: { x: 0.45, y: -0.2 },
      excited: { x: 0, y: -0.4 },
      dizzy: { x: 0, y: 0 },
    };
    if (fixed[this.primaryState]) return fixed[this.primaryState];

    const rect = this.botRig?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height * 0.42;

    // 1. Look at Focused Input
    if (this.targetElement?.isConnected) {
      const targetRect = this.targetElement.getBoundingClientRect();
      const targetX = targetRect.left + targetRect.width / 2;
      const targetY = targetRect.top + targetRect.height / 2;
      return {
        x: Math.max(-1, Math.min(1, (targetX - centerX) / Math.max(rect.width * 2.5, 1))),
        y: Math.max(-1, Math.min(1, (targetY - centerY) / Math.max(rect.height * 2.5, 1))),
      };
    }

    // 2. Follow User Cursor
    if (this.pointer) {
      // Use the bot's own size as the response distance so nearby pointer
      // movement produces visible iris movement instead of feeling delayed.
      const spanX = Math.max(rect.width * 1.5, 180);
      const spanY = Math.max(rect.height * 1.5, 180);
      return {
        x: Math.max(-1, Math.min(1, (this.pointer.x - centerX) / spanX)),
        y: Math.max(-1, Math.min(1, (this.pointer.y - centerY) / spanY)),
      };
    }

    return { x: 0, y: 0 };
  }

  tickGaze() {
    const target = this.resolveGazeTarget();
    const ease = this.reducedMotion?.matches ? 1 : this.config.gazeEase;
    this.gaze.x += (target.x - this.gaze.x) * ease;
    this.gaze.y += (target.y - this.gaze.y) * ease;

    const x = this.gaze.x * this.config.eyeMaxX;
    const y = this.gaze.y * this.config.eyeMaxY;
    const headRot = this.gaze.x * 5;
    const headTilt = this.gaze.y * 3;

    const targets = [...this.eyes, ...this.pupils];
    targets.forEach((el) => {
      el.style.setProperty('--pupil-x', `${x.toFixed(2)}px`);
      el.style.setProperty('--pupil-y', `${y.toFixed(2)}px`);
    });

    if (this.head && !this.reducedMotion?.matches) {
      this.head.style.setProperty('--head-rot', `${headRot.toFixed(2)}deg`);
      this.head.style.setProperty('--head-tilt', `${headTilt.toFixed(2)}px`);
    }

    this.rafId = requestAnimationFrame(this.tickGaze);
  }

  onFieldFocus(fieldName) {
    if (this.isProcessing) return;
    this.focusTarget = fieldName;
    this.resetIdleTimer();
    const input = document.activeElement?.matches?.('input, textarea')
      ? document.activeElement
      : null;
    if (this.passwordVisible) {
      this.setAuthState('password-visible');
    } else if (fieldName.toLowerCase().includes('password')) {
      this.setAuthState('password-focus');
    } else {
      this.setAuthState('username-focus', { target: input });
    }
  }

  onFieldInput(fieldName, fieldValue, validation = {}) {
    if (this.isProcessing) return;
    this.resetIdleTimer();
    const invalid = validation.isValid === false || validation.formData?._hasErrors === true;
    this.formCompleteness = invalid ? 'invalid' : fieldValue ? 'partial' : 'empty';
    this.focusTarget = fieldName;
    const input = document.activeElement?.matches?.('input, textarea')
      ? document.activeElement
      : null;

    if (this.passwordVisible) {
      this.setAuthState('password-visible');
      return;
    }
    if (invalid) {
      this.setAuthState('invalid-field', { target: input });
      return;
    }
    if (fieldName.toLowerCase().includes('password')) {
      this.setAuthState('password-focus');
      return;
    }

    this.setAuthState('username-typing', { target: input });
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      if (!this.isProcessing && this.focusTarget === fieldName) {
        this.setAuthState('username-focus', { target: input });
      }
    }, this.config.typingSettleDelay);
  }

  onFieldBlur() {
    queueMicrotask(() => {
      if (this.isProcessing || document.activeElement?.matches?.('input, textarea')) return;
      this.focusTarget = 'none';
      this.targetElement = null;
      this.setAuthState(this.passwordVisible ? 'password-visible' : 'idle');
    });
  }

  /**
   * Tracks each revealed password field. Without an input, every field is treated as hidden
   * (used when the page resets all toggles, e.g. switching between login and signup).
   */
  onPasswordToggle(visible, input = null) {
    if (!input) {
      this.revealedPasswords.clear();
    } else if (visible) {
      this.revealedPasswords.add(input);
    } else {
      this.revealedPasswords.delete(input);
    }
    if (this.isProcessing) return;

    if (this.passwordVisible) {
      this.setAuthState('password-visible');
      return;
    }
    const active = document.activeElement?.matches?.('input, textarea')
      ? document.activeElement
      : null;
    if (active?.type === 'password') {
      this.setAuthState('password-focus');
    } else if (active) {
      this.setAuthState('username-focus', { target: active });
    } else {
      this.focusTarget = 'none';
      this.setAuthState('idle');
    }
  }

  onButtonHover(active) {
    if (!active || this.isProcessing || this.focusTarget !== 'none') return;
    this.targetElement = document.activeElement?.matches?.('button')
      ? document.activeElement
      : null;
  }

  onInvalidField(element) {
    if (!this.isProcessing) {
      this.setAuthState('invalid-field', { target: element || null });
    }
  }

  onSubmit() {
    this.isProcessing = true;
    clearTimeout(this.typingTimer);
    this.setAuthState('submitting');
  }

  onSuccess() {
    this.isProcessing = false;
    this.setAuthState('success');
  }

  onError() {
    this.isProcessing = false;
    this.setAuthState('error');
  }

  scheduleBlink() {
    // Reschedule only the next blink. An active blink must keep its end timer
    // so the eyelids can reopen even when auth state changes during the blink.
    clearTimeout(this.blinkTimer);
    this.blinkTimer = null;
    const range = this.config.blinkMaxDelay - this.config.blinkMinDelay;
    this.blinkTimer = setTimeout(
      () => {
        this.triggerBlink();
        this.scheduleBlink();
      },
      this.config.blinkMinDelay + Math.floor(Math.random() * range)
    );
  }

  triggerBlink() {
    if (!this.botRig || LOCKED_STATES.has(this.primaryState)) return;
    this.botRig.classList.add('blinking');
    clearTimeout(this.blinkEndTimer);
    this.blinkEndTimer = setTimeout(() => {
      this.botRig?.classList.remove('blinking');
    }, this.config.blinkDuration);
  }

  clearBlinkTimer() {
    clearTimeout(this.blinkTimer);
    clearTimeout(this.blinkEndTimer);
    this.blinkTimer = null;
    this.blinkEndTimer = null;
  }

  startIdleTimer() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.enterMood('bored'), this.config.idleBoredDelay);
    this.sleepTimer = setTimeout(() => this.enterMood('sleeping'), this.config.idleSleepDelay);
  }

  resetIdleTimer() {
    const wasAsleep = this.mood === 'sleeping';
    this.clearMood();
    this.startIdleTimer();
    if (wasAsleep) this.react('startle');
  }

  clearIdleTimer() {
    clearTimeout(this.idleTimer);
    clearTimeout(this.sleepTimer);
    this.idleTimer = null;
    this.sleepTimer = null;
  }

  /** True when nothing is asking for the bot's attention, so it may amuse itself. */
  isUnattended() {
    return (
      this.primaryState === 'idle' &&
      !this.isProcessing &&
      this.focusTarget === 'none' &&
      !this.passwordVisible &&
      this.dragPointerId === null
    );
  }

  enterMood(mood) {
    if (!this.botRig || !this.isUnattended()) return;
    this.clearMood();
    this.mood = mood;
    this.botRig.classList.add(`syncro-mood--${mood}`);
    if (mood === 'bored') this.react('yawn');
    else this.clearReaction();
  }

  clearMood() {
    this.mood = null;
    this.botRig?.classList.remove('syncro-mood--bored', 'syncro-mood--sleeping');
  }

  onWindowKeydown() {
    this.resetIdleTimer();
  }

  scheduleFidget() {
    clearTimeout(this.fidgetTimer);
    this.fidgetTimer = null;
    if (this.reducedMotion?.matches) return;
    const { fidgetMinDelay, fidgetMaxDelay } = this.config;
    const delay = fidgetMinDelay + Math.floor(this.random() * (fidgetMaxDelay - fidgetMinDelay));
    this.fidgetTimer = setTimeout(() => {
      this.fidget();
      this.scheduleFidget();
    }, delay);
  }

  fidget() {
    if (!this.isUnattended() || this.mood || this.reaction || document.hidden) return;
    const move = FIDGETS[Math.floor(this.random() * FIDGETS.length)];
    if (move === 'double-blink') {
      this.triggerBlink();
      clearTimeout(this.doubleBlinkTimer);
      this.doubleBlinkTimer = setTimeout(() => this.triggerBlink(), 220);
      return;
    }
    this.react(move);
  }

  clearPasswordToggleTimer() {}

  destroy() {
    clearTimeout(this.typingTimer);
    clearTimeout(this.pokeResetTimer);
    clearTimeout(this.eyeHitTimer);
    clearTimeout(this.eyeHitDecayTimer);
    clearTimeout(this.fidgetTimer);
    clearTimeout(this.doubleBlinkTimer);
    clearTimeout(this.reactionTimer);
    this.cancelIntro();
    this.clearBlinkTimer();
    this.clearIdleTimer();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerleave', this.onPointerLeave);
    this.container?.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    this.container?.removeEventListener('keydown', this.onCharacterKeydown);
    window.removeEventListener('keydown', this.onWindowKeydown);
    this.botRig?.removeEventListener('animationend', this.onReactionEnd);
    this.zzz?.remove();
  }
}
