import { supabase } from '../config/supabase.js';

// 🆕 HELPER: GET SETTINGS FROM DATABASE
const getSystemSettings = async () => {
  const { data: settings } = await supabase
    .from('system_settings')
    .select('daily_queue_limit, office_hours')
    .single();

  return {
    dailyLimit: settings?.daily_queue_limit || 100,
    officeHours: settings?.office_hours || 'Monday to Friday, 8:00 AM - 4:45 PM'
  };
};

// HELPER: GET PHILIPPINE DATE
const getPHDate = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};

// GET QUEUE STATUS (for Dashboard)
export const getQueueStatus = async (req, res) => {
  try {
    const today = getPHDate();
    const { dailyLimit } = await getSystemSettings();
    
    // Get current serving
    const { data: currentServing, error: servingError } = await supabase
  .from('requests')
  .select('queue_number')
  .eq('queue_date', today)
  .in('status', ['processing', 'ready'])
  .order('queue_number', { ascending: false }) // ✅ FIX HERE
  .limit(1);
    
    if (servingError) throw servingError;
    
    // Get last issued queue number
    const { data: lastQueue, error: lastError } = await supabase
      .from('requests')
      .select('queue_number')
      .eq('queue_date', today)
      .not('status', 'in', '("rejected","claimed")')
      .order('queue_number', { ascending: false })
      .limit(1);
    
    if (lastError) throw lastError;
    
    // Get pending count
    const { count: pendingCount, error: pendingError } = await supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('queue_date', today)
      .not('status', 'in', '("rejected","claimed")');
    
    if (pendingError) throw pendingError;
    
    // Get total requests today
    const { count: totalToday, error: countError } = await supabase
      .from('requests')
      .select('*', { count: 'exact', head: true })
      .eq('queue_date', today);
    
    if (countError) throw countError;
    
    // Build response
    const responseData = {
      success: true,
      current_serving: currentServing?.[0]?.queue_number || null,
      last_queue_number: lastQueue?.[0]?.queue_number || null,
      pending_count: pendingCount || 0,
      total_requests_today: totalToday || 0,
      queue_limit: dailyLimit,
      is_limit_reached: (totalToday || 0) >= dailyLimit,
      last_updated: new Date().toISOString()
    };

    // ✅ Debug print (what frontend receives)
    console.log("📊 Queue Status Response:", responseData);
    // Optional cleaner view:
    // console.table(responseData);

    // Send to frontend
    res.json(responseData);
    
  } catch (error) {
    console.error('❌ Error fetching queue status:', error);
    res.status(500).json({ error: error.message });
  }
};