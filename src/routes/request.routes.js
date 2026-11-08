import express from 'express';
import { 
  createRequest, 
  getAllRequests,
  trackRequestByCode,
  getRequestById, 
  searchRequests,
  getUserRequests,
  getUserRequestDetails,
  getUserRequestTimeline,
  getAllandallRequests,
  exportRequestsToCSV,
  getPendingCount,
  getTodayRequests  // 🆕 Import the new handler
} from '../controllers/request.controller.js';
import { authenticateToken as auth, requireAdmin } from '../middleware/auth.middleware.js';
import { orUploadSingle } from '../middleware/orUpload.js';
import {
  uploadOfficialReceipt,
  getOfficialReceipt,
  getOfficialReceiptTimeline,
  getOfficialReceiptHistory
} from '../controllers/orController.js';

const router = express.Router();

// Protected routes — user must send valid JWT
router.post('/request', auth, createRequest);
router.get('/getrequest', auth, requireAdmin, getAllRequests);
router.get('/track/:tracking_code', auth, trackRequestByCode);
router.get('/requestbyid/:id', auth, getRequestById);
router.get('/user/requests', auth, getUserRequests);
router.get('/user/requests/:trackingCode/timeline', auth, getUserRequestTimeline);
router.get('/search', auth, requireAdmin, searchRequests);
router.get('/requests/all', auth, requireAdmin, getAllandallRequests);
router.get('/user/requests/:trackingCode', auth, getUserRequestDetails);
router.get('/export/csv', auth, requireAdmin, exportRequestsToCSV);

// 🆕 Pending count for sidebar badge
router.get('/pending-count', auth, getPendingCount);

// 🆕 Get today's requests for duplicate check (frontend dropdown disabling)
router.get('/today', auth, getTodayRequests);

// Official receipt upload is owned by the requester; viewing is allowed for the requester and admins.
router.post('/:id/or', auth, orUploadSingle, uploadOfficialReceipt);
router.get('/:id/or/timeline', auth, getOfficialReceiptTimeline);
router.get('/:id/or/history', auth, requireAdmin, getOfficialReceiptHistory);
router.get('/:id/or', auth, getOfficialReceipt);

export default router;