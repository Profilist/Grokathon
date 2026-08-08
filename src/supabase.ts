import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.WXT_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY?.trim();

let client: SupabaseClient | null = null;

export function hasSupabaseConfig(): boolean {
  return Boolean(supabaseUrl && supabasePublishableKey);
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseConfig()) return null;

  client ??= createClient(supabaseUrl!, supabasePublishableKey!, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });

  return client;
}

export async function ensureAnonymousUser(supabase: SupabaseClient): Promise<User> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (sessionData.session?.user) return sessionData.session.user;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("Supabase did not return an anonymous user");
  return data.user;
}
