import multer from 'multer';
import { matchesImageSignature } from '../utils/imageSignature.js';

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

export const orUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error('Only JPG, PNG, and WebP images are allowed.'));
    }

    callback(null, true);
  }
});

export const orUploadSingle = (req, res, next) => {
  orUpload.single('or_image')(req, res, (error) => {
    if (!error) {
      if (req.file && !matchesImageSignature(req.file.buffer, req.file.mimetype)) {
        return res.status(400).json({ message: 'The uploaded file content does not match a supported image format.' });
      }
      return next();
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Official receipt images must be 5 MB or smaller.' });
    }

    return res.status(400).json({ message: error.message || 'Invalid official receipt image.' });
  });
};
