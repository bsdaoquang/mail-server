/** @format */

import { fetchEmails } from '../utils/fetchEmails.js';

const getMails = async (req, res) => {
	const { emails } = req.body;

	try {
		const results = await fetchEmails(emails);

		res.status(200).json({
			message: 'Kết quả',
			data: results,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export { getMails };
