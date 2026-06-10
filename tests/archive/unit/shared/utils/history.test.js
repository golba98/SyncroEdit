const { logHistory } = require('../../../../src/utils/history');
const History = require('../../../../src/documents/History');

jest.mock('../../../../src/documents/History');
jest.mock('../../../../src/utils/logger');

describe('History Utils Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create new history entry for normal actions', async () => {
    const mockSave = jest.fn();
    History.mockImplementation(() => ({
      save: mockSave,
    }));

    await logHistory('doc1', 'user1', 'User', 'Created Document');

    expect(History).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'Created Document',
      })
    );
    expect(mockSave).toHaveBeenCalled();
  });

  it('should update existing entry if "Edited Page" happened recently (Debounce)', async () => {
    const mockSave = jest.fn();
    const mockEntry = {
      timestamp: new Date(),
      save: mockSave,
    };

    History.findOne.mockReturnValue({
      sort: jest.fn().mockResolvedValue(mockEntry),
    });

    await logHistory('doc1', 'user1', 'User', 'Edited Page 1');

    // Should not create new
    expect(History).not.toHaveBeenCalled();
    // Should save existing
    expect(mockSave).toHaveBeenCalled();
  });
});
