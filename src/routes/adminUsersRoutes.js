// backend/src/routes/adminUsersRoutes.js

import express from 'express';
import { authenticateToken, authorizeRoles, requireAdmin } from '../middleware/auth.middleware.js';
import {
  getAllAdminUsers,
  addAdminUser,
  updateAdminUser,
  deleteAdminUser,
  resetAdminPassword
} from '../controllers/adminUsersController.js';

const router = express.Router();

// All routes require authentication and admin privileges
router.use(authenticateToken);
router.use(requireAdmin);
router.use(authorizeRoles('super_admin'));

// ✅ UPDATED: removed "/admin-users" prefix (base is /api/admin)
// Now endpoints are:
// GET    /api/admin/users
// POST   /api/admin/users
// PUT    /api/admin/users/:id
// DELETE /api/admin/users/:id
// POST   /api/admin/users/:id/reset-password

router.get('/users', getAllAdminUsers);
router.post('/users', addAdminUser);
router.put('/users/:id', updateAdminUser);
router.delete('/users/:id', deleteAdminUser);
router.post('/users/:id/reset-password', resetAdminPassword);

export default router;