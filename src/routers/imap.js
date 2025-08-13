/** @format */

import { Router } from 'express';
import { getMails } from '../controllers/imap.js';

/** @format */
const router = Router();

router.post('/get-mails', getMails);

export default router;
