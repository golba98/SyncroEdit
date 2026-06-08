/**
 * @jest-environment jsdom
 */

import { SynchroBot } from '../../../public/js/features/auth/synchro/SynchroBot.js';

describe('SynchroBot polish', () => {
  let synchro;
  let requestAnimationFrameMock;
  let cancelAnimationFrameMock;

  beforeEach(() => {
    jest.useFakeTimers();

    document.body.innerHTML = `
      <div class="character-container">
        <div class="bot-rig" id="botRig">
          <div class="eye left"><div class="pupil"></div></div>
          <div class="eye right"><div class="pupil"></div></div>
          <div class="eyelid top"></div>
          <div class="eyelid bottom"></div>
        </div>
      </div>
      <input id="loginUsername" />
    `;

    requestAnimationFrameMock = jest.fn((cb) => setTimeout(() => cb(performance.now()), 16));
    cancelAnimationFrameMock = jest.fn((id) => clearTimeout(id));
    global.requestAnimationFrame = requestAnimationFrameMock;
    global.cancelAnimationFrame = cancelAnimationFrameMock;

    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.id === 'loginUsername') {
        return {
          x: 20,
          y: 120,
          left: 20,
          top: 120,
          width: 180,
          height: 40,
          right: 200,
          bottom: 160,
          toJSON: () => {},
        };
      }

      if (this.classList?.contains('eye')) {
        const isLeft = this.classList.contains('left');
        return {
          x: isLeft ? 180 : 220,
          y: 100,
          left: isLeft ? 180 : 220,
          top: 100,
          width: 32,
          height: 40,
          right: isLeft ? 212 : 252,
          bottom: 140,
          toJSON: () => {},
        };
      }

      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        right: 0,
        bottom: 0,
        toJSON: () => {},
      };
    });

    synchro = new SynchroBot({ authFlow: 'login' });
    expect(synchro.init('.character-container')).toBe(true);
  });

  afterEach(() => {
    synchro?.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete global.requestAnimationFrame;
    delete global.cancelAnimationFrame;
  });

  test('blinks and returns to the resting eye state', () => {
    synchro.triggerBlink();
    expect(document.getElementById('botRig').classList.contains('blinking')).toBe(true);

    jest.advanceTimersByTime(synchro.config.blinkDuration);

    expect(document.getElementById('botRig').classList.contains('blinking')).toBe(false);
  });

  test('keeps refreshing the focused input target while tracking', () => {
    const trackSpy = jest.spyOn(synchro, 'trackElement');

    synchro.setTargetElement(document.getElementById('loginUsername'));

    expect(trackSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(32);

    expect(trackSpy.mock.calls.length).toBeGreaterThan(1);
    expect(document.querySelector('.eye.left .pupil').style.transform).toContain('calc(-50% +');
  });

  test('centers the pupils again when focus is lost', () => {
    synchro.setTargetElement(document.getElementById('loginUsername'));
    jest.advanceTimersByTime(16);

    synchro.onFieldBlur();

    expect(document.querySelectorAll('.pupil')[0].style.transform).toBe('translate(-50%, -50%)');
    expect(document.querySelectorAll('.pupil')[1].style.transform).toBe('translate(-50%, -50%)');
  });
});
