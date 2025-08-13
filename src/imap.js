/** @format */

import { ImapFlow } from 'imapflow';

/**
 * Đọc email từ Gmail qua IMAP bằng App Password
 * @param {Object} opt
 * @param {string} opt.email - Gmail address
 * @param {string} opt.appPassword - 16-char App Password
 * @param {number} [opt.limit=10] - số email gần nhất
 * @param {string} [opt.mailbox='INBOX'] - hộp thư
 * @returns {Promise<Array>} danh sách email đã chuẩn hoá
 */
export const fetchEmails = async ({
	email,
	appPassword,
	limit = 10,
	mailbox = 'INBOX',
}) => {
	if (!email || !appPassword) throw new Error('Missing credentials');

	const client = new ImapFlow({
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		auth: { user: email, pass: appPassword },
		logger: false,
	});

	const messages = [];

	try {
		await client.connect();

		// Khoá mailbox để đọc an toàn
		const lock = await client.getMailboxLock(mailbox);
		try {
			// Lấy UID của các message gần nhất
			let uids = await client.search({ all: true }, { uid: true });
			if (!uids.length) return [];
			uids = uids.slice(-limit).reverse(); // mới nhất trước

			for (const uid of uids) {
				const msg = await client.fetchOne(uid, {
					envelope: true,
					source: false,
					bodyStructure: true,
				});

				const from = (msg.envelope.from || []).map((a) => a.address).join(', ');
				const to = (msg.envelope.to || []).map((a) => a.address).join(', ');

				messages.push({
					uid,
					subject: msg.envelope.subject || '',
					from,
					to,
					date: msg.envelope.date || null,
				});
			}
		} finally {
			lock.release();
		}
	} finally {
		try {
			await client.logout();
		} catch {}
	}

	return messages;
};
