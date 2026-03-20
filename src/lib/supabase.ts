import { createClient } from "@supabase/supabase-js";

// nod's shared supabase instance — anon key is safe to embed (RLS enforced)
const NOD_SUPABASE_URL = "https://ooykzbkcquvreeheaijy.supabase.co";
const NOD_SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9veWt6YmtjcXV2cmVlaGVhaWp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MDU5OTMsImV4cCI6MjA4OTI4MTk5M30.dR52jvzt6in0hL8eJFD8CGmpbHO0WuE2q8FrN3NxHfw";

const supabaseUrl = process.env.SUPABASE_URL || process.env.NOD_SUPABASE_URL || NOD_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NOD_SUPABASE_KEY || NOD_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);
