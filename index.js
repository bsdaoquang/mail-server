/** @format */
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { config } from './src/config.js';
import helpmet from 'helmet';
import imapRouter from './src/routers/imap.js';
import rateLimit from 'express-rate-limit';

dotenv.config();

const limiter = rateLimit({
	windowMs: config.rateLimitWindowMs,
	max: config.rateLimitMax,
	standardHeaders: true,
	legacyHeaders: false,
});

const app = express();

app.use(
	cors({
		origin: config.corsOrigin,
	})
);
app.use(helpmet());
app.use(
	express.json({
		limit: '200kb',
	})
);
app.set('trust proxy', 1);

app.use('/imap', limiter, imapRouter);
app.get('/health', (_req, res) =>
	res.json({
		ok: true,
	})
);

app.listen(config.port, (err) => {
	if (err) {
		console.log('Server err');
		return;
	}

	console.log(`Server starting at http://localhost:${config.port}`);
});
