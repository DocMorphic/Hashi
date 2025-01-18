import { createClient } from '@supabase/supabase-js';

// Initialize the Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// High scores table type
export type HighScore = {
  id?: number;
  username: string;
  score: number;
  timestamp: number;
  created_at?: string;
};

// High scores functions
export const highScores = {
  async getAll(): Promise<HighScore[]> {
    const { data, error } = await supabase
      .from('high_scores')
      .select('*')
      .order('score', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Error fetching high scores:', error);
      return [];
    }
    
    return data || [];
  },

  async upsert(score: Omit<HighScore, 'id' | 'created_at'>): Promise<HighScore | null> {
    // First check if user already has a score
    const { data: existing } = await supabase
      .from('high_scores')
      .select('*')
      .eq('username', score.username)
      .single();

    // Only update if new score is higher
    if (existing && existing.score >= score.score) {
      return existing;
    }

    const { data, error } = await supabase
      .from('high_scores')
      .upsert(
        { 
          username: score.username,
          score: score.score,
          timestamp: score.timestamp
        },
        { 
          onConflict: 'username',
          ignoreDuplicates: false
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting high score:', error);
      return null;
    }

    return data;
  }
}; 