/** @format */
import dotenv from 'dotenv';
dotenv.config();

const config = {
	port: Number(process.env.PORT || 3000),
	corsOrigin: process.env.CORS_ORIGIN || '*',
	rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
	rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 30),
	API_KEY_2CAPTCHA: process.env.API_KEY_2CAPTCHA,
	CHROME_PATH: process.env.CHROME_PATH,
	PROXY: null,
};

export { config };
