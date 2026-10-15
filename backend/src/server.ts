import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Request Timing Logger (< 150ms verification)
app.use((req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const duration = Math.round(performance.now() - start);
    if (req.path.startsWith('/api')) {
      const color = duration < 100 ? '\x1b[32m' : duration < 200 ? '\x1b[33m' : '\x1b[31m';
      console.log(`${color}[API]\x1b[0m ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Mount Routes
app.use('/api/v1', apiRouter);

// Root Welcome & Health Check
app.get('/', (req, res) => {
  res.json({
    message: 'Enterprise POS & Inventory SaaS Backend (Node.js/Express)',
    docs: '/api/v1/health',
    status: 'ONLINE'
  });
});

app.listen(PORT, () => {
  console.log('\x1b[32m%s\x1b[0m', `🚀 [SERVER] Enterprise POS Backend listening on port ${PORT}`);
  console.log('\x1b[36m%s\x1b[0m', `👉 API Health: http://localhost:${PORT}/api/v1/health`);
});
