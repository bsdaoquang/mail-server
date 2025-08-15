/** @format */
import axios from 'axios';
import fs from 'fs';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from '../config.js';

puppeteer.use(StealthPlugin());

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const detectChromePath = () => {
	const candidates = [
		puppeteer.executablePath(), // Bundled Chromium
		process.env.CHROME_PATH || (config && config.CHROME_PATH),
		'/snap/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/chromium',
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
	].filter(Boolean);
	for (const p of candidates) {
		try {
			if (fs.existsSync(p)) return p;
		} catch {}
	}
	return null;
};

const API_KEY = config.API_KEY_2CAPTCHA;

const safeClick = async (page, selector, stepName = '') => {
	console.log(`[DEBUG][${stepName}] Trying click: ${selector}`);
	await page.waitForSelector(selector, { visible: true, timeout: 30000 });
	await page.click(selector);
};

const waitAnyVisible = async (page, selectors, stepName = '') => {
	console.log(`[DEBUG][${stepName}] Waiting any selector:`, selectors);
	const timeout = 30000;
	const checks = selectors.map((sel) =>
		page
			.waitForSelector(sel, { visible: true, timeout })
			.then(() => sel)
			.catch(() => null)
	);
	const result = await Promise.race(checks);
	if (!result) throw new Error(`[${stepName}] None visible`);
	console.log(`[DEBUG][${stepName}] Matched: ${result}`);
	return result;
};

const clickFirst = async (page, selectors, stepName = '') => {
	for (const sel of selectors) {
		const found = await page.$(sel);
		if (found) {
			await safeClick(page, sel, stepName);
			return true;
		}
	}
	console.log(`[ERROR][${stepName}] No selector matched`);
	return false;
};

const solveCaptcha = async (page) => {
	console.log('[DEBUG][Captcha] Checking for captcha...');
	let sitekey = null;

	page.on('request', (req) => {
		const url = req.url();
		if (url.includes('/recaptcha/api2/anchor')) {
			const match = url.match(/[?&]k=([^&]+)/);
			if (match && match[1]) {
				sitekey = decodeURIComponent(match[1]);
				console.log('[DEBUG][Captcha] Captured sitekey:', sitekey);
			}
		}
	});

	if (!sitekey) {
		try {
			const frames = page.frames();
			for (const f of frames) {
				const sk = await f
					.$eval('div.g-recaptcha[data-sitekey]', (el) =>
						el.getAttribute('data-sitekey')
					)
					.catch(() => null);
				if (sk) {
					sitekey = sk;
					break;
				}
			}
		} catch {}
	}

	if (!sitekey) {
		console.log('[DEBUG][Captcha] No captcha detected.');
		return;
	}

	console.log('[DEBUG][Captcha] Solving with 2Captcha...');
	const pageUrl = page.url();
	const inRes = await axios.get(
		`http://2captcha.com/in.php?key=${API_KEY}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${encodeURIComponent(
			pageUrl
		)}&json=1`
	);
	if (inRes.data.status !== 1) {
		throw new Error('2Captcha IN error: ' + JSON.stringify(inRes.data));
	}
	const requestId = inRes.data.request;

	let token = null;
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 5000));
		const res = await axios.get(
			`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${requestId}&json=1`
		);
		if (res.data.status === 1) {
			token = res.data.request;
			break;
		}
		if (res.data.request !== 'CAPCHA_NOT_READY') {
			throw new Error('2Captcha RES error: ' + JSON.stringify(res.data));
		}
	}
	if (!token) throw new Error('2Captcha timeout');

	await page.evaluate((tok) => {
		const textarea = document.getElementById('g-recaptcha-response');
		if (textarea) {
			textarea.value = tok;
		} else {
			const t = document.createElement('textarea');
			t.id = 'g-recaptcha-response';
			t.value = tok;
			document.body.appendChild(t);
		}
	}, token);

	console.log('[DEBUG][Captcha] Solved & token injected');
};

const loginAndGetMail = async ({ email, password }) => {
	let browser;
	console.log(`[START] Processing account: ${email}`);

	try {
		const execPath = detectChromePath();
		console.log('[DEBUG] Using Chromium path:', execPath || '(bundled)');
		browser = await puppeteer.launch({
			headless: false,
			executablePath: execPath || undefined,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-dev-shm-usage',
				'--disable-gpu',
			],
		});

		const page = await browser.newPage();
		page.setDefaultTimeout(60000);
		page.setDefaultNavigationTimeout(90000);

		// Step 0: Test network
		console.log('[DEBUG][Step 0] Testing network with example.com...');
		await page.goto('https://example.com', {
			waitUntil: 'domcontentloaded',
			timeout: 15000,
		});
		console.log('[DEBUG][Step 0] Network test OK');

		console.log('[DEBUG][Step 1] Opening Google login...');
		await page.goto('https://accounts.google.com/signin/v2/identifier', {
			waitUntil: 'networkidle2',
		});

		console.log('[DEBUG][Step 2] Typing email...');
		const emailSelectors = [
			'input[type="email"]',
			'input[name="identifier"]',
			'input[name="Email"]',
			'input#identifierId',
		];
		const emailInputSel = await waitAnyVisible(
			page,
			emailSelectors,
			'Email Input'
		);
		await page.type(emailInputSel, email, { delay: 50 });

		const nextBtnSelectors = [
			'#identifierNext',
			'button[jsname="LgbsSe"]',
			'div[role="button"][id^="identifierNext"]',
			'div[role="button"]:has(span)',
		];
		await clickFirst(page, nextBtnSelectors, 'Click Next after Email');
		await wait(2000);

		console.log('[DEBUG][Step 3] Typing password...');
		const passwordSelectors = [
			'input[type="password"]',
			'input[name="Passwd"]',
			'input[name="password"]',
		];
		let passwordInputSel;
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				passwordInputSel = await waitAnyVisible(
					page,
					passwordSelectors,
					'Password Input'
				);
				break;
			} catch (e) {
				console.log(
					`[DEBUG][Password Input] Attempt ${attempt + 1} failed, retrying...`
				);
				await wait(2000);
			}
		}
		if (!passwordInputSel) {
			throw new Error('[Password Input] None visible after retries');
		}
		await page.type(passwordInputSel, password, { delay: 50 });

		const passNextBtnSelectors = [
			'#passwordNext',
			'button[jsname="LgbsSe"]',
			'div[role="button"][id^="passwordNext"]',
			'div[role="button"]:has(span)',
		];
		await clickFirst(page, passNextBtnSelectors, 'Click Next after Password');
		await wait(3000);

		// Solve captcha if present
		await solveCaptcha(page);

		await wait(5000);
		// bỏ qua bước nhập email khôi phục
		let shouldSkipRecovery = false;
		try {
			if (
				page.url().includes('addrecoveryphone') ||
				page.url().includes('addrecoveryemail')
			) {
				shouldSkipRecovery = true;
			} else {
				const phoneHeaders = await page.$x(
					"//h1[contains(text(),'Thêm số điện thoại')]"
				);
				const emailHeaders = await page.$x(
					"//h1[contains(text(),'Thêm địa chỉ email khôi phục')]"
				);
				if (
					(phoneHeaders && phoneHeaders.length > 0) ||
					(emailHeaders && emailHeaders.length > 0)
				) {
					shouldSkipRecovery = true;
				}
			}
		} catch (e) {
			console.log('[ERROR] Error checking recovery step:', e.message);
		}
		if (shouldSkipRecovery) {
			console.log('[DEBUG] Skipping recovery info step...');
			const skipSelectors = [
				'#skip',
				'#cancel',
				'button[jsname="LgbsSe"]',
				'div[role="button"]:has(span)',
			];
			await tryClickMultiple(page, skipSelectors, 'Skip Recovery Info');
			await page
				.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
				.catch(() => {});
		}

		if (page.url().includes('challenge')) {
			console.log('[DEBUG] Login blocked by Google challenge.');
			return {
				email,
				status: 'error',
				message: 'Google yêu cầu xác minh bổ sung',
				mails: [],
			};
		}

		console.log('[DEBUG][Step 4] Opening Gmail inbox...');
		await page.goto('https://mail.google.com/mail/u/0/#inbox', {
			waitUntil: 'networkidle2',
		});

		console.log(`[SUCCESS] Logged in and inbox loaded for ${email}`);
		// Lấy 10 email mới nhất
		const emails = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll('tr.zA')).slice(0, 10);
			return rows.map((row) => {
				const from =
					row.querySelector('.yX.xY .yW span')?.getAttribute('email') ||
					row.querySelector('.yX.xY .yW span')?.innerText;
				const subject = row.querySelector('.y6 span span')?.innerText;
				const snippet = row
					.querySelector('.y2')
					?.innerText.replace(/^-\s*/, ''); // tóm tắt nội dung
				return { from, subject, snippet };
			});
		});

		return {
			email,
			status: 'success',
			message: 'Lấy email thành công',
			mails: emails,
		};
	} catch (error) {
		console.log(`[ERROR] ${email} -> ${error.message}`);
		return {
			email,
			status: 'error',
			message: error.message || 'Unknown error',
			mails: [],
		};
	} finally {
		if (browser) await browser.close();
	}
};

export { loginAndGetMail };
