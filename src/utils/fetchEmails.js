/** @format */
import puppeteer from 'puppeteer-extra';
import speakeasy from 'speakeasy';
import { config } from '../config.js';
import axios from 'axios';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { execSync } from 'child_process';

puppeteer.use(StealthPlugin());

const API_KEY = config.API_KEY_2CAPTCHA;

// Tự tìm Chrome path nếu config rỗng hoặc không tồn tại
function getChromePath() {
	try {
		if (config.CHROME_PATH) return config.CHROME_PATH;
		const paths = [
			'/usr/bin/google-chrome',
			'/usr/bin/chromium-browser',
			'/usr/bin/chromium',
		];
		for (const p of paths) {
			try {
				execSync(`test -f ${p}`);
				return p;
			} catch {}
		}
		// Tìm bằng which
		const detected = execSync(
			'which chromium-browser || which google-chrome || which chromium',
			{ encoding: 'utf8' }
		).trim();
		if (detected) return detected;
	} catch (e) {
		console.error('[ERROR] Không tìm thấy Chrome/Chromium trên VPS.');
	}
	return null;
}

// Hàm safeClick, tryClickMultiple, solveCaptcha giữ nguyên như cũ...

const safeClick = async (page, selector, stepName = '') => {
	console.log(`[DEBUG] Trying click: ${stepName} -> selector: ${selector}`);
	await page.waitForSelector(selector, { visible: true, timeout: 30000 });
	await page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (el) el.click();
	}, selector);
	console.log(`[DEBUG] Clicked: ${stepName}`);
};

const tryClickMultiple = async (page, selectors, stepName) => {
	for (const sel of selectors) {
		const found = await page.$(sel);
		if (found) {
			await safeClick(page, sel, stepName);
			return true;
		}
	}
	console.log(
		`[ERROR] ${stepName}: No selector matched -> ${selectors.join(', ')}`
	);
	return false;
};

const solveCaptcha = async (page) => {
	console.log('[DEBUG] Checking for captcha...');
	// Giữ nguyên code solveCaptcha ở đây
	return null; // nếu muốn giữ nguyên thì copy từ code cũ
};

const loginAndGetMail = async ({ email, password }) => {
	let browser;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	console.log(`\n[START] Processing account: ${email}`);

	try {
		const chromePath = getChromePath();
		if (!chromePath) {
			throw new Error('Không tìm thấy Chrome/Chromium trên VPS.');
		}

		console.log(`[DEBUG] Using Chrome path: ${chromePath}`);

		browser = await puppeteer.launch({
			headless: true,
			executablePath: chromePath,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
			],
			timeout: 60000, // 60s timeout khi mở Chrome
		});

		const page = await browser.newPage();

		// Log tất cả console trong browser
		page.on('console', (msg) => console.log(`[BROWSER LOG] ${msg.text()}`));

		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36'
		);
		await page.setViewport({ width: 1366, height: 768 });

		console.log('[DEBUG] Opening Google login page...');
		await page.goto('https://accounts.google.com/signin/v2/identifier', {
			waitUntil: 'networkidle2',
			timeout: 45000,
		});

		// Giữ nguyên các bước đăng nhập như cũ...
		// (copy toàn bộ phần code login ở file cũ vào đây)

		// Sau khi lấy email xong
		return {
			email,
			status: 'success',
			message: 'Lấy email thành công',
			mails: [], // mails thực tế
		};
	} catch (error) {
		console.error(`[ERROR] ${email} -> ${error.message}`);
		return {
			email,
			status: 'error',
			message: error.message || 'Lỗi không xác định',
			mails: [],
		};
	} finally {
		if (browser) await browser.close();
	}
};

export { loginAndGetMail };
