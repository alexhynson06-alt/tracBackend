import jwt from 'jsonwebtoken';

const supabaseIssuer = `${process.env.SUPABASE_URL?.replace(/\/$/, '')}/auth/v1`;

const attachAdminProfile = async (req, res, userId) => {
  const { supabase } = await import('../config/supabase.js');
  const { data: admin, error } = await supabase
    .from('admins')
    .select('id, username, email, full_name, role, department, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Admin profile lookup failed:', error.message);
    res.status(500).json({ message: 'Unable to verify admin access' });
    return false;
  }

  if (!admin || !admin.is_active) {
    res.status(403).json({ message: 'Admin account is inactive or not authorized' });
    return false;
  }

  req.user = {
    userId: admin.id,
    role: admin.role,
    department: admin.department,
    type: 'admin',
    username: admin.username,
    email: admin.email,
    name: admin.full_name
  };
  return true;
};

export const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'No token provided' });

  const tokenClaims = jwt.decode(token);

  if (tokenClaims?.iss === supabaseIssuer) {
    try {
      const { supabase } = await import('../config/supabase.js');
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return res.status(403).json({ message: 'Invalid token' });
      }

      if (!(await attachAdminProfile(req, res, data.user.id))) return;
      return next();
    } catch (error) {
      console.error('Supabase admin token validation failed:', error.message);
      return res.status(403).json({ message: 'Invalid token' });
    }
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });

    if (decoded.type === 'admin' || decoded.role?.toLowerCase().includes('admin')) {
      try {
        if (!(await attachAdminProfile(req, res, decoded.userId))) return;
      } catch (error) {
        console.error('Admin profile verification failed:', error.message);
        return res.status(500).json({ message: 'Unable to verify admin access' });
      }
    } else {
      req.user = decoded;
    }

    next();
  });
};

// NEW: Role-based authorization middleware
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const userRole = req.user.role?.toLowerCase();
    const userType = req.user.type?.toLowerCase();

    // Check if user's role is in allowed roles
    // For admins: role might be 'admin', 'super_admin', etc.
    // For students: role might be 'student', 'alumni', etc.
    if (allowedRoles.includes(userRole) || allowedRoles.includes(userType)) {
      next();
    } else {
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.' 
      });
    }
  };
};

export const authorizeAdminRoles = (...allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.role?.toLowerCase();
    if (allowedRoles.includes(userRole)) {
      return next();
    }

    return res.status(403).json({ message: 'Access denied. This profile action is not available for your role.' });
  };
};

// NEW: Admin-only middleware (convenience wrapper)
export const requireAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const userRole = req.user.role?.toLowerCase();
  const userType = req.user.type?.toLowerCase();
  
  // Check if user is admin (role includes 'admin' or type is 'admin')
  if (userRole?.includes('admin') || userType === 'admin') {
    next();
  } else {
    return res.status(403).json({ 
      message: 'Access denied. Admin privileges required.' 
    });
  }
};