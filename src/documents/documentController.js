const Document = require('./Document');
const User = require('../users/User');
const History = require('./History');
const { logHistory } = require('../utils/history');
const { notifyDocumentDeleted } = require('./socket');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

exports.getDocuments = async (req, res, next) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  const user = await User.findById(userId).select('recentDocuments').lean();

  const query = {
    $or: [
      { owner: userId },
      { sharedWith: userId },
      {
        $and: [{ _id: { $in: user ? user.recentDocuments : [] } }, { isPublic: true }],
      },
    ],
  };

  const totalDocuments = await Document.countDocuments(query);
  const documents = await Document.find(query)
    .select('title lastModified lastModifiedBy pages owner sharedWith')
    .populate('lastModifiedBy', 'username')
    .sort({ lastModified: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Add ownership status to each document
  const documentsWithStatus = documents.map((doc) => ({
    ...doc,
    isOwner: doc.owner.toString() === userId,
    isShared: doc.sharedWith && doc.sharedWith.some((id) => id.toString() === userId),
  }));

  res.json({
    documents: documentsWithStatus,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(totalDocuments / limit),
      totalDocuments,
      hasNextPage: page * limit < totalDocuments,
      hasPrevPage: page > 1,
    },
  });
};

exports.addToRecent = async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user) return next(new AppError('User not found', 404));

  const docId = req.params.id;
  const doc = await Document.findById(docId).select('owner sharedWith isPublic').lean();
  if (!doc) return next(new AppError('Document not found', 404));

  const isOwner = doc.owner.toString() === req.user.id;
  const isShared = doc.sharedWith && doc.sharedWith.some((id) => id.toString() === req.user.id);

  if (!isOwner && !isShared && !doc.isPublic) {
    return next(new AppError('Access denied', 403));
  }

  if (!user.recentDocuments) user.recentDocuments = [];

  const index = user.recentDocuments.findIndex((id) => id.toString() === docId);
  if (index > -1) {
    user.recentDocuments.splice(index, 1);
  }
  user.recentDocuments.unshift(docId);

  if (user.recentDocuments.length > 20) {
    user.recentDocuments.pop();
  }

  await user.save();
  res.json({ message: 'Added to recent' });
};

exports.updateSettings = async (req, res, next) => {
  const docId = req.params.id;
  const { isPublic } = req.body;

  const doc = await Document.findById(docId);
  if (!doc) return next(new AppError('Document not found', 404));

  if (doc.owner.toString() !== req.user.id) {
    return next(new AppError('Access denied. Only owner can change settings.', 403));
  }

  // Robust boolean conversion
  if (isPublic === true || isPublic === 'true') {
    doc.isPublic = true;
  } else if (isPublic === false || isPublic === 'false') {
    doc.isPublic = false;
  }

  await doc.save();
  logger.info(`Document settings updated: ${docId} isPublic=${doc.isPublic} by ${req.user.id}`);

  res.json({
    message: 'Settings updated',
    isPublic: doc.isPublic,
  });
};

exports.getSettings = async (req, res, next) => {
  const docId = req.params.id;
  const doc = await Document.findById(docId).select('owner sharedWith isPublic').lean();

  if (!doc) return next(new AppError('Document not found', 404));

  const isOwner = doc.owner.toString() === req.user.id;
  const isShared = doc.sharedWith && doc.sharedWith.some((id) => id.toString() === req.user.id);

  // Even if public, we might want to restrict *viewing settings* to owner/collaborators?
  // Or at least allow reading "isPublic" if you have access.
  if (!isOwner && !isShared && !doc.isPublic) {
    return next(new AppError('Access denied', 403));
  }

  res.json({
    isPublic: doc.isPublic || false,
    isOwner,
    isShared,
  });
};

exports.createDocument = async (req, res, next) => {
  const doc = new Document({
    owner: req.user.id,
    title: req.body.title || 'Untitled document',
    pages: req.body.pages || [{ content: '' }],
  });
  await doc.save();

  logHistory(doc._id, req.user.id, req.user.username, 'Created Document');

  logger.info(`Document created: ${doc._id} by ${req.user.id}`);
  res.status(201).json(doc);
};

exports.deleteDocument = async (req, res, next) => {
  const docId = req.params.id;
  const doc = await Document.findById(docId);

  if (!doc) {
    // Check if it's in recent docs to remove it (cleanup)
    const user = await User.findById(req.user.id);
    if (user && user.recentDocuments) {
      const index = user.recentDocuments.findIndex((id) => id.toString() === docId);
      if (index > -1) {
        user.recentDocuments.splice(index, 1);
        await user.save();
        return res.json({ message: 'Removed from recent', action: 'removed' });
      }
    }
    return next(new AppError('Document not found', 404));
  }

  const isOwner = doc.owner.toString() === req.user.id;
  const isShared = doc.sharedWith && doc.sharedWith.some((id) => id.toString() === req.user.id);

  // If user is not the owner but has shared access, remove from recent only
  if (!isOwner && isShared) {
    const user = await User.findById(req.user.id);
    if (user && user.recentDocuments) {
      const index = user.recentDocuments.findIndex((id) => id.toString() === docId);
      if (index > -1) {
        user.recentDocuments.splice(index, 1);
        await user.save();
      }
    }
    logger.info(`Document removed from drive: ${docId} by ${req.user.id}`);
    return res.json({ message: 'Removed from your drive', action: 'removed' });
  }

  // Only owner can permanently delete
  if (!isOwner) {
    return next(new AppError('Only the document owner can delete this document', 403));
  }

  await doc.deleteOne();

  notifyDocumentDeleted(docId);

  await History.deleteMany({ documentId: docId });

  logger.info(`Document deleted: ${docId} by ${req.user.id}`);
  res.json({ message: 'Document deleted', action: 'deleted' });
};

exports.getHistory = async (req, res, next) => {
  const docId = req.params.id;
  const doc = await Document.findById(docId).select('owner sharedWith').lean();
  if (!doc) return next(new AppError('Document not found', 404));

  const isOwner = doc.owner.toString() === req.user.id;
  const isShared = doc.sharedWith && doc.sharedWith.some((id) => id.toString() === req.user.id);

  if (!isOwner && !isShared) {
    return next(new AppError('Access denied', 403));
  }

  const history = await History.find({ documentId: docId })
    .sort({ timestamp: -1 })
    .limit(50)
    .lean();

  res.json(history);
};

exports.transferOwnership = async (req, res, next) => {
  const docId = req.params.id;
  const { newOwnerUsername } = req.body;

  if (!newOwnerUsername) {
    return next(new AppError('New owner username is required', 400));
  }

  if (typeof newOwnerUsername !== 'string') {
    return next(new AppError('New owner username must be a string', 400));
  }

  const doc = await Document.findById(docId);
  if (!doc) return next(new AppError('Document not found', 404));

  if (doc.owner.toString() !== req.user.id) {
    return next(new AppError('Access denied. Only the owner can transfer ownership.', 403));
  }

  const newOwner = await User.findOne({ username: newOwnerUsername });
  if (!newOwner) {
    return next(new AppError('User not found', 404));
  }

  if (newOwner._id.toString() === req.user.id) {
    return next(new AppError('You are already the owner of this document', 400));
  }

  // Transfer ownership
  doc.owner = newOwner._id;

  // Add old owner to sharedWith if not already there, so they don't lose access immediately
  if (!doc.sharedWith.includes(req.user.id)) {
    doc.sharedWith.push(req.user.id);
  }

  // Remove new owner from sharedWith if they were there (cleanup)
  doc.sharedWith = doc.sharedWith.filter((id) => id.toString() !== newOwner._id.toString());

  await doc.save();

  logHistory(
    doc._id,
    req.user.id,
    req.user.username,
    `Transferred ownership to ${newOwnerUsername}`
  );
  logger.info(
    `Document ownership transferred: ${docId} from ${req.user.username} to ${newOwnerUsername}`
  );

  res.json({ message: `Ownership transferred to ${newOwnerUsername}` });
};

exports.getDocumentInfo = async (req, res, next) => {
  const docId = req.params.id;
  const doc = await Document.findById(docId).select('owner sharedWith title').lean();

  if (!doc) return next(new AppError('Document not found', 404));

  const isOwner = doc.owner.toString() === req.user.id;
  const isShared = doc.sharedWith && doc.sharedWith.some((id) => id.toString() === req.user.id);

  if (!isOwner && !isShared) {
    return next(new AppError('Access denied', 403));
  }

  res.json({
    title: doc.title,
    isOwner,
    isShared,
  });
};
