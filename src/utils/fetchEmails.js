/** @format */

/** @format */
import puppeteer from 'puppeteer-extra';
import speakeasy from 'speakeasy';
import { config } from '../config.js';
import axios from 'axios';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const API_KEY = config.API_KEY_2CAPTCHA;

function getChromePath() {
	try {
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

// Safe click with log
const safeClick = async (page, selector, stepName = '') => {
	console.log(`[DEBUG] Trying click: ${stepName} -> selector: ${selector}`);
	await page.waitForSelector(selector, { visible: true, timeout: 30000 });
	await page.waitForFunction(
		(sel) => {
			const el = document.querySelector(sel);
			if (!el) return false;
			const style = window.getComputedStyle(el);
			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				!el.disabled
			);
		},
		{},
		selector
	);
	await page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (el) el.click();
	}, selector);
	console.log(`[DEBUG] Clicked: ${stepName}`);
};

// Try multiple selectors
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

	let sitekey = null;

	// 1. Nghe request network để lấy sitekey
	page.on('request', (req) => {
		const url = req.url();
		if (url.includes('/recaptcha/api2/anchor')) {
			const match = url.match(/[?&]k=([0-9A-Za-z_-]+)/);
			if (match) {
				sitekey = match[1];
				console.log(`[DEBUG] Captcha sitekey found from network: ${sitekey}`);
			}
		}
	});

	// 2. Chờ iframe captcha xuất hiện
	const captchaFrame = await page
		.waitForSelector('iframe[src*="recaptcha"]', { timeout: 15000 })
		.catch(() => null);
	if (!captchaFrame) {
		console.log('[DEBUG] No captcha iframe found.');
		return null;
	}

	// 3. Nếu sitekey chưa có, thử lấy trong iframe
	if (!sitekey) {
		const frame = page.frames().find((f) => f.url().includes('recaptcha'));
		if (frame) {
			sitekey = await frame.evaluate(() => {
				const el = document.querySelector('[data-sitekey]');
				return el ? el.getAttribute('data-sitekey') : null;
			});
		}
	}

	if (!sitekey) {
		console.log('[ERROR] Could not find sitekey for captcha.');
		return null;
	}

	// 4. Gửi tới 2Captcha
	const id = await axios.get(
		`http://2captcha.com/in.php?key=${API_KEY}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${page.url()}&json=1`
	);
	const requestId = id.data.request;

	let token = '';
	while (true) {
		await new Promise((r) => setTimeout(r, 5000));
		const res = await axios.get(
			`http://2captcha.com/res.php?key=${API_KEY}&action=get&id=${requestId}&json=1`
		);
		if (res.data.status === 1) {
			token = res.data.request;
			break;
		}
		console.log('[DEBUG] Waiting for captcha solution...');
	}
	console.log('[DEBUG] Captcha solved.');
	return token;
};
// ... giữ nguyên các import và hàm safeClick, tryClickMultiple, solveCaptcha ...

const loginAndGetMail = async ({ email, password }) => {
	let browser;
	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	console.log(`\n[START] Processing account: ${email}`);
	const chromePath = '/usr/bin/chromium-browser';
	if (!chromePath) {
		throw new Error('Không tìm thấy Chrome/Chromium trên VPS.');
	}
	try {
		browser = await puppeteer
			.launch({
				headless: true,
				executablePath: chromePath,
				args: [
					'--no-sandbox',
					'--disable-setuid-sandbox',
					'--disable-dev-shm-usage',
					'--disable-gpu',
				],
			})
			.catch((e) => {
				console.log('Can not open Chrome path ' + chromePath);
				throw new Error(`Không thể mở trình duyệt`);
			});

		const page = await browser.newPage();
		await page.setUserAgent(
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115 Safari/537.36'
		);
		await page.setViewport({ width: 1366, height: 768 });

		console.log('[DEBUG] Opening Google login page...');
		await page.goto('https://accounts.google.com/signin/v2/identifier', {
			waitUntil: 'networkidle2',
		});

		console.log('[DEBUG] Typing email...');
		const emailInput = await page.waitForSelector(
			'input[type="email"], input[name="identifier"]',
			{ visible: true, timeout: 30000 }
		);
		await emailInput.type(email, { delay: 50 });

		const emailNextSelectors = [
			'#identifierNext',
			'button[jsname="LgbsSe"]',
			'div[role="button"][id*="Next"]',
			'div[role="button"][jsname]',
			'div[role="button"]:has(span)',
		];
		if (!(await tryClickMultiple(page, emailNextSelectors, 'Email Next'))) {
			return {
				email,
				status: 'error',
				message: 'Không tìm thấy nút Tiếp theo sau khi nhập email',
				mails: [],
			};
		}
		await page
			.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
			.catch(() => {});

		// Captcha ở bước email
		if (await page.$('iframe[src*="recaptcha"]')) {
			const token = await solveCaptcha(page);
			if (token) {
				await page.evaluate(
					`document.getElementById("g-recaptcha-response").innerHTML="${token}";`
				);
				await safeClick(page, '#recaptcha-demo-submit', 'Captcha Submit Email');
				await wait(3000);
			} else {
				return {
					email,
					status: 'error',
					message: 'Captcha ở bước email thất bại',
					mails: [],
				};
			}
		}

		console.log('[DEBUG] Typing password...');
		const passwordInput = await page.waitForSelector(
			'input[name="Passwd"], input[type="password"]',
			{ visible: true, timeout: 30000 }
		);
		await passwordInput.focus();
		await passwordInput.type(password, { delay: 50 });

		const passwordNextSelectors = [
			'#passwordNext',
			'button[jsname="LgbsSe"]',
			'div[role="button"][id*="Next"]',
			'div[role="button"][jsname]',
			'div[role="button"]:has(span)',
		];
		if (
			!(await tryClickMultiple(page, passwordNextSelectors, 'Password Next'))
		) {
			return {
				email,
				status: 'error',
				message: 'Không tìm thấy nút Tiếp theo sau khi nhập mật khẩu',
				mails: [],
			};
		}
		await page
			.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
			.catch(() => {});

		// Captcha ở bước password
		if (await page.$('iframe[src*="recaptcha"]')) {
			const token = await solveCaptcha(page);
			if (token) {
				await page.evaluate(
					`document.getElementById("g-recaptcha-response").innerHTML="${token}";`
				);
				await safeClick(
					page,
					'#recaptcha-demo-submit',
					'Captcha Submit Password'
				);
				await wait(3000);
			} else {
				console.log(
					`[MANUAL] Captcha không có sitekey ở bước password cho ${email}`
				);
				const screenshotPath = `captcha_${Date.now()}.png`;
				await page.screenshot({ path: screenshotPath });
				console.log(`[MANUAL] Đã lưu screenshot tại: ${screenshotPath}`);
				console.log(
					`[MANUAL] Vui lòng giải captcha thủ công rồi nhấn Enter để tiếp tục.`
				);
				await new Promise((resolve) => {
					process.stdin.resume();
					process.stdin.once('data', () => {
						process.stdin.pause();
						resolve();
					});
				});
			}
		}

		// OTP / 2FA
		if (await page.$('input[type="tel"]')) {
			console.log('[DEBUG] OTP required.');
			if (!otpSecret) {
				return {
					email,
					status: 'error',
					message: 'Yêu cầu OTP nhưng không có otpSecret',
					mails: [],
				};
			}
			const otp = speakeasy.totp({ secret: otpSecret, encoding: 'base32' });
			await page.type('input[type="tel"]', otp, { delay: 50 });

			const otpNextSelectors = [
				'#idvPreregisteredPhoneNext',
				'#idvAnyPhoneNext',
				'#totpNext',
				'div[role="button"]:has(span)',
			];
			if (!(await tryClickMultiple(page, otpNextSelectors, 'OTP Next'))) {
				return {
					email,
					status: 'error',
					message: 'Không tìm thấy nút Tiếp theo sau khi nhập OTP',
					mails: [],
				};
			}
			await page
				.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
				.catch(() => {});
		}

		// Bỏ qua bước thêm số điện thoại / email khôi phục
		await wait(5000);
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

		console.log('[DEBUG] Opening Gmail...');
		await page.goto('https://mail.google.com/mail/u/0/#inbox', {
			waitUntil: 'networkidle2',
		});

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

		await wait(5000);

		if (!emails.length) {
			console.log('[DEBUG] No emails fetched.');
			return {
				email,
				status: 'error',
				message: 'Đăng nhập thành công, không phát hiện nội dung email',
				mails: [],
			};
		}

		console.log('[DEBUG] Emails fetched successfully.');
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
			message: error.message || 'Lỗi không xác định',
			mails: [],
		};
	} finally {
		if (browser) await browser.close();
	}
};

export { loginAndGetMail };
