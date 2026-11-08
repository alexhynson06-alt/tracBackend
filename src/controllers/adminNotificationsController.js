import { supabase } from '../config/supabase.js';

const NOTIFICATION_LIMIT = 20;

export const getMyNotifications = async (req, res) => {
  try {
    const adminId = req.user.userId;

    const [listResult, unreadResult] = await Promise.all([
      supabase
        .from('admin_notifications')
        .select('id, request_id, type, title, message, link, is_read, created_at')
        .eq('admin_id', adminId)
        .order('created_at', { ascending: false })
        .limit(NOTIFICATION_LIMIT),
      supabase
        .from('admin_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('is_read', false)
    ]);

    if (listResult.error) throw listResult.error;
    if (unreadResult.error) throw unreadResult.error;

    res.status(200).json({
      notifications: listResult.data || [],
      unread_count: unreadResult.count || 0
    });
  } catch (error) {
    console.error('Get admin notifications error:', error);
    res.status(500).json({ message: 'Failed to load notifications.' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const { error } = await supabase
      .from('admin_notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('admin_id', req.user.userId);

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ message: 'Failed to update notification.' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const { error } = await supabase
      .from('admin_notifications')
      .update({ is_read: true })
      .eq('admin_id', req.user.userId)
      .eq('is_read', false);

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ message: 'Failed to update notifications.' });
  }
};
