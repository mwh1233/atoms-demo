export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  initial_prompt: string;
  generated_code: string | null;
  status: "pending" | "generating" | "completed" | "failed";
  current_step: "analyzing" | "designing" | "coding" | "deploying" | null;
  error_message: string | null;
  deploy_status: "not_deployed" | "deploying" | "success" | "failed";
  deployed_url: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  step: "analysis" | "design" | "code" | "system" | null;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  category: "SaaS" | "ecommerce" | "tool" | "personal";
  description: string | null;
  preview_image: string | null;
  default_prompt: string;
  sort_order: number;
  created_at: string;
}
