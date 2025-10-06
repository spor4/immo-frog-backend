const express = require('express');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const { upload, handleMulterError, cleanupFile } = require('../middleware/upload');
const validatedClaudeService = require('../services/validatedClaudeService');
const validator = require('../utils/validator');
const logger = require('../utils/logger');

const router = express.Router();

const extractionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5, // Lower limit due to multiple API calls per request
  message: 'Too many extraction requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many validated extraction requests. Please try again later.',
      status: 429
    });
  }
});

/**
 * POST /api/extract-property-data-validated
 *
 * Enhanced extraction endpoint with multi-pass validation:
 * 1. Initial extraction with source attribution
 * 2. Self-verification by re-reading the document
 * 3. Correction pass if errors found
 * 4. Programmatic calculation validation
 *
 * Query parameters:
 * - validate=true (default): Enable full validation
 * - validate=false: Skip validation passes (faster, less accurate)
 */
router.post(
  '/extract-property-data-validated',
  extractionLimiter,
  upload.single('pdf'),
  handleMulterError,
  async (req, res, next) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    let filePath = null;

    logger.info(`Starting validated property data extraction`, { requestId });

    try {
      if (!req.file) {
        const error = new Error('No PDF file provided. Please upload a file with field name "pdf".');
        error.status = 400;
        throw error;
      }

      const enableValidation = req.query.validate !== 'false';

      filePath = req.file.path;
      logger.info(`Processing file: ${req.file.originalname}`, {
        requestId,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        validationEnabled: enableValidation
      });

      const fileBuffer = await fs.readFile(filePath);
      const base64Pdf = fileBuffer.toString('base64');

      logger.info(`PDF converted to base64, starting validated extraction`, { requestId });

      // Use validated extraction service
      const result = await validatedClaudeService.extractPropertyData(base64Pdf, enableValidation);

      // Run additional validation
      const validationResult = validator.validatePropertyData(result.data);
      if (!validationResult.valid) {
        logger.warn('Schema validation warnings:', {
          requestId,
          warnings: validationResult.warnings
        });
      }

      const processingTime = Date.now() - startTime;
      logger.info(`Validated extraction completed`, {
        requestId,
        processingTime: `${processingTime}ms`,
        dataType: Array.isArray(result.data) ? 'portfolio' : 'single_property',
        validationEnabled: enableValidation,
        confidenceScore: result.validation?.confidence_score,
        correctionsApplied: result.validation?.corrections_applied
      });

      res.set({
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Processing-Time': `${processingTime}ms`,
        'X-Validation-Enabled': enableValidation.toString(),
        'X-Confidence-Score': result.validation?.confidence_score?.toString() || 'N/A'
      });

      // Structure response based on validation mode
      if (enableValidation) {
        res.json({
          data: result.data,
          validation: {
            ...result.validation,
            schema_validation: validationResult
          },
          metadata: {
            ...result.metadata,
            processingTime,
            requestId
          }
        });
      } else {
        // Simplified response when validation is disabled
        res.json(result.data);
      }

    } catch (error) {
      logger.error(`Validated extraction failed`, {
        requestId,
        error: error.message,
        stack: error.stack
      });

      if (error.code === 'ENOENT') {
        error.status = 500;
        error.message = 'Uploaded file was not found or could not be processed.';
      }

      next(error);

    } finally {
      if (filePath) {
        cleanupFile(filePath);
      }
    }
  }
);

/**
 * GET endpoint - Shows usage information
 */
router.get('/extract-property-data-validated', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'This endpoint only accepts POST requests with PDF files',
    status: 405,
    usage: {
      method: 'POST',
      contentType: 'multipart/form-data',
      field: 'pdf',
      maxFileSize: `${process.env.MAX_FILE_SIZE_MB || '32'}MB`,
      maxPages: process.env.MAX_PDF_PAGES || '100',
      queryParameters: {
        validate: 'true (default) | false - Enable/disable multi-pass validation'
      },
      validationPasses: [
        '1. Initial extraction with source attribution',
        '2. Self-verification by re-reading document',
        '3. Correction pass (if errors found)',
        '4. Programmatic calculation validation'
      ],
      responseFields: {
        data: 'Extracted property data',
        validation: {
          self_verification: 'Field-by-field verification results',
          calculation_validation: 'Arithmetic consistency checks',
          confidence_score: 'Overall accuracy percentage (0-100)',
          corrections_applied: 'Whether corrections were needed'
        },
        metadata: {
          model: 'Claude model used',
          classification: 'SINGLE or PORTFOLIO',
          validation_passes: 'Number of validation passes performed',
          processingTime: 'Total processing time in ms'
        }
      }
    }
  });
});

module.exports = router;
