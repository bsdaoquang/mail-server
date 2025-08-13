/** @format */

import { fetchEmails } from '../utils/fetchEmails.js';

/** @format */
const getMails = async (req, res) => {
	const { email, appPassword } = req.body;

	if (!email || !appPassword) {
		res
			.status(400)
			.json({ message: 'Thiếu thông tin email hoặc mật khẩu ứng dụng' });
	}

	try {
		const mails = await fetchEmails(req.body);
		res.status(200).json({
			message: 'Thành công',
			data: mails,
		});
	} catch (err) {
		console.error('Lỗi khi lấy email:', err.message);

		let statusCode = 500;
		let errorMsg = 'Lỗi không xác định';

		if (err.code === 'EAUTH') {
			statusCode = 401;
			errorMsg = 'Xác thực thất bại: email hoặc app password sai';
		} else if (err.code === 'ENOTFOUND') {
			statusCode = 502;
			errorMsg = 'Không kết nối được đến server Gmail';
		} else if (err.code === 'ECONNECTION') {
			statusCode = 504;
			errorMsg = 'Kết nối Gmail bị timeout';
		} else {
			errorMsg = err.response || errorMsg;
		}

		res.status(statusCode).json({
			message: errorMsg,
			error: err,
		});
	}
};

export { getMails };
