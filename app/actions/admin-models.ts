"use server";

import { createClient } from "@/lib/supabase/server";

export async function revokeAllModelAssignmentsAction() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const isAdmin = [
      "nthanhnam@gmail.com"
    ].includes(user.email || "");

    if (!isAdmin) throw new Error("Permission denied. Admin only.");

    // Clear admin_assigned_model for all profiles
    // Use neq with a fake ID to target all rows (standard Supabase trick for mass update)
    const { error } = await supabase
      .from("profiles")
      .update({ admin_assigned_model: null })
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) throw error;

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
