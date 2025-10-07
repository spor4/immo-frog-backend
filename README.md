# Real Estate PDF Processing API Server

A Node.js/Express server that processes real estate PDF documents (property exposés) using Claude AI to extract structured property information with **multi-pass validation** for high accuracy.

## Features

- 📄 **PDF Processing**: Upload and analyze real estate property exposés up to 32MB and 100 pages
- 🤖 **Claude AI Integration**: Leverages Claude Sonnet 4.5 for intelligent document analysis
- ✅ **Multi-Pass Validation**: Three-pass verification system improves accuracy from ~65% to ~90%
- 🎯 **Guaranteed Schema Compliance**: Uses Claude's tool calling to enforce strict JSON schema adherence
- 🔍 **Smart Validation**: Detects and removes fabricated data, verifies calculations, applies corrections
- 🏢 **Adaptive Extraction**: Automatically classifies and extracts single properties or portfolios
- 📊 **Structured Output**: Returns clean, validated JSON data with comprehensive property information
- 🔒 **Security**: Includes rate limiting, CORS support, and comprehensive error handling
- 📝 **Development Tools**: Built-in test upload form for easy testing in development mode

## What's New: Validation System

The server now includes a **three-pass validation architecture** that significantly improves data accuracy:

1. **Initial Extraction** - Extract with source attribution (requires page numbers)
2. **Self-Verification** - Agent re-reads document to verify each field
3. **Correction Pass** - Fix identified errors, remove fabrications
4. **Arithmetic Validation** - Programmatic checks for calculation consistency

**Result**: ~90% accuracy vs ~65% with standard extraction

Read more: [VALIDATION_ARCHITECTURE.md](./VALIDATION_ARCHITECTURE.md)

## Installation

### Prerequisites

- Node.js 16.x or higher
- npm or yarn
- Claude API key from Anthropic

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd immo-frog
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` and add your Claude API key:
```env
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
```

5. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## How It Works

### Document Classification

Claude analyzes the PDF and determines whether it contains:
- **SINGLE**: One complex property (possibly with multiple uses/addresses)
- **PORTFOLIO**: Multiple separate properties

### Extraction Methods

The server offers three extraction endpoints with different accuracy/speed trade-offs:

| Method | Accuracy | Speed | Use Case |
|--------|----------|-------|----------|
| **Standard** | ~65% | ~15s | Quick prototyping, manual review |
| **Validated** | ~90% | ~45s | Production use, high accuracy needed |
| **Clean** | ~90% | ~45s | Production API (returns clean data only) |

## API Documentation

### 1. POST /api/extract-clean ⭐ **RECOMMENDED**

**Returns validated, corrected data in your schema format without validation wrapper.**

Perfect for production applications that need accurate data without debugging metadata.

**Request:**
```bash
curl -X POST http://localhost:3000/api/extract-clean \
  -F "pdf=@property-expose.pdf"
```

**Response Body:**
```json
{
  "property_identity": { ... },
  "property_metrics": { ... },
  "financial": { ... },
  ...
}
```

**Response Headers:**
- `X-Confidence-Score`: Overall accuracy (0-100)
- `X-Corrections-Applied`: Whether corrections were made
- `X-Fabrications-Detected`: Number of fake fields removed
- `X-Validation-Issues`: Number of critical issues
- `X-Classification`: SINGLE or PORTFOLIO

**Features:**
- ✅ Removes fabricated data (e.g., made-up postal codes)
- ✅ Fixes calculation errors automatically
- ✅ Verifies every field against source document
- ✅ Schema-compliant output guaranteed
- ✅ Validation metadata in headers only

**When to use:**
- Production applications
- When you need accurate data without validation details
- Automated pipelines
- Applications expecting clean schema-compliant JSON

Read more: [CLEAN_ENDPOINT_USAGE.md](./CLEAN_ENDPOINT_USAGE.md)

---

### 2. POST /api/extract-clean-with-report

Same as `/extract-clean` but includes simplified validation report in response body.

**Response:**
```json
{
  "data": {
    // Clean schema-compliant data
  },
  "report": {
    "confidence_score": 68,
    "corrections_applied": true,
    "verification_summary": {
      "total_fields_checked": 47,
      "correct": 32,
      "incorrect": 8,
      "fabricated": 2
    },
    "critical_issues": [
      "Land area fabricated - removed",
      "Parking sqm fabricated - removed"
    ],
    "calculation_issues": [ ... ],
    "recommendation": "MEDIUM CONFIDENCE - Review recommended"
  }
}
```

**When to use:**
- Debugging extraction issues
- Building quality dashboards
- Logging validation results
- Manual quality assessment

---

### 3. POST /api/extract-property-data-validated

Returns data + complete validation metadata including field-by-field verification.

**Response:**
```json
{
  "data": { ... },
  "validation": {
    "self_verification": {
      "verification_summary": { ... },
      "field_verifications": [
        {
          "field_path": "property_identity.city",
          "status": "CORRECT",
          "extracted_value": "Gaimersheim",
          "correct_value": "Gaimersheim",
          "source_location": "page 10, executive summary"
        },
        {
          "field_path": "property_metrics.land_area_sqm",
          "status": "FABRICATED",
          "extracted_value": 42277,
          "correct_value": null,
          "notes": "Not stated in document"
        }
      ],
      "calculation_checks": [ ... ],
      "critical_issues": [ ... ]
    },
    "calculation_validation": { ... },
    "confidence_score": 68
  },
  "metadata": { ... }
}
```

**When to use:**
- Full validation details needed
- Research/analysis of agent performance
- Building validation tools
- Debugging complex extraction issues

---

### 4. POST /api/extract-property-data (Standard)

**Fast extraction without validation.**

**Request:**
```bash
curl -X POST http://localhost:3000/api/extract-property-data \
  -F "pdf=@property-expose.pdf" \
  -H "Accept: application/json"
```

**Response for Single Property:**
```json
{
  "property_identity": {
    "name_id": "Falkenblick Berlin",
    "streets": ["Falkenseer Platz 1"],
    "postal_code": "13589",
    "city": "Berlin",
    "country": "Deutschland"
  },
  "property_metrics": {
    "land_area_sqm": 5200,
    "total_usable_area_sqm": 8500,
    "breakdown_by_use": {
      "office_sqm": 3200,
      "retail_sqm": 1500,
      "residential_sqm": 3800,
      "gastronomy_sqm": null,
      "parking_sqm": null,
      "other_sqm": null
    }
  },
  "financial": {
    "total_rental_income_annual_eur": 1850000,
    "breakdown_by_use": {
      "office": 750000,
      "retail": 380000,
      "residential": 720000
    }
  },
  "project_details": {
    "project_type": "Bestand",
    "original_year_built": 1998,
    "completion_year": 2018
  },
  ...
}
```

**Response for Portfolio:**
```json
[
  {
    "name_id": "Building A - Office Tower",
    "street": "Friedrichstraße 100",
    "postal_code": "10117",
    "city": "Berlin",
    "country": "Deutschland",
    "usable_area_sqm": 4800,
    "rental_income_annual_eur": 750000,
    "year_built": 1995
  },
  ...
]
```

**When to use:**
- Quick prototyping
- Testing schema compliance
- All data manually reviewed anyway
- Speed more critical than accuracy

---

### GET /health

Returns the server health status.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "environment": "development",
  "uptime": 3600
}
```

### GET /upload (Development Only)

In development mode, access a web interface for testing PDF uploads:
```
http://localhost:3000/upload
```

## Endpoint Comparison

| Endpoint | Accuracy | Speed | Cost | Response Format | Best For |
|----------|----------|-------|------|-----------------|----------|
| `/extract-property-data` | ~65% | ~15s | ~$0.10 | Data only | Prototyping, testing |
| `/extract-clean` ⭐ | ~90% | ~45s | ~$0.25 | Data only (validated) | Production apps |
| `/extract-clean-with-report` | ~90% | ~45s | ~$0.25 | Data + report | Debugging, logging |
| `/extract-property-data-validated` | ~90% | ~45s | ~$0.25 | Data + full validation | Analysis, research |

**Validation improves:**
- City name accuracy (removes hallucinations like "City A/City B" → "City A")
- Calculation correctness (office area, rental income sums)
- Fabrication detection (removes made-up postal codes, land areas)
- Year accuracy (distinguishes construction vs modernization years)

## Example Usage

### JavaScript/Node.js
```javascript
const FormData = require('form-data');
const fs = require('fs');

// Recommended: Clean validated extraction
async function extractProperty(pdfPath) {
  const formData = new FormData();
  formData.append('pdf', fs.createReadStream(pdfPath));

  const response = await fetch('http://localhost:3000/api/extract-clean', {
    method: 'POST',
    body: formData
  });

  // Check validation metadata
  const confidence = response.headers.get('x-confidence-score');
  const fabrications = response.headers.get('x-fabrications-detected');

  if (confidence < 70) {
    console.warn(`⚠️  Low confidence (${confidence}%) - review recommended`);
  }

  const data = await response.json();
  return data;
}
```

### Python
```python
import requests

def extract_property(pdf_path):
    with open(pdf_path, 'rb') as f:
        files = {'pdf': f}
        response = requests.post(
            'http://localhost:3000/api/extract-clean',
            files=files
        )

    # Check validation headers
    confidence = int(response.headers.get('x-confidence-score', 0))

    if confidence < 70:
        print(f"⚠️  Low confidence ({confidence}%)")

    return response.json()
```

### cURL
```bash
# Clean extraction (recommended)
curl -X POST http://localhost:3000/api/extract-clean \
  -F "pdf=@property.pdf" \
  -o result.json

# View validation headers
curl -X POST http://localhost:3000/api/extract-clean \
  -F "pdf=@property.pdf" \
  -i | grep -i "x-confidence"

# With validation report
curl -X POST http://localhost:3000/api/extract-clean-with-report \
  -F "pdf=@property.pdf" | jq .
```

## Error Responses

The API returns structured error responses with appropriate HTTP status codes:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "errorId": "uuid-for-tracking",
  "status": 400
}
```

**Common Error Codes:**
- `400` - Bad Request (missing file, invalid format)
- `413` - File too large (exceeds 32MB)
- `415` - Unsupported media type (not a PDF)
- `422` - Unprocessable entity (encrypted PDF, exceeds 100 pages)
- `429` - Too many requests (rate limit exceeded: 10 req/min standard, 5 req/min validated)
- `500` - Internal server error
- `503` - Service unavailable (Claude API issues)

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Your Claude API key (required) | - |
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment (development/production) | development |
| `MAX_FILE_SIZE_MB` | Maximum PDF file size in MB | 32 |
| `MAX_PDF_PAGES` | Maximum pages per PDF | 100 |
| `UPLOAD_DIR` | Directory for temporary file storage | ./uploads |
| `CLAUDE_MODEL` | Claude model to use | claude-sonnet-4-5 |
| `ENABLE_REQUEST_LOGGING` | Enable request logging | true |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | info |
| `ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | * |

## Scripts

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "npm test",
  "lint": "eslint .",
  "format": "prettier --write ."
}
```

## Project Structure

```
immo-frog/
├── server.js                      # Main server file
├── .env                           # Environment variables (git-ignored)
├── .env.example                   # Example environment template
├── package.json                   # Dependencies and scripts
├── README.md                      # This file
├── VALIDATION_ARCHITECTURE.md     # Technical docs on validation system
├── CLEAN_ENDPOINT_USAGE.md        # Detailed usage guide for clean endpoints
├── QUICK_START_VALIDATION.md      # Quick start guide
├── src/
│   ├── middleware/
│   │   ├── errorHandler.js        # Global error handling
│   │   └── upload.js              # Multer configuration
│   ├── services/
│   │   ├── claudeService.js       # Standard extraction (2-pass)
│   │   └── validatedClaudeService.js  # Validated extraction (3-4 pass)
│   ├── routes/
│   │   ├── extraction.js          # Standard endpoint
│   │   ├── validatedExtraction.js # Validated endpoint with metadata
│   │   └── cleanExtraction.js     # Clean endpoints (data only)
│   ├── schemas/
│   │   ├── complexSchema.json     # JSON schema for single properties
│   │   └── portfolioSchema.json   # JSON schema for portfolio properties
│   └── utils/
│       ├── validator.js           # Data validation
│       ├── logger.js              # Winston logger
│       └── extractionCompare.js   # Compare standard vs validated
└── uploads/                       # Temporary files (git-ignored)
```

## Validation System Details

### What Gets Validated

1. **Source Attribution** - Every value must cite page/section (prevents fabrication)
2. **Field Verification** - Agent re-reads document to verify each field
3. **Arithmetic Checks** - Programmatic validation of sums and calculations
4. **Fabrication Detection** - Identifies and removes made-up data
5. **Correction Application** - Fixes identified errors automatically

### Common Issues Fixed

| Issue | Before | After |
|-------|--------|-------|
| City hallucination | "Gaimersheim/Ingolstadt" | "Ingolstadt" |
| Fabricated postal code | "85049" (made up) | null |
| Wrong area calculation | 16,663 m² | 19,499.67 m² (correct sum) |
| Wrong rental income | €1,570,000 | €2,200,880.30 (correct) |
| Fabricated land area | 42,277 m² (not in doc) | null |
| Confused construction year | 1990 (wrong) | 2006 (actual) |

### Confidence Score Guide

- **90-100**: HIGH CONFIDENCE - Use directly
- **75-89**: GOOD CONFIDENCE - Spot check critical fields
- **60-74**: MEDIUM CONFIDENCE - Review financial data & areas
- **< 60**: LOW CONFIDENCE - Manual review required

Read the full technical documentation: [VALIDATION_ARCHITECTURE.md](./VALIDATION_ARCHITECTURE.md)

## Production Deployment

### Recommendations

1. **Process Manager**: Use PM2 for process management and auto-restart
```bash
npm install -g pm2
pm2 start server.js --name immo-frog
pm2 save
pm2 startup
```

2. **Reverse Proxy**: Set up Nginx as a reverse proxy
```nginx
location /api {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    client_max_body_size 35M;
    proxy_read_timeout 120s;  # For validated endpoints
}
```

3. **Security**:
   - Always use HTTPS in production
   - Set appropriate CORS origins
   - Implement authentication if needed
   - Use environment-specific API keys
   - Enable rate limiting

4. **Monitoring**:
   - Monitor `X-Confidence-Score` distribution
   - Track `X-Fabrications-Detected` rate
   - Alert on low confidence scores
   - Log validation issues for analysis

5. **Performance**:
   - Use `/extract-property-data` for batch processing (faster)
   - Use `/extract-clean` for production API (accurate)
   - Implement request queuing for high traffic
   - Consider caching for identical PDFs

## Troubleshooting

### Common Issues

**Low Confidence Scores:**
- Document may be too complex or unusual format
- Review fields marked as "UNCERTAIN" in validation report
- Consider manual review of critical fields
- Check if document type matches endpoint expectations

**Fabrication Warnings:**
- Check `X-Fabrications-Detected` header
- Use `/extract-clean-with-report` to see what was fabricated
- Verify removed fields aren't actually in the document
- Normal for documents with missing data sections

**Calculation Mismatches:**
- Common when breakdown categories are incomplete
- Stated totals are trusted over partial sums
- Review `calculation_issues` in validation report
- May indicate missing data in original document

**PDF Upload Fails:**
- Ensure PDF is not password-protected or encrypted
- Check file size is under 32MB
- Verify PDF has 100 pages or less
- Confirm file is valid PDF format

**Claude API Errors:**
- Verify API key is correct and active
- Check Claude API status at status.anthropic.com
- Ensure you haven't exceeded rate limits
- Verify PDF content is readable

**Server Won't Start:**
- Check all dependencies: `npm install`
- Verify .env file exists with required variables
- Ensure port 3000 is available
- Check Node.js version is 16.x or higher

**Memory Issues:**
- Increase Node.js memory: `node --max-old-space-size=4096 server.js`
- Monitor memory usage during processing
- Validated extraction uses more memory (3-4 API calls)

## Rate Limits

| Endpoint | Rate Limit | Reason |
|----------|------------|--------|
| `/extract-property-data` | 10 req/min | Single API call |
| `/extract-clean` | 5 req/min | Multiple API calls (3-4) |
| `/extract-clean-with-report` | 5 req/min | Multiple API calls (3-4) |
| `/extract-property-data-validated` | 5 req/min | Multiple API calls (3-4) |

## Cost Estimation

| Endpoint | Tokens/Request | Cost/Request | 1000 Requests |
|----------|----------------|--------------|---------------|
| Standard | ~8,000 | ~$0.10 | ~$100 |
| Validated | ~20,000 | ~$0.25 | ~$250 |

Validated extraction costs 2.5x more but prevents costly errors in data.

## Support

For issues, questions, or contributions:
1. Check the troubleshooting section above
2. Review [VALIDATION_ARCHITECTURE.md](./VALIDATION_ARCHITECTURE.md)
3. Review [CLEAN_ENDPOINT_USAGE.md](./CLEAN_ENDPOINT_USAGE.md)
4. Check server logs for detailed error information
5. Create an issue in the repository

## Documentation

- [README.md](./README.md) - This file (overview and API docs)
- [VALIDATION_ARCHITECTURE.md](./VALIDATION_ARCHITECTURE.md) - Complete technical documentation on validation system
- [CLEAN_ENDPOINT_USAGE.md](./CLEAN_ENDPOINT_USAGE.md) - Detailed usage guide for production endpoints
- [QUICK_START_VALIDATION.md](./QUICK_START_VALIDATION.md) - Quick start guide for validation features

## License

[Specify your license here]

## Acknowledgments

- Built with Express.js and Node.js
- Powered by Claude AI from Anthropic
- Validation architecture based on Anthropic's "Building Effective Agents" patterns
- PDF processing with pdf-parse
- Logging with Winston
- File uploads with Multer
