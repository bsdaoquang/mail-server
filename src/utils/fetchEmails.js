/** @format */

import { ImapFlow } from 'imapflow';

const fetchEmails = async ({
	email,
	appPassword,
	limit = 10,
	mailbox = 'INBOX',
}) => {
	if (!email || !appPassword) {
		throw new Error('Thiếu thông tin email hoặc mật khẩu ứng dụng');
	}

	const client = new ImapFlow({
		host: 'imap.gmail.com',
		port: 993,
		secure: true,
		auth: {
			user: email,
			pass: appPassword,
		},
		logger: false,
	});

	const messages = [];

	try {
		await client.connect();

		// khoá mail
		const lock = await client.getMailboxLock(mailbox);
		try {
			// lấy UID của các message
			let uids = await client.search(
				{
					all: true,
				},
				{ uid: true }
			);
			if (!uids.length) {
				return [];
			}

			uids = uids.slice(-limit).reverse(); // Lấy mới nhất trước
			for (const uid of uids) {
				for await (let msg of client.fetch(
					{ uid },
					{
						envelope: true,
						bodyStructure: true,
					}
				)) {
					const from = (msg.envelope.from || [])
						.map((a) => a.address)
						.join(', ');
					const to = (msg.envelope.to || []).map((a) => a.address).join(', ');

					messages.push({
						uid,
						from,
						to,
						subject: msg.envelope.subject,
						date: msg.envelope.date,
					});
				}
			}
		} catch (error) {
			throw error;
		} finally {
			lock.release();
		}
	} catch (error) {
		throw error;
	} finally {
		try {
			await client.logout();
		} catch (error) {}
	}

	return messages;
};

export { fetchEmails };
