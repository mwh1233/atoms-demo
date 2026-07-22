export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  initial_prompt: string;
  template_id: string | null;
  generated_code: string | null;
  generated_files: Record<string, string>;
  architecture_doc: string | null;
  file_tree_plan: FileTreePlanItem[];
  status:
    | "pending"
    | "generating"
    | "awaiting_features_confirmation"
    | "awaiting_confirmation"
    | "completed"
    | "failed";
  current_step: "pending" | "analyzing" | "designing" | "coding" | "deploying" | "completed" | null;
  error_message: string | null;
  deploy_status: "not_deployed" | "deploying" | "success" | "failed";
  deployed_url: string | null;
  deployed_at: string | null;
  features_list: Feature[];
  confirmed_features: Feature[];
  created_at: string;
  updated_at: string;
}

export interface Feature {
  id: string;
  name: string;
  description: string;
  defaultSelected: boolean;
}

export interface FileTreePlanItem {
  path: string;
  description: string;
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
