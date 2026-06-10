/**
 * @jest-environment jsdom
 */

import { BorderManager } from '/js/features/editor/managers/BorderManager.js';

// Mock utils
jest.mock('/js/app/utils.js', () => ({
  ptToPx: jest.fn((pt) => parseFloat(pt)), // Simple 1:1 mapping for easy math
}));

describe('BorderManager', () => {
  let editorMock;
  let borderManager;

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="borderNone"></button>
      <button id="borderBox"></button>
      <button id="borderShadow"></button>
      <button id="border3D"></button>
      <select id="borderStyleSelect">
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
      </select>
      <select id="borderWidthSelect">
        <option value="1pt">1pt</option>
        <option value="2pt">2pt</option>
      </select>
      <input type="color" id="borderColorPicker" />
      <button id="borderColorBtn"></button>
      <div id="borderColorIndicator"></div>
      
      <!-- Target Element -->
      <div class="page-border-inner"></div>
    `;

    editorMock = {
      onContentChange: jest.fn(),
    };

    borderManager = new BorderManager(editorMock);
    borderManager.init();
  });

  it('should update border style on selection change', () => {
    const select = document.getElementById('borderStyleSelect');
    select.value = 'dashed';
    select.dispatchEvent(new Event('change'));

    expect(borderManager.currentBorderStyle).toBe('dashed');
    expect(editorMock.onContentChange).toHaveBeenCalledWith('update-borders', expect.anything());
  });

  it('should apply border styles to elements', () => {
    // Set state
    borderManager.currentBorderType = 'box';
    borderManager.currentBorderStyle = 'solid';
    borderManager.currentBorderWidth = '2pt';
    borderManager.currentBorderColor = 'red';

    const element = document.querySelector('.page-border-inner');
    borderManager.applyBorderToElement(element);

    expect(element.style.border).toBe('2px solid red');
  });

  it('should handle "none" border type', () => {
    const btn = document.getElementById('borderNone');
    btn.click();

    expect(borderManager.currentBorderType).toBe('none');

    const element = document.querySelector('.page-border-inner');
    expect(element.style.border).toBe('');
  });

  it('should not trigger content change if fromServer is true', () => {
    borderManager.updateBorders('dotted', '1pt', 'blue', 'box', true);
    expect(editorMock.onContentChange).not.toHaveBeenCalled();
  });
});
