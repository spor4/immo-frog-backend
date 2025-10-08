const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/contextLogger');
const { getContext } = require('../middleware/correlationContext');
const complexSchema = require('../schemas/complexSchema.json');
const portfolioSchema = require('../schemas/portfolioSchema.json');

// Helper function to calculate API costs
function calculateCost(usage) {
  const inputCost = (usage.input_tokens / 1_000_000) * 3.0;  // $3/MTok
  const outputCost = (usage.output_tokens / 1_000_000) * 15.0; // $15/MTok
  return parseFloat((inputCost + outputCost).toFixed(4));
}

/**
 * Enhanced Claude Service with Three-Pass Validation Architecture
 *
 * Based on Anthropic's "Building Effective Agents" patterns:
 * 1. Initial Extraction Pass - Extract data with source attribution
 * 2. Self-Verification Pass - Agent re-reads document to verify claims
 * 3. Calculation Validation - Programmatic checks for arithmetic consistency
 *
 * This follows the "Evaluator-Optimizer" pattern where one LLM extracts
 * and another evaluates/corrects the output.
 */
class ValidatedClaudeService {
  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
  }

  getClassificationPrompt() {
    return `You are analyzing a German real estate exposé (property listing document).

Your task is to determine whether this document describes:
- SINGLE: One complex property (possibly with multiple uses, addresses, or components, but it's ONE property)
- PORTFOLIO: Multiple separate properties that could be sold individually

Classification criteria:

Classify as SINGLE when:
- Document describes one building complex with multiple addresses
- Mixed-use property with integrated components (e.g., retail + residential in same building)
- Single purchase price for entire complex
- Shared infrastructure (parking, utilities, management)
- One land plot (Grundstück) number or contiguous land
- Described as "Objekt" (singular) not "Objekte" (plural)
- One overall property name/identifier

Classify as PORTFOLIO when:
- Multiple distinct properties at completely different locations
- Separate building IDs or names that indicate independence (e.g., "Building A", "Building B")
- Individual property metrics listed in separate tables
- Properties that can be sold separately
- Different construction years per building indicating separate developments
- Separate land plots (Flurstücke) per property
- Multiple property addresses that are geographically separate

Respond with ONLY one word: either "SINGLE" or "PORTFOLIO"`;
  }

  getExtractionPromptWithSourceAttribution(propertyType) {
    const baseRules = `CRITICAL EXTRACTION RULES - READ CAREFULLY:

1. SOURCE ATTRIBUTION (MANDATORY):
   - You MUST include page numbers and specific locations for EVERY extracted value
   - Format: "value extracted from page X, section Y, table Z"
   - If you cannot find a value in the document, mark it as null - DO NOT GUESS

2. DIFFERENTIATE vs AGGREGATE:
   - "Baujahr" in a table header = construction year of that specific building/section
   - Look for EARLIEST construction year across all buildings
   - Modernization years are SEPARATE from original construction
   - Tables often show BREAKDOWNS not totals - you must SUM them

3. CALCULATION TRANSPARENCY:
   - When summing values, list each component: "A + B + C = Total"
   - Show your arithmetic so it can be verified
   - If values don't add up, flag it as uncertain

4. LOCATION ACCURACY:
   - Extract EXACT text from document for city names
   - Do not combine/modify city names (e.g., "Ingolstadt" not "Gaimersheim/Ingolstadt")
   - Only include what's explicitly stated

5. NEVER FABRICATE:
   - If land area (Grundstück) column is empty, mark as null
   - If parking spaces aren't listed, mark as null
   - Missing data is better than wrong data

6. NUMBER FORMATS:
   - Convert German formats: "1.234,56" → 1234.56
   - Verify sums match totals shown in document
   - Round appropriately (areas to whole numbers, money to cents)`;

    if (propertyType === 'SINGLE') {
      return `${baseRules}

SINGLE PROPERTY EXTRACTION:
- Extract ALL numerical values with their locations
- For mixed-use properties, sum ALL sections for totals
- Verify your totals match or explain discrepancies
- Look for multiple tables that need to be combined

You MUST use the extract_complex_property tool to return the data.`;
    } else {
      return `${baseRules}

PORTFOLIO EXTRACTION:
- Create one array item per distinct property
- Extract ALL properties from the document
- Each property must cite where its data came from
- Never duplicate or skip properties

You MUST use the extract_portfolio_properties tool to return the data.`;
    }
  }

  getVerificationPrompt(extractedData, propertyType) {
    return `You are a DATA VERIFICATION AGENT. Your job is to check the accuracy of extracted data.

ORIGINAL EXTRACTION RESULT:
${JSON.stringify(extractedData, null, 2)}

Your task:
1. Re-read the PDF document carefully
2. Verify EACH numeric value against the source document
3. Check all calculations (sums, totals, breakdowns)
4. Identify any discrepancies, hallucinations, or errors

For EACH field, respond with:
- ✓ CORRECT: Value matches document
- ✗ INCORRECT: Value differs from document (provide correct value and source)
- ? UNCERTAIN: Cannot verify (explain why)
- ⚠ MISSING: Field is null but data exists in document
- ⚡ FABRICATED: Field has data but doesn't exist in document

Pay special attention to:
- Sums and breakdowns (do the parts add up to the total?)
- City names (exact match to document?)
- Construction years (earliest vs individual building years)
- Empty vs missing fields (is null appropriate?)
- Calculation errors (office area, rental income, etc.)

Return a JSON object with this structure:
{
  "verification_summary": {
    "total_fields_checked": number,
    "correct": number,
    "incorrect": number,
    "uncertain": number,
    "missing": number,
    "fabricated": number,
    "overall_accuracy_percent": number
  },
  "field_verifications": [
    {
      "field_path": "property_identity.city",
      "status": "CORRECT|INCORRECT|UNCERTAIN|MISSING|FABRICATED",
      "extracted_value": any,
      "correct_value": any,
      "source_location": "page X, section Y",
      "notes": "explanation"
    }
  ],
  "calculation_checks": [
    {
      "description": "Office area calculation",
      "extracted_total": number,
      "component_sum": "BV14: X + BV16: Y + LK02: Z = Total",
      "is_correct": boolean,
      "discrepancy": number
    }
  ],
  "critical_issues": ["list of serious errors that must be fixed"],
  "confidence_score": number
}`;
  }

  getCorrectionPrompt(extractedData, verificationResult, propertyType) {
    return `You are a DATA CORRECTION AGENT. Based on verification findings, correct the extracted data.

ORIGINAL EXTRACTION:
${JSON.stringify(extractedData, null, 2)}

VERIFICATION FINDINGS:
${JSON.stringify(verificationResult, null, 2)}

Your task:
1. Apply all corrections identified in the verification
2. Fix calculation errors
3. Remove fabricated data (set to null)
4. Add missing data that exists in the document
5. Re-verify your corrections against the source PDF

Return the CORRECTED data using the ${propertyType === 'SINGLE' ? 'extract_complex_property' : 'extract_portfolio_properties'} tool.

IMPORTANT: Only include data that you can verify exists in the document. When in doubt, use null.`;
  }

  async extractPropertyData(pdfBase64, enableValidation = true) {
    try {
      const context = getContext();
      logger.info('Starting validated extraction process', {
        enableValidation,
        pdfSizeKB: Math.round(pdfBase64.length / 1024)
      });
      const startTime = Date.now();

      // STEP 1: Classify the document type
      logger.info('Classification pass started', {
        stage: 'classification',
        pdfSizeKB: Math.round(pdfBase64.length / 1024)
      });
      const classifyStart = Date.now();
      const classificationResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: this.getClassificationPrompt() },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64
                }
              }
            ]
          }
        ]
      });

      const classificationType = this.extractTextFromResponse(classificationResponse).trim();

      logger.info('Classification pass completed', {
        stage: 'classification',
        result: classificationType,
        inputTokens: classificationResponse.usage.input_tokens,
        outputTokens: classificationResponse.usage.output_tokens,
        cost: calculateCost(classificationResponse.usage),
        durationMs: Date.now() - classifyStart
      });

      if (classificationType !== 'SINGLE' && classificationType !== 'PORTFOLIO') {
        throw new Error(`Invalid classification result: ${classificationType}`);
      }

      const tool = classificationType === 'SINGLE' ? {
        name: "extract_complex_property",
        description: "Extract structured information about a single complex property from the exposé",
        input_schema: complexSchema
      } : {
        name: "extract_portfolio_properties",
        description: "Extract structured information about multiple properties from the exposé",
        input_schema: portfolioSchema
      };

      // STEP 2: Initial extraction with source attribution
      logger.info('Extraction pass started', {
        stage: 'extraction',
        documentType: classificationType,
        schema: classificationType === 'SINGLE' ? 'complex' : 'portfolio'
      });
      const extractStart = Date.now();
      const extractionResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        temperature: 0,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: this.getExtractionPromptWithSourceAttribution(classificationType) },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64
                }
              }
            ]
          }
        ]
      });

      const toolUse = extractionResponse.content.find(block => block.type === 'tool_use');
      if (!toolUse || !toolUse.input) {
        throw new Error('No tool use found in extraction response');
      }

      let extractedData = toolUse.input;

      logger.info('Extraction pass completed', {
        stage: 'extraction',
        fieldsExtracted: this.countExtractedFields(extractedData),
        inputTokens: extractionResponse.usage.input_tokens,
        outputTokens: extractionResponse.usage.output_tokens,
        cost: calculateCost(extractionResponse.usage),
        durationMs: Date.now() - extractStart
      });

      if (!enableValidation) {
        logger.info('Validation disabled, returning initial extraction');
        return {
          data: extractedData,
          validation: null,
          processingTime: Date.now() - startTime
        };
      }

      // STEP 3: Self-verification pass
      logger.info('Verification pass started', {
        stage: 'verification'
      });
      const verifyStart = Date.now();
      const verificationResponse = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: this.getVerificationPrompt(extractedData, classificationType) },
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64
                }
              }
            ]
          }
        ]
      });

      const verificationText = this.extractTextFromResponse(verificationResponse);
      let verificationResult;

      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = verificationText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) ||
                         verificationText.match(/(\{[\s\S]*\})/);
        verificationResult = JSON.parse(jsonMatch ? jsonMatch[1] : verificationText);
      } catch (parseError) {
        logger.warn('Failed to parse verification result as JSON', { error: parseError.message });
        verificationResult = { error: 'Failed to parse verification', raw: verificationText };
      }

      const verificationSummary = {
        correct: verificationResult.verification_summary?.correct || 0,
        incorrect: verificationResult.verification_summary?.incorrect || 0,
        fabricated: verificationResult.verification_summary?.fabricated || 0,
        accuracyPercent: verificationResult.verification_summary?.overall_accuracy_percent || 0
      };

      logger.info('Verification pass completed', {
        stage: 'verification',
        ...verificationSummary,
        criticalIssuesCount: verificationResult.critical_issues?.length || 0,
        inputTokens: verificationResponse.usage.input_tokens,
        outputTokens: verificationResponse.usage.output_tokens,
        cost: calculateCost(verificationResponse.usage),
        durationMs: Date.now() - verifyStart
      });

      if (verificationSummary.fabricated > 0) {
        logger.warn('Hallucinations detected', {
          stage: 'verification',
          fabricatedCount: verificationSummary.fabricated,
          fabricatedFields: verificationResult.fabricated_fields || []
        });
      }

      // STEP 4: Apply corrections if needed
      let finalData = extractedData;
      let correctionResponse = null;
      const hasErrors = verificationResult.verification_summary?.incorrect > 0 ||
                       verificationResult.verification_summary?.fabricated > 0 ||
                       verificationResult.critical_issues?.length > 0;

      if (hasErrors) {
        logger.info('Correction pass started', {
          stage: 'correction',
          issuesCount: verificationResult.verification_summary?.incorrect + verificationResult.verification_summary?.fabricated
        });
        const correctStart = Date.now();
        correctionResponse = await this.client.messages.create({
          model: this.model,
          max_tokens: 8192,
          temperature: 0,
          tools: [tool],
          tool_choice: { type: "tool", name: tool.name },
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: this.getCorrectionPrompt(extractedData, verificationResult, classificationType) },
                {
                  type: "document",
                  source: {
                    type: "base64",
                    media_type: "application/pdf",
                    data: pdfBase64
                  }
                }
              ]
            }
          ]
        });

        const correctionToolUse = correctionResponse.content.find(block => block.type === 'tool_use');
        if (correctionToolUse && correctionToolUse.input) {
          finalData = correctionToolUse.input;
          logger.info('Correction pass completed', {
            stage: 'correction',
            correctionsCount: verificationResult.verification_summary?.incorrect + verificationResult.verification_summary?.fabricated,
            inputTokens: correctionResponse.usage.input_tokens,
            outputTokens: correctionResponse.usage.output_tokens,
            cost: calculateCost(correctionResponse.usage),
            durationMs: Date.now() - correctStart
          });
        }
      }

      // STEP 5: Programmatic calculation validation
      const calculationValidation = this.validateCalculations(finalData, classificationType);

      const processingTime = Date.now() - startTime;

      // Calculate total API costs
      const totalTokens = classificationResponse.usage.input_tokens + classificationResponse.usage.output_tokens +
                         extractionResponse.usage.input_tokens + extractionResponse.usage.output_tokens +
                         verificationResponse.usage.input_tokens + verificationResponse.usage.output_tokens;
      const totalCost = calculateCost(classificationResponse.usage) +
                       calculateCost(extractionResponse.usage) +
                       calculateCost(verificationResponse.usage);

      logger.info('Request completed successfully', {
        stage: 'complete',
        totalDurationMs: Date.now() - context.startTime,
        totalCost: hasErrors ? totalCost + calculateCost(correctionResponse.usage) : totalCost,
        totalTokens: hasErrors ? totalTokens + correctionResponse.usage.input_tokens + correctionResponse.usage.output_tokens : totalTokens,
        confidenceScore: verificationResult.confidence_score || verificationSummary.accuracyPercent,
        correctionsApplied: hasErrors,
        passesExecuted: hasErrors ? 4 : 3
      });

      return {
        data: finalData,
        validation: {
          self_verification: verificationResult,
          calculation_validation: calculationValidation,
          confidence_score: verificationResult.confidence_score ||
                          verificationResult.verification_summary?.overall_accuracy_percent || null,
          corrections_applied: hasErrors
        },
        processingTime,
        metadata: {
          model: this.model,
          classification: classificationType,
          validation_passes: hasErrors ? 4 : 3,
          pdfSizeKB: Math.round(pdfBase64.length / 1024),
          totalCost: hasErrors ? totalCost + calculateCost(correctionResponse.usage) : totalCost,
          totalTokens: hasErrors ? totalTokens + correctionResponse.usage.input_tokens + correctionResponse.usage.output_tokens : totalTokens,
          apiCallsCount: hasErrors ? 4 : 3
        }
      };

    } catch (error) {
      logger.error('Validated extraction error:', error);
      this.handleApiError(error);
    }
  }

  /**
   * Programmatic validation of arithmetic consistency
   * This catches calculation errors that the LLM might miss
   */
  validateCalculations(data, propertyType) {
    const issues = [];
    const checks = [];

    if (propertyType === 'SINGLE') {
      // Validate area breakdowns
      if (data.property_metrics?.breakdown_by_use && data.property_metrics?.total_usable_area_sqm) {
        const breakdown = data.property_metrics.breakdown_by_use;
        const sum = Object.values(breakdown).reduce((acc, val) => acc + (val || 0), 0);
        const total = data.property_metrics.total_usable_area_sqm;
        const tolerance = Math.max(10, total * 0.02); // 2% tolerance or 10 sqm

        checks.push({
          type: 'area_breakdown_sum',
          breakdown_sum: sum,
          stated_total: total,
          difference: Math.abs(sum - total),
          within_tolerance: Math.abs(sum - total) <= tolerance
        });

        if (Math.abs(sum - total) > tolerance) {
          issues.push({
            severity: 'high',
            field: 'property_metrics.total_usable_area_sqm',
            issue: `Total area (${total}) doesn't match sum of breakdown (${sum})`,
            difference: sum - total
          });
        }
      }

      // Validate income breakdowns
      if (data.financial?.breakdown_by_use && data.financial?.total_rental_income_annual_eur) {
        const breakdown = data.financial.breakdown_by_use;
        const sum = Object.values(breakdown).reduce((acc, val) => acc + (val || 0), 0);
        const total = data.financial.total_rental_income_annual_eur;
        const tolerance = Math.max(1000, total * 0.02); // 2% tolerance or €1000

        checks.push({
          type: 'income_breakdown_sum',
          breakdown_sum: sum,
          stated_total: total,
          difference: Math.abs(sum - total),
          within_tolerance: Math.abs(sum - total) <= tolerance
        });

        if (Math.abs(sum - total) > tolerance) {
          issues.push({
            severity: 'high',
            field: 'financial.total_rental_income_annual_eur',
            issue: `Total income (${total}) doesn't match sum of breakdown (${sum})`,
            difference: sum - total
          });
        }
      }

      // Validate year logic
      if (data.project_details?.original_year_built && data.project_details?.completion_year) {
        const built = data.project_details.original_year_built;
        const completed = data.project_details.completion_year;

        if (completed < built) {
          issues.push({
            severity: 'high',
            field: 'project_details',
            issue: `Completion year (${completed}) is before construction year (${built})`,
            note: 'This is logically impossible'
          });
        }

        const currentYear = new Date().getFullYear();
        if (built < 1800 || built > currentYear + 10) {
          issues.push({
            severity: 'medium',
            field: 'project_details.original_year_built',
            issue: `Year built (${built}) is outside reasonable range (1800-${currentYear + 10})`
          });
        }
      }

      // Validate occupancy rates
      if (data.usage_details?.overall_occupancy_percent !== undefined) {
        const occupancy = data.usage_details.overall_occupancy_percent;
        if (occupancy < 0 || occupancy > 100) {
          issues.push({
            severity: 'high',
            field: 'usage_details.overall_occupancy_percent',
            issue: `Occupancy rate (${occupancy}%) is outside valid range (0-100%)`
          });
        }
      }
    } else {
      // Portfolio validation
      if (Array.isArray(data)) {
        data.forEach((property, idx) => {
          if (property.occupancy_rate_percent !== null && property.occupancy_rate_percent !== undefined) {
            if (property.occupancy_rate_percent < 0 || property.occupancy_rate_percent > 100) {
              issues.push({
                severity: 'high',
                property_index: idx,
                property_name: property.name_id,
                field: 'occupancy_rate_percent',
                issue: `Occupancy (${property.occupancy_rate_percent}%) outside valid range`
              });
            }
          }

          if (property.year_built !== null) {
            const currentYear = new Date().getFullYear();
            if (property.year_built < 1800 || property.year_built > currentYear + 10) {
              issues.push({
                severity: 'medium',
                property_index: idx,
                property_name: property.name_id,
                field: 'year_built',
                issue: `Year (${property.year_built}) outside reasonable range`
              });
            }
          }
        });
      }
    }

    return {
      is_valid: issues.filter(i => i.severity === 'high').length === 0,
      checks_performed: checks,
      issues,
      summary: {
        total_checks: checks.length,
        high_severity_issues: issues.filter(i => i.severity === 'high').length,
        medium_severity_issues: issues.filter(i => i.severity === 'medium').length
      }
    };
  }

  extractTextFromResponse(response) {
    if (!response || !response.content || !Array.isArray(response.content)) {
      throw new Error('Invalid response structure from Claude API');
    }

    const textContent = response.content.find(item => item.type === 'text');
    if (!textContent || !textContent.text) {
      throw new Error('No text content found in Claude response');
    }

    return textContent.text;
  }

  handleApiError(error) {
    if (error.status === 429) {
      const rateLimitError = new Error('Rate limit exceeded. Please try again in a moment.');
      rateLimitError.status = 429;
      rateLimitError.source = 'claude-api';
      throw rateLimitError;
    }

    if (error.status === 401) {
      const authError = new Error('Invalid API key. Please check your Claude API credentials.');
      authError.status = 401;
      authError.source = 'claude-api';
      throw authError;
    }

    if (error.status === 400) {
      const badRequestError = new Error('Invalid request to Claude API. The PDF may be corrupted or in an unsupported format.');
      badRequestError.status = 400;
      badRequestError.source = 'claude-api';
      badRequestError.details = error.message;
      throw badRequestError;
    }

    if (error.status === 413) {
      const sizeError = new Error('PDF file is too large for Claude API (max 32MB).');
      sizeError.status = 413;
      sizeError.source = 'claude-api';
      throw sizeError;
    }

    const genericError = new Error(`Failed to process PDF with Claude: ${error.message}`);
    genericError.status = error.status || 500;
    genericError.source = 'claude-api';
    throw genericError;
  }

  validateApiKey() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return false;
    }
    return process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');
  }

  countExtractedFields(data) {
    let count = 0;
    const countFields = (obj) => {
      for (const key in obj) {
        if (obj[key] !== null && obj[key] !== undefined) {
          if (typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            countFields(obj[key]);
          } else if (Array.isArray(obj[key])) {
            count += obj[key].length;
          } else {
            count++;
          }
        }
      }
    };
    countFields(data);
    return count;
  }
}

module.exports = new ValidatedClaudeService();
