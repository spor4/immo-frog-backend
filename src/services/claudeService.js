const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../utils/logger');

class ClaudeService {
  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';
    this.systemPrompt = this.getSystemPrompt();
  }

  getSystemPrompt() {
    return JSON.stringify({
      task: "extract_real_estate_information_adaptive",
      instruction: "Analyze the exposé and determine the appropriate extraction approach: SINGLE COMPLEX PROPERTY (one property with multiple uses/addresses) or PORTFOLIO (multiple separate properties). Extract information accordingly.",

      decision_criteria: {
        treat_as_single_property_when: [
          "Document describes one building complex with multiple addresses",
          "Mixed-use property with integrated components",
          "Single purchase price for entire complex",
          "Shared infrastructure (parking, utilities)",
          "One land plot (Grundstück) number",
          "Described as 'Objekt' (singular) not 'Objekte' (plural)"
        ],
        treat_as_portfolio_when: [
          "Multiple distinct properties at different locations",
          "Separate building IDs or names (e.g., BV10, BV12)",
          "Individual property metrics listed in tables",
          "Properties can be sold separately",
          "Different construction years per building",
          "Separate land plots (Flurstücke) per property"
        ]
      },

      extraction_modes: {
        mode_1_single_complex: {
          description: "For single properties with multiple uses/components",
          output_structure: {
            property_identity: {
              name_id: "Property name or identifier",
              streets: ["All street addresses if multiple"],
              postal_code: "string",
              city: "string",
              country: "string"
            },
            property_metrics: {
              land_area_sqm: "number",
              total_usable_area_sqm: "number",
              breakdown_by_use: {
                office_sqm: "number or null",
                retail_sqm: "number or null",
                gastronomy_sqm: "number or null",
                residential_sqm: "number or null",
                parking_sqm: "number or null",
                other_sqm: "number or null"
              }
            },
            usage_details: {
              primary_usage_type: "string",
              usage_mix: ["array of all uses"],
              overall_occupancy_percent: "number",
              occupancy_by_use: {
                office: "number or null",
                retail: "number or null",
                gastronomy: "number or null",
                residential: "number or null"
              }
            },
            unit_counts: {
              residential_units: "number or null",
              microapartments: "number or null",
              commercial_units: "number or null",
              parking_spaces: "number or null"
            },
            financial: {
              total_rental_income_annual_eur: "number",
              potential_rental_income_annual_eur: "number or null",
              breakdown_by_use: {
                office: "number or null",
                retail: "number or null",
                gastronomy: "number or null",
                residential: "number or null",
                parking: "number or null"
              }
            },
            project_details: {
              project_type: "enum",
              original_year_built: "integer",
              modernization_years: "string or null",
              completion_year: "integer or null"
            }
          }
        },

        mode_2_portfolio: {
          description: "For multiple separate properties",
          output_structure: {
            type: "array",
            items: {
              name_id: "string",
              street: "string",
              postal_code: "string",
              city: "string",
              country: "string",
              land_area_sqm: "number or null",
              usable_area_sqm: "number or null",
              usage_type: "string",
              occupancy_rate_percent: "number or null",
              rental_income_annual_eur: "number",
              project_type: "string or null",
              year_built: "integer or null"
            }
          }
        }
      },

      extraction_rules: [
        "First determine if this is ONE property or MULTIPLE properties",
        "For mixed-use properties, capture ALL components and uses",
        "Look for tables showing tenant details vs. property details",
        "Check 'IST & SOLL' sections for current vs. potential income",
        "Extract modernization/renovation periods separately from original construction",
        "For complex properties, provide breakdown by usage type when available",
        "Parking counts should be extracted as units, not area",
        "Convert all German number formats properly (. for thousands, , for decimals)"
      ],

      special_handling: {
        mixed_use_properties: [
          "Extract total figures AND breakdowns by use",
          "List all tenant types in usage_mix array",
          "Calculate weighted occupancy if different uses have different rates"
        ],
        microapartments: [
          "Count separately from regular apartments",
          "Note if furnished/serviced apartments",
          "Include operator name if managed"
        ],
        parking: [
          "Extract number of spaces, not just area",
          "Note if underground/above ground",
          "Include rental income from parking if separate"
        ]
      },

      validation_rules: [
        "If document has one purchase price, treat as single property",
        "Mixed-use with shared infrastructure = single property",
        "Separate property tables with individual metrics = portfolio",
        "Verify occupancy rates match what's shown in charts/graphs",
        "Total income should equal sum of component incomes"
      ]
    });
  }

  async extractPropertyData(pdfBase64) {
    try {
      logger.info('Sending PDF to Claude API for analysis');

      const startTime = Date.now();

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 8192,
        temperature: 0,
        system: this.systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this real estate exposé and extract property information according to the instructions. Return ONLY the JSON data, no explanations."
              },
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

      const processingTime = Date.now() - startTime;
      logger.info(`Claude API response received in ${processingTime}ms`);

      const extractedText = this.extractTextFromResponse(response);
      const jsonData = this.parseExtractedText(extractedText);

      return jsonData;

    } catch (error) {
      logger.error('Claude API error:', error);

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

  parseExtractedText(text) {
    let cleanedText = text.trim();

    cleanedText = cleanedText.replace(/^```json\s*/i, '');
    cleanedText = cleanedText.replace(/\s*```$/i, '');
    cleanedText = cleanedText.replace(/^```\s*/i, '');
    cleanedText = cleanedText.replace(/\s*```$/i, '');

    const jsonMatch = cleanedText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      cleanedText = jsonMatch[1];
    }

    try {
      const jsonData = JSON.parse(cleanedText);
      logger.info('Successfully parsed JSON from Claude response');
      return jsonData;
    } catch (parseError) {
      logger.error('Failed to parse JSON from Claude response:', parseError);
      logger.debug('Raw text that failed to parse:', cleanedText.substring(0, 500));

      const error = new Error('Failed to parse property data from PDF. The document may not be a valid property exposé.');
      error.source = 'claude-api';
      error.status = 422;
      throw error;
    }
  }

  validateApiKey() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return false;
    }
    return process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');
  }
}

module.exports = new ClaudeService();