import { cache } from "react";
import { cookies } from "next/headers";
import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";

export function createSupabaseServerClient() {
  return createServerComponentClient({ cookies });
}

// React cache: 同一个请求内只调用一次 getUser，避免 layout + page 重复请求
export const getCurrentUser = cache(async () => {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return { user, supabase };
});
