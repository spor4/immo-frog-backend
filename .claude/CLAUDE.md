# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Real Estate PDF Processing API that extracts structured property data from German real estate exposés using Claude AI. The system uses a multi-pass validation architecture to ensure high accuracy (90%+) by detecting hallucinations, calculation errors, and fabricated data.

## Development Commands

```bash
# Start server
npm start

# Development mode with auto-reload
npm run dev

# Lint code
npm run lint

# Format code
npm run format

# Test upload interface (development only)
# Visit http://localhost:3000/upload after running dev server
```

## Architecture Overview

### Two-Stage Extraction Process

1. **Classification Pass**: Determines if document is `SINGLE` (one complex property) or `PORTFOLIO` (multiple properties)
2. **Extraction Pass**: Uses appropriate JSON schema with Claude tool calling for guaranteed schema compliance

### Three API Endpoint Tiers

1. **`/api/extract-property-data`** - Original fast extraction (~15s, 2 API calls)
   - Use for: Prototyping, testing, speed-critical scenarios
   - Accuracy: ~65%, may hallucinate or miscalculate

2. **`/api/extract-property-data-validated`** - Full validation with metadata (~45s, 4-5 API calls)
   - Use for: Debugging, analysis, detailed verification reports
   - Returns: `{data, validation, metadata}` with field-by-field verification

3. **`/api/extract-clean`** - Production endpoint (~45s, 4-5 API calls)
   - Use for: Production applications requiring clean data
   - Returns: Validated data only, metadata in response headers
   - Accuracy: ~90% with auto-correction of hallucinations/errors

### Validation Architecture (Evaluator-Optimizer Pattern)

Based on Anthropic's "Building Effective Agents" framework:

```
Classification → Initial Extraction (with source attribution) →
Self-Verification (re-read document) → Correction Pass (if needed) →
Programmatic Validation (arithmetic checks) → Final Output
```

**Key Principles:**
- **Source Attribution**: Every value must cite page/location (prevents hallucination)
- **Never Fabricate**: Missing data → `null` (not guessed values)
- **Calculation Transparency**: Show components when summing (e.g., "A + B + C = Total")
- **Differentiate vs Aggregate**: "Baujahr" in table = that building's year, must find earliest across all buildings

## File Structure

```
src/
├── services/
│   ├── claudeService.js              # Fast extraction (2-pass)
│   └── validatedClaudeService.js     # Validated extraction (3-4 pass)
├── routes/
│   ├── extraction.js                 # Original endpoint
│   ├── validatedExtraction.js        # Validated endpoint
│   └── cleanExtraction.js            # Production clean endpoint
├── schemas/
│   ├── complexSchema.json            # Single property schema
│   └── portfolioSchema.json          # Portfolio array schema
├── middleware/
│   ├── errorHandler.js               # Global error handling
│   └── upload.js                     # Multer PDF upload config
└── utils/
    ├── validator.js                  # Schema/programmatic validation
    ├── extractionCompare.js          # Compare standard vs validated
    └── logger.js                     # Winston logger
```

## Common Data Extraction Errors (Fixed by Validation)

1. **City Name Hallucination**: Combining nearby cities instead of exact text
2. **Calculation Errors**: Incorrect sums of area/income breakdowns (15-40% off)
3. **Fabricated Data**: Inventing postal codes, land areas, parking spaces
4. **Semantic Confusion**: Using modernization year as construction year
5. **Incomplete Aggregation**: Missing components when summing across tables

## Environment Variables

Required:
- `ANTHROPIC_API_KEY` - Claude API key (starts with `sk-ant-`)

Optional:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `MAX_FILE_SIZE_MB` - Max PDF size (default: 32)
- `MAX_PDF_PAGES` - Max pages (default: 100)
- `CLAUDE_MODEL` - Model name (default: claude-sonnet-4-5)
- `LOG_LEVEL` - Logging level (default: info)
- `ALLOWED_ORIGINS` - CORS origins (default: *)

## JSON Schema Tool Calling

Both services use Claude's tool calling mechanism to enforce schema compliance:

- **complexSchema.json**: Single property with breakdown by use type (office, retail, residential, etc.)
- **portfolioSchema.json**: Array of simpler property objects

The extraction prompts force the model to use these tools, guaranteeing valid JSON structure.

## Validation Metrics

When using validated endpoints, monitor these response headers:

- `X-Confidence-Score`: 0-100 (80+ = good, 60-79 = review, <60 = manual check)
- `X-Corrections-Applied`: Whether auto-corrections were made
- `X-Fabrications-Detected`: Number of hallucinated fields removed
- `X-Validation-Issues`: Number of critical issues found

## Performance Characteristics

| Metric | Standard | Validated |
|--------|----------|-----------|
| Processing Time | ~15s | ~45s |
| API Calls | 2 | 4-5 |
| Token Usage | ~8K | ~20K |
| Cost per Request | ~$0.10 | ~$0.25 |
| Accuracy | ~65% | ~90% |

## Testing Validation System

```javascript
const extractionCompare = require('./src/utils/extractionCompare');

// Compare both extractions
const standard = await claudeService.extractPropertyData(pdfBase64);
const validated = await validatedClaudeService.extractPropertyData(pdfBase64);

const comparison = extractionCompare.compare(standard, validated.data, 'SINGLE');
const summary = extractionCompare.generateSummary(comparison);
console.log(summary.recommendation);
```

## Error Handling

Standard HTTP status codes:
- `400` - Bad request (missing file, invalid format)
- `413` - File too large (>32MB)
- `415` - Unsupported media type (not PDF)
- `422` - Unprocessable entity (encrypted PDF, >100 pages)
- `429` - Rate limit exceeded
- `500` - Internal server error
- `503` - Service unavailable (Claude API issues)

## Rate Limits

- Standard endpoint: 10 requests/min
- Validated endpoints: 5 requests/min (due to multi-pass overhead)

## Documentation Files

- `VALIDATION_ARCHITECTURE.md` - Full technical documentation of 3-pass validation system
- `QUICK_START_VALIDATION.md` - Quick start guide for validated extraction
- `CLEAN_ENDPOINT_USAGE.md` - Production clean endpoint guide with examples
- `README.md` - User-facing API documentation

## Important Development Notes

- Always prefer editing existing files over creating new ones
- The validation system is designed to catch and correct LLM errors - test changes against known problematic PDFs
- When modifying prompts in `validatedClaudeService.js`, ensure source attribution requirements remain strict
- The `extractionCompare.js` utility is essential for testing prompt changes
- Programmatic validation in `validator.js` catches arithmetic errors that LLMs miss (±2% tolerance for sums)
