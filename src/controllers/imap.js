/** @format */

import { loginAndGetMail } from '../utils/fetchEmails.js';

const getMails = async (req, res) => {
	try {
		const results = await loginAndGetMail(req.body);

		res.status(200).json(results);
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export { getMails };
