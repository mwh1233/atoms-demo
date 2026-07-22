from supabase import create_client
import os
from dotenv import load_dotenv

load_dotenv()
url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
supabase = create_client(url, key)

# 查询最新的5个项目
result = supabase.table('projects').select('id, name, status, current_step, error_message, created_at, updated_at, template_id, iteration_count').order('created_at', desc=True).limit(5).execute()
for p in result.data:
    print(f"项目: {p['name']}")
    print(f"  ID: {p['id']}")
    print(f"  状态: {p['status']}")
    print(f"  当前步骤: {p['current_step']}")
    print(f"  模板: {p.get('template_id', 'N/A')}")
    print(f"  迭代: {p.get('iteration_count', 0)}")
    print(f"  错误: {p.get('error_message', '无')}")
    print(f"  创建: {p['created_at']}")
    print(f"  更新: {p['updated_at']}")
    print('---')
