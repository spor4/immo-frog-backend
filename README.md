# Real Estate PDF Processing API Server

A Node.js/Express server that processes real estate PDF documents (property exposés) using Claude AI to extract structured property information.

## Features

- 📄 **PDF Processing**: Upload and analyze real estate property exposés up to 32MB and 100 pages
- 🤖 **Claude AI Integration**: Leverages Claude Sonnet 4.5 for intelligent document analysis
- 🏢 **Adaptive Extraction**: Two-step process automatically classifies and extracts single properties or portfolios
- 🎯 **Guaranteed Schema Compliance**: Uses Claude's tool calling to enforce strict JSON schema adherence
- 🔍 **Smart Validation**: Validates PDFs for encryption, size, and page count before processing
- 📊 **Structured Output**: Returns clean, validated JSON data with comprehensive property information
- 🔒 **Security**: Includes rate limiting, CORS support, and comprehensive error handling
- 📝 **Development Tools**: Built-in test upload form for easy testing in development mode

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

The extraction process uses a sophisticated two-step approach:

1. **Document Classification**: Claude analyzes the PDF and determines whether it contains:
   - **SINGLE**: One complex property (possibly with multiple uses/addresses)
   - **PORTFOLIO**: Multiple separate properties

2. **Structured Extraction**: Based on the classification, Claude uses tool calling with the appropriate JSON schema to extract data with **guaranteed schema compliance**. The tool calling mechanism ensures the output always matches the exact schema structure.

This approach provides consistent, reliable data extraction across diverse property documents.

## API Documentation

### POST /api/extract-property-data

Extracts structured property information from a PDF exposé.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Field name: `pdf`
- Max file size: 32MB
- Max pages: 100

**Example using curl:**
```bash
curl -X POST http://localhost:3000/api/extract-property-data \
  -F "pdf=@/path/to/property-expose.pdf" \
  -H "Accept: application/json"
```

**Example using JavaScript:**
```javascript
const formData = new FormData();
formData.append('pdf', fileInput.files[0]);

const response = await fetch('http://localhost:3000/api/extract-property-data', {
  method: 'POST',
  body: formData
});

const propertyData = await response.json();
```

**Response for Single Property (ComplexProperty schema):**
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
      "gastronomy_sqm": null,
      "residential_sqm": 3800,
      "parking_sqm": null,
      "other_sqm": null
    }
  },
  "usage_details": {
    "primary_usage_type": "Mixed-Use",
    "usage_mix": ["Office", "Retail", "Residential"],
    "overall_occupancy_percent": 95.0,
    "occupancy_by_use": {
      "office": 98.0,
      "retail": 100.0,
      "residential": 92.0,
      "gastronomy": null
    }
  },
  "unit_counts": {
    "residential_units": 45,
    "microapartments": null,
    "commercial_units": 8,
    "parking_spaces": 60,
    "storage_units": null
  },
  "financial": {
    "total_rental_income_annual_eur": 1850000,
    "potential_rental_income_annual_eur": 1950000,
    "market_rental_income_annual_eur": null,
    "breakdown_by_use": {
      "office": 750000,
      "retail": 380000,
      "residential": 720000,
      "gastronomy": null,
      "parking": null,
      "commercial": null,
      "storage": null
    }
  },
  "project_details": {
    "project_type": "Bestand",
    "original_year_built": 1998,
    "modernization_years": "2015-2018",
    "completion_year": 2018
  },
  "additional_metrics": {
    "average_apartment_size_sqm": 84,
    "average_residential_rent_eur_sqm_month": 15.8,
    "elevator": true,
    "energy_efficiency_class": "B",
    "heating_type": "Fernwärme",
    "market_rent_eur_sqm_month": null,
    "vacancy_rate_percent": 5.0
  }
}
```

The complete schema includes all fields defined in `src/schemas/complexSchema.json`. All required fields are guaranteed to be present.

**Response for Portfolio (Array of PortfolioProperty schema):**
```json
[
  {
    "name_id": "Building A - Office Tower",
    "street": "Friedrichstraße 100",
    "postal_code": "10117",
    "city": "Berlin",
    "country": "Deutschland",
    "land_area_sqm": 2500,
    "usable_area_sqm": 4800,
    "usage_type": "Office",
    "occupancy_rate_percent": 95.0,
    "rental_income_annual_eur": 750000,
    "project_type": "Bestand",
    "year_built": 1995
  },
  {
    "name_id": "Building B - Retail Center",
    "street": "Kurfürstendamm 50",
    "postal_code": "10707",
    "city": "Berlin",
    "country": "Deutschland",
    "land_area_sqm": 1800,
    "usable_area_sqm": 3200,
    "usage_type": "Retail",
    "occupancy_rate_percent": 100.0,
    "rental_income_annual_eur": 480000,
    "project_type": null,
    "year_built": 2005
  }
]
```

The complete schema for each array item is defined in `src/schemas/portfolioSchema.json`. All required fields are guaranteed to be present.

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
- `429` - Too many requests (rate limit exceeded)
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
├── server.js              # Main server file
├── .env                   # Environment variables (git-ignored)
├── .env.example           # Example environment template
├── package.json           # Dependencies and scripts
├── README.md              # This file
├── src/
│   ├── middleware/
│   │   ├── errorHandler.js  # Global error handling
│   │   └── upload.js         # Multer configuration
│   ├── services/
│   │   └── claudeService.js  # Claude API integration with tool calling
│   ├── routes/
│   │   └── extraction.js     # Main API endpoints
│   ├── schemas/
│   │   ├── complexSchema.json    # JSON schema for single properties
│   │   └── portfolioSchema.json  # JSON schema for portfolio properties
│   └── utils/
│       ├── validator.js      # Data validation
│       └── logger.js          # Winston logger
└── uploads/                   # Temporary files (git-ignored)
```

## Production Deployment

### Recommendations

1. **Process Manager**: Use PM2 for process management and auto-restart
```bash
npm install -g pm2
pm2 start server.js --name immo-frog
pm2 save
pm2 startup  # Follow instructions to enable auto-start on reboot
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
}
```

3. **Security**:
   - Always use HTTPS in production
   - Set appropriate CORS origins
   - Implement authentication if needed
   - Use environment-specific API keys
   - Enable rate limiting

4. **Monitoring**:
   - Set up application monitoring (e.g., New Relic, Datadog)
   - Configure log aggregation
   - Implement health check monitoring
   - Set up alerts for errors and high latency

5. **Performance**:
   - Consider implementing caching for repeated PDFs
   - Use a CDN for static assets if applicable
   - Optimize Node.js memory settings for large PDFs
   - Implement request queuing for high traffic

## Troubleshooting

### Common Issues

**PDF Upload Fails:**
- Ensure the PDF is not password-protected or encrypted
- Check file size is under 32MB
- Verify PDF has 100 pages or less
- Confirm the file is a valid PDF format

**Claude API Errors:**
- Verify your API key is correct and active
- Check Claude API status at status.anthropic.com
- Ensure you haven't exceeded rate limits
- Verify the PDF content is readable

**Server Won't Start:**
- Check all dependencies are installed: `npm install`
- Verify .env file exists with required variables
- Ensure port 3000 (or configured port) is available
- Check Node.js version is 16.x or higher

**Memory Issues with Large PDFs:**
- Increase Node.js memory limit: `node --max-old-space-size=4096 server.js`
- Ensure adequate server RAM for processing
- Monitor memory usage during processing

## Support

For issues, questions, or contributions:
1. Check the troubleshooting section above
2. Review the API documentation
3. Check server logs for detailed error information
4. Create an issue in the repository

## License

[Specify your license here]

## Acknowledgments

- Built with Express.js and Node.js
- Powered by Claude AI from Anthropic
- PDF processing with pdf-parse
- Logging with Winston
- File uploads with Multer