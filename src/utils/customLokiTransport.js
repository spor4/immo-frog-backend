const https = require('https');
const Transport = require('winston-transport');

/**
 * Custom Loki transport for Winston that actually works with Grafana Cloud
 * Winston-loki package is broken, so we use direct HTTPS requests
 */
class CustomLokiTransport extends Transport {
  constructor(opts) {
    super(opts);

    this.host = opts.host || 'logs-prod-012.grafana.net';
    this.path = '/loki/api/v1/push';
    this.username = opts.username;
    this.apiKey = opts.apiKey;
    this.labels = opts.labels || { job: 'app' };
    this.auth = Buffer.from(`${this.username}:${this.apiKey}`).toString('base64');

    // Batch logs to avoid overwhelming Loki
    this.batch = [];
    this.batchSize = opts.batchSize || 10;
    this.batchInterval = opts.batchInterval || 5000; // 5 seconds
    this.flushTimer = null;

    // Start batch timer
    this.startBatchTimer();
  }

  startBatchTimer() {
    this.flushTimer = setInterval(() => {
      if (this.batch.length > 0) {
        this.flush();
      }
    }, this.batchInterval);

    // Prevent timer from blocking process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Add to batch with nanosecond timestamp
    const timestamp = `${Date.now()}000000`;

    // Send the entire log entry as JSON (Grafana can parse this)
    const logEntry = {
      message: info.message || '',
      level: info.level || 'info',
      ...info
    };

    // Remove duplicate fields
    delete logEntry.timestamp; // Using Loki's timestamp instead

    const logLine = JSON.stringify(logEntry);
    this.batch.push([timestamp, logLine]);

    // Flush if batch is full
    if (this.batch.length >= this.batchSize) {
      this.flush();
    }

    callback();
  }

  flush() {
    if (this.batch.length === 0) return;

    const payload = JSON.stringify({
      streams: [
        {
          stream: this.labels,
          values: [...this.batch]
        }
      ]
    });

    // Clear batch immediately
    this.batch = [];

    const options = {
      hostname: this.host,
      port: 443,
      path: this.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Basic ${this.auth}`,
        'X-Scope-OrgID': this.username
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode !== 204) {
          console.error(`❌ Loki push failed with status ${res.statusCode}: ${data}`);
          this.emit('error', new Error(`Loki returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Loki request error:', error.message);
      this.emit('error', error);
    });

    req.write(payload);
    req.end();
  }

  close() {
    // Flush remaining logs
    this.flush();

    // Clear timer
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
  }
}

module.exports = CustomLokiTransport;
