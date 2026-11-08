import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.routes.js';
import requestRoutes from './routes/request.routes.js';
import testRoutes from './routes/test.routes.js';
import adminAuthRoutes from './routes/adminAuthRoutes.js';
import updateStatusRoutes from './routes/updateStatusRoutes.js';
import emailLogsRoutes from './routes/emailLogsRoutes.js';
import activityLogsRoutes from './routes/activityLogsRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js'; 
import adminUsersRoutes from './routes/adminUsersRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import queueRoutes from './routes/queue.routes.js';
import adminNotificationsRoutes from './routes/adminNotificationsRoutes.js';

// 🆕 PUBLIC SETTINGS — No authentication required
import { getPublicSettings } from './controllers/settingsController.js';

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:3002,http://localhost:5000')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);

app.use(cors({
	origin: (origin, callback) => {
		if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
		return callback(new Error('Origin is not allowed by CORS'));
	},
	methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	allowedHeaders: ['Content-Type', 'Authorization'],
	exposedHeaders: ['ETag']
}));
app.use(express.json());

// 🆕 PUBLIC SETTINGS ENDPOINT — No auth required
app.get('/api/public/settings', getPublicSettings);

// ✅ IMPORTANTE: UNAHIN ANG QUEUE ROUTES
app.use('/api/queue', queueRoutes);

// Routes na walang conflict
app.use('/api/test', testRoutes);
app.use('/api/admin/notifications', adminNotificationsRoutes); // /api/admin/notifications
app.use('/api/admin', adminAuthRoutes);      // /api/admin/auth
app.use('/api/requests', requestRoutes);     // /api/requests/*
app.use('/api/auth', authRoutes);            // /api/auth/*
app.use('/api', updateStatusRoutes);         // /api/update-status
app.use('/api', emailLogsRoutes);            // /api/email-logs
app.use('/api', activityLogsRoutes);         // /api/activity-logs
app.use('/api/requests', dashboardRoutes);   // /api/requests/dashboard-stats
app.use('/api/admin', adminUsersRoutes);     // /api/admin/users
app.use('/api/admin', settingsRoutes);       // /api/admin/settings

export default app;