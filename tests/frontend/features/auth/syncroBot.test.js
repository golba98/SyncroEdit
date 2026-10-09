/**
 * @jest-environment jsdom
 */

import { SyncroBot } from '/js/features/auth/syncro/SyncroBot.js';

function renderBot() {
  document.body.innerHTML = `
    <section class="right-section">
      <div class="character-container">
        <div class="bot-rig">
          <div class="antenna-stalk"></div><div class="antenna-bulb"></div>
          <div class="head"><div class="face-screen">
            <div class="eyes-container">
              <div class="eye"><div class="eyelid top"></div><div class="pupil"></div><div class="eyelid bottom"></div></div>
              <div class="eye"><div class="eyelid top"></div><div class="pupil"></div><div class="eyelid bottom"></div></div>
            </div><div class="mouth"></div>
          </div></div>
          <div class="hands-container"><div class="hand left"></div><div class="hand right"></div></div>
        </div>
      </div>
    </section>
    <input id="email" />
    <input id="password" type="password" />
  `;
  document.querySelector('.bot-rig').getBoundingClientRect = () => ({
    left: 500,
    top: 200,
    width: 160,
    height: 176,
  });
  document.querySelector('.character-container').getBoundingClientRect = () => ({
    left: 430,
    top: 140,
    width: 300,
    height: 300,
  });
  document.querySelector('.right-section').getBoundingClientRect = () => ({
    left: 400,
    top: 0,
    width: 500,
    height: 500,
    right: 900,
    bottom: 500,
  });
}

describe('SyncroBot', () => {
  let bot;
  let animationFrameSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    renderBot();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    animationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    bot = new SyncroBot();
    bot.init('.character-container');
  });

  afterEach(() => {
    bot.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('maintains exactly one authoritative auth state class', () => {
    bot.setAuthState('username-focus', {
      target: document.getElementById('email'),
    });
    bot.setAuthState('password-focus');
    const stateClasses = Array.from(bot.botRig.classList).filter((name) =>
      name.startsWith('syncro-state--')
    );

    expect(bot.botRig.dataset.syncroState).toBe('password-focus');
    expect(stateClasses).toEqual(['syncro-state--password-focus']);
  });

  it('supports full emotional state suite (excited, mad, sad, confused, dizzy)', () => {
    bot.setAuthState('excited');
    expect(bot.botRig.dataset.syncroState).toBe('excited');
    expect(bot.botRig.classList.contains('syncro-state--excited')).toBe(true);

    bot.setAuthState('mad');
    expect(bot.botRig.dataset.syncroState).toBe('mad');
    expect(bot.botRig.classList.contains('syncro-state--mad')).toBe(true);

    bot.setAuthState('sad');
    expect(bot.botRig.dataset.syncroState).toBe('sad');
    expect(bot.botRig.classList.contains('syncro-state--sad')).toBe(true);

    bot.setAuthState('confused');
    expect(bot.botRig.dataset.syncroState).toBe('confused');
    expect(bot.botRig.classList.contains('syncro-state--confused')).toBe(true);

    bot.setAuthState('dizzy');
    expect(bot.botRig.dataset.syncroState).toBe('dizzy');
    expect(bot.botRig.classList.contains('syncro-state--dizzy')).toBe(true);
  });

  it('interpolates pupil gaze toward pointer movement', () => {
    bot.onPointerMove({ clientX: 760, clientY: 260 });
    bot.tickGaze();

    expect(bot.gaze.x).toBeGreaterThan(0);
    expect(bot.pupils[0].style.getPropertyValue('--pupil-x')).not.toBe('0.00px');
    expect(animationFrameSpy).toHaveBeenCalled();
  });

  it('moves the iris farther for a farther pointer target', () => {
    bot.gaze.x = 0;
    bot.onPointerMove({ clientX: 620, clientY: 260 });
    const nearTarget = bot.resolveGazeTarget().x;

    bot.onPointerMove({ clientX: 760, clientY: 260 });
    const farTarget = bot.resolveGazeTarget().x;

    expect(farTarget).toBeGreaterThan(nearTarget);
  });

  it('always ends a blink when the next blink is scheduled', () => {
    bot.triggerBlink();
    expect(bot.botRig.classList.contains('blinking')).toBe(true);

    bot.scheduleBlink();
    jest.advanceTimersByTime(bot.config.blinkDuration);

    expect(bot.botRig.classList.contains('blinking')).toBe(false);
  });

  it('lets field state override pointer gaze', () => {
    const email = document.getElementById('email');
    email.getBoundingClientRect = () => ({
      left: 30,
      top: 300,
      width: 240,
      height: 48,
    });
    email.focus();
    bot.onPointerMove({ clientX: 900, clientY: 200 });
    bot.onFieldFocus('email');

    const target = bot.resolveGazeTarget();
    expect(target.x).toBeLessThan(0);
  });

  it('maps hits to contextual transient emotions', () => {
    // Head hit -> confused
    bot.onCharacterPress({ button: 0, clientX: 580, clientY: 150 });
    expect(bot.botRig.classList.contains('syncro-reaction--confused')).toBe(true);

    // Cheek hit -> annoyed
    bot.onCharacterPress({ button: 0, clientX: 450, clientY: 250 });
    expect(bot.botRig.classList.contains('syncro-reaction--annoyed')).toBe(true);

    // Repeated hits escalate to sad
    bot.onCharacterPress({ button: 0, clientX: 700, clientY: 250 });
    expect(bot.botRig.classList.contains('syncro-reaction--sad')).toBe(true);
    expect(bot.botRig.dataset.syncroState).toBe('idle');

    bot.onCharacterPress({ button: 0, clientX: 700, clientY: 250 });
    expect(bot.botRig.classList.contains('syncro-reaction--sad')).toBe(true);
  });

  it('marks a poked eye red and clears it after release', () => {
    const eye = bot.eyes[0];
    bot.onPointerDown({
      button: 0,
      clientX: 540,
      clientY: 250,
      pointerId: 1,
      target: eye,
      preventDefault: jest.fn(),
    });

    expect(eye.classList.contains('syncro-eye--hit')).toBe(true);

    bot.onPointerUp({ button: 0, clientX: 540, clientY: 250, pointerId: 1 });
    jest.advanceTimersByTime(650);

    expect(eye.classList.contains('syncro-eye--hit')).toBe(false);
  });

  it('increases eye redness across repeated hits', () => {
    const eye = bot.eyes[0];
    const press = (pointerId) =>
      bot.onPointerDown({
        button: 0,
        clientX: 540,
        clientY: 250,
        pointerId,
        target: eye,
        preventDefault: jest.fn(),
      });

    press(3);
    const firstOpacity = Number(eye.style.getPropertyValue('--eye-hit-opacity'));
    bot.onPointerUp({ button: 0, clientX: 540, clientY: 250, pointerId: 3 });
    press(4);
    const secondOpacity = Number(eye.style.getPropertyValue('--eye-hit-opacity'));

    expect(secondOpacity).toBeGreaterThan(firstOpacity);
  });

  it('drags the character and clamps it inside the black panel', () => {
    bot.onPointerDown({
      button: 0,
      clientX: 580,
      clientY: 250,
      pointerId: 2,
      target: bot.botRig,
      preventDefault: jest.fn(),
    });
    bot.onPointerMove({ clientX: 1000, clientY: 1000, pointerId: 2 });

    expect(bot.botRig.style.getPropertyValue('--drag-x')).toBe('240px');
    expect(bot.botRig.style.getPropertyValue('--drag-y')).toBe('124px');

    bot.onPointerUp({ button: 0, clientX: 1000, clientY: 1000, pointerId: 2 });
    expect(bot.botRig.classList.contains('syncro-reaction--annoyed')).toBe(false);
    expect(bot.dragPosition).toEqual({ x: 240, y: 124 });
  });

  it('triggers dizzy reaction when poked rapidly 5+ times', () => {
    for (let i = 0; i < 5; i++) {
      bot.onCharacterPress({ button: 0, clientX: 580, clientY: 250 });
    }
    expect(bot.botRig.classList.contains('syncro-reaction--dizzy')).toBe(true);
  });

  it('plays a bounded tap reaction and cancels it for submitting', () => {
    bot.onCharacterPress({ button: 0, clientX: 450, clientY: 250 });
    expect(bot.botRig.classList.contains('syncro-reaction--annoyed')).toBe(true);

    bot.onSubmit();
    expect(bot.botRig.dataset.syncroState).toBe('submitting');
    expect(
      Array.from(bot.botRig.classList).some((name) => name.startsWith('syncro-reaction--'))
    ).toBe(false);

    bot.react('pleased');
    expect(
      Array.from(bot.botRig.classList).some((name) => name.startsWith('syncro-reaction--'))
    ).toBe(false);
  });

  it('exposes the character as a keyboard-operable playful control', () => {
    expect(bot.container.getAttribute('role')).toBe('button');
    expect(bot.container.tabIndex).toBe(0);
    bot.onCharacterKeydown({ key: 'Enter', preventDefault: jest.fn() });
    expect(bot.botRig.classList.contains('syncro-reaction--pleased')).toBe(true);
  });

  describe('password privacy', () => {
    it('keeps its eyes covered and turned away after a revealed password loses focus', () => {
      const password = document.getElementById('password');
      password.focus();
      bot.onFieldFocus('password');
      bot.onPasswordToggle(true, password);

      password.blur();
      bot.onFieldBlur();
      jest.runAllTicks();
      bot.onPointerMove({ clientX: 100, clientY: 300 });

      expect(bot.botRig.dataset.syncroState).toBe('password-visible');
      expect(bot.resolveGazeTarget().x).toBeGreaterThan(0);
    });

    it('does not look at other fields while a password is revealed', () => {
      const email = document.getElementById('email');
      bot.onPasswordToggle(true, document.getElementById('password'));

      email.focus();
      bot.onFieldFocus('email');
      bot.onFieldInput('email', 'someone', { isValid: false });

      expect(bot.botRig.dataset.syncroState).toBe('password-visible');
    });

    it('goes back to idle once the password is hidden and nothing is focused', () => {
      const password = document.getElementById('password');
      bot.onPasswordToggle(true, password);
      bot.onPasswordToggle(false, password);

      expect(bot.passwordVisible).toBe(false);
      expect(bot.botRig.dataset.syncroState).toBe('idle');
    });

    it('treats a reset without an input as hiding every password', () => {
      bot.onPasswordToggle(true, document.getElementById('password'));
      bot.onPasswordToggle(false);

      expect(bot.passwordVisible).toBe(false);
      expect(bot.botRig.dataset.syncroState).toBe('idle');
    });
  });

  describe('intro', () => {
    const startWithIntro = (options = {}) => {
      bot.destroy();
      renderBot();
      bot = new SyncroBot({ intro: true, ...options });
      bot.init('.character-container');
    };

    it('wakes up, then waves', () => {
      startWithIntro();
      expect(bot.botRig.classList.contains('syncro-intro')).toBe(true);

      jest.advanceTimersByTime(bot.config.introWakeDelay);
      expect(bot.botRig.classList.contains('syncro-intro')).toBe(false);

      jest.advanceTimersByTime(bot.config.introWaveDelay - bot.config.introWakeDelay);
      expect(bot.botRig.classList.contains('syncro-reaction--wave')).toBe(true);
    });

    it('nods at a returning user after waving', () => {
      startWithIntro({ isReturningUser: () => true });
      jest.advanceTimersByTime(3000);

      expect(bot.botRig.classList.contains('syncro-reaction--nod')).toBe(true);
    });

    it('does not nod when nobody is remembered', () => {
      startWithIntro({ isReturningUser: () => false });
      jest.advanceTimersByTime(3000);

      expect(bot.botRig.classList.contains('syncro-reaction--nod')).toBe(false);
    });

    it('stops the intro as soon as the user focuses a field', () => {
      startWithIntro();
      bot.setAuthState('username-focus');
      jest.advanceTimersByTime(3000);

      expect(bot.botRig.classList.contains('syncro-intro')).toBe(false);
      expect(bot.botRig.classList.contains('syncro-reaction--wave')).toBe(false);
    });

    it('is skipped for reduced motion', () => {
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });
      startWithIntro();

      expect(bot.botRig.classList.contains('syncro-intro')).toBe(false);
    });
  });

  describe('idle life', () => {
    const startWithRandom = (value) => {
      bot.destroy();
      renderBot();
      bot = new SyncroBot({ random: () => value });
      bot.init('.character-container');
    };

    it('fidgets on its own when left alone', () => {
      startWithRandom(0); // shortest delay, first fidget (look-around)
      jest.advanceTimersByTime(bot.config.fidgetMinDelay);

      expect(bot.botRig.classList.contains('syncro-reaction--look-around')).toBe(true);
    });

    it('does not fidget while a password is revealed', () => {
      startWithRandom(0);
      bot.onPasswordToggle(true, document.getElementById('password'));
      jest.advanceTimersByTime(bot.config.fidgetMinDelay);

      expect(
        Array.from(bot.botRig.classList).some((name) => name.startsWith('syncro-reaction--'))
      ).toBe(false);
    });

    it('gets bored, falls asleep, and startles awake on activity', () => {
      jest.advanceTimersByTime(bot.config.idleBoredDelay);
      expect(bot.botRig.classList.contains('syncro-mood--bored')).toBe(true);
      expect(bot.botRig.classList.contains('syncro-reaction--yawn')).toBe(true);

      jest.advanceTimersByTime(bot.config.idleSleepDelay - bot.config.idleBoredDelay);
      expect(bot.botRig.classList.contains('syncro-mood--sleeping')).toBe(true);
      expect(bot.botRig.classList.contains('syncro-mood--bored')).toBe(false);
      expect(bot.botRig.querySelectorAll('.syncro-zzz i')).toHaveLength(3);

      bot.onPointerMove({ clientX: 600, clientY: 260 });
      expect(bot.botRig.classList.contains('syncro-mood--sleeping')).toBe(false);
      expect(bot.botRig.classList.contains('syncro-reaction--startle')).toBe(true);
    });

    it('wakes on a key press too', () => {
      jest.advanceTimersByTime(bot.config.idleSleepDelay);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(bot.botRig.classList.contains('syncro-mood--sleeping')).toBe(false);
    });

    it('keeps a single auth state class while in a mood', () => {
      jest.advanceTimersByTime(bot.config.idleSleepDelay);
      const stateClasses = Array.from(bot.botRig.classList).filter((name) =>
        name.startsWith('syncro-state--')
      );

      expect(stateClasses).toEqual(['syncro-state--idle']);
    });

    it('clears transient reactions that only animate child parts', () => {
      bot.react('wave');
      jest.advanceTimersByTime(2000);

      expect(bot.reaction).toBe(null);
      expect(bot.botRig.classList.contains('syncro-reaction--wave')).toBe(false);
    });
  });
});
