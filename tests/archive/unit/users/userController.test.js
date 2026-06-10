const userController = require('../../../src/users/userController');
const User = require('../../../src/users/User');
const AppError = require('../../../src/utils/AppError');

jest.mock('../../../src/users/User');
jest.mock('../../../src/utils/logger');

describe('userController', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { id: 'user123' },
      body: {},
    };
    res = {
      json: jest.fn(),
    };
    next = jest.fn();
    jest.clearAllMocks();
  });

  describe('updateProfile', () => {
    it('should update profile fields including showOnlineStatus', async () => {
      const mockUser = {
        _id: 'user123',
        profilePicture: '',
        accentColor: '#8b5cf6',
        bio: '',
        showOnlineStatus: true,
        save: jest.fn().mockResolvedValue(true),
      };

      User.findById.mockResolvedValue(mockUser);

      req.body = {
        bio: 'New bio',
        showOnlineStatus: false,
      };

      await userController.updateProfile(req, res, next);

      expect(User.findById).toHaveBeenCalledWith('user123');
      expect(mockUser.bio).toBe('New bio');
      expect(mockUser.showOnlineStatus).toBe(false);
      expect(mockUser.save).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          showOnlineStatus: false,
          bio: 'New bio',
        })
      );
    });

    it('should update profile picture string', async () => {
      const mockUser = {
        _id: 'user123',
        save: jest.fn().mockResolvedValue(true),
      };
      User.findById.mockResolvedValue(mockUser);

      req.body = {
        profilePicture: 'data:image/png;base64,mockdata',
      };

      await userController.updateProfile(req, res, next);

      expect(mockUser.profilePicture).toBe('data:image/png;base64,mockdata');
      expect(mockUser.save).toHaveBeenCalled();
    });

    it('should return 404 if user not found', async () => {
      User.findById.mockResolvedValue(null);

      await userController.updateProfile(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(next.mock.calls[0][0].statusCode).toBe(404);
    });
  });
});
