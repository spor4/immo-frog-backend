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

class ClaudeService {
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

  getExtractionPrompt(propertyType) {
    if (propertyType === 'SINGLE') {
      return `You are extracting property information from a German real estate exposé.

Key extraction rules:
- Extract ALL numerical values (areas, income, occupancy rates)
- For mixed-use properties, provide both totals AND breakdowns by use type
- Convert German number formats: "1.234,56" becomes 1234.56
- Look for "IST" (current) vs "SOLL" (potential) income sections
- Extract modernization years separately from original construction year
- Count parking as number of spaces, not area
- Ensure all required fields are filled - if data is missing, use null for optional fields
- Be thorough - extract every piece of information available

You MUST use the extract_complex_property tool to return the data.`;
    } else {
      return `You are extracting property information from a German real estate exposé with multiple properties.

Key extraction rules:
- Create one array item for each distinct property
- Extract ALL properties mentioned in the document
- Convert German number formats: "1.234,56" becomes 1234.56
- Each property must have at minimum: name_id, street, postal_code, city, country
- Extract all available metrics for each property
- If a value is not available for a property, use null

You MUST use the extract_portfolio_properties tool to return the data.`;
    }
  }

  // Convert JSON schema to Anthropic tool input schema format
  convertToToolSchema(jsonSchema) {
    // Anthropic tools use input_schema which is basically the same as JSON schema
    // but we need to ensure it's properly formatted
    return jsonSchema;
  }

  async extractPropertyData(pdfBase64) {
    try {
      const context = getContext();
      logger.info('Starting fast extraction process', {
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
              {
                type: "text",
                text: this.getClassificationPrompt()
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

      // STEP 2: Extract with the appropriate schema using TOOL CALLING
      logger.info('Extraction pass started', {
        stage: 'extraction',
        documentType: classificationType,
        schema: classificationType === 'SINGLE' ? 'complex' : 'portfolio'
      });
      const extractStart = Date.now();

      const tool = classificationType === 'SINGLE' ? {
        name: "extract_complex_property",
        description: "Extract structured information about a single complex property from the exposé",
        input_schema: complexSchema
      } : {
        name: "extract_portfolio_properties",
        description: "Extract structured information about multiple properties from the exposé",
        input_schema: portfolioSchema
      };

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
              {
                type: "text",
                text: this.getExtractionPrompt(classificationType)
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

      // Extract the tool use result
      const toolUse = extractionResponse.content.find(block => block.type === 'tool_use');
      if (!toolUse || !toolUse.input) {
        throw new Error('No tool use found in Claude response');
      }

      logger.info('Extraction pass completed', {
        stage: 'extraction',
        inputTokens: extractionResponse.usage.input_tokens,
        outputTokens: extractionResponse.usage.output_tokens,
        cost: calculateCost(extractionResponse.usage),
        durationMs: Date.now() - extractStart
      });

      const totalTokens = classificationResponse.usage.input_tokens + classificationResponse.usage.output_tokens +
                         extractionResponse.usage.input_tokens + extractionResponse.usage.output_tokens;
      const totalCost = calculateCost(classificationResponse.usage) + calculateCost(extractionResponse.usage);

      logger.info('Request completed successfully', {
        stage: 'complete',
        totalDurationMs: Date.now() - startTime,
        totalCost,
        totalTokens,
        passesExecuted: 2
      });

      return toolUse.input;

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

  validateApiKey() {
    if (!process.env.ANTHROPIC_API_KEY) {
      return false;
    }
    return process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-');
  }
}

module.exports = new ClaudeService();
