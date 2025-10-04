const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const { upload, handleMulterError, cleanupFile } = require('../middleware/upload');
const claudeService = require('../services/claudeService');
const validator = require('../utils/validator');
const logger = require('../utils/logger');

const router = express.Router();

const extractionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many extraction requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many extraction requests. Please try again later.',
      status: 429
    });
  }
});

router.post(
  '/extract-property-data',
  extractionLimiter,
  upload.single('pdf'),
  handleMulterError,
  async (req, res, next) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    let filePath = null;

    logger.info(`Starting property data extraction`, { requestId });

    try {
      if (!req.file) {
        const error = new Error('No PDF file provided. Please upload a file with field name "pdf".');
        error.status = 400;
        throw error;
      }

      filePath = req.file.path;
      logger.info(`Processing file: ${req.file.originalname}`, {
        requestId,
        fileSize: req.file.size,
        mimeType: req.file.mimetype
      });

      const fileBuffer = await fs.readFile(filePath);

      logger.info(`Validating PDF structure`, { requestId });
      const pdfData = await pdfParse(fileBuffer, {
        max: 100,
        version: 'v2.0.550'
      });

      if (pdfData.info && pdfData.info.IsAcroFormPresent) {
        const error = new Error('Password-protected or encrypted PDFs are not supported.');
        error.status = 422;
        error.source = 'pdf-validation';
        throw error;
      }

      const pageCount = pdfData.numpages || 0;
      const maxPages = parseInt(process.env.MAX_PDF_PAGES || '100', 10);

      if (pageCount > maxPages) {
        const error = new Error(`PDF exceeds maximum page limit. Found ${pageCount} pages, maximum is ${maxPages}.`);
        error.status = 422;
        error.source = 'pdf-validation';
        error.details = { pageCount, maxPages };
        throw error;
      }

      logger.info(`PDF validation successful`, {
        requestId,
        pageCount,
        textLength: pdfData.text ? pdfData.text.length : 0
      });

      const base64Pdf = fileBuffer.toString('base64');
      logger.info(`PDF converted to base64, size: ${base64Pdf.length} characters`, { requestId });

      const extractedData = await claudeService.extractPropertyData(base64Pdf);

      const validationResult = validator.validatePropertyData(extractedData);
      if (!validationResult.valid) {
        logger.warn('Extracted data validation warnings:', {
          requestId,
          warnings: validationResult.warnings
        });
      }

      const processingTime = Date.now() - startTime;
      logger.info(`Property data extraction completed successfully`, {
        requestId,
        processingTime: `${processingTime}ms`,
        dataType: Array.isArray(extractedData) ? 'portfolio' : 'single_property'
      });

      res.set({
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Processing-Time': `${processingTime}ms`
      });

      res.json(extractedData);

    } catch (error) {
      logger.error(`Property data extraction failed`, {
        requestId,
        error: error.message,
        stack: error.stack
      });

      if (error.code === 'ENOENT') {
        error.status = 500;
        error.message = 'Uploaded file was not found or could not be processed.';
      }

      if (error.message && error.message.includes('PDF damaged')) {
        error.status = 422;
        error.source = 'pdf-validation';
        error.message = 'The PDF file appears to be damaged or corrupted.';
      }

      next(error);

    } finally {
      if (filePath) {
        cleanupFile(filePath);
      }
    }
  }
);

router.get('/extract-property-data', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'This endpoint only accepts POST requests with PDF files',
    status: 405,
    usage: {
      method: 'POST',
      contentType: 'multipart/form-data',
      field: 'pdf',
      maxFileSize: `${process.env.MAX_FILE_SIZE_MB || '32'}MB`,
      maxPages: process.env.MAX_PDF_PAGES || '100'
    }
  });
});

module.exports = router;