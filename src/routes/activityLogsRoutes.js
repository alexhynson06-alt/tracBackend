import express from 'express';
import { authenticateToken as auth, requireAdmin } from '../middleware/auth.middleware.js';
import { getActivityLogs, getActivityLogById } from '../controllers/activityLogsController.js';

const router = express.Router();

// All activity log routes require authentication and admin privileges
router.use(auth);
router.use(requireAdmin);

router.get('/activity-logs', getActivityLogs);
router.get('/activity-logs/:id', getActivityLogById);

export default router;