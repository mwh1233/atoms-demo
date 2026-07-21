export const mockPreviewHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Atoms Pomodoro</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="min-h-screen bg-zinc-950 text-zinc-50">
    <main class="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6">
      <section class="w-full rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-2xl">
        <div class="mb-8 flex items-center justify-between">
          <div>
            <p class="text-sm text-zinc-400">Focus Sprint</p>
            <h1 class="text-3xl font-semibold">番茄钟任务台</h1>
          </div>
          <span class="rounded-full bg-emerald-500/15 px-3 py-1 text-sm text-emerald-300">Ready</span>
        </div>

        <div class="grid gap-6 md:grid-cols-[1fr_0.8fr]">
          <div class="rounded-xl bg-zinc-950 p-6 text-center">
            <p id="timer" class="text-7xl font-bold tracking-tight">25:00</p>
            <p class="mt-3 text-zinc-400">保持专注，一次只推进一件事。</p>
            <div class="mt-6 flex justify-center gap-3">
              <button id="start" class="rounded-lg bg-white px-5 py-2 font-medium text-zinc-950">开始</button>
              <button id="reset" class="rounded-lg border border-zinc-700 px-5 py-2 text-zinc-200">重置</button>
            </div>
          </div>

          <div class="rounded-xl border border-zinc-800 p-5">
            <h2 class="mb-4 font-semibold">今日待办</h2>
            <div class="flex gap-2">
              <input id="todoInput" class="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-sky-400" placeholder="添加任务" />
              <button id="addTodo" class="rounded-lg bg-sky-500 px-4 py-2 font-medium text-white">添加</button>
            </div>
            <ul id="todoList" class="mt-4 space-y-2 text-sm">
              <li class="rounded-lg bg-zinc-800 px-3 py-2">整理产品需求</li>
              <li class="rounded-lg bg-zinc-800 px-3 py-2">完成首页线框</li>
            </ul>
          </div>
        </div>
      </section>
    </main>

    <script>
      let seconds = 25 * 60;
      let timerId = null;
      const timer = document.getElementById("timer");
      const start = document.getElementById("start");
      const reset = document.getElementById("reset");
      const input = document.getElementById("todoInput");
      const addTodo = document.getElementById("addTodo");
      const list = document.getElementById("todoList");

      function renderTimer() {
        const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
        const rest = String(seconds % 60).padStart(2, "0");
        timer.textContent = minutes + ":" + rest;
      }

      start.addEventListener("click", () => {
        if (timerId) return;
        start.textContent = "进行中";
        timerId = setInterval(() => {
          seconds = Math.max(0, seconds - 1);
          renderTimer();
          if (seconds === 0) {
            clearInterval(timerId);
            timerId = null;
            start.textContent = "开始";
          }
        }, 1000);
      });

      reset.addEventListener("click", () => {
        clearInterval(timerId);
        timerId = null;
        seconds = 25 * 60;
        start.textContent = "开始";
        renderTimer();
      });

      addTodo.addEventListener("click", () => {
        const value = input.value.trim();
        if (!value) return;
        const item = document.createElement("li");
        item.className = "rounded-lg bg-zinc-800 px-3 py-2";
        item.textContent = value;
        item.addEventListener("click", () => item.classList.toggle("line-through"));
        list.appendChild(item);
        input.value = "";
      });
    </script>
  </body>
</html>`;
