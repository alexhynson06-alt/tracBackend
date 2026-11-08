import express from 'express';
import { authenticateToken as auth, requireAdmin } from '../middleware/auth.middleware.js';
import {
  updateRequestStatus,
  bulkUpdateRequestStatus,
  getStatusHistory
} from '../controllers/updateStatusController.js';
import { confirmOfficialReceipt, rejectOfficialReceipt } from '../controllers/orController.js';

const router = express.Router();

// ===========================================
// ADMIN ROUTES - bawat route ay may sariling auth + requireAdmin
// ===========================================

// Get status history for a specific request
router.get('/requests/:id/history', auth, requireAdmin, getStatusHistory);

// Update single request status
router.put('/requests/:id/status', auth, requireAdmin, updateRequestStatus);

// Bulk update multiple requests
router.post('/requests/bulk-status', auth, requireAdmin, bulkUpdateRequestStatus);

router.put('/requests/:id/or/confirm', auth, requireAdmin, confirmOfficialReceipt);
router.put('/requests/:id/or/reject', auth, requireAdmin, rejectOfficialReceipt);

export default router;