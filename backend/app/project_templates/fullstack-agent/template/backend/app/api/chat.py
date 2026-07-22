import os

from dotenv import load_dotenv
from fastapi import APIRouter

from ..schemas import ChatRequest, ChatResponse


load_dotenv()

router = APIRouter(prefix="/chat", tags=["chat"])

# 预留 OpenAI/DeepSeek 兼容接口配置；当前 MVP 只返回模拟回复。
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


@router.post("", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    message = payload.message.strip()
    if not message:
        return ChatResponse(reply="Please send a message first.")

    # TODO: 配置 API Key 后，将下面的 echo 逻辑替换为真实 LLM 调用。
    # Example shape:
    # client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)
    # response = client.chat.completions.create(
    #     model=OPENAI_MODEL,
    #     messages=[{"role": "user", "content": message}],
    # )
    # return ChatResponse(reply=response.choices[0].message.content or "")
    reply = f"Echo: {message}\n\nThis is a mock agent reply. Configure an OpenAI/DeepSeek compatible API to enable real responses."
    return ChatResponse(reply=reply)
