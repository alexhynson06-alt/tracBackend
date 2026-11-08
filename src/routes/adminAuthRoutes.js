import express from 'express';
import { authenticateToken as auth, requireAdmin, authorizeRoles, authorizeAdminRoles } from '../middleware/auth.middleware.js';
import { avatarUploadSingle } from '../middleware/avatarUpload.js';
import {
  getCurrentAdmin,
  updateCurrentAdmin,
  uploadAdminAvatar,
  deleteAdminAvatar,
  getAllAdmins,
  updateAdminStatus
} from '../controllers/adminAuthController.js';

const router = express.Router();

// ===========================================
// PROTECTED ROUTES - All routes below require authentication AND admin role
// ===========================================
router.use(auth);
router.use(requireAdmin); // All routes below this require admin privileges

// ===========================================
// ADMIN ROUTES - Any admin can access
// ===========================================
router.get('/me', getCurrentAdmin);
router.patch('/me', authorizeAdminRoles('admin', 'staff'), updateCurrentAdmin);
router.post('/me/avatar', authorizeAdminRoles('admin', 'staff'), avatarUploadSingle, uploadAdminAvatar);
router.delete('/me/avatar', authorizeAdminRoles('admin', 'staff'), deleteAdminAvatar);
// ===========================================
// SUPER ADMIN ONLY ROUTES
// ===========================================
router.get('/admins', 
  authorizeRoles('super_admin'), 
  getAllAdmins
);

router.patch('/admins/:id/status', 
  authorizeRoles('super_admin'), 
  updateAdminStatus
);

export default router;