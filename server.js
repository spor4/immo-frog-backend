const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const logger = require('./src/utils/logger');
const { correlationMiddleware } = require('./src/middleware/correlationContext');
const errorHandler = require('./src/middleware/errorHandler');
const extractionRoutes = require('./src/routes/extraction');
const validatedExtractionRoutes = require('./src/routes/validatedExtraction');
const cleanExtractionRoutes = require('./src/routes/cleanExtraction');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

app.use(helmet());

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept'],
  maxAge: 86400
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Add correlation middleware BEFORE routes to track all requests
app.use(correlationMiddleware);

if (process.env.ENABLE_REQUEST_LOGGING === 'true') {
  app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
  }));
}

app.use('/api', extractionRoutes);
app.use('/api', validatedExtractionRoutes);
app.use('/api', cleanExtractionRoutes);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime()
  });
});

if (NODE_ENV === 'development') {
  app.get('/upload', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>PDF Upload Test</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background-color: #f5f5f5;
          }
          .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
          }
          .upload-form {
            margin-top: 30px;
          }
          .form-group {
            margin-bottom: 20px;
          }
          label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #555;
          }
          input[type="file"] {
            padding: 10px;
            border: 2px dashed #ddd;
            border-radius: 4px;
            width: 100%;
            background: #fafafa;
          }
          button {
            background-color: #4CAF50;
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            transition: background-color 0.3s;
          }
          button:hover {
            background-color: #45a049;
          }
          button:disabled {
            background-color: #cccccc;
            cursor: not-allowed;
          }
          .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 4px;
            display: none;
          }
          .status.success {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
          }
          .status.error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
          }
          .status.loading {
            background-color: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
            display: block;
          }
          .result {
            margin-top: 20px;
            padding: 15px;
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            display: none;
            overflow-x: auto;
          }
          pre {
            margin: 0;
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 14px;
            line-height: 1.5;
          }
          .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(0,0,0,.3);
            border-radius: 50%;
            border-top-color: #0c5460;
            animation: spin 1s ease-in-out infinite;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .file-info {
            margin-top: 10px;
            color: #666;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Real Estate PDF Extraction Test</h1>
          <p>Upload a PDF property exposé to extract structured information using Claude AI.</p>

          <form class="upload-form" id="uploadForm">
            <div class="form-group">
              <label for="pdfFile">Select PDF File (Max 32MB, Max 100 pages)</label>
              <input type="file" id="pdfFile" name="pdf" accept=".pdf,application/pdf" required />
              <div class="file-info" id="fileInfo"></div>
            </div>
            <button type="submit" id="submitBtn">Extract Property Data</button>
          </form>

          <div class="status" id="status"></div>
          <div class="result" id="result">
            <h3>Extracted Data:</h3>
            <pre id="jsonOutput"></pre>
          </div>
        </div>

        <script>
          const form = document.getElementById('uploadForm');
          const statusDiv = document.getElementById('status');
          const resultDiv = document.getElementById('result');
          const jsonOutput = document.getElementById('jsonOutput');
          const submitBtn = document.getElementById('submitBtn');
          const fileInput = document.getElementById('pdfFile');
          const fileInfo = document.getElementById('fileInfo');

          fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
              const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
              fileInfo.textContent = \`Selected: \${file.name} (Size: \${sizeMB} MB)\`;

              if (sizeMB > 32) {
                fileInfo.style.color = 'red';
                fileInfo.textContent += ' - File too large! Maximum size is 32MB.';
                submitBtn.disabled = true;
              } else {
                fileInfo.style.color = '#666';
                submitBtn.disabled = false;
              }
            } else {
              fileInfo.textContent = '';
              submitBtn.disabled = false;
            }
          });

          form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = new FormData();
            const fileInput = document.getElementById('pdfFile');
            formData.append('pdf', fileInput.files[0]);

            statusDiv.className = 'status loading';
            statusDiv.innerHTML = '<div class="spinner"></div> Processing PDF... This may take a minute for large documents.';
            statusDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            submitBtn.disabled = true;

            try {
              const response = await fetch('/api/extract-property-data', {
                method: 'POST',
                body: formData
              });

              const data = await response.json();

              if (response.ok) {
                statusDiv.className = 'status success';
                statusDiv.textContent = 'Extraction successful!';
                resultDiv.style.display = 'block';
                jsonOutput.textContent = JSON.stringify(data, null, 2);
              } else {
                statusDiv.className = 'status error';
                statusDiv.textContent = \`Error: \${data.error || 'Failed to extract data'}\`;
                resultDiv.style.display = 'none';
              }
            } catch (error) {
              statusDiv.className = 'status error';
              statusDiv.textContent = \`Error: \${error.message}\`;
              resultDiv.style.display = 'none';
            } finally {
              submitBtn.disabled = false;
            }
          });
        </script>
      </body>
      </html>
    `);
  });
}

app.use(errorHandler);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
    status: 404
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT} in ${NODE_ENV} mode`);
  logger.info(`Health check available at http://localhost:${PORT}/health`);
  if (NODE_ENV === 'development') {
    logger.info(`Test upload form available at http://localhost:${PORT}/upload`);
  }
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;