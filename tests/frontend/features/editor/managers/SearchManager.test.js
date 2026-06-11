/**
 * @jest-environment jsdom
 */

import { escapeRegExp, SearchManager } from '/js/features/editor/managers/SearchManager.js';

function createSearchManager(content) {
  document.body.innerHTML = `
    <div id="searchDialog"></div>
    <input id="findInput" />
    <input id="replaceInput" />
    <div id="searchMatchCount"></div>
  `;

  const pageMap = {
    get: jest.fn((key) => {
      if (key === 'content') {
        return {
          toString: () => content,
        };
      }
      return undefined;
    }),
  };

  return new SearchManager({
    yPages: {
      toArray: () => [pageMap],
    },
    quill: null,
  });
}

describe('SearchManager', () => {
  it.each(['.', '*', '?', '[', ']', '(', ')', '\\', '$', '+'])(
    'treats %s as a literal search term',
    (term) => {
      const manager = createSearchManager(`before ${term} after`);

      manager.search(term);

      expect(manager.matches).toHaveLength(1);
      expect(manager.matches[0]).toEqual(
        expect.objectContaining({
          index: 7,
          length: term.length,
          text: term,
        })
      );
      expect(document.getElementById('searchMatchCount').textContent).toBe('1 found');
    }
  );

  it('escapes all regular-expression metacharacters without changing the literal value', () => {
    const value = '.*?[]()\\$+';
    const regex = new RegExp(escapeRegExp(value), 'g');

    expect('prefix .*?[]()\\$+ suffix'.match(regex)).toEqual([value]);
  });
});
