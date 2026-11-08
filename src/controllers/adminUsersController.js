// backend/src/controllers/adminUsersController.js

import { supabase } from '../config/supabase.js';
import { adminAppUrl } from '../config/email.js';

// Helper: Generate username from email
const generateUsername = (email) => {
  return email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
};

// Department list for validation
const VALID_DEPARTMENTS = ['CCS', 'COED', 'CAS', 'COF', 'CIAS', 'IOES', 'ALL'];

// =============================================
// GET ALL ADMIN USERS
// =============================================
export const getAllAdminUsers = async (req, res) => {
  try {
    const { data: users, error } = await supabase
      .from('admins')
      .select('id, username, email, full_name, role, department, is_active, last_login, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const transformedUsers = users.map(user => ({
      id: user.id,
      name: user.full_name,
      username: user.username,
      email: user.email,
      role: user.role,
      status: user.is_active ? 'active' : 'inactive',
      department: user.department || 'CCS',
      last_active: user.last_login,
      created_at: user.created_at
    }));

    res.status(200).json({
      success: true,
      users: transformedUsers
    });
  } catch (err) {
    console.error('Error fetching admin users:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// ADD NEW ADMIN USER
// =============================================
export const addAdminUser = async (req, res) => {
  try {
    const { name, role = 'staff', department = 'CCS' } = req.body;
    const email = req.body.email?.trim().toLowerCase();

    if (typeof name !== 'string' || !name.trim() || !email) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    // Validate department
    if (!VALID_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ message: 'Invalid department selected' });
    }

    if (!['admin', 'staff'].includes(role)) {
      return res.status(400).json({ message: 'Only staff and admin roles can be invited' });
    }

    const { data: existing } = await supabase
      .from('admins')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const { data: invitation, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${adminAppUrl}/login?flow=invite`
    });

    if (inviteError) {
      if (inviteError.code === 'email_exists' || inviteError.status === 422) {
        return res.status(409).json({ message: 'An account with this email already exists' });
      }
      throw inviteError;
    }

    const userId = invitation.user.id;
    const username = `${generateUsername(email) || 'admin'}-${userId.slice(0, 6)}`;
    const { data: newUser, error } = await supabase
      .from('admins')
      .insert({
        id: userId,
        username,
        email,
        full_name: name.trim(),
        role,
        department,
        is_active: true
      })
      .select('id, username, email, full_name, role, department, is_active, created_at')
      .single();

    if (error) {
      await supabase.auth.admin.deleteUser(userId).catch(() => {});
      throw error;
    }

    res.status(201).json({
      success: true,
      message: 'Admin invitation sent successfully',
      user: {
        id: newUser.id,
        name: newUser.full_name,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        department: newUser.department,
        status: newUser.is_active ? 'active' : 'inactive',
        created_at: newUser.created_at
      }
    });
  } catch (err) {
    console.error('Error adding admin user:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// UPDATE ADMIN USER
// =============================================
export const updateAdminUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, status, role, department } = req.body;

    const { data: existingUser, error: lookupError } = await supabase
      .from('admins')
      .select('id, email, role, is_active')
      .eq('id', id)
      .single();

    if (lookupError || !existingUser) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    if (email && email.trim().toLowerCase() !== existingUser.email.toLowerCase()) {
      return res.status(400).json({ message: 'Change the email through Supabase Auth account settings' });
    }

    if (role !== undefined && !['admin', 'staff', 'super_admin'].includes(role)) {
      return res.status(400).json({ message: 'Invalid admin role' });
    }

    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: 'Invalid admin status' });
    }

    if (department !== undefined && !VALID_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ message: 'Invalid department selected' });
    }

    const isActive = status === undefined ? existingUser.is_active : status === 'active';
    const nextRole = role ?? existingUser.role;
    const removingSuperAdminAccess = existingUser.role === 'super_admin' && (!isActive || nextRole !== 'super_admin');

    if (removingSuperAdminAccess) {
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

    if (!isActive && id === req.user.userId) {
      return res.status(400).json({ message: 'You cannot deactivate your own account' });
    }

    const updateData = {};
    if (name !== undefined) updateData.full_name = name;
    if (role !== undefined) updateData.role = role;
    if (department !== undefined) updateData.department = department;
    if (status !== undefined) updateData.is_active = isActive;
    
    updateData.updated_at = new Date().toISOString();

    if (isActive && status !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, { ban_duration: 'none' });
      if (authError) throw authError;
    }

    const { data: updatedUser, error } = await supabase
      .from('admins')
      .update(updateData)
      .eq('id', id)
      .select('id, username, email, full_name, role, department, is_active, created_at')
      .single();

    if (error) throw error;

    if (!isActive && status !== undefined) {
      const { error: authError } = await supabase.auth.admin.updateUserById(id, { ban_duration: '876000h' });
      if (authError) throw authError;
    }

    res.status(200).json({
      success: true,
      message: 'Admin user updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.full_name,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        department: updatedUser.department,
        status: updatedUser.is_active ? 'active' : 'inactive',
        created_at: updatedUser.created_at
      }
    });
  } catch (err) {
    console.error('Error updating admin user:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// DELETE ADMIN USER
// =============================================
export const deleteAdminUser = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: fetchError } = await supabase
      .from('admins')
      .select('role')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    if (user.role === 'super_admin') {
      return res.status(400).json({ message: 'Cannot delete the Registrar account' });
    }

    const { error } = await supabase.auth.admin.deleteUser(id);

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'Admin user deleted successfully'
    });
  } catch (err) {
    console.error('Error deleting admin user:', err);
    res.status(500).json({ error: err.message });
  }
};

// =============================================
// RESET ADMIN PASSWORD
// =============================================
export const resetAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { data: admin, error: lookupError } = await supabase
      .from('admins')
      .select('email')
      .eq('id', id)
      .maybeSingle();

    if (lookupError || !admin) return res.status(404).json({ message: 'Admin user not found' });

    const { error } = await supabase.auth.resetPasswordForEmail(admin.email, {
      redirectTo: `${adminAppUrl}/login?flow=recovery`
    });
    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'Password recovery email sent successfully'
    });
  } catch (err) {
    console.error('Error resetting password:', err);
    res.status(500).json({ error: err.message });
  }
};