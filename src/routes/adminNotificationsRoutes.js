import express from 'express';
import { authenticateToken as auth, requireAdmin } from '../middleware/auth.middleware.js';
import {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead
} from '../controllers/adminNotificationsController.js';

const router = express.Router();

router.use(auth);
router.use(requireAdmin);

router.get('/', getMyNotifications);
router.patch('/read-all', markAllNotificationsRead);
router.patch('/:id/read', markNotificationRead);

export default router;
