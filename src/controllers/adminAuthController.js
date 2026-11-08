import { supabase } from '../config/supabase.js';
import { storageService } from '../services/cloudinaryService.js';

export const getCurrentAdmin = async (req, res) => {
  try {
    const { data: admin, error } = await supabase
      .from('admins')
      .select('id, username, email, full_name, role, department, last_login, created_at, is_active, avatar_url')
      .eq('id', req.user.userId)
      .single();

    if (error || !admin) {
      return res.status(404).json({ 
        message: 'Admin not found' 
      });
    }

    res.status(200).json(admin);

  } catch (err) {
    console.error('Get current admin error:', err);
    res.status(500).json({ 
      message: 'Failed to get admin data' 
    });
  }
};

export const updateCurrentAdmin = async (req, res) => {
  try {
    const { email, full_name } = req.body;
    const updates = {};

    if (email !== undefined) {
      return res.status(400).json({ message: 'Change the email through Supabase Auth account settings' });
    }
    if (full_name !== undefined) updates.full_name = full_name;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    if (email) {
      const { data: existingAdmin } = await supabase
        .from('admins')
        .select('id')
        .eq('email', email)
        .neq('id', req.user.userId)
        .maybeSingle();

      if (existingAdmin) {
        return res.status(400).json({ message: 'Email already in use by another account' });
      }
    }

    const { data: admin, error } = await supabase
      .from('admins')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', req.user.userId)
      .select('id, username, email, full_name, role, department, last_login, created_at, is_active, avatar_url')
      .single();

    if (error || !admin) throw error || new Error('Admin not found');

    res.status(200).json({ message: 'Profile updated successfully', admin });
  } catch (err) {
    console.error('Update current admin error:', err);
    res.status(500).json({ message: 'Failed to update admin profile' });
  }
};

export const uploadAdminAvatar = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'An image file is required' });
    }

    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('avatar_public_id')
      .eq('id', req.user.userId)
      .single();

    if (adminError || !admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const upload = await storageService.uploadImage(req.file, {
      folder: 'trac/avatars/admins'
    });

    const { data: updatedAdmin, error: updateError } = await supabase
      .from('admins')
      .update({ avatar_url: upload.url, avatar_public_id: upload.publicId, updated_at: new Date().toISOString() })
      .eq('id', req.user.userId)
      .select('avatar_url')
      .single();

    if (updateError) {
      await storageService.deleteImage(upload.publicId).catch(() => {});
      throw updateError;
    }

    if (admin.avatar_public_id) {
      await storageService.deleteImage(admin.avatar_public_id).catch((error) => {
        console.error('Previous admin avatar cleanup failed:', error.message);
      });
    }

    res.status(200).json({ message: 'Profile photo updated successfully', avatar_url: updatedAdmin.avatar_url });
  } catch (err) {
    console.error('Upload admin avatar error:', err);
    res.status(500).json({ message: err.message || 'Failed to update profile photo' });
  }
};

export const deleteAdminAvatar = async (req, res) => {
  try {
    const { data: admin, error: adminError } = await supabase
      .from('admins')
      .select('avatar_public_id')
      .eq('id', req.user.userId)
      .single();

    if (adminError || !admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    if (admin.avatar_public_id) {
      await storageService.deleteImage(admin.avatar_public_id);
    }

    const { error } = await supabase
      .from('admins')
      .update({ avatar_url: null, avatar_public_id: null, updated_at: new Date().toISOString() })
      .eq('id', req.user.userId);

    if (error) throw error;

    res.status(200).json({ message: 'Profile photo removed successfully' });
  } catch (err) {
    console.error('Delete admin avatar error:', err);
    res.status(500).json({ message: err.message || 'Failed to remove profile photo' });
  }
};

export const getAllAdmins = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'Only super admins can view all admins' 
      });
    }

    const { data: admins, error } = await supabase
      .from('admins')
      .select('id, username, email, full_name, role, department, is_active, last_login, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json(admins);

  } catch (err) {
    console.error('Get all admins error:', err);
    res.status(500).json({ 
      message: 'Failed to get admins' 
    });
  }
};

export const updateAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active, role } = req.body;

    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ 
        message: 'Only super admins can update admin status' 
      });
    }

    if (role !== undefined && !['super_admin', 'admin', 'staff'].includes(role)) {
      return res.status(400).json({ message: 'Invalid admin role' });
    }

    const { data: currentAdmin, error: currentAdminError } = await supabase
      .from('admins')
      .select('role, is_active')
      .eq('id', id)
      .maybeSingle();

    if (currentAdminError) throw currentAdminError;
    if (!currentAdmin) return res.status(404).json({ message: 'Admin not found' });

    if (id === req.user.userId && is_active === false) {
      return res.status(400).json({ 
        message: 'You cannot deactivate your own account' 
      });
    }

    const nextRole = role ?? currentAdmin.role;
    const nextIsActive = is_active ?? currentAdmin.is_active;
    if (currentAdmin.role === 'super_admin' && (!nextIsActive || nextRole !== 'super_admin')) {
      const { count, error: countError } = await supabase
        .from('admins')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin')
        .eq('is_active', true);

      if (countError) throw countError;
      if (count <= 1) {
        return res.status(409).json({ message: 'The final active SuperAdmin cannot be deactivated or demoted' });
      }
    }

    const updates = {
      ...(is_active !== undefined && { is_active }),
      ...(role !== undefined && { role }),
      updated_at: new Date().toISOString()
    };

    const { data: admin, error } = await supabase
      .from('admins')
      .update(updates)
      .eq('id', id)
      .select('id, username, email, full_name, role, is_active')
      .single();

    if (error) throw error;

    if (is_active !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, {
        ban_duration: is_active ? 'none' : '876000h'
      });
      if (authError) throw authError;
    }

    res.status(200).json({
      message: 'Admin updated successfully',
      admin
    });

  } catch (err) {
    console.error('Update admin status error:', err);
    res.status(500).json({ 
      message: 'Failed to update admin' 
    });
  }
};

export const verifyAdminToken = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const role = req.user.role;
    const { data: admin, error } = await supabase
      .from('admins')
      .select('id, username, role, is_active')
      .eq('id', adminId)
      .single();

    if (error || !admin || !admin.is_active) {
      return res.status(401).json({ 
        message: 'Admin account is inactive or not found' 
      });
    }

    res.status(200).json({
      valid: true,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role
      }
    });

  } catch (err) {
    console.error('Verify admin token error:', err);
    res.status(500).json({ 
      message: 'Failed to verify token' 
    });
  }
};