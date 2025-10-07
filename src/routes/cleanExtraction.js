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
  max: 5,
  message: 'Too many extraction requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many clean extraction requests. Please try again later.',
      status: 429
    });
  }
});

/**
 * Apply intelligent corrections based on validation findings
 * This uses the validation report to fix known issues in the extracted data
 */
function applyIntelligentCorrections(data, validation) {
  const corrected = JSON.parse(JSON.stringify(data)); // Deep clone

  if (!validation || !validation.self_verification) {
    return corrected;
  }

  const verifications = validation.self_verification.field_verifications || [];
  const criticalIssues = validation.self_verification.critical_issues || [];

  // Apply field-level corrections
  verifications.forEach(verification => {
    if (verification.status === 'INCORRECT' && verification.correct_value !== undefined) {
      applyFieldCorrection(corrected, verification.field_path, verification.correct_value);
    }

    // Remove fabricated data
    if (verification.status === 'FABRICATED') {
      applyFieldCorrection(corrected, verification.field_path, null);
      logger.info(`Removed fabricated field: ${verification.field_path}`);
    }

    // Add missing data
    if (verification.status === 'MISSING' && verification.correct_value !== undefined) {
      applyFieldCorrection(corrected, verification.field_path, verification.correct_value);
      logger.info(`Added missing field: ${verification.field_path}`);
    }
  });

  // Handle specific critical issues
  criticalIssues.forEach(issue => {
    if (issue.includes('Land area') && issue.includes('not stated')) {
      // Set land_area_sqm to null if it's fabricated
      if (corrected.property_metrics) {
        corrected.property_metrics.land_area_sqm = null;
      }
    }

    if (issue.includes('Parking area in sqm') && issue.includes('fabricated')) {
      // Remove parking_sqm if fabricated
      if (corrected.property_metrics?.breakdown_by_use) {
        corrected.property_metrics.breakdown_by_use.parking_sqm = null;
      }
    }
  });

  // Apply calculation corrections if breakdowns don't match totals
  if (validation.calculation_validation?.issues) {
    validation.calculation_validation.issues.forEach(issue => {
      if (issue.field === 'property_metrics.total_usable_area_sqm') {
        // If breakdown doesn't sum correctly, trust the stated total
        logger.info(`Area breakdown sum (${issue.difference}) doesn't match total - keeping stated total`);
      }

      if (issue.field === 'financial.total_rental_income_annual_eur') {
        // If income breakdown doesn't sum correctly, trust the stated total
        logger.info(`Income breakdown sum (${issue.difference}) doesn't match total - keeping stated total`);
      }
    });
  }

  return corrected;
}

/**
 * Apply a correction to a nested field path
 * Example: "property_identity.city" -> corrected.property_identity.city = value
 */
function applyFieldCorrection(obj, fieldPath, value) {
  const parts = fieldPath.split('.');
  let current = obj;

  // Navigate to parent object
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }

  // Set the value
  const lastPart = parts[parts.length - 1];
  current[lastPart] = value;
}

/**
 * POST /api/extract-clean
 *
 * Returns ONLY the validated, corrected data in the expected schema format.
 * No validation metadata in response body.
 *
 * Validation metadata is available in response headers:
 * - X-Confidence-Score: Overall accuracy percentage (0-100)
 * - X-Corrections-Applied: Whether corrections were made (true/false)
 * - X-Fabrications-Detected: Number of fabricated fields removed
 * - X-Validation-Issues: Number of critical issues found
 */
router.post(
  '/extract-clean',
  extractionLimiter,
  upload.single('pdf'),
  handleMulterError,
  async (req, res, next) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    let filePath = null;

    logger.info(`Starting clean extraction`, { requestId });

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
      const base64Pdf = fileBuffer.toString('base64');

      // Use validated extraction service
      const result = await validatedClaudeService.extractPropertyData(base64Pdf, true);

      // Apply intelligent corrections based on validation findings
      const cleanedData = applyIntelligentCorrections(result.data, result.validation);

      // Run schema validation on cleaned data
      const schemaValidation = validator.validatePropertyData(cleanedData);
      if (!schemaValidation.valid) {
        logger.warn('Schema validation warnings on cleaned data:', {
          requestId,
          warnings: schemaValidation.warnings,
          errors: schemaValidation.errors
        });
      }

      const processingTime = Date.now() - startTime;

      // Extract validation metrics for headers
      const confidenceScore = result.validation?.confidence_score || 0;
      const correctionsApplied = result.validation?.corrections_applied || false;
      const fabricationsDetected = result.validation?.self_verification?.verification_summary?.fabricated || 0;
      const criticalIssues = result.validation?.self_verification?.critical_issues?.length || 0;

      logger.info(`Clean extraction completed`, {
        requestId,
        processingTime: `${processingTime}ms`,
        dataType: Array.isArray(cleanedData) ? 'portfolio' : 'single_property',
        confidenceScore,
        correctionsApplied,
        fabricationsDetected,
        criticalIssues
      });

      // Set validation metadata in headers
      res.set({
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Processing-Time': `${processingTime}ms`,
        'X-Confidence-Score': confidenceScore.toString(),
        'X-Corrections-Applied': correctionsApplied.toString(),
        'X-Fabrications-Detected': fabricationsDetected.toString(),
        'X-Validation-Issues': criticalIssues.toString(),
        'X-Model': result.metadata?.model || 'unknown',
        'X-Classification': result.metadata?.classification || 'unknown'
      });

      // Return ONLY the cleaned data (no validation wrapper)
      res.json(cleanedData);

    } catch (error) {
      logger.error(`Clean extraction failed`, {
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
 * POST /api/extract-clean-with-report
 *
 * Same as /extract-clean but includes validation report in response body
 * for debugging purposes.
 *
 * Response format:
 * {
 *   "data": { ... },  // Clean data in expected schema
 *   "report": {       // Validation report (optional, only if requested)
 *     "confidence_score": 85,
 *     "corrections_applied": true,
 *     "issues_found": [...],
 *     "summary": "..."
 *   }
 * }
 */
router.post(
  '/extract-clean-with-report',
  extractionLimiter,
  upload.single('pdf'),
  handleMulterError,
  async (req, res, next) => {
    const requestId = uuidv4();
    const startTime = Date.now();
    let filePath = null;

    logger.info(`Starting clean extraction with report`, { requestId });

    try {
      if (!req.file) {
        const error = new Error('No PDF file provided. Please upload a file with field name "pdf".');
        error.status = 400;
        throw error;
      }

      filePath = req.file.path;
      const fileBuffer = await fs.readFile(filePath);
      const base64Pdf = fileBuffer.toString('base64');

      // Use validated extraction service
      const result = await validatedClaudeService.extractPropertyData(base64Pdf, true);

      // Apply intelligent corrections
      const cleanedData = applyIntelligentCorrections(result.data, result.validation);

      const processingTime = Date.now() - startTime;

      // Build simplified validation report
      const report = {
        confidence_score: result.validation?.confidence_score || 0,
        corrections_applied: result.validation?.corrections_applied || false,
        verification_summary: result.validation?.self_verification?.verification_summary || {},
        critical_issues: result.validation?.self_verification?.critical_issues || [],
        calculation_issues: result.validation?.calculation_validation?.issues || [],
        recommendation: getRecommendation(result.validation)
      };

      res.set({
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-Processing-Time': `${processingTime}ms`
      });

      res.json({
        data: cleanedData,
        report
      });

    } catch (error) {
      logger.error(`Clean extraction with report failed`, {
        requestId,
        error: error.message
      });

      next(error);

    } finally {
      if (filePath) {
        cleanupFile(filePath);
      }
    }
  }
);

/**
 * Generate a recommendation based on validation results
 */
function getRecommendation(validation) {
  if (!validation) {
    return 'No validation performed';
  }

  const confidenceScore = validation.confidence_score || 0;
  const fabrications = validation.self_verification?.verification_summary?.fabricated || 0;
  const criticalIssues = validation.self_verification?.critical_issues?.length || 0;
  const calculationIssues = validation.calculation_validation?.issues?.filter(i => i.severity === 'high').length || 0;

  if (confidenceScore < 60 || fabrications > 5 || criticalIssues > 5) {
    return 'LOW CONFIDENCE - Manual review strongly recommended. Multiple critical issues detected.';
  }

  if (confidenceScore < 75 || fabrications > 2 || criticalIssues > 2 || calculationIssues > 2) {
    return 'MEDIUM CONFIDENCE - Review recommended for critical fields (financial data, areas).';
  }

  if (confidenceScore >= 90 && fabrications === 0 && criticalIssues === 0) {
    return 'HIGH CONFIDENCE - Data appears accurate and reliable.';
  }

  return 'ACCEPTABLE CONFIDENCE - Data has been validated and corrected. Spot checks recommended.';
}

/**
 * GET endpoint - Shows usage information
 */
router.get('/extract-clean', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'This endpoint only accepts POST requests with PDF files',
    status: 405,
    usage: {
      method: 'POST',
      endpoint: '/api/extract-clean',
      contentType: 'multipart/form-data',
      field: 'pdf',
      maxFileSize: `${process.env.MAX_FILE_SIZE_MB || '32'}MB`,
      maxPages: process.env.MAX_PDF_PAGES || '100',
      description: 'Returns only validated, corrected data in expected schema format',
      responseFormat: 'JSON matching ComplexProperty or Array<PortfolioProperty> schema',
      validationMetadata: 'Available in response headers (X-Confidence-Score, X-Corrections-Applied, etc.)',
      alternativeEndpoint: '/api/extract-clean-with-report - Includes validation report in response body'
    },
    headers: {
      'X-Confidence-Score': 'Overall accuracy percentage (0-100)',
      'X-Corrections-Applied': 'Whether corrections were made (true/false)',
      'X-Fabrications-Detected': 'Number of fabricated fields removed',
      'X-Validation-Issues': 'Number of critical issues found',
      'X-Model': 'Claude model used',
      'X-Classification': 'SINGLE or PORTFOLIO'
    }
  });
});

router.get('/extract-clean-with-report', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'This endpoint only accepts POST requests with PDF files',
    status: 405,
    usage: {
      method: 'POST',
      endpoint: '/api/extract-clean-with-report',
      contentType: 'multipart/form-data',
      field: 'pdf',
      description: 'Returns validated data plus simplified validation report',
      responseFormat: {
        data: 'JSON matching ComplexProperty or Array<PortfolioProperty> schema',
        report: {
          confidence_score: 'number (0-100)',
          corrections_applied: 'boolean',
          verification_summary: 'object with correct/incorrect/fabricated counts',
          critical_issues: 'array of issue descriptions',
          calculation_issues: 'array of arithmetic inconsistencies',
          recommendation: 'string with usage guidance'
        }
      }
    }
  });
});

module.exports = router;
