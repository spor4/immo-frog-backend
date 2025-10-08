const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/contextLogger');

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `${uniqueId}-${sanitizedName}`;
    cb(null, fileName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['application/pdf'];
  const allowedExtensions = ['.pdf'];

  const mimeTypeValid = allowedMimeTypes.includes(file.mimetype);
  const extname = path.extname(file.originalname).toLowerCase();
  const extensionValid = allowedExtensions.includes(extname);

  if (mimeTypeValid && extensionValid) {
    logger.info(`Accepted file upload: ${file.originalname}, MIME: ${file.mimetype}, Size: ${file.size} bytes`);
    cb(null, true);
  } else {
    const error = new Error('Invalid file type. Only PDF files are allowed.');
    error.status = 415;
    logger.warn(`Rejected file upload: ${file.originalname}, MIME: ${file.mimetype}, Extension: ${extname}`);
    cb(error, false);
  }
};

const maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB || '32', 10);
const maxFileSize = maxFileSizeMB * 1024 * 1024;

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: maxFileSize,
    files: 1,
    fields: 0
  }
});

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.error(`Multer error: ${err.message}`, { code: err.code, field: err.field });

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: 'File too large',
        message: `Maximum file size is ${maxFileSizeMB}MB`,
        status: 413
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        error: 'Too many files',
        message: 'Only one file can be uploaded at a time',
        status: 400
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected field',
        message: 'File must be uploaded with field name "pdf"',
        status: 400
      });
    }

    return res.status(400).json({
      error: 'Upload error',
      message: err.message,
      status: 400
    });
  } else if (err) {
    next(err);
  } else {
    next();
  }
};

const cleanupFile = (filePath) => {
  if (!filePath) return;

  fs.unlink(filePath, (err) => {
    if (err) {
      logger.error(`Failed to delete temporary file: ${filePath}`, err);
    } else {
      logger.debug(`Deleted temporary file: ${filePath}`);
    }
  });
};

const cleanupOldFiles = () => {
  const maxAge = 15 * 60 * 1000;

  fs.readdir(uploadDir, (err, files) => {
    if (err) {
      logger.error('Error reading upload directory:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(uploadDir, file);

      fs.stat(filePath, (err, stats) => {
        if (err) {
          logger.error(`Error getting file stats for ${filePath}:`, err);
          return;
        }

        const age = Date.now() - stats.mtimeMs;
        if (age > maxAge) {
          cleanupFile(filePath);
        }
      });
    });
  });
};

setInterval(cleanupOldFiles, 5 * 60 * 1000);

module.exports = {
  upload,
  handleMulterError,
  cleanupFile
};